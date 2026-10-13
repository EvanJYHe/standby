import AppKit
import SwiftUI

/// The first-launch window: 520 × 620, centred, a white canvas with the title bar hidden.
@MainActor
final class OnboardingWindowController: NSWindowController, NSWindowDelegate {
    var onClose: () -> Void = {}

    init(model: AppModel) {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Theme.onboardingSize),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Welcome to Standby"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.backgroundColor = .white
        window.appearance = NSAppearance(named: .aqua)
        window.isReleasedWhenClosed = false
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true

        let host = NSHostingController(rootView: OnboardingView().environment(model))
        host.sizingOptions = []
        window.contentViewController = host
        window.setContentSize(Theme.onboardingSize)
        window.center()
        super.init(window: window)
        window.delegate = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func present() {
        NSApp.activate()
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        // macOS may decline to activate an app the user didn't click; the welcome window still comes forward.
        window?.orderFrontRegardless()
    }

    func windowWillClose(_ notification: Notification) {
        onClose()
    }
}

/// A standard preferences window: toolbar tabs (Account, Calendars, Waitlist, About), 440 wide.
@MainActor
final class SettingsWindowController: NSWindowController {
    private let tabs: SettingsTabController

    init(model: AppModel) {
        tabs = SettingsTabController()
        tabs.tabStyle = .toolbar
        for tab in SettingsTab.allCases {
            let host = NSHostingController(rootView: SettingsTabView(tab: tab).environment(model))
            host.sizingOptions = [.preferredContentSize]
            host.title = tab.title   // The tab controller shows the selected tab's title in the title bar.
            let item = NSTabViewItem(viewController: host)
            item.label = tab.title
            item.image = NSImage(systemSymbolName: tab.symbol, accessibilityDescription: tab.title)
            tabs.addTabViewItem(item)
        }

        let window = NSWindow(contentViewController: tabs)
        window.styleMask = [.titled, .closable]
        window.toolbarStyle = .preference
        window.appearance = NSAppearance(named: .aqua)
        window.isReleasedWhenClosed = false
        window.backgroundColor = .white
        super.init(window: window)
        tabs.resizeWindowToSelection(animated: false)
        window.center()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func present(tab: SettingsTab) {
        tabs.selectedTabViewItemIndex = tab.rawValue
        tabs.resizeWindowToSelection(animated: false)
        NSApp.activate()
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        window?.orderFrontRegardless()
    }
}

/// Resizes the window to each tab's content, keeping the title bar where it is.
final class SettingsTabController: NSTabViewController {
    override func tabView(_ tabView: NSTabView, didSelect tabViewItem: NSTabViewItem?) {
        super.tabView(tabView, didSelect: tabViewItem)
        resizeWindowToSelection(animated: view.window?.isVisible ?? false)
    }

    override func preferredContentSizeDidChange(for viewController: NSViewController) {
        super.preferredContentSizeDidChange(for: viewController)
        if viewController === tabViewItems[safe: selectedTabViewItemIndex]?.viewController {
            resizeWindowToSelection(animated: false)
        }
    }

    func resizeWindowToSelection(animated: Bool) {
        guard let window = view.window,
              let controller = tabViewItems[safe: selectedTabViewItemIndex]?.viewController else { return }
        var size = controller.preferredContentSize
        if size.height < 1 { size = controller.view.fittingSize }
        size.width = Theme.settingsWidth
        let frame = window.frameRect(forContentRect: NSRect(origin: .zero, size: size))
        var target = window.frame
        target.origin.y += target.height - frame.height
        target.size = frame.size
        guard target != window.frame else { return }
        window.setFrame(target, display: true, animate: animated)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
