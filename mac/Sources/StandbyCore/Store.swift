import Foundation

/// Everything Standby keeps between launches, in one JSON file. OAuth tokens are not in here; they go to the Keychain.
public struct PersistedState: Codable, Equatable, Sendable {
    public enum Mode: String, Codable, Sendable {
        case google
        case sample
    }

    public var version: Int = 1
    public var mode: Mode?
    public var onboardingComplete = false
    public var watchedCalendarIDs: [String] = []
    /// The calendar list from the last fetch, so names and colours show before the next one.
    public var knownCalendars: [CalendarInfo] = []
    public var waitlist: [WaitlistEntry] = []
    public var seen: [String: SeenEvent] = [:]
    public var openings: [Opening] = []
    public var bookings: [Booking] = []
    public var isPaused = false
    public var account: AccountProfile?
    public var sample: SampleSession?

    public init() {}

    /// Bookings made this calendar week, in the current mode.
    public func bookingsThisWeek(now: Date, calendar: Calendar) -> Int {
        guard let week = calendar.dateInterval(of: .weekOfYear, for: now) else { return 0 }
        let sample = mode == .sample
        return bookings.filter { $0.isSample == sample && week.contains($0.bookedAt) }.count
    }

    /// Drops openings whose time has passed. Booked ones stay until their slot ends, as a record of the save.
    public mutating func pruneOpenings(now: Date) {
        openings.removeAll { opening in
            opening.isBooked ? opening.end <= now : (opening.start <= now || opening.dismissed)
        }
    }
}

/// The sample calendar's moving parts, so a sample session survives a relaunch.
public struct SampleSession: Codable, Equatable, Sendable {
    /// The start of the slot that gets cancelled (Josh's haircut); the sample day is laid out around it.
    public var anchor: Date
    public var cancelled: Bool
    /// Events Standby booked into the sample calendar.
    public var createdEvents: [CalendarEvent]

    public init(anchor: Date, cancelled: Bool = false, createdEvents: [CalendarEvent] = []) {
        self.anchor = anchor
        self.cancelled = cancelled
        self.createdEvents = createdEvents
    }
}

/// Reads and writes `PersistedState` as JSON, atomically.
public struct StateStore: Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    /// `~/Library/Application Support/Standby/state.json`
    public static func defaultURL() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return support.appendingPathComponent("Standby", isDirectory: true).appendingPathComponent("state.json")
    }

    public enum LoadResult: Equatable, Sendable {
        case missing
        case loaded(PersistedState)
        /// The file could not be read; it was moved aside so a fresh state can start.
        case corrupt(movedTo: URL?)
    }

    public func load() -> LoadResult {
        guard FileManager.default.fileExists(atPath: url.path) else { return .missing }
        do {
            let data = try Data(contentsOf: url)
            return .loaded(try Self.decoder().decode(PersistedState.self, from: data))
        } catch {
            let aside = url.deletingLastPathComponent()
                .appendingPathComponent("state.corrupt-\(Int(Date().timeIntervalSince1970)).json")
            let moved = (try? FileManager.default.moveItem(at: url, to: aside)) != nil
            return .corrupt(movedTo: moved ? aside : nil)
        }
    }

    public func save(_ state: PersistedState) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try Self.encoder().encode(state)
        try data.write(to: url, options: [.atomic])
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(Self.dateFormatter().string(from: date))
        }
        return encoder
    }

    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            if let date = Self.dateFormatter().date(from: text) ?? GoogleCalendarAPI.parseRFC3339(text) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unreadable date \(text)")
        }
        return decoder
    }

    static func dateFormatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}
