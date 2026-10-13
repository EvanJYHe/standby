import Foundation

/// Turns two snapshots of a calendar into openings. An event becomes an opening when Standby saw it confirmed and
/// it is now `cancelled`, or when it disappears from the watched window before its time has come.
public enum OpeningDetector {
    /// Longer events (a day off, a conference) are not appointments anyone can take.
    public static let maxDuration: TimeInterval = 4 * 60 * 60
    /// How long to remember events after they end.
    public static let memory: TimeInterval = 2 * 24 * 60 * 60

    public struct Result: Sendable {
        /// Every remembered event, across all calendars, after this sync.
        public var seen: [String: SeenEvent]
        public var newOpenings: [Opening]
    }

    /// Whether Standby treats an event as an appointment at all.
    public static func isAppointment(start: Date, end: Date, isAllDay: Bool) -> Bool {
        !isAllDay && end > start && end.timeIntervalSince(start) <= maxDuration
    }

    /// Reconciles one calendar's freshly fetched events (every page, fetched with `showDeleted=true`) against what was
    /// seen before. Call it only after a successful fetch: a failed one must not look like everything vanished.
    ///
    /// - Parameters:
    ///   - window: the time range that was fetched; only events that should have come back can "vanish".
    ///   - knownOpeningIDs: openings that already exist, so a cancellation is reported once.
    public static func reconcile(
        calendarID: String,
        fetched: [CalendarEvent],
        window: DateInterval,
        previous: [String: SeenEvent],
        knownOpeningIDs: Set<String>,
        now: Date
    ) -> Result {
        var seen = previous
        var openings: [Opening] = []
        var reported = knownOpeningIDs
        var returnedKeys = Set<String>()

        func report(_ before: SeenEvent, reason: Opening.Reason) {
            guard before.status != .cancelled, before.start > now, !reported.contains(before.key) else { return }
            let parsed = TitleParser.parse(before.title, attendeeName: before.attendeeName)
            openings.append(
                Opening(
                    calendarID: before.calendarID,
                    eventID: before.eventID,
                    title: before.title,
                    start: before.start,
                    end: before.end,
                    service: parsed.service,
                    personName: parsed.person.map(TitleParser.firstName),
                    reason: reason,
                    detectedAt: now
                )
            )
            reported.insert(before.key)
        }

        for event in fetched where event.calendarID == calendarID {
            let key = event.key
            returnedKeys.insert(key)
            let before = previous[key]

            // Deleted events can come back with only an id and a status; fall back to what was seen.
            guard let start = event.start ?? before?.start, let end = event.end ?? before?.end else { continue }
            guard isAppointment(start: start, end: end, isAllDay: event.isAllDay) else {
                seen.removeValue(forKey: key)
                continue
            }

            let title = event.title.isEmpty ? (before?.title ?? "") : event.title
            let current = SeenEvent(
                calendarID: calendarID,
                eventID: event.id,
                title: title,
                start: start,
                end: end,
                status: event.status,
                attendeeName: event.attendeeName ?? before?.attendeeName
            )

            if event.status == .cancelled, let before {
                // Report the slot as it was booked, in case the cancelled copy lost its details.
                var booked = before
                booked.title = title
                booked.attendeeName = current.attendeeName
                report(booked, reason: .cancelled)
            }
            seen[key] = current
        }

        for (key, before) in previous where before.calendarID == calendarID && !returnedKeys.contains(key) {
            if window.contains(before.start) && before.start > now {
                report(before, reason: .removed)
            }
            seen.removeValue(forKey: key)
        }

        let cutoff = now.addingTimeInterval(-memory)
        seen = seen.filter { $0.value.end > cutoff }
        return Result(seen: seen, newOpenings: openings)
    }

    /// Forgets everything remembered about calendars that are no longer watched.
    public static func forgetUnwatched(_ seen: [String: SeenEvent], watched: Set<String>) -> [String: SeenEvent] {
        seen.filter { watched.contains($0.value.calendarID) }
    }
}
