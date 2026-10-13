import AppKit

// `Standby --render-screenshots <dir>` writes the landing page's PNGs and exits.
// `Standby --render-icon <dir>` writes the app icon's .iconset PNGs and exits.
// `Standby --self-test` checks the loopback OAuth server, the Keychain and the sample flow, then exits.
let arguments = CommandLine.arguments

func argument(after flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag) else { return nil }
    return index + 1 < arguments.count ? arguments[index + 1] : FileManager.default.currentDirectoryPath
}

MainActor.assumeIsolated {
    if let directory = argument(after: "--render-screenshots") {
        exit(ScreenshotRenderer.run(outputDirectory: directory))
    }
    if let directory = argument(after: "--render-review") {
        exit(ScreenshotRenderer.runReview(outputDirectory: directory))
    }
    if let directory = argument(after: "--render-icon") {
        exit(IconRenderer.run(outputDirectory: directory))
    }
    if arguments.contains("--self-test") {
        NSApplication.shared.setActivationPolicy(.prohibited)
        Typeface.registerBundledFonts()
        Task { @MainActor in exit(await SelfTest.run()) }
        RunLoop.main.run()
    }

    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
}
