import Foundation
import Testing
@testable import StandbyCore

@Suite struct OpeningDetectorTests {
    let calendarID = "cal"
    let now = Date(timeIntervalSince1970: 1_791_576_720)   // A fixed afternoon.
    var window: DateInterval { DateInterval(start: now.addingTimeInterval(-3600), end: now.addingTimeInterval(7 * 86_400)) }

    func event(_ id: String, _ title: String, startIn minutes: Double, length: Double = 60, status: EventStatus = .confirmed) -> CalendarEvent {
        let start = now.addingTimeInterval(minutes * 60)
        return CalendarEvent(id: id, calendarID: calendarID, title: title, start: start, end: start.addingTimeInterval(length * 60), status: status)
    }

    func sync(_ events: [CalendarEvent], after previous: [String: SeenEvent] = [:], known: Set<String> = []) -> OpeningDetector.Result {
        OpeningDetector.reconcile(calendarID: calendarID, fetched: events, window: window, previous: previous, knownOpeningIDs: known, now: now)
    }

    @Test func confirmedThenCancelledBecomesAnOpening() {
        let first = sync([event("josh", "Josh · Haircut", startIn: 48), event("ava", "Ava · Colour", startIn: 138)])
        #expect(first.newOpenings.isEmpty)
        #expect(first.seen.count == 2)

        let second = sync([event("josh", "Josh · Haircut", startIn: 48, status: .cancelled), event("ava", "Ava · Colour", startIn: 138)], after: first.seen)
        #expect(second.newOpenings.count == 1)
        let opening = try! #require(second.newOpenings.first)
        #expect(opening.eventID == "josh")
        #expect(opening.service == "Haircut")
        #expect(opening.personName == "Josh")
        #expect(opening.reason == .cancelled)
        #expect(Copy.openingDetail(opening) == "Haircut · cancelled by Josh")
        #expect(second.seen[opening.id]?.status == .cancelled)
    }

    @Test func alreadyCancelledOnFirstSightIsNotAnOpening() {
        let result = sync([event("josh", "Josh · Haircut", startIn: 48, status: .cancelled)])
        #expect(result.newOpenings.isEmpty)
    }

    @Test func aCancellationIsReportedOnce() {
        let first = sync([event("josh", "Josh · Haircut", startIn: 48)])
        let second = sync([event("josh", "Josh · Haircut", startIn: 48, status: .cancelled)], after: first.seen)
        #expect(second.newOpenings.count == 1)
        let third = sync([event("josh", "Josh · Haircut", startIn: 48, status: .cancelled)], after: second.seen)
        #expect(third.newOpenings.isEmpty)

        // Even with stale memory, an opening that already exists is not reported again.
        let replay = sync([event("josh", "Josh · Haircut", startIn: 48, status: .cancelled)], after: first.seen, known: [second.newOpenings[0].id])
        #expect(replay.newOpenings.isEmpty)
    }

    @Test func cancelledCopyWithoutDetailsUsesWhatWasSeen() {
        let first = sync([event("josh", "Josh · Haircut", startIn: 48)])
        let bare = CalendarEvent(id: "josh", calendarID: calendarID, title: "", start: nil, end: nil, status: .cancelled)
        let second = sync([bare], after: first.seen)
        let opening = try! #require(second.newOpenings.first)
        #expect(opening.title == "Josh · Haircut")
        #expect(opening.start == now.addingTimeInterval(48 * 60))
        #expect(opening.end == now.addingTimeInterval(108 * 60))
    }

    @Test func eventThatVanishesBeforeItsTimeIsAnOpening() {
        let first = sync([event("josh", "Haircut with Josh", startIn: 48), event("ava", "Ava · Colour", startIn: 138)])
        let second = sync([event("ava", "Ava · Colour", startIn: 138)], after: first.seen)
        let opening = try! #require(second.newOpenings.first)
        #expect(opening.reason == .removed)
        #expect(opening.personName == "Josh")
        #expect(second.seen[opening.id] == nil)
    }

    @Test func eventThatVanishesBecauseItsTimePassedIsNotAnOpening() {
        let first = sync([event("michael", "Michael · Haircut", startIn: -50, length: 45)])
        let second = sync([], after: first.seen)
        #expect(second.newOpenings.isEmpty)
        #expect(second.seen.isEmpty)
    }

    @Test func cancelledEventWhoseTimeHasPassedIsNotAnOpening() {
        let first = sync([event("michael", "Michael · Haircut", startIn: -30)])
        let second = sync([event("michael", "Michael · Haircut", startIn: -30, status: .cancelled)], after: first.seen)
        #expect(second.newOpenings.isEmpty)
    }

    @Test func allDayAndLongEventsAreIgnored() {
        var allDay = event("off", "Day off", startIn: 600)
        allDay.isAllDay = true
        let long = event("course", "Training course", startIn: 600, length: 5 * 60)
        let first = sync([allDay, long])
        #expect(first.seen.isEmpty)
        var allDayCancelled = allDay
        allDayCancelled.status = .cancelled
        var longCancelled = long
        longCancelled.status = .cancelled
        #expect(sync([allDayCancelled, longCancelled], after: first.seen).newOpenings.isEmpty)
        #expect(sync([], after: first.seen).newOpenings.isEmpty)
    }

    @Test func otherCalendarsAreLeftAlone() {
        let mine = sync([event("josh", "Josh · Haircut", startIn: 48)])
        var seen = mine.seen
        let other = SeenEvent(calendarID: "other", eventID: "x", title: "Lunch", start: now.addingTimeInterval(3600), end: now.addingTimeInterval(7200), status: .confirmed, attendeeName: nil)
        seen[other.key] = other
        let result = sync([event("josh", "Josh · Haircut", startIn: 48)], after: seen)
        #expect(result.newOpenings.isEmpty)
        #expect(result.seen[other.key] == other)
    }

    @Test func attendeeNameFillsInThePerson() {
        var haircut = event("x", "Haircut", startIn: 48)
        haircut.attendeeName = "Josh Patel"
        let first = sync([haircut])
        var cancelled = haircut
        cancelled.status = .cancelled
        let opening = try! #require(sync([cancelled], after: first.seen).newOpenings.first)
        #expect(opening.service == "Haircut")
        #expect(opening.personName == "Josh")
    }

    @Test func openingsCloseWhenTheirTimeComes() {
        var state = PersistedState()
        var future = Opening(calendarID: "c", eventID: "a", title: "A", start: now.addingTimeInterval(600), end: now.addingTimeInterval(4200), service: nil, personName: nil, reason: .cancelled, detectedAt: now)
        let past = Opening(calendarID: "c", eventID: "b", title: "B", start: now.addingTimeInterval(-60), end: now.addingTimeInterval(3000), service: nil, personName: nil, reason: .cancelled, detectedAt: now)
        var booked = past
        booked.id = "booked"
        booked.bookingID = UUID()
        state.openings = [future, past, booked]
        state.pruneOpenings(now: now)
        #expect(state.openings.map(\.id) == [future.id, "booked"])
        #expect(future.isOpen(at: now))
        future.dismissed = true
        #expect(!future.isOpen(at: now))
    }
}
