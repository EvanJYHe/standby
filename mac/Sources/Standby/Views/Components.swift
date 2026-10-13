import AppKit
import SwiftUI

// MARK: Buttons

/// The blue button. Capsule-shaped like Google's pill button so the two sit together.
struct PrimaryButtonStyle: ButtonStyle {
    var height: CGFloat = 30
    var fontSize: CGFloat = 13
    var minWidth: CGFloat? = nil

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, hoverable: true) { pressed, hovering in
            configuration.label
                .font(Typeface.geist(fontSize, .medium))
                .tracking(-0.1)
                .foregroundStyle(.white)
                .padding(.horizontal, height * 0.5)
                .frame(minWidth: minWidth)
                .frame(height: height)
                .background(Capsule().fill(pressed ? Theme.bluePressed : hovering ? Theme.blueHover : Theme.blue))
                .contentShape(Capsule())
        }
    }
}

/// White with a hairline, for the second choice next to a primary button.
struct SecondaryButtonStyle: ButtonStyle {
    var height: CGFloat = 30
    var fontSize: CGFloat = 13

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, hoverable: true) { pressed, hovering in
            configuration.label
                .font(Typeface.geist(fontSize, .medium))
                .tracking(-0.1)
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, height * 0.46)
                .frame(height: height)
                .background(Capsule().fill(pressed ? Color(rgb: 0xE9ECF1) : hovering ? Theme.surface2 : .white))
                .overlay(Capsule().strokeBorder(Theme.lineStrong, lineWidth: 1))
                .contentShape(Capsule())
        }
    }
}

/// Text only: muted, darkening on hover. For quiet choices like "Explore with sample data".
struct QuietButtonStyle: ButtonStyle {
    var fontSize: CGFloat = 13
    var color: Color = Theme.muted
    var hoverColor: Color = Theme.ink

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, hoverable: true) { pressed, hovering in
            configuration.label
                .font(Typeface.geist(fontSize, .medium))
                .foregroundStyle(hovering || pressed ? hoverColor : color)
                .contentShape(Rectangle())
        }
    }
}

/// A round icon button with a soft hover fill (the popover's gear).
struct IconButtonStyle: ButtonStyle {
    var size: CGFloat = 28

    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, hoverable: true) { pressed, hovering in
            configuration.label
                .foregroundStyle(hovering || pressed ? Theme.ink : Theme.muted)
                .frame(width: size, height: size)
                .background(Circle().fill(Color.black.opacity(pressed ? 0.09 : hovering ? 0.055 : 0)))
                .contentShape(Circle())
        }
    }
}

/// Shared hover and press tracking for the custom styles. Pure SwiftUI, so it renders offscreen too.
private struct StyledButton<Content: View>: View {
    let configuration: ButtonStyleConfiguration
    let hoverable: Bool
    @ViewBuilder let content: (_ pressed: Bool, _ hovering: Bool) -> Content
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        content(configuration.isPressed, hovering && isEnabled)
            .opacity(isEnabled ? 1 : 0.45)
            .onHover { inside in
                guard hoverable else { return }
                hovering = inside
            }
            .animation(.easeOut(duration: 0.15), value: hovering)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

// MARK: Google's button

/// Google's "Continue with Google" button, built to its sign-in branding guidelines for a custom button: white fill,
/// a 1 px #747775 stroke inside, the standard colour "G" from Google's asset bundle at 20 × 20, Google Sans Medium
/// 14/20 in #1F1F1F, 12 px before the logo, 10 px after it, 12 px after the text, pill-shaped, 40 tall.
struct GoogleSignInButton: View {
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                GoogleG()
                Text("Continue with Google")
                    .font(Typeface.googleSans(14))
                    .foregroundStyle(Color(rgb: 0x1F1F1F))
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .buttonStyle(GoogleButtonStyle())
        .accessibilityLabel("Continue with Google")
    }
}

private struct GoogleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        StyledButton(configuration: configuration, hoverable: true) { pressed, hovering in
            configuration.label
                .padding(.leading, 12)
                .padding(.trailing, 12)
                .frame(height: 40)
                .background(Capsule().fill(.white))
                // Google's state layers: #303030 at 8% on hover, 12% when pressed.
                .overlay(Capsule().fill(Color(rgb: 0x303030).opacity(pressed ? 0.12 : hovering ? 0.08 : 0)))
                .overlay(Capsule().strokeBorder(Color(rgb: 0x747775), lineWidth: 1))
                .contentShape(Capsule())
        }
    }
}

/// The standard colour Google "G", rendered from the official sign-in asset bundle (not redrawn).
struct GoogleG: View {
    var body: some View {
        if let image = GoogleAssets.g {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .frame(width: 20, height: 20)
                .accessibilityHidden(true)
        } else {
            Color.clear.frame(width: 20, height: 20)
        }
    }
}

@MainActor
enum GoogleAssets {
    static let g: NSImage? = Resources.image("google-g", subdirectory: "Google", pointSize: NSSize(width: 20, height: 20))
}

// MARK: Small pieces

/// A checkbox drawn in SwiftUI (blue when on), so it looks the same live and in renders.
struct CheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: 10) {
                configuration.label
                CheckboxBox(isOn: configuration.isOn)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? [.isSelected] : [])
    }
}

struct CheckboxBox: View {
    var isOn: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 4.5, style: .continuous)
            .fill(isOn ? Theme.blue : .white)
            .overlay(
                RoundedRectangle(cornerRadius: 4.5, style: .continuous)
                    .strokeBorder(isOn ? Color.clear : Color.black.opacity(0.24), lineWidth: 1)
            )
            .overlay {
                if isOn {
                    Image(systemName: "checkmark")
                        .font(.system(size: 9.5, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 16, height: 16)
            .animation(.easeOut(duration: 0.12), value: isOn)
    }
}

/// Three short bars at the bottom of onboarding; the current step's is blue.
struct StepIndicator: View {
    var current: Int
    var count = 3

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { index in
                Capsule()
                    .fill(index == current ? Theme.blue : Color.black.opacity(0.1))
                    .frame(width: 18, height: 3)
            }
        }
        .animation(.easeOut(duration: 0.25), value: current)
        .accessibilityElement()
        .accessibilityLabel("Step \(current + 1) of \(count)")
    }
}

/// Five bars that rise and fall while a (simulated) call rings.
struct Waveform: View {
    var color: Color = Theme.blue
    @Environment(\.isStaticRender) private var isStaticRender
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if isStaticRender || reduceMotion {
            bars(at: 0.42)
        } else {
            TimelineView(.animation) { context in
                bars(at: context.date.timeIntervalSinceReferenceDate)
            }
        }
    }

    private func bars(at time: TimeInterval) -> some View {
        HStack(spacing: 2.5) {
            ForEach(0..<5, id: \.self) { index in
                Capsule()
                    .fill(color)
                    .frame(width: 2.5, height: Self.barHeight(index: index, time: time))
            }
        }
        .frame(height: 14)
    }

    private static func barHeight(index: Int, time: TimeInterval) -> CGFloat {
        let phase: Double = time * 2 * Double.pi / 1.15 + Double(index) * 0.95
        let level: Double = 0.5 + 0.5 * sin(phase)
        return CGFloat(4 + 9 * level)
    }
}

/// A round avatar: a photo when there is one, otherwise an initial on one of Google's avatar colours.
struct InitialAvatar: View {
    var name: String
    var size: CGFloat = 32
    var imageURL: URL? = nil

    static let palette: [UInt32] = [0x1A73E8, 0xE8710A, 0x188038, 0xD01884, 0x9334E6, 0x12A4AF, 0xC5221F, 0xB06000]

    var body: some View {
        ZStack {
            Circle().fill(Color(rgb: Self.color(for: name)))
            Text(initials)
                .font(Typeface.geist(size * 0.4, .semibold))
                .foregroundStyle(.white)
            if let imageURL {
                AsyncImage(url: imageURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
                .clipShape(Circle())
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap(\.first).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? "?" : letters
    }

    /// Stable across launches (Swift's `hashValue` is not).
    static func color(for name: String) -> UInt32 {
        let hash = name.unicodeScalars.reduce(UInt32(5381)) { ($0 &* 33) &+ $1.value }
        return palette[Int(hash % UInt32(palette.count))]
    }
}

/// A 1 pt hairline in the brand's line colour.
struct Hairline: View {
    var body: some View {
        Rectangle().fill(Theme.line).frame(height: 1)
    }
}

/// Rounded white container with a hairline border, for lists.
struct ListContainer<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.lineStrong, lineWidth: 1))
    }
}

/// Scrolls when live; renders as a plain stack offscreen, where AppKit scroll views can't draw.
struct AdaptiveScroll<Content: View>: View {
    @ViewBuilder var content: Content
    @Environment(\.isStaticRender) private var isStaticRender

    var body: some View {
        if isStaticRender {
            VStack(spacing: 0) { content }
                .frame(maxHeight: .infinity, alignment: .top)
                .clipped()
        } else {
            ScrollView(.vertical) { content }
                .scrollIndicators(.automatic)
        }
    }
}
