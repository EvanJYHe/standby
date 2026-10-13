import AppKit
import StandbyCore
import SwiftUI
import UniformTypeIdentifiers

/// `--render-screenshots <dir>`: renders the key views with sample data, offscreen with `ImageRenderer` at 2×, as
/// transparent PNGs for the landing page. The clock is fixed at Friday 4:12 PM so every render tells the same story.
@MainActor
enum ScreenshotRenderer {
    /// Transparent margin around each render (points), so the soft shadow isn't cut off.
    static let popoverMargin: CGFloat = 60
    static let windowMargin: CGFloat = 72

    enum Scenario {
        case connect, calendars, opening, booked, today, about
        // Review-only states (`--render-review`), for layouts that need a Google client to reach live.
        case noClient, waitlist, calling, reconnect, googleAccount
    }

    /// `--render-review <dir>`: extra states for checking layouts, not for the website.
    static func runReview(outputDirectory: String) -> Int32 {
        NSApplication.shared.appearance = NSAppearance(named: .aqua)
        Typeface.registerBundledFonts()
        let directory = URL(fileURLWithPath: outputDirectory, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try render(WindowShot(size: Theme.onboardingSize) { OnboardingView() }, .noClient, "review-onboarding-no-client.png", in: directory)
            try render(WindowShot(size: Theme.onboardingSize) { OnboardingView() }, .waitlist, "review-onboarding-waitlist.png", in: directory)
            try render(PopoverShot(), .calling, "review-popover-calling.png", in: directory)
            try render(PopoverShot(), .reconnect, "review-popover-reconnect.png", in: directory)
            try render(SettingsShot(tab: .account) { SettingsTabView(tab: .account) }, .googleAccount, "review-settings-account-google.png", in: directory)
            try render(SettingsShot(tab: .account) { SettingsTabView(tab: .account) }, .calendars, "review-settings-account-sample.png", in: directory)
            return 0
        } catch {
            FileHandle.standardError.write(Data("Standby: review rendering failed: \(error)\n".utf8))
            return 1
        }
    }

    static func run(outputDirectory: String) -> Int32 {
        NSApplication.shared.appearance = NSAppearance(named: .aqua)
        Typeface.registerBundledFonts()
        let directory = URL(fileURLWithPath: outputDirectory, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try render(WindowShot(size: Theme.onboardingSize) { OnboardingView() }, .connect, "onboarding-connect.png", in: directory)
            try render(WindowShot(size: Theme.onboardingSize) { OnboardingView() }, .calendars, "onboarding-calendars.png", in: directory)
            try render(PopoverShot(), .opening, "popover-openings.png", in: directory)
            try render(PopoverShot(), .booked, "popover-booked.png", in: directory)
            try render(PopoverShot(), .today, "popover-today.png", in: directory)
            try render(SettingsShot(tab: .about) { AboutSettings() }, .about, "settings-about.png", in: directory)
            return 0
        } catch {
            FileHandle.standardError.write(Data("Standby: screenshot rendering failed: \(error)\n".utf8))
            return 1
        }
    }

    private static func render<V: View>(_ view: V, _ scenario: Scenario, _ name: String, in directory: URL) throws {
        let model = makeModel(scenario)
        let content = view
            .environment(model)
            .environment(\.isStaticRender, true)
            .environment(\.colorScheme, .light)
            .environment(\.locale, model.locale)
            .environment(\.timeZone, model.calendar.timeZone)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        renderer.isOpaque = false
        guard let image = renderer.cgImage else { throw RenderError.noImage(name) }
        try writePNG(image, to: directory.appendingPathComponent(name), scale: 2)
        print("\(name)  \(image.width)×\(image.height)")
    }

    enum RenderError: Error {
        case noImage(String)
        case write(String)
    }

    static func writePNG(_ image: CGImage, to url: URL, scale: CGFloat) throws {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw RenderError.write(url.lastPathComponent)
        }
        let dpi = 72 * scale
        CGImageDestinationAddImage(destination, image, [kCGImagePropertyDPIWidth: dpi, kCGImagePropertyDPIHeight: dpi] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw RenderError.write(url.lastPathComponent) }
    }

    /// Friday, October 9, 2026, 4:12 PM in Toronto; Josh's 5:00 haircut is the opening.
    static func makeModel(_ scenario: Scenario) -> AppModel {
        let locale = Locale(identifier: "en_US")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        calendar.locale = locale
        let now = calendar.date(from: DateComponents(year: 2026, month: 10, day: 9, hour: 16, minute: 12))!
        let anchor = SampleData.anchor(for: now, calendar: calendar)

        var state = PersistedState()
        state.mode = .sample
        state.knownCalendars = SampleData.calendars
        state.watchedCalendarIDs = [SampleData.appointmentsCalendarID]
        state.waitlist = SampleData.waitlist(now: now)
        state.bookings = SampleData.earlierBookings(now: now, calendar: calendar)

        let joshCancelled = [.opening, .booked, .calling].contains(scenario)
        var session = SampleSession(anchor: anchor, cancelled: joshCancelled)
        let events = SampleData.events(anchor: anchor, cancelled: joshCancelled)
        for event in events {
            guard let start = event.start, let end = event.end else { continue }
            state.seen[event.key] = SeenEvent(calendarID: event.calendarID, eventID: event.id, title: event.title, start: start, end: end, status: event.status, attendeeName: nil)
        }

        var offer: (OfferState, String)?
        if joshCancelled, let josh = events.first(where: { $0.id == "sample-josh" }), let start = josh.start, let end = josh.end {
            var opening = Opening(
                calendarID: josh.calendarID,
                eventID: josh.id,
                title: josh.title,
                start: start,
                end: end,
                service: "Haircut",
                personName: "Josh",
                reason: .cancelled,
                detectedAt: now.addingTimeInterval(-90)
            )
            let sarah = state.waitlist[0]
            if scenario == .booked {
                let created = CalendarEvent(
                    id: "sample-booking-sarah",
                    calendarID: josh.calendarID,
                    title: "Sarah · Haircut",
                    start: start,
                    end: end,
                    colorHex: GoogleColors.peacock,
                    bookedByStandby: true
                )
                let booking = Booking(
                    openingID: opening.id,
                    calendarID: josh.calendarID,
                    eventID: created.id,
                    personName: sarah.name,
                    phone: sarah.phone,
                    service: "Haircut",
                    start: start,
                    end: end,
                    bookedAt: now,
                    isSample: true
                )
                opening.bookingID = booking.id
                state.bookings.append(booking)
                state.waitlist.removeFirst()
                session.createdEvents = [created]
            } else {
                offer = (scenario == .calling ? .calling(sarah.id) : .accepted(sarah.id), opening.id)
            }
            state.openings = [opening]
        }
        state.sample = session
        let renderedEvents = events + session.createdEvents

        switch scenario {
        case .connect, .noClient:
            state.mode = nil
            state.onboardingComplete = false
        case .calendars, .waitlist:
            state.onboardingComplete = false
        default:
            // The landing page shows Standby as it looks once Google is connected (no "Sample data" strip), with
            // the same example day and people.
            state.onboardingComplete = true
            state.mode = .google
            state.account = AccountProfile(email: "frontdesk@example.com", name: "Front desk", pictureURL: nil)
            state.bookings = state.bookings.map { booking in
                var booking = booking
                booking.isSample = false
                return booking
            }
            state.sample = nil
        }

        let model = AppModel(config: .empty, store: nil, clock: { now }, calendar: calendar, locale: locale, initialState: state, isStatic: true)
        model.setEventsForPreview(renderedEvents)
        if let (offerState, openingID) = offer { model.setOfferForPreview(offerState, openingID: openingID) }
        switch scenario {
        case .connect: model.onboardingStep = .connect
        case .noClient:
            model.onboardingStep = .connect
            model.applyPreview(signIn: .notConfigured)
        case .calendars: model.onboardingStep = .calendars
        case .waitlist: model.onboardingStep = .waitlist
        case .reconnect: model.applyPreview(needsReconnect: true)
        case .googleAccount: model.applyPreview(lastSync: now.addingTimeInterval(-40))
        default: break
        }
        return model
    }
}

// MARK: Frames for the renders

/// The popover as it floats under the menu bar: material stand-in, rounded corners, hairline edge, soft shadow.
private struct PopoverShot: View {
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.popoverRadius, style: .continuous)
        PopoverView()
            .background(Theme.popoverStaticFill)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.black.opacity(0.13), lineWidth: 0.5))
            .background(
                shape
                    .fill(Theme.popoverStaticFill)
                    .shadow(color: .black.opacity(0.10), radius: 2, y: 1)
                    .shadow(color: .black.opacity(0.18), radius: 28, y: 14)
            )
            .padding(ScreenshotRenderer.popoverMargin)
    }
}

/// A window with its title bar hidden: rounded corners, the close button, a hairline edge and the window shadow.
private struct WindowShot<Content: View>: View {
    let size: CGSize
    @ViewBuilder var content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: WindowChrome.radius, style: .continuous)
        content
            .frame(width: size.width, height: size.height)
            .overlay(alignment: .topLeading) {
                WindowChrome.TrafficLights(enabled: [true, false, false], hidden: [false, true, true])
                    .padding(.leading, WindowChrome.lightsInset.width)
                    .padding(.top, WindowChrome.lightsInset.height)
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.black.opacity(0.16), lineWidth: 0.5))
            .background(
                shape
                    .fill(.white)
                    .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
                    .shadow(color: .black.opacity(0.22), radius: 34, y: 20)
            )
            .padding(ScreenshotRenderer.windowMargin)
    }
}

/// The standard Settings window: title, toolbar tabs with the current one highlighted, then the tab's content.
private struct SettingsShot<Content: View>: View {
    let tab: SettingsTab
    @ViewBuilder var content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: WindowChrome.settingsRadius, style: .continuous)
        VStack(spacing: 0) {
            WindowChrome.SettingsToolbar(selected: tab)
            content
                .frame(width: Theme.settingsWidth)
                .background(Color.white)
        }
        .frame(width: Theme.settingsWidth)
        .background(Color.white)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Color.black.opacity(0.16), lineWidth: 0.5))
        .background(
            shape
                .fill(.white)
                .shadow(color: .black.opacity(0.12), radius: 3, y: 1)
                .shadow(color: .black.opacity(0.22), radius: 34, y: 20)
        )
        .padding(ScreenshotRenderer.windowMargin)
    }
}

/// Replicas of macOS window chrome, measured against this app's real windows, for the offscreen renders only.
enum WindowChrome {
    static let radius: CGFloat = 17
    static let settingsRadius: CGFloat = 17
    static let lightsInset = CGSize(width: 9, height: 9)

    struct TrafficLights: View {
        var enabled: [Bool]
        var hidden: [Bool]
        static let colors: [UInt32] = [0xFF5F57, 0xFEBC2E, 0x28C840]

        var body: some View {
            HStack(spacing: 9) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(enabled[index] ? Color(rgb: Self.colors[index]) : Color(rgb: 0xDDDDDD))
                        .overlay(Circle().strokeBorder(Color.black.opacity(0.12), lineWidth: 0.5))
                        .frame(width: 14, height: 14)
                        .opacity(hidden[index] ? 0 : 1)
                }
            }
        }
    }

    /// macOS 26's preference toolbar, as measured from Standby's real Settings window: white, the title centred on
    /// the traffic lights' line, 47-pt tab cells (icon over label) starting 32 pt down, a hairline at 87 pt.
    struct SettingsToolbar: View {
        var selected: SettingsTab

        var body: some View {
            ZStack(alignment: .top) {
                Color.white
                Text(selected.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.black.opacity(0.85))
                    .frame(height: 31)
                HStack {
                    TrafficLights(enabled: [true, false, false], hidden: [false, false, false])
                    Spacer()
                }
                .padding(.leading, lightsInset.width)
                .padding(.top, lightsInset.height)
                HStack(spacing: 1) {
                    ForEach(SettingsTab.allCases, id: \.self) { tab in
                        VStack(spacing: 1) {
                            Image(systemName: tab.symbol)
                                .font(.system(size: 17, weight: .regular))
                                .frame(height: 24)
                            Text(tab.title)
                                .font(.system(size: 11))
                                .frame(height: 14)
                        }
                        .padding(.top, 4)
                        .frame(width: tab == .calendars ? 65 : 55, height: 47, alignment: .top)
                        // The selected tab takes the system accent colour (blue by default) in an active window.
                        .foregroundStyle(tab == selected ? Color(rgb: 0x007AFF) : Color.black.opacity(0.62))
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(Color.black.opacity(tab == selected ? 0.045 : 0))
                        )
                    }
                }
                .padding(.top, 32)
            }
            .frame(height: 87)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .bottom) { Rectangle().fill(Color.black.opacity(0.1)).frame(height: 0.5) }
        }
    }
}

// MARK: Icon

/// `--render-icon <dir>`: writes `AppIcon.iconset` PNGs (16–1024 at 1× and 2×) from the same drawing as the app.
@MainActor
enum IconRenderer {
    static func run(outputDirectory: String) -> Int32 {
        let directory = URL(fileURLWithPath: outputDirectory, isDirectory: true)
        let sizes: [(name: String, pixels: Int)] = [
            ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
            ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
            ("icon_512x512", 512), ("icon_512x512@2x", 1024),
        ]
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            for (name, pixels) in sizes {
                let renderer = ImageRenderer(content: AppIconView(size: CGFloat(pixels)))
                renderer.scale = 1
                renderer.isOpaque = false
                guard let image = renderer.cgImage else { throw ScreenshotRenderer.RenderError.noImage(name) }
                try ScreenshotRenderer.writePNG(image, to: directory.appendingPathComponent("\(name).png"), scale: name.hasSuffix("@2x") ? 2 : 1)
            }
            return 0
        } catch {
            FileHandle.standardError.write(Data("Standby: icon rendering failed: \(error)\n".utf8))
            return 1
        }
    }
}
