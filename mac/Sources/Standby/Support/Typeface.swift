import AppKit
import CoreText
import SwiftUI

/// Geist for the interface, Instrument Serif for each onboarding headline, Google Sans Medium for Google's button.
/// All three are bundled under the SIL Open Font License and registered for this process at launch.
@MainActor
enum Typeface {
    enum Weight: CGFloat {
        case regular = 400
        case medium = 500
        case semibold = 600

        var instanceName: String {
            switch self {
            case .regular: "Geist-Regular"
            case .medium: "Geist-Medium"
            case .semibold: "Geist-SemiBold"
            }
        }
    }

    private static var registered = false
    private static var cache: [String: Font] = [:]

    static func registerBundledFonts() {
        guard !registered else { return }
        registered = true
        for file in ["Geist[wght].ttf", "InstrumentSerif-Regular.ttf", "GoogleSans-Medium.ttf"] {
            guard let url = Resources.url(file, subdirectory: "Fonts") else {
                NSLog("Standby: missing bundled font %@", file)
                continue
            }
            var error: Unmanaged<CFError>?
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
                NSLog("Standby: could not register %@", file)
            }
        }
    }

    /// Geist at a weight; `tabular` lines digits up for times.
    static func geist(_ size: CGFloat, _ weight: Weight = .regular, tabular: Bool = false) -> Font {
        let key = "geist-\(size)-\(weight.rawValue)-\(tabular)"
        if let font = cache[key] { return font }
        let font = Font(nsGeist(size, weight, tabular: tabular))
        cache[key] = font
        return font
    }

    static func nsGeist(_ size: CGFloat, _ weight: Weight = .regular, tabular: Bool = false) -> NSFont {
        var base = NSFont(name: weight.instanceName, size: size)
        if base == nil, let regular = NSFont(name: "Geist-Regular", size: size) {
            // Fall back to setting the variable font's weight axis directly.
            let wght = NSNumber(value: 0x7767_6874)   // 'wght'
            let descriptor = regular.fontDescriptor.addingAttributes([
                NSFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [wght: weight.rawValue],
            ])
            base = NSFont(descriptor: descriptor, size: size)
        }
        guard var font = base else { return .systemFont(ofSize: size, weight: weight.systemWeight) }
        if tabular {
            let descriptor = font.fontDescriptor.addingAttributes([
                .featureSettings: [[
                    NSFontDescriptor.FeatureKey.typeIdentifier: kNumberSpacingType,
                    NSFontDescriptor.FeatureKey.selectorIdentifier: kMonospacedNumbersSelector,
                ]],
            ])
            font = NSFont(descriptor: descriptor, size: size) ?? font
        }
        return font
    }

    static func serif(_ size: CGFloat) -> Font {
        let key = "serif-\(size)"
        if let font = cache[key] { return font }
        let font = NSFont(name: "InstrumentSerif-Regular", size: size).map { Font($0) } ?? .system(size: size, design: .serif)
        cache[key] = font
        return font
    }

    /// Google's sign-in branding asks for Google Sans Medium 14/20 on its button.
    static func googleSans(_ size: CGFloat) -> Font {
        let key = "gsans-\(size)"
        if let font = cache[key] { return font }
        let font = NSFont(name: "GoogleSans-Medium", size: size).map { Font($0) } ?? .system(size: size, weight: .medium)
        cache[key] = font
        return font
    }
}

private extension Typeface.Weight {
    var systemWeight: NSFont.Weight {
        switch self {
        case .regular: .regular
        case .medium: .medium
        case .semibold: .semibold
        }
    }
}
