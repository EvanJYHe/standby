import Foundation

/// The built-in sample calendar: a barber's afternoon. Michael at 3:00, walk-ins at 4:00, Josh's 5:00 haircut (the
/// one that gets cancelled), Ava at 6:30 and Leo at 7:30, laid out around the next free hour so the opening is
/// always ahead.
public enum SampleData {
    public static let appointmentsCalendarID = "sample-appointments"

    public static let calendars: [CalendarInfo] = [
        CalendarInfo(id: appointmentsCalendarID, name: "Appointments", colorHex: "#039be5", isPrimary: true),
        CalendarInfo(id: "sample-walk-ins", name: "Walk-ins", colorHex: "#33b679", isPrimary: false),
        CalendarInfo(id: "sample-staff", name: "Staff schedule", colorHex: "#8e24aa", isPrimary: false),
        CalendarInfo(id: "sample-personal", name: "Personal", colorHex: "#f4511e", isPrimary: false),
    ]

    public static let services = ["Haircut", "Beard trim", "Colour"]

    /// The start of Josh's slot: the next whole hour at least 30 minutes away, kept within opening hours
    /// (10 AM to 7 PM starts); late in the evening it moves to 11 AM tomorrow.
    public static func anchor(for now: Date, calendar: Calendar) -> Date {
        let soon = now.addingTimeInterval(30 * 60)
        var hourStart = calendar.dateInterval(of: .hour, for: soon)?.start ?? soon
        if hourStart < soon { hourStart = calendar.date(byAdding: .hour, value: 1, to: hourStart) ?? hourStart }
        let hour = calendar.component(.hour, from: hourStart)
        if (10...19).contains(hour), calendar.isDate(hourStart, inSameDayAs: now) { return hourStart }
        let today = calendar.startOfDay(for: now)
        let day = calendar.component(.hour, from: now) < 10 ? today : (calendar.date(byAdding: .day, value: 1, to: today) ?? today)
        return calendar.date(bySettingHour: 11, minute: 0, second: 0, of: day) ?? hourStart
    }

    public static func events(anchor: Date, cancelled: Bool) -> [CalendarEvent] {
        func at(_ minutes: Double) -> Date { anchor.addingTimeInterval(minutes * 60) }
        let id = appointmentsCalendarID
        return [
            CalendarEvent(id: "sample-michael", calendarID: id, title: "Michael · Haircut", start: at(-120), end: at(-75)),
            CalendarEvent(id: "sample-walk-ins", calendarID: id, title: "Walk-ins", start: at(-60), end: at(-30), colorHex: GoogleColors.eventColors["2"]),
            CalendarEvent(
                id: "sample-josh",
                calendarID: id,
                title: "Josh · Haircut",
                start: at(0),
                end: at(60),
                status: cancelled ? .cancelled : .confirmed
            ),
            CalendarEvent(id: "sample-ava", calendarID: id, title: "Ava · Colour", start: at(90), end: at(135), colorHex: GoogleColors.eventColors["3"]),
            CalendarEvent(id: "sample-leo", calendarID: id, title: "Leo · Beard trim", start: at(150), end: at(180)),
        ]
    }

    public static func waitlist(now: Date) -> [WaitlistEntry] {
        func daysAgo(_ days: Double) -> Date { now.addingTimeInterval(-days * 24 * 60 * 60) }
        return [
            WaitlistEntry(name: "Sarah Chen", phone: "(416) 555-0142", service: "Haircut", addedAt: daysAgo(9)),
            WaitlistEntry(name: "Daniel Okafor", phone: "(647) 555-0119", service: "Beard trim", addedAt: daysAgo(6)),
            WaitlistEntry(name: "Priya Raman", phone: "(416) 555-0187", service: WaitlistEntry.anyService, addedAt: daysAgo(3)),
        ]
    }

    /// Two openings the sample shop filled earlier in the week, so the weekly count has a history.
    public static func earlierBookings(now: Date, calendar: Calendar) -> [Booking] {
        guard let week = calendar.dateInterval(of: .weekOfYear, for: now) else { return [] }
        let past: [(hoursAgo: Double, name: String, service: String)] = [(26, "Ava Martin", "Colour"), (50, "Michael Ross", "Haircut")]
        return past.compactMap { item in
            let bookedAt = now.addingTimeInterval(-item.hoursAgo * 60 * 60)
            guard week.contains(bookedAt) else { return nil }
            return Booking(
                openingID: "sample-earlier-\(Int(item.hoursAgo))",
                calendarID: appointmentsCalendarID,
                eventID: "sample-earlier-\(Int(item.hoursAgo))",
                personName: item.name,
                phone: "",
                service: item.service,
                start: bookedAt.addingTimeInterval(45 * 60),
                end: bookedAt.addingTimeInterval(90 * 60),
                bookedAt: bookedAt,
                isSample: true
            )
        }
    }
}
