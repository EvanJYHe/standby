import Foundation
import StandbyCore

/// Google Calendar API v3 over URLSession: the calendar list, events in a window (every page, deleted ones included),
/// and inserting a booking.
@MainActor
final class GoogleCalendarClient {
    private let auth: GoogleAuth
    private let session: URLSession

    init(auth: GoogleAuth) {
        self.auth = auth
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration)
    }

    func calendars() async throws -> [CalendarInfo] {
        var calendars: [CalendarInfo] = []
        var pageToken: String?
        repeat {
            let data = try await send(URLRequest(url: GoogleCalendarAPI.calendarListURL(pageToken: pageToken)))
            let page = try decode(GoogleCalendarAPI.CalendarListPage.self, data)
            calendars += (page.items ?? []).filter { $0.deleted != true }.map(GoogleCalendarAPI.calendarInfo)
            pageToken = page.nextPageToken
        } while pageToken != nil
        return calendars
    }

    /// Every event in the window, following `nextPageToken` so nothing looks like it vanished. `allowPartial` is for
    /// lookups that only need a sample (the service names), never for detecting openings.
    func events(calendarID: String, window: DateInterval, maxPages: Int = 20, allowPartial: Bool = false) async throws -> [CalendarEvent] {
        var events: [CalendarEvent] = []
        var pageToken: String?
        var pages = 0
        repeat {
            let url = GoogleCalendarAPI.eventsURL(calendarID: calendarID, window: window, pageToken: pageToken)
            let page = try decode(GoogleCalendarAPI.EventsPage.self, try await send(URLRequest(url: url)))
            events += (page.items ?? []).map { GoogleCalendarAPI.calendarEvent($0, calendarID: calendarID) }
            pageToken = page.nextPageToken
            pages += 1
        } while pageToken != nil && pages < maxPages
        // A truncated list would make the rest look deleted, so treat it as a failed fetch.
        if pageToken != nil, !allowPartial { throw GoogleError.invalidResponse }
        return events
    }

    func insertEvent(calendarID: String, draft: EventDraft) async throws -> CalendarEvent {
        var request = URLRequest(url: GoogleCalendarAPI.insertEventURL(calendarID: calendarID))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try GoogleCalendarAPI.insertEventBody(draft, timeZone: .current)
        let event = try decode(GoogleCalendarAPI.APIEvent.self, try await send(request))
        return GoogleCalendarAPI.calendarEvent(event, calendarID: calendarID)
    }

    // MARK: Private

    private func send(_ request: URLRequest, retried: Bool = false) async throws -> Data {
        var authorized = request
        authorized.setValue("Bearer \(try await auth.accessToken(forceRefresh: retried))", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: authorized)
        guard let http = response as? HTTPURLResponse else { throw GoogleError.invalidResponse }
        switch http.statusCode {
        case 200..<300:
            return data
        case 401 where !retried:
            return try await send(request, retried: true)
        case 401:
            throw GoogleError.reconnectRequired
        case 403 where String(decoding: data, as: UTF8.self).contains("insufficient"):
            // The user unticked a calendar permission on Google's consent screen.
            throw GoogleError.reconnectRequired
        default:
            throw GoogleError.http(http.statusCode)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw GoogleError.invalidResponse
        }
    }
}
