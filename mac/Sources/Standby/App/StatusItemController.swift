import AppKit
import Observation
import SwiftUI

/// The menu-bar icon and its popover: a borderless panel under the icon with a vibrant material background and
/// rounded corners, like a `MenuBarExtra` window. Built on `NSStatusItem` so the icon can carry a blue dot for an
/// unhandled opening and the popover can open by itself once after onboarding.
@MainActor
final class StatusItemController: NSObject {
    private let model: AppModel
    private let statusItem: NSStatusItem
    private let panel: PopoverPanel
    private let dot = NSView()
    private var monitors: [Any] = []

    /// Asked before opening; return false to show something else (onboarding) instead.
    var shouldOpen: () -> Bool = { true }
    var onOpenSettings: () -> Void = {}

    init(model: AppModel) {
        self.model = model
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        panel = PopoverPanel(size: Theme.popoverSize, radius: Theme.popoverRadius)
        super.init()

        if let button = statusItem.button {
            button.image = MenuBarIcon.image()
            button.imagePosition = .imageOnly
            button.target = self
            button.action = #selector(statusItemClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.setAccessibilityLabel("Standby")

            dot.wantsLayer = true
            dot.layer?.backgroundColor = NSColor(red: 0x08 / 255, green: 0x67 / 255, blue: 0xF5 / 255, alpha: 1).cgColor
            dot.layer?.cornerRadius = 3
            dot.isHidden = true
            button.addSubview(dot)
        }

        let host = NSHostingView(rootView: PopoverView().environment(model))
        host.translatesAutoresizingMaskIntoConstraints = true
        panel.setContent(host)
        panel.onClose = { [weak self] in self?.close() }

        observeOpenings()
        observeAppearance()

        // Another app coming forward (Cmd-Tab, or the browser opening Google Calendar) closes the popover too.
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            let activated = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            guard activated?.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
            MainActor.assumeIsolated { self?.close() }
        }
    }

    var isOpen: Bool { panel.isVisible }

    @objc private func statusItemClicked(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showContextMenu()
        } else {
            toggle()
        }
    }

    func toggle() {
        isOpen ? close() : open()
    }

    func open() {
        guard !isOpen else { return }
        guard shouldOpen() else { return }
        guard let button = statusItem.button, let buttonWindow = button.window else { return }

        // Centred under the icon, a few points below the menu bar, kept on screen.
        let anchor = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
        let visible = (buttonWindow.screen ?? NSScreen.main)?.visibleFrame ?? .zero
        let size = Theme.popoverSize
        let x = min(max(anchor.midX - size.width / 2, visible.minX + 8), visible.maxX - size.width - 8)
        let y = min(anchor.minY, visible.maxY) - size.height - 6
        panel.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: true)

        model.popoverOpened()
        button.highlight(true)
        panel.alphaValue = 0
        panel.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.12
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = 1
        }
        panel.invalidateShadow()
        installMonitors()
    }

    func close() {
        guard isOpen else { return }
        removeMonitors()
        statusItem.button?.highlight(false)
        panel.orderOut(nil)
    }

    // MARK: Private

    private func installMonitors() {
        removeMonitors()
        // Clicks in other apps close the popover, as a menu would.
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.close() }
        }) {
            monitors.append(global)
        }
        // So do clicks in Standby's other windows (but not on the menu-bar icon, which toggles).
        if let local = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] event in
            let window = event.window
            MainActor.assumeIsolated {
                guard let self, window !== self.panel, window !== self.statusItem.button?.window else { return }
                self.close()
            }
            return event
        }) {
            monitors.append(local)
        }
    }

    private func removeMonitors() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
    }

    private func showContextMenu() {
        close()
        let menu = NSMenu()
        let settings = NSMenuItem(title: "Settings…", action: #selector(openSettingsFromMenu), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Standby", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func openSettingsFromMenu() {
        onOpenSettings()
    }

    /// Shows the dot whenever there is an opening nobody has handled.
    private func observeOpenings() {
        withObservationTracking {
            updateDot(visible: model.hasUnhandledOpening)
        } onChange: { [weak self] in
            Task { @MainActor in self?.observeOpenings() }
        }
    }

    private func updateDot(visible: Bool) {
        guard let button = statusItem.button else { return }
        let size: CGFloat = 6
        let markWidth = StandbyMark.width(forHeight: MenuBarIcon.height)
        let bounds = button.bounds
        // At the mark's top right corner, just off the ring.
        let x = bounds.midX + markWidth / 2 - size / 2 + 1.5
        let y = button.isFlipped ? (bounds.midY - MenuBarIcon.height / 2 - 1.5) : (bounds.midY + MenuBarIcon.height / 2 - size + 1.5)
        dot.frame = NSRect(x: x, y: y, width: size, height: size)
        dot.isHidden = !visible
        let count = model.state.openings.filter { $0.isOpen(at: model.now) }.count
        button.setAccessibilityLabel(visible ? "Standby, \(count) new opening\(count == 1 ? "" : "s")" : "Standby")
    }

    private func observeAppearance() {
        NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: statusItem.button, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.updateDot(visible: self.model.hasUnhandledOpening)
            }
        }
    }
}

/// A borderless, non-activating panel that can still take keyboard focus, with a rounded vibrant background.
final class PopoverPanel: NSPanel {
    var onClose: () -> Void = {}
    private let effect = NSVisualEffectView()

    init(size: CGSize, radius: CGFloat) {
        super.init(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        level = .popUpMenu
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        hidesOnDeactivate = false
        isMovable = false
        isReleasedWhenClosed = false
        animationBehavior = .none
        collectionBehavior = [.canJoinAllSpaces, .transient, .ignoresCycle, .fullScreenAuxiliary]
        appearance = NSAppearance(named: .aqua)

        effect.material = .popover
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.maskImage = Self.roundedMask(radius: radius)
        effect.frame = NSRect(origin: .zero, size: size)
        effect.autoresizingMask = [.width, .height]
        contentView = effect
    }

    func setContent(_ view: NSView) {
        // A white wash over the material keeps it frosted but close to the brand's white, whatever is behind it.
        let wash = NSView(frame: effect.bounds)
        wash.wantsLayer = true
        wash.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.55).cgColor
        wash.autoresizingMask = [.width, .height]
        effect.addSubview(wash)

        view.frame = effect.bounds
        view.autoresizingMask = [.width, .height]
        effect.addSubview(view)

        // A hairline edge, like the system's menus and panels.
        let border = BorderView(frame: effect.bounds, radius: Theme.popoverRadius)
        border.autoresizingMask = [.width, .height]
        effect.addSubview(border)
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) {
        onClose()
    }

    override func resignKey() {
        super.resignKey()
        onClose()
    }

    /// A stretchable rounded-rect mask for the material (and so for the window's shadow).
    static func roundedMask(radius: CGFloat) -> NSImage {
        let edge = radius * 2 + 1
        let image = NSImage(size: NSSize(width: edge, height: edge), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
            return true
        }
        image.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius)
        image.resizingMode = .stretch
        return image
    }
}

private final class BorderView: NSView {
    private let radius: CGFloat

    init(frame: NSRect, radius: CGFloat) {
        self.radius = radius
        super.init(frame: frame)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.25, dy: 0.25), xRadius: radius, yRadius: radius)
        path.lineWidth = 0.5
        NSColor.black.withAlphaComponent(0.14).setStroke()
        path.stroke()
    }
}
