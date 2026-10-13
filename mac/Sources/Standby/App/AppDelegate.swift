import AppKit
import StandbyCore
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var model: AppModel!
    private var status: StatusItemController!
    private var onboarding: OnboardingWindowController?
    private var settings: SettingsWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        NSApp.appearance = NSAppearance(named: .aqua)
        Typeface.registerBundledFonts()
        installMainMenu()

        model = AppModel(config: Resources.googleClientConfig(), store: StateStore(url: StateStore.defaultURL()))
        model.onFinishOnboarding = { [weak self] in self?.onboardingFinished() }
        model.onOpenSettings = { [weak self] tab in self?.showSettings(tab: tab) }
        model.onRestartOnboarding = { [weak self] in
            self?.settings?.close()
            self?.showOnboarding()
        }

        status = StatusItemController(model: model)
        status.shouldOpen = { [weak self] in
            guard let self else { return false }
            if !model.state.onboardingComplete {
                showOnboarding()
                return false
            }
            return true
        }
        status.onOpenSettings = { [weak self] in self?.showSettings(tab: .account) }

        model.start()
        if !model.state.onboardingComplete {
            showOnboarding()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        model?.prepareForQuit()
    }

    /// Opening the app again (from Finder or Spotlight) shows the popover, since there is no Dock icon.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if model.state.onboardingComplete {
            status.open()
        } else {
            showOnboarding()
        }
        return false
    }

    // MARK: Windows

    private func showOnboarding() {
        if onboarding == nil {
            let controller = OnboardingWindowController(model: model)
            controller.onClose = { [weak self] in
                guard let self else { return }
                model.cancelSignIn()
                onboarding = nil
            }
            onboarding = controller
        }
        onboarding?.present()
    }

    private func onboardingFinished() {
        let controller = onboarding
        onboarding = nil
        controller?.onClose = {}
        controller?.close()
        // The popover opens once, so the first opening has somewhere to land.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            MainActor.assumeIsolated { self?.status.open() }
        }
    }

    @objc func showSettings(_ sender: Any? = nil) {
        showSettings(tab: .account)
    }

    @objc func showAbout(_ sender: Any? = nil) {
        showSettings(tab: .about)
    }

    private func showSettings(tab: SettingsTab) {
        status?.close()
        if settings == nil { settings = SettingsWindowController(model: model) }
        settings?.present(tab: tab)
    }

    // MARK: Menu

    /// Menu-bar apps have no visible main menu, but its key equivalents still work: ⌘Q, ⌘, and the Edit commands
    /// the waitlist's text fields need.
    private func installMainMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Standby")
        appMenu.addItem(withTitle: "About Standby", action: #selector(showAbout(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Settings…", action: #selector(showSettings(_:)), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Standby", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)

        NSApp.mainMenu = main
    }
}
