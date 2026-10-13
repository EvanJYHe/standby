import Foundation

/// Times the way the app shows them: "Today, 5:00–6:00 PM", "3:00–3:45 PM", "5:00 PM".
public struct TimeFormatting: Sendable {
    public var calendar: Calendar
    public var locale: Locale

    public init(calendar: Calendar = .current, locale: Locale = .current) {
        var calendar = calendar
        calendar.locale = locale
        self.calendar = calendar
        self.locale = locale
    }

    public var timeZone: TimeZone { calendar.timeZone }

    public var uses12HourClock: Bool {
        (DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: locale) ?? "h a").contains("a")
    }

    /// "5:00 PM" or "17:00".
    public func time(_ date: Date) -> String {
        formatter(uses12HourClock ? "h:mm a" : "HH:mm").string(from: date)
    }

    /// "5:00–6:00 PM", "11:30 AM–12:15 PM" or "17:00–18:00".
    public func range(_ start: Date, _ end: Date) -> String {
        guard uses12HourClock else { return "\(time(start))–\(time(end))" }
        let period = formatter("a")
        if period.string(from: start) == period.string(from: end) {
            return "\(formatter("h:mm").string(from: start))–\(time(end))"
        }
        return "\(time(start))–\(time(end))"
    }

    /// "Today", "Tomorrow", a weekday within the week ahead, otherwise "Oct 20".
    public func dayName(_ date: Date, now: Date) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: tomorrow) {
            return "Tomorrow"
        }
        let startOfToday = calendar.startOfDay(for: now)
        if let days = calendar.dateComponents([.day], from: startOfToday, to: calendar.startOfDay(for: date)).day, (2...6).contains(days) {
            return formatter("EEEE").string(from: date)
        }
        return formatter(localizedTemplate: "MMMd").string(from: date)
    }

    /// "Today, 5:00–6:00 PM"
    public func slot(_ start: Date, _ end: Date, now: Date) -> String {
        "\(dayName(start, now: now)), \(range(start, end))"
    }

    /// "Friday, October 9"
    public func longDate(_ date: Date) -> String {
        formatter(localizedTemplate: "EEEEMMMMd").string(from: date)
    }

    func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = calendar.timeZone
        formatter.calendar = calendar
        formatter.dateFormat = format
        return formatter
    }

    func formatter(localizedTemplate template: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = calendar.timeZone
        formatter.calendar = calendar
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter
    }
}

public enum Copy {
    /// "3 openings filled this week"
    public static func filledThisWeek(_ count: Int) -> String {
        switch count {
        case 0: "No openings filled this week"
        case 1: "1 opening filled this week"
        default: "\(count) openings filled this week"
        }
    }

    /// "Haircut · cancelled by Josh", or "Haircut with Josh · removed" when the event disappeared instead.
    public static func openingDetail(_ opening: Opening) -> String {
        let what = opening.service ?? (opening.title.isEmpty ? "Appointment" : opening.title)
        let person = opening.personName.flatMap { $0.isEmpty ? nil : $0 }
        switch (opening.reason, person) {
        case (.cancelled, let person?): return "\(what) · cancelled by \(person)"
        case (.cancelled, nil): return "\(what) · cancelled"
        case (.removed, let person?): return "\(what) with \(person) · removed"
        case (.removed, nil): return "\(what) · removed"
        }
    }
}
