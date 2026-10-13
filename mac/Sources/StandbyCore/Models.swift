import Foundation

/// A calendar the user can choose to watch.
public struct CalendarInfo: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    /// The colour Google Calendar shows for this calendar, as `#rrggbb`.
    public var colorHex: String
    public var isPrimary: Bool
    public var canWrite: Bool

    public init(id: String, name: String, colorHex: String, isPrimary: Bool, canWrite: Bool = true) {
        self.id = id
        self.name = name
        self.colorHex = colorHex
        self.isPrimary = isPrimary
        self.canWrite = canWrite
    }
}

public enum EventStatus: String, Codable, Hashable, Sendable {
    case confirmed
    case tentative
    case cancelled
}

/// One event as Standby sees it, whichever backend it came from.
public struct CalendarEvent: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var calendarID: String
    public var title: String
    /// Missing for all-day events and for some deleted events Google returns with `showDeleted`.
    public var start: Date?
    public var end: Date?
    public var isAllDay: Bool
    public var status: EventStatus
    /// The event's own colour (`colorId`), if it overrides the calendar's.
    public var colorHex: String?
    /// The first guest who is not the calendar owner, if any.
    public var attendeeName: String?
    public var bookedByStandby: Bool

    public init(
        id: String,
        calendarID: String,
        title: String,
        start: Date?,
        end: Date?,
        isAllDay: Bool = false,
        status: EventStatus = .confirmed,
        colorHex: String? = nil,
        attendeeName: String? = nil,
        bookedByStandby: Bool = false
    ) {
        self.id = id
        self.calendarID = calendarID
        self.title = title
        self.start = start
        self.end = end
        self.isAllDay = isAllDay
        self.status = status
        self.colorHex = colorHex
        self.attendeeName = attendeeName
        self.bookedByStandby = bookedByStandby
    }

    public var key: String { EventKey.make(calendarID: calendarID, eventID: id) }
}

public enum EventKey {
    public static func make(calendarID: String, eventID: String) -> String { calendarID + "\n" + eventID }
}

/// What Standby remembers about an event between syncs, so it can tell when one is cancelled or disappears.
public struct SeenEvent: Codable, Hashable, Sendable {
    public var calendarID: String
    public var eventID: String
    public var title: String
    public var start: Date
    public var end: Date
    public var status: EventStatus
    public var attendeeName: String?

    public init(calendarID: String, eventID: String, title: String, start: Date, end: Date, status: EventStatus, attendeeName: String?) {
        self.calendarID = calendarID
        self.eventID = eventID
        self.title = title
        self.start = start
        self.end = end
        self.status = status
        self.attendeeName = attendeeName
    }

    public var key: String { EventKey.make(calendarID: calendarID, eventID: eventID) }
}

/// A slot that opened because an appointment was cancelled or removed.
public struct Opening: Codable, Hashable, Identifiable, Sendable {
    public enum Reason: String, Codable, Sendable { case cancelled, removed }

    /// The cancelled event's key, so one cancellation can only ever make one opening.
    public var id: String
    public var calendarID: String
    public var eventID: String
    public var title: String
    public var start: Date
    public var end: Date
    public var service: String?
    public var personName: String?
    public var reason: Reason
    public var detectedAt: Date
    /// Waitlist entries already offered this slot ("Try someone else").
    public var triedEntryIDs: [UUID]
    public var bookingID: UUID?
    public var dismissed: Bool

    public init(
        calendarID: String,
        eventID: String,
        title: String,
        start: Date,
        end: Date,
        service: String?,
        personName: String?,
        reason: Reason,
        detectedAt: Date
    ) {
        self.id = EventKey.make(calendarID: calendarID, eventID: eventID)
        self.calendarID = calendarID
        self.eventID = eventID
        self.title = title
        self.start = start
        self.end = end
        self.service = service
        self.personName = personName
        self.reason = reason
        self.detectedAt = detectedAt
        self.triedEntryIDs = []
        self.bookingID = nil
        self.dismissed = false
    }

    public var isBooked: Bool { bookingID != nil }

    /// Still worth offering: not booked, not dismissed, and its time has not started.
    public func isOpen(at now: Date) -> Bool { !isBooked && !dismissed && start > now }
}

/// Someone who wants an earlier appointment.
public struct WaitlistEntry: Codable, Hashable, Identifiable, Sendable {
    public static let anyService = "Any"

    public var id: UUID
    public var name: String
    public var phone: String
    /// A service name seen in the calendar, or `anyService`.
    public var service: String
    public var addedAt: Date

    public init(id: UUID = UUID(), name: String, phone: String, service: String, addedAt: Date) {
        self.id = id
        self.name = name
        self.phone = phone
        self.service = service
        self.addedAt = addedAt
    }

    public var firstName: String {
        name.split(separator: " ").first.map(String.init) ?? name
    }

    public var isBlank: Bool { name.trimmingCharacters(in: .whitespaces).isEmpty }
}

/// A replacement Standby put on the calendar.
public struct Booking: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var openingID: String
    public var calendarID: String
    public var eventID: String
    public var personName: String
    public var phone: String
    public var service: String?
    public var start: Date
    public var end: Date
    public var bookedAt: Date
    public var isSample: Bool

    public init(
        id: UUID = UUID(),
        openingID: String,
        calendarID: String,
        eventID: String,
        personName: String,
        phone: String,
        service: String?,
        start: Date,
        end: Date,
        bookedAt: Date,
        isSample: Bool
    ) {
        self.id = id
        self.openingID = openingID
        self.calendarID = calendarID
        self.eventID = eventID
        self.personName = personName
        self.phone = phone
        self.service = service
        self.start = start
        self.end = end
        self.bookedAt = bookedAt
        self.isSample = isSample
    }
}

/// The signed-in Google account's public profile. Tokens live in the Keychain, never here.
public struct AccountProfile: Codable, Hashable, Sendable {
    public var email: String
    public var name: String?
    public var pictureURL: URL?

    public init(email: String, name: String?, pictureURL: URL?) {
        self.email = email
        self.name = name
        self.pictureURL = pictureURL
    }

    public var displayName: String { name?.isEmpty == false ? name! : email }

    public var initial: String {
        String(displayName.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
    }
}

/// The new event Standby writes when someone takes an opening.
public struct EventDraft: Hashable, Sendable {
    public var title: String
    public var notes: String
    public var start: Date
    public var end: Date
    public var colorID: String?

    public init(title: String, notes: String, start: Date, end: Date, colorID: String?) {
        self.title = title
        self.notes = notes
        self.start = start
        self.end = end
        self.colorID = colorID
    }

    /// "Sarah · Haircut", noted "Booked by Standby", in Google's Peacock.
    public static func booking(for entry: WaitlistEntry, opening: Opening) -> EventDraft {
        let service = opening.service ?? (entry.service == WaitlistEntry.anyService ? nil : entry.service)
        let title = [entry.firstName, service].compactMap { $0 }.joined(separator: " · ")
        var lines = ["Booked by Standby"]
        let contact = [entry.name, entry.phone].filter { !$0.isEmpty }.joined(separator: " · ")
        if !contact.isEmpty { lines.append(contact) }
        return EventDraft(
            title: title,
            notes: lines.joined(separator: "\n"),
            start: opening.start,
            end: opening.end,
            colorID: GoogleColors.peacockEventColorID
        )
    }
}
