import SwiftUI

/// The landing page's palette, plus Google's real-world colours where the UI depicts Google things.
enum Theme {
    static let blue = Color(rgb: 0x0867F5)
    static let blueHover = Color(rgb: 0x0657D4)
    static let bluePressed = Color(rgb: 0x054CBD)
    static let ink = Color(rgb: 0x0B1220)
    static let ink2 = Color(rgb: 0x3A4352)
    static let muted = Color(rgb: 0x6B7380)
    static let line = Color(rgb: 0x0B1220).opacity(0.08)
    static let lineStrong = Color(rgb: 0x0B1220).opacity(0.14)
    static let surface2 = Color(rgb: 0xF4F6F9)
    static let markGrey = Color(rgb: 0xD3D8DF)

    /// Status and confirmation green (Google's), the paused grey, and Google Calendar's now-line red.
    static let green = Color(rgb: 0x1E8E3E)
    static let greenDot = Color(rgb: 0x34A853)
    static let pausedDot = Color(rgb: 0xA0A6AE)
    static let nowRed = Color(rgb: 0xEA4335)

    /// What the popover's material looks like over a light desktop, for offscreen renders where materials can't draw.
    static let popoverStaticFill = Color(rgb: 0xF3F4F6)

    static let cardRadius: CGFloat = 14
    static let popoverRadius: CGFloat = 16
    static let popoverSize = CGSize(width: 380, height: 560)
    static let onboardingSize = CGSize(width: 520, height: 620)
    static let settingsWidth: CGFloat = 440
}

extension Color {
    init(rgb: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255,
            opacity: opacity
        )
    }

    /// `#rrggbb` from Google's API; anything unreadable falls back to Peacock.
    init(hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        self.init(rgb: digits.count == 6 ? UInt32(digits, radix: 16) ?? 0x039BE5 : 0x039BE5)
    }
}

/// Set while rendering offscreen with `ImageRenderer`, which cannot draw AppKit-backed views (scroll views, text
/// fields, menus) or materials. Views swap in plain SwiftUI equivalents that look the same.
private struct StaticRenderKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var isStaticRender: Bool {
        get { self[StaticRenderKey.self] }
        set { self[StaticRenderKey.self] = newValue }
    }
}
