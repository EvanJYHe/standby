import AppKit
import StandbyCore

/// `Standby --self-test`: exercises the app's own code paths that unit tests can't reach, without the network or a
/// Google client: the OAuth loopback server (over real HTTP on 127.0.0.1), the Keychain, and the sample-mode flow
/// end to end through `AppModel` (cancellation → opening → simulated call → booking). Prints one line per check.
@MainActor
enum SelfTest {
    private static var failures = 0

    static func run() async -> Int32 {
        print("Standby self-test")
        check("PKCE matches RFC 7636", PKCE.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        await loopback()
        keychain()
        await sampleFlow()
        print(failures == 0 ? "All checks passed." : "\(failures) check(s) failed.")
        return failures == 0 ? 0 : 1
    }

    private static func check(_ name: String, _ passed: Bool) {
        print("\(passed ? "✓" : "✗") \(name)")
        if !passed { failures += 1 }
    }

    // MARK: Loopback

    private static func loopback() async {
        let server = LoopbackServer()
        guard let port = try? await server.start() else {
            check("loopback server listens on 127.0.0.1", false)
            return
        }
        check("loopback server listens on 127.0.0.1 (port \(port))", port > 0)

        let session = URLSession(configuration: .ephemeral)
        let favicon = try? await session.data(from: URL(string: "http://127.0.0.1:\(port)/favicon.ico")!)
        check("ignores the browser's favicon request", (favicon?.1 as? HTTPURLResponse)?.statusCode == 404)

        async let redirect = server.waitForRedirect(timeout: 10)
        async let browser = session.data(from: URL(string: "http://127.0.0.1:\(port)/?state=abc&code=4%2F0AbC&scope=email")!)
        let query = try? await redirect
        check("hands the redirect's code and state to the sign-in", query?["code"] == "4/0AbC" && query?["state"] == "abc")
        server.finish(.connected)
        let page = try? await browser
        let html = page.map { String(decoding: $0.0, as: UTF8.self) } ?? ""
        check("answers the browser with the connected page", (page?.1 as? HTTPURLResponse)?.statusCode == 200 && html.contains("You’re connected.") && html.contains("Instrument Serif"))
    }

    // MARK: Keychain

    private static func keychain() {
        let account = "self-test-\(UUID().uuidString)"
        let secret = Data("not-a-real-token".utf8)
        do {
            try Keychain.save(secret, account: account)
            try Keychain.save(secret + Data("-2".utf8), account: account)
            let loaded = Keychain.load(account: account)
            Keychain.delete(account: account)
            check("Keychain saves, updates, reads and deletes", loaded == secret + Data("-2".utf8) && Keychain.load(account: account) == nil)
        } catch {
            Keychain.delete(account: account)
            check("Keychain saves, updates, reads and deletes (\(error))", false)
        }
    }

    // MARK: Sample flow

    private static func sampleFlow() async {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("standby-self-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = StateStore(url: directory.appendingPathComponent("state.json"))
        let model = AppModel(config: .empty, store: store)

        model.signInWithGoogle()
        check("without a Google client, sign-in explains instead of pretending", model.signInState == .notConfigured)

        model.chooseSampleData()
        check("sample data picks the Appointments calendar", model.state.watchedCalendarIDs == [SampleData.appointmentsCalendarID] && model.onboardingStep == .calendars)
        model.finishCalendarsStep()
        check("the waitlist starts with the three example people", model.state.waitlist.map(\.name) == ["Sarah Chen", "Daniel Okafor", "Priya Raman"])
        model.finishOnboarding()
        check("watching starts after onboarding", model.state.onboardingComplete)

        let opened = await waitUntil(seconds: 8) { model.hasUnhandledOpening }
        let opening = model.visibleOpenings.first
        check("Josh's cancellation becomes an opening", opened && opening?.personName == "Josh" && opening?.service == "Haircut")
        guard let opening else { return }

        model.offer(opening.id)
        let sarah = model.state.waitlist.first { $0.name == "Sarah Chen" }
        check("the offer calls Sarah first", model.offers[opening.id] == .calling(sarah?.id ?? UUID()))
        let accepted = await waitUntil(seconds: 6) { model.offers[opening.id] == .accepted(sarah?.id ?? UUID()) }
        check("the simulated call comes back yes", accepted)

        let before = model.filledThisWeek
        model.book(opening.id)
        let booked = await waitUntil(seconds: 4) { model.booking(for: model.state.openings.first { $0.id == opening.id } ?? opening) != nil }
        check("booking writes Sarah into the sample calendar", booked && model.events.contains { $0.title == "Sarah · Haircut" && $0.bookedByStandby })
        check("the week's count goes up by one", model.filledThisWeek == before + 1)
        check("Sarah leaves the waitlist", !model.state.waitlist.contains { $0.name == "Sarah Chen" })
        check("the menu-bar dot clears", !model.hasUnhandledOpening)

        model.prepareForQuit()
        if case .loaded(let saved) = store.load() {
            check("state is saved as JSON", saved.bookings.count == model.state.bookings.count && saved.openings.first?.bookingID != nil)
        } else {
            check("state is saved as JSON", false)
        }
    }

    private static func waitUntil(seconds: Double, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return condition()
    }
}
