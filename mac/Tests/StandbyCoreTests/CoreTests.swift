import Foundation
import Testing
@testable import StandbyCore

@Suite struct PKCETests {
    @Test func challengeMatchesRFC7636AppendixB() {
        #expect(PKCE.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func verifierIsLongEnoughAndURLSafe() {
        let verifier = PKCE.makeVerifier()
        #expect(verifier.count == 43)
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        #expect(verifier.allSatisfy { allowed.contains($0) })
        #expect(PKCE.makeVerifier() != verifier)
        #expect(PKCE.makeState() != PKCE.makeState())
    }

    @Test func base64URLRoundTrips() {
        let data = Data((0..<64).map { UInt8($0 * 4 % 256) })
        #expect(PKCE.decodeBase64URL(PKCE.base64URL(data)) == data)
    }
}

@Suite struct WaitlistRankerTests {
    let now = Date(timeIntervalSince1970: 1_791_576_720)

    func entry(_ name: String, _ service: String, waitedDays: Double) -> WaitlistEntry {
        WaitlistEntry(name: name, phone: "", service: service, addedAt: now.addingTimeInterval(-waitedDays * 86_400))
    }

    @Test func serviceMatchComesFirstThenLongestWait() {
        let priya = entry("Priya Raman", "Any", waitedDays: 12)
        let sarah = entry("Sarah Chen", "Haircut", waitedDays: 9)
        let daniel = entry("Daniel Okafor", "Beard trim", waitedDays: 20)
        let mo = entry("Mo Ali", "haircut", waitedDays: 2)
        let ranked = WaitlistRanker.rank([priya, daniel, mo, sarah], for: "Haircut")
        #expect(ranked.map(\.name) == ["Sarah Chen", "Mo Ali", "Priya Raman"])
    }

    @Test func excludedPeopleAndBlankRowsAreSkipped() {
        let sarah = entry("Sarah Chen", "Haircut", waitedDays: 9)
        let priya = entry("Priya Raman", "Any", waitedDays: 3)
        let blank = entry("  ", "Any", waitedDays: 30)
        let ranked = WaitlistRanker.rank([sarah, priya, blank], for: "Haircut", excluding: [sarah.id])
        #expect(ranked.map(\.name) == ["Priya Raman"])
    }

    @Test func unknownServiceOffersEveryoneByWait() {
        let a = entry("A", "Colour", waitedDays: 1)
        let b = entry("B", "Any", waitedDays: 5)
        #expect(WaitlistRanker.rank([a, b], for: nil).map(\.name) == ["B", "A"])
    }

    @Test func sampleWaitlistOffersSarahThenPriya() {
        let ranked = WaitlistRanker.rank(SampleData.waitlist(now: now), for: "Haircut")
        #expect(ranked.map(\.name) == ["Sarah Chen", "Priya Raman"])
    }
}

@Suite struct TitleParserTests {
    @Test(arguments: [
        ("Josh · Haircut", "Josh", "Haircut"),
        ("Haircut - Josh", "Josh", "Haircut"),
        ("Haircut with Josh Patel", "Josh Patel", "Haircut"),
        ("Beard trim (Daniel)", "Daniel", "Beard trim"),
        ("Sarah Chen – Colour", "Sarah Chen", "Colour"),
        ("Tutoring: Priya", "Priya", "Tutoring"),
    ])
    func splitsPersonAndService(title: String, person: String, service: String) {
        #expect(TitleParser.parse(title) == .init(person: person, service: service))
    }

    @Test func bareTitlesAreServices() {
        #expect(TitleParser.parse("Haircut") == .init(person: nil, service: "Haircut"))
        #expect(TitleParser.parse("Haircut", attendeeName: "Josh") == .init(person: "Josh", service: "Haircut"))
        #expect(TitleParser.parse("Josh", attendeeName: "Josh Patel") == .init(person: "Josh Patel", service: nil))
    }

    @Test func servicesAreCollectedMostCommonFirst() {
        let titles = ["Michael · Haircut", "Walk-ins", "Josh · Haircut", "Ava · Colour", "Lunch", "Beard trim with Daniel", "Massage"]
        #expect(TitleParser.services(in: titles) == ["Haircut", "Colour", "Beard trim", "Massage"])
    }
}

@Suite struct StoreTests {
    func temporaryURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("standby-tests-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("state.json")
    }

    @Test func roundTripsEverything() throws {
        let url = temporaryURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = StateStore(url: url)
        #expect(store.load() == .missing)

        let now = Date(timeIntervalSince1970: 1_791_576_720)
        var state = PersistedState()
        state.mode = .sample
        state.onboardingComplete = true
        state.watchedCalendarIDs = ["a", "b"]
        state.knownCalendars = SampleData.calendars
        state.waitlist = SampleData.waitlist(now: now)
        let seen = SeenEvent(calendarID: "a", eventID: "e", title: "Josh · Haircut", start: now, end: now.addingTimeInterval(3600), status: .confirmed, attendeeName: "Josh")
        state.seen = [seen.key: seen]
        var opening = Opening(calendarID: "a", eventID: "e", title: "Josh · Haircut", start: now, end: now.addingTimeInterval(3600), service: "Haircut", personName: "Josh", reason: .cancelled, detectedAt: now)
        opening.triedEntryIDs = [state.waitlist[0].id]
        state.openings = [opening]
        state.bookings = SampleData.earlierBookings(now: now, calendar: Calendar(identifier: .gregorian))
        state.account = AccountProfile(email: "someone@example.com", name: "Some One", pictureURL: URL(string: "https://example.com/a.png"))
        state.sample = SampleSession(anchor: now, cancelled: true, createdEvents: SampleData.events(anchor: now, cancelled: false))

        try store.save(state)
        #expect(store.load() == .loaded(state))
        let text = try String(contentsOf: url, encoding: .utf8)
        #expect(text.contains("\"Sarah Chen\""))
        #expect(!text.contains("token"))
    }

    @Test func unreadableFileIsMovedAside() throws {
        let url = temporaryURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{ not json".utf8).write(to: url)
        guard case .corrupt(let movedTo?) = StateStore(url: url).load() else {
            Issue.record("expected the corrupt file to be moved aside")
            return
        }
        #expect(FileManager.default.fileExists(atPath: movedTo.path))
        #expect(!FileManager.default.fileExists(atPath: url.path))
    }
}

@Suite struct FormattingTests {
    var formatting: TimeFormatting {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return TimeFormatting(calendar: calendar, locale: Locale(identifier: "en_US"))
    }

    func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        formatting.calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    @Test func formatsRangesLikeTheApp() {
        #expect(formatting.time(date(9, 17)) == "5:00 PM")
        #expect(formatting.range(date(9, 17), date(9, 18)) == "5:00–6:00 PM")
        #expect(formatting.range(date(9, 11, 30), date(9, 12, 15)) == "11:30 AM–12:15 PM")
        #expect(formatting.slot(date(9, 17), date(9, 18), now: date(9, 16, 12)) == "Today, 5:00–6:00 PM")
        #expect(formatting.slot(date(10, 9), date(10, 9, 45), now: date(9, 16, 12)) == "Tomorrow, 9:00–9:45 AM")
        #expect(formatting.dayName(date(12, 9), now: date(9, 16)) == "Monday")
        #expect(formatting.dayName(date(20, 9), now: date(9, 16)) == "Oct 20")
        #expect(formatting.longDate(date(9, 16)) == "Friday, October 9")
    }

    @Test func twentyFourHourLocales() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Berlin")!
        let german = TimeFormatting(calendar: calendar, locale: Locale(identifier: "de_DE"))
        let start = calendar.date(from: DateComponents(year: 2026, month: 10, day: 9, hour: 17))!
        #expect(german.range(start, start.addingTimeInterval(3600)) == "17:00–18:00")
    }

    @Test func weeklyCopy() {
        #expect(Copy.filledThisWeek(0) == "No openings filled this week")
        #expect(Copy.filledThisWeek(1) == "1 opening filled this week")
        #expect(Copy.filledThisWeek(3) == "3 openings filled this week")
    }
}

@Suite struct SampleDataTests {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return calendar
    }

    func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    @Test func openingIsTheNextFreeHour() {
        #expect(SampleData.anchor(for: date(9, 16, 12), calendar: calendar) == date(9, 17))
        #expect(SampleData.anchor(for: date(9, 16, 40), calendar: calendar) == date(9, 18))
        #expect(SampleData.anchor(for: date(9, 7, 5), calendar: calendar) == date(9, 11))
        #expect(SampleData.anchor(for: date(9, 21, 30), calendar: calendar) == date(10, 11))
    }

    @Test func dayIsLaidOutAroundTheOpening() {
        let events = SampleData.events(anchor: date(9, 17), cancelled: true)
        #expect(events.map(\.title) == ["Michael · Haircut", "Walk-ins", "Josh · Haircut", "Ava · Colour", "Leo · Beard trim"])
        #expect(events[0].start == date(9, 15))
        #expect(events[2].status == .cancelled)
        #expect(events[3].start == date(9, 18, 30))
    }

    @Test func weeklyCountOnlyCountsThisModeAndWeek() {
        let now = date(9, 16, 12)   // A Friday.
        var state = PersistedState()
        state.mode = .sample
        state.bookings = SampleData.earlierBookings(now: now, calendar: calendar)
        #expect(state.bookingsThisWeek(now: now, calendar: calendar) == 2)
        state.mode = .google
        #expect(state.bookingsThisWeek(now: now, calendar: calendar) == 0)
    }

    @Test func bookingDraftReadsLikeTheBrief() {
        let now = date(9, 16, 12)
        let sarah = SampleData.waitlist(now: now)[0]
        let opening = Opening(calendarID: "c", eventID: "josh", title: "Josh · Haircut", start: date(9, 17), end: date(9, 18), service: "Haircut", personName: "Josh", reason: .cancelled, detectedAt: now)
        let draft = EventDraft.booking(for: sarah, opening: opening)
        #expect(draft.title == "Sarah · Haircut")
        #expect(draft.notes == "Booked by Standby\nSarah Chen · (416) 555-0142")
        #expect(draft.start == opening.start && draft.end == opening.end)
        #expect(draft.colorID == "7")
    }
}
