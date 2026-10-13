import Foundation

/// Reads a person and a service out of appointment titles such as "Josh · Haircut", "Haircut - Josh",
/// "Haircut with Josh" or "Haircut (Josh)". Booking tools write titles many ways, so this is a heuristic.
public enum TitleParser {
    public struct Parsed: Equatable, Sendable {
        public var person: String?
        public var service: String?

        public init(person: String?, service: String?) {
            self.person = person
            self.service = service
        }
    }

    static let separators = [" · ", " • ", " | ", " – ", " — ", " - ", ": "]

    static let serviceWords: Set<String> = [
        "appointment", "beard", "blowout", "braids", "class", "cleaning", "color", "colour", "consult",
        "consultation", "cut", "checkup", "exam", "facial", "fade", "haircut", "highlights", "lesson",
        "manicure", "massage", "pedicure", "physio", "session", "shave", "styling", "therapy",
        "training", "treatment", "trim", "tutoring", "visit", "wax", "waxing",
    ]

    public static func parse(_ rawTitle: String, attendeeName: String? = nil) -> Parsed {
        parseDetailed(rawTitle, attendeeName: attendeeName).parsed
    }

    /// `structured` is true when the title had a recognisable person/service shape.
    static func parseDetailed(_ rawTitle: String, attendeeName: String?) -> (parsed: Parsed, structured: Bool) {
        let title = rawTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let attendee = attendeeName.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        guard !title.isEmpty else { return (Parsed(person: attendee, service: nil), false) }

        if let range = title.range(of: " with ", options: .caseInsensitive) {
            let service = String(title[..<range.lowerBound]).trimmed
            let person = String(title[range.upperBound...]).trimmed
            if !service.isEmpty, !person.isEmpty { return (Parsed(person: person, service: service), true) }
        }

        if title.hasSuffix(")"), let open = title.lastIndex(of: "("), open > title.startIndex {
            let service = String(title[..<open]).trimmed
            let person = String(title[title.index(after: open)..<title.index(before: title.endIndex)]).trimmed
            if !service.isEmpty, !person.isEmpty { return (Parsed(person: person, service: service), true) }
        }

        for separator in separators {
            guard let range = title.range(of: separator) else { continue }
            let first = String(title[..<range.lowerBound]).trimmed
            let second = String(title[range.upperBound...]).trimmed
            guard !first.isEmpty, !second.isEmpty else { continue }
            return (assign(first, second, attendee: attendee), true)
        }

        // A bare title: it is the service unless it is just the guest's name.
        if let attendee, sameFirstName(title, attendee) { return (Parsed(person: attendee, service: nil), false) }
        return (Parsed(person: attendee, service: title), false)
    }

    /// Distinct services named in a set of titles, most common first, for the waitlist's service menu.
    /// Bare titles ("Walk-ins", "Josh") only count when they name a recognisable service.
    public static func services(in titles: [String], limit: Int = 12) -> [String] {
        var counts: [String: (name: String, count: Int, firstSeen: Int)] = [:]
        for (index, title) in titles.enumerated() {
            let (parsed, structured) = parseDetailed(title, attendeeName: nil)
            guard let service = parsed.service, structured || containsServiceWord(service) else { continue }
            let key = normalized(service)
            if key.isEmpty || key == normalized(WaitlistEntry.anyService) { continue }
            if let existing = counts[key] {
                counts[key] = (existing.name, existing.count + 1, existing.firstSeen)
            } else {
                counts[key] = (service, 1, index)
            }
        }
        return counts.values
            .sorted { ($1.count, $0.firstSeen) < ($0.count, $1.firstSeen) }
            .prefix(limit)
            .map(\.name)
    }

    public static func normalized(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func firstName(_ name: String) -> String {
        name.split(separator: " ").first.map(String.init) ?? name
    }

    static func assign(_ first: String, _ second: String, attendee: String?) -> Parsed {
        if let attendee {
            if sameFirstName(first, attendee) { return Parsed(person: first, service: second) }
            if sameFirstName(second, attendee) { return Parsed(person: second, service: first) }
        }
        let firstIsService = containsServiceWord(first)
        let secondIsService = containsServiceWord(second)
        if firstIsService != secondIsService {
            return firstIsService ? Parsed(person: second, service: first) : Parsed(person: first, service: second)
        }
        let firstIsName = looksLikeName(first)
        let secondIsName = looksLikeName(second)
        if firstIsName != secondIsName {
            return firstIsName ? Parsed(person: first, service: second) : Parsed(person: second, service: first)
        }
        return Parsed(person: first, service: second)
    }

    static func containsServiceWord(_ text: String) -> Bool {
        let words = normalized(text)
            .components(separatedBy: CharacterSet.letters.inverted)
            .filter { !$0.isEmpty }
        return words.contains { word in
            serviceWords.contains(word) || (word.hasSuffix("s") && serviceWords.contains(String(word.dropLast())))
        }
    }

    /// One to three capitalised words with no digits, like "Josh" or "Sarah Chen".
    static func looksLikeName(_ text: String) -> Bool {
        let words = text.split(separator: " ")
        guard (1...3).contains(words.count) else { return false }
        return words.allSatisfy { word in
            guard let first = word.first, first.isUppercase else { return false }
            return word.allSatisfy { $0.isLetter || $0 == "'" || $0 == "’" || $0 == "-" || $0 == "." }
        }
    }

    static func sameFirstName(_ a: String, _ b: String) -> Bool {
        normalized(firstName(a)) == normalized(firstName(b))
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
