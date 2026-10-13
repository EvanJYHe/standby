import Foundation

/// The OAuth client the build was configured with (`mac/Config.local.json`, bundled at build time).
public struct GoogleClientConfig: Codable, Equatable, Sendable {
    public var googleClientId: String
    public var googleClientSecret: String

    public init(googleClientId: String, googleClientSecret: String) {
        self.googleClientId = googleClientId
        self.googleClientSecret = googleClientSecret
    }

    public static let empty = GoogleClientConfig(googleClientId: "", googleClientSecret: "")

    public var isConfigured: Bool {
        !googleClientId.trimmed.isEmpty && !googleClientSecret.trimmed.isEmpty
    }

    public static func load(from url: URL?) -> GoogleClientConfig {
        guard let url, let data = try? Data(contentsOf: url),
              let config = try? JSONDecoder().decode(GoogleClientConfig.self, from: data) else { return .empty }
        return GoogleClientConfig(googleClientId: config.googleClientId.trimmed, googleClientSecret: config.googleClientSecret.trimmed)
    }
}

/// Google's OAuth 2.0 flow for installed apps: PKCE, a loopback redirect, and a client secret that Google issues to
/// desktop clients without treating it as confidential.
public enum GoogleOAuth {
    public static let authorizationEndpoint = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    public static let tokenEndpoint = URL(string: "https://oauth2.googleapis.com/token")!
    public static let revokeEndpoint = URL(string: "https://oauth2.googleapis.com/revoke")!
    public static let userInfoEndpoint = URL(string: "https://openidconnect.googleapis.com/v1/userinfo")!

    public static let scopes = [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
    ]

    public static func authorizationURL(clientID: String, redirectURI: String, codeChallenge: String, state: String) -> URL {
        let query = formEncode([
            ("client_id", clientID),
            ("redirect_uri", redirectURI),
            ("response_type", "code"),
            ("scope", scopes.joined(separator: " ")),
            ("code_challenge", codeChallenge),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("state", state),
        ])
        return URL(string: authorizationEndpoint.absoluteString + "?" + query)!
    }

    public static func codeExchangeRequest(code: String, verifier: String, redirectURI: String, config: GoogleClientConfig) -> URLRequest {
        formRequest(tokenEndpoint, [
            ("code", code),
            ("client_id", config.googleClientId),
            ("client_secret", config.googleClientSecret),
            ("redirect_uri", redirectURI),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier),
        ])
    }

    public static func refreshRequest(refreshToken: String, config: GoogleClientConfig) -> URLRequest {
        formRequest(tokenEndpoint, [
            ("refresh_token", refreshToken),
            ("client_id", config.googleClientId),
            ("client_secret", config.googleClientSecret),
            ("grant_type", "refresh_token"),
        ])
    }

    public static func revokeRequest(token: String) -> URLRequest {
        formRequest(revokeEndpoint, [("token", token)])
    }

    static func formRequest(_ url: URL, _ fields: [(String, String)]) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(formEncode(fields).utf8)
        return request
    }

    /// Percent-encodes everything except RFC 3986's unreserved characters, so `+`, `&`, `=` and spaces survive.
    public static func formEncode(_ fields: [(String, String)]) -> String {
        fields.map { "\(percentEncode($0.0))=\(percentEncode($0.1))" }.joined(separator: "&")
    }

    public static func percentEncode(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? text
    }

    static let unreserved: CharacterSet = {
        var set = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        set.insert(charactersIn: "-._~")
        return set
    }()

    /// Parses the redirect's query (`/?state=…&code=…` or `/?error=access_denied`).
    public static func parseRedirect(target: String) -> [String: String] {
        guard let queryStart = target.firstIndex(of: "?") else { return [:] }
        var values: [String: String] = [:]
        for pair in target[target.index(after: queryStart)...].split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard let rawKey = parts.first else { continue }
            let decode = { (text: Substring) in
                String(text).replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? String(text)
            }
            values[decode(rawKey)] = parts.count > 1 ? decode(parts[1]) : ""
        }
        return values
    }
}

public struct TokenResponse: Decodable, Sendable {
    public var accessToken: String
    public var expiresIn: Int
    public var refreshToken: String?
    public var scope: String?
    public var idToken: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
        case scope
        case idToken = "id_token"
    }
}

public struct OAuthErrorResponse: Decodable, Sendable {
    public var error: String
    public var errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case error
        case errorDescription = "error_description"
    }
}

/// The profile claims in the ID token Google returns from its token endpoint over TLS.
public struct IDTokenClaims: Decodable, Sendable {
    public var email: String?
    public var name: String?
    public var givenName: String?
    public var picture: String?

    enum CodingKeys: String, CodingKey {
        case email, name, picture
        case givenName = "given_name"
    }

    public static func decode(jwt: String) -> IDTokenClaims? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2, let payload = PKCE.decodeBase64URL(String(parts[1])) else { return nil }
        return try? JSONDecoder().decode(IDTokenClaims.self, from: payload)
    }

    public var profile: AccountProfile? {
        guard let email, !email.isEmpty else { return nil }
        return AccountProfile(email: email, name: name, pictureURL: picture.flatMap(URL.init(string:)))
    }
}

/// Google Calendar API v3 over plain REST.
public enum GoogleCalendarAPI {
    public static let base = "https://www.googleapis.com/calendar/v3"

    public static func calendarListURL(pageToken: String?) -> URL {
        var fields: [(String, String)] = [("maxResults", "250"), ("minAccessRole", "reader")]
        if let pageToken { fields.append(("pageToken", pageToken)) }
        return URL(string: "\(base)/users/me/calendarList?\(GoogleOAuth.formEncode(fields))")!
    }

    public static func eventsURL(calendarID: String, window: DateInterval, pageToken: String?) -> URL {
        var fields: [(String, String)] = [
            ("timeMin", rfc3339UTC(window.start)),
            ("timeMax", rfc3339UTC(window.end)),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("showDeleted", "true"),
            ("maxResults", "250"),
        ]
        if let pageToken { fields.append(("pageToken", pageToken)) }
        return URL(string: "\(base)/calendars/\(GoogleOAuth.percentEncode(calendarID))/events?\(GoogleOAuth.formEncode(fields))")!
    }

    public static func insertEventURL(calendarID: String) -> URL {
        URL(string: "\(base)/calendars/\(GoogleOAuth.percentEncode(calendarID))/events")!
    }

    public static func insertEventBody(_ draft: EventDraft, timeZone: TimeZone) throws -> Data {
        struct Body: Encodable {
            struct Time: Encodable { var dateTime: String; var timeZone: String }
            struct Extended: Encodable { var `private`: [String: String] }
            var summary: String
            var description: String
            var start: Time
            var end: Time
            var colorId: String?
            var extendedProperties: Extended
        }
        let body = Body(
            summary: draft.title,
            description: draft.notes,
            start: .init(dateTime: rfc3339(draft.start, timeZone: timeZone), timeZone: timeZone.identifier),
            end: .init(dateTime: rfc3339(draft.end, timeZone: timeZone), timeZone: timeZone.identifier),
            colorId: draft.colorID,
            extendedProperties: .init(private: [bookedByStandbyKey: "true"])
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(body)
    }

    public static let bookedByStandbyKey = "bookedByStandby"

    // MARK: Responses

    public struct CalendarListPage: Decodable, Sendable {
        public var items: [CalendarListEntry]?
        public var nextPageToken: String?
    }

    public struct CalendarListEntry: Decodable, Sendable {
        public var id: String
        public var summary: String?
        public var summaryOverride: String?
        public var backgroundColor: String?
        public var colorId: String?
        public var primary: Bool?
        public var accessRole: String?
        public var deleted: Bool?
    }

    public struct EventsPage: Decodable, Sendable {
        public var items: [APIEvent]?
        public var nextPageToken: String?
    }

    public struct APIEvent: Decodable, Sendable {
        public var id: String
        public var status: String?
        public var summary: String?
        public var start: APITime?
        public var end: APITime?
        public var colorId: String?
        public var attendees: [APIAttendee]?
        public var extendedProperties: ExtendedProperties?
    }

    public struct APITime: Decodable, Sendable {
        public var dateTime: String?
        public var date: String?
    }

    public struct APIAttendee: Decodable, Sendable {
        public var email: String?
        public var displayName: String?
        public var isSelf: Bool?
        public var organizer: Bool?
        public var resource: Bool?

        enum CodingKeys: String, CodingKey {
            case email, displayName, organizer, resource
            case isSelf = "self"
        }
    }

    public struct ExtendedProperties: Decodable, Sendable {
        public var `private`: [String: String]?
    }

    public static func calendarInfo(_ entry: CalendarListEntry) -> CalendarInfo {
        CalendarInfo(
            id: entry.id,
            name: entry.summaryOverride ?? entry.summary ?? entry.id,
            colorHex: GoogleColors.calendarDisplayColor(colorID: entry.colorId, backgroundColor: entry.backgroundColor),
            isPrimary: entry.primary ?? false,
            canWrite: entry.accessRole == "owner" || entry.accessRole == "writer"
        )
    }

    public static func calendarEvent(_ event: APIEvent, calendarID: String) -> CalendarEvent {
        let guest = event.attendees?.first { $0.isSelf != true && $0.organizer != true && $0.resource != true }
        let guestName = guest.flatMap { guest -> String? in
            if let name = guest.displayName?.trimmed, !name.isEmpty { return name }
            return guest.email.flatMap { $0.split(separator: "@").first.map(String.init) }
        }
        return CalendarEvent(
            id: event.id,
            calendarID: calendarID,
            title: event.summary ?? "",
            start: event.start?.dateTime.flatMap(parseRFC3339),
            end: event.end?.dateTime.flatMap(parseRFC3339),
            isAllDay: event.start?.date != nil && event.start?.dateTime == nil,
            status: EventStatus(rawValue: event.status ?? "confirmed") ?? .confirmed,
            colorHex: GoogleColors.eventDisplayColor(colorID: event.colorId),
            attendeeName: guestName,
            bookedByStandby: event.extendedProperties?.private?[bookedByStandbyKey] == "true"
        )
    }

    // MARK: Dates

    public static func parseRFC3339(_ text: String) -> Date? {
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: text) { return date }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: text)
    }

    public static func rfc3339UTC(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }

    public static func rfc3339(_ date: Date, timeZone: TimeZone) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = timeZone
        return formatter.string(from: date)
    }
}
