import AppKit
import SwiftUI

/// The Standby mark: five arcs in a ring broken at the top, and a bar through the gap. In units of the ring's centre
/// radius r: stroke 0.34 r; the opening is 68° wide centred at the top; 7° splits, so each arc spans 52.8°; the bar is
/// 0.34 r wide and runs from 1.29 r above the centre to 0.06 r above it; flat ends. Its box is 2.34 r × 2.46 r, the
/// same geometry as `public/landing/v2/standby-mark.svg`.
struct StandbyMark: Shape {
    static let aspect: CGFloat = 2.34 / 2.46

    /// The width for a given height.
    static func width(forHeight height: CGFloat) -> CGFloat { height * aspect }

    func path(in rect: CGRect) -> Path {
        let r = min(rect.width / 2.34, rect.height / 2.46)
        // The box runs from 1.29 r above the ring's centre to 1.17 r below it, so the centre sits 0.06 r below the box's.
        let center = CGPoint(x: rect.midX, y: rect.midY + 0.06 * r)
        let outer = 1.17 * r
        let inner = 0.83 * r

        func point(_ radius: CGFloat, _ degreesFromTop: Double) -> CGPoint {
            let radians = degreesFromTop * .pi / 180
            return CGPoint(x: center.x + radius * sin(radians), y: center.y - radius * cos(radians))
        }

        var path = Path()
        for index in 0..<5 {
            let start = 34 + Double(index) * (52.8 + 7)
            let end = start + 52.8
            // Measured clockwise from the top; Path angles start at +x, and `clockwise: false` runs clockwise on screen.
            path.move(to: point(outer, start))
            path.addArc(center: center, radius: outer, startAngle: .degrees(start - 90), endAngle: .degrees(end - 90), clockwise: false)
            path.addLine(to: point(inner, end))
            path.addArc(center: center, radius: inner, startAngle: .degrees(end - 90), endAngle: .degrees(start - 90), clockwise: true)
            path.closeSubpath()
        }
        path.addRect(CGRect(x: center.x - 0.17 * r, y: center.y - 1.29 * r, width: 0.34 * r, height: 1.23 * r))
        return path
    }
}

extension StandbyMark {
    /// The mark at a height, in a colour.
    static func view(height: CGFloat, color: Color) -> some View {
        StandbyMark().fill(color).frame(width: width(forHeight: height), height: height)
    }
}

/// The app icon (the white mark on a blue rounded square), drawn on macOS's icon grid: the square is 824/1024 of
/// the canvas with continuous corners, and the mark is the same proportion of the square as in the brand SVG.
struct AppIconView: View {
    var size: CGFloat
    var showsShadow = true

    var body: some View {
        let body = size * 824 / 1024
        ZStack {
            RoundedRectangle(cornerRadius: body * 0.2237, style: .continuous)
                .fill(Theme.blue)
                .frame(width: body, height: body)
                .shadow(color: .black.opacity(showsShadow ? 0.18 : 0), radius: size * 0.018, y: size * 0.012)
            // In the brand SVG the mark is 2.46 × 262.564 = 645.9 of 1024 tall, centred.
            StandbyMark.view(height: body * 645.9 / 1024, color: .white)
        }
        .frame(width: size, height: size)
    }
}

/// The menu-bar icon: the mark as a template image, so macOS tints it for light and dark menu bars.
@MainActor
enum MenuBarIcon {
    static let height: CGFloat = 16

    static func image() -> NSImage {
        let size = NSSize(width: 16, height: height)
        let image = NSImage(size: size, flipped: true) { rect in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            let markRect = CGRect(x: (rect.width - StandbyMark.width(forHeight: height)) / 2, y: 0, width: StandbyMark.width(forHeight: height), height: height)
            context.addPath(StandbyMark().path(in: markRect).cgPath)
            context.setFillColor(NSColor.black.cgColor)
            context.fillPath()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Standby"
        return image
    }
}
