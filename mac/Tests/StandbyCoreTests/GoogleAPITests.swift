import Foundation
import Testing
@testable import StandbyCore

@Suite struct GoogleAPITests {
    let config = GoogleClientConfig(googleClientId: "123-abc.apps.googleusercontent.com", googleClientSecret: "not-a-real-secret")

    @Test func authorizationURLHasEveryParameter() throws {
        let url = GoogleOAuth.authorizationURL(clientID: config.googleClientId, redirectURI: "http://127.0.0.1:53682", codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", state: "s+t/a=te")
        #expect(url.absoluteString.hasPrefix("https://accounts.google.com/o/oauth2/v2/auth?"))
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        #expect(query["client_id"] == config.googleClientId)
        #expect(query["redirect_uri"] == "http://127.0.0.1:53682")
        #expect(query["response_type"] == "code")
        #expect(query["scope"] == "openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events")
        #expect(query["code_challenge_method"] == "S256")
        #expect(query["access_type"] == "offline")
        #expect(query["prompt"] == "consent")
        #expect(query["state"] == "s+t/a=te")
        #expect(url.absoluteString.contains("state=s%2Bt%2Fa%3Dte"))
    }

    @Test func tokenRequestsAreFormEncoded() throws {
        let exchange = GoogleOAuth.codeExchangeRequest(code: "4/0Ab+c", verifier: "v", redirectURI: "http://127.0.0.1:1", config: config)
        #expect(exchange.httpMethod == "POST")
        #expect(exchange.url == GoogleOAuth.tokenEndpoint)
        let body = try #require(exchange.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        #expect(body.contains("code=4%2F0Ab%2Bc"))
        #expect(body.contains("grant_type=authorization_code"))
        #expect(body.contains("code_verifier=v"))
        #expect(body.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1"))

        let refresh = GoogleOAuth.refreshRequest(refreshToken: "1//r", config: config)
        let refreshBody = try #require(refresh.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        #expect(refreshBody.contains("grant_type=refresh_token"))
        #expect(refreshBody.contains("refresh_token=1%2F%2Fr"))
    }

    @Test func redirectQueryIsParsed() {
        let values = GoogleOAuth.parseRedirect(target: "/?state=abc&code=4%2F0AbC&scope=email%20openid")
        #expect(values["state"] == "abc")
        #expect(values["code"] == "4/0AbC")
        #expect(values["scope"] == "email openid")
        #expect(GoogleOAuth.parseRedirect(target: "/?error=access_denied&state=abc")["error"] == "access_denied")
        #expect(GoogleOAuth.parseRedirect(target: "/favicon.ico").isEmpty)
    }

    @Test func eventsURLEncodesTheCalendarAndAsksForDeletedEvents() throws {
        let start = Date(timeIntervalSince1970: 1_791_576_720)
        let url = GoogleCalendarAPI.eventsURL(calendarID: "en.canadian#holiday@group.v.calendar.google.com", window: DateInterval(start: start, duration: 7 * 86_400), pageToken: "next")
        #expect(url.absoluteString.hasPrefix("https://www.googleapis.com/calendar/v3/calendars/en.canadian%23holiday%40group.v.calendar.google.com/events?"))
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        #expect(query["singleEvents"] == "true")
        #expect(query["orderBy"] == "startTime")
        #expect(query["showDeleted"] == "true")
        #expect(query["pageToken"] == "next")
        #expect(query["timeMin"] == GoogleCalendarAPI.rfc3339UTC(start))
        #expect(query["timeMin"]?.hasSuffix("Z") == true)
    }

    @Test func eventsDecodeFromGoogleJSON() throws {
        let json = """
        {
          "items": [
            {"id": "josh", "status": "confirmed", "summary": "Haircut",
             "start": {"dateTime": "2026-10-09T17:00:00-04:00"}, "end": {"dateTime": "2026-10-09T18:00:00-04:00"},
             "attendees": [{"email": "me@example.com", "self": true}, {"email": "josh.patel@example.com", "displayName": "Josh Patel"}]},
            {"id": "gone", "status": "cancelled"},
            {"id": "off", "status": "confirmed", "summary": "Day off", "start": {"date": "2026-10-12"}, "end": {"date": "2026-10-13"}, "colorId": "11"},
            {"id": "booked", "summary": "Sarah · Haircut", "colorId": "7",
             "start": {"dateTime": "2026-10-09T21:00:00.000Z"}, "end": {"dateTime": "2026-10-09T22:00:00Z"},
             "extendedProperties": {"private": {"bookedByStandby": "true"}}}
          ],
          "nextPageToken": "p2"
        }
        """
        let page = try JSONDecoder().decode(GoogleCalendarAPI.EventsPage.self, from: Data(json.utf8))
        #expect(page.nextPageToken == "p2")
        let events = try #require(page.items).map { GoogleCalendarAPI.calendarEvent($0, calendarID: "primary") }

        #expect(events[0].attendeeName == "Josh Patel")
        #expect(events[0].start == GoogleCalendarAPI.parseRFC3339("2026-10-09T21:00:00Z"))
        #expect(events[0].end!.timeIntervalSince(events[0].start!) == 3600)
        #expect(events[1].status == .cancelled && events[1].start == nil && events[1].title.isEmpty)
        #expect(events[2].isAllDay && events[2].colorHex == "#d50000")
        #expect(events[3].bookedByStandby && events[3].colorHex == "#039be5")
        #expect(events[3].start == events[0].start)
    }

    @Test func calendarsMapToTodaysGoogleColours() throws {
        let json = """
        {"items": [
          {"id": "me@example.com", "summary": "me@example.com", "summaryOverride": "Appointments", "colorId": "14", "backgroundColor": "#9fe1e7", "primary": true, "accessRole": "owner"},
          {"id": "team@group.calendar.google.com", "summary": "Team", "colorId": "8", "backgroundColor": "#16a765", "accessRole": "reader"},
          {"id": "custom@group.calendar.google.com", "summary": "Custom", "backgroundColor": "#123456", "accessRole": "writer"}
        ]}
        """
        let page = try JSONDecoder().decode(GoogleCalendarAPI.CalendarListPage.self, from: Data(json.utf8))
        let calendars = try #require(page.items).map(GoogleCalendarAPI.calendarInfo)
        #expect(calendars[0] == CalendarInfo(id: "me@example.com", name: "Appointments", colorHex: "#039be5", isPrimary: true, canWrite: true))
        #expect(calendars[1].colorHex == "#0b8043" && !calendars[1].canWrite)
        #expect(calendars[2].colorHex == "#123456" && calendars[2].canWrite)
    }

    @Test func insertBodyCarriesTheBooking() throws {
        let start = Date(timeIntervalSince1970: 1_791_576_720)
        let draft = EventDraft(title: "Sarah · Haircut", notes: "Booked by Standby", start: start, end: start.addingTimeInterval(3600), colorID: "7")
        let data = try GoogleCalendarAPI.insertEventBody(draft, timeZone: TimeZone(identifier: "America/Toronto")!)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["summary"] as? String == "Sarah · Haircut")
        #expect(object["description"] as? String == "Booked by Standby")
        #expect(object["colorId"] as? String == "7")
        let startObject = try #require(object["start"] as? [String: String])
        #expect(startObject["timeZone"] == "America/Toronto")
        #expect(GoogleCalendarAPI.parseRFC3339(startObject["dateTime"]!) == start)
        #expect(((object["extendedProperties"] as? [String: Any])?["private"] as? [String: String])?["bookedByStandby"] == "true")
    }

    @Test func idTokenProfileIsRead() {
        let payload = PKCE.base64URL(Data(#"{"email":"evan@example.com","name":"Evan He","picture":"https://lh3.googleusercontent.com/a/x"}"#.utf8))
        let claims = IDTokenClaims.decode(jwt: "eyJhbGciOiJSUzI1NiJ9.\(payload).sig")
        #expect(claims?.profile == AccountProfile(email: "evan@example.com", name: "Evan He", pictureURL: URL(string: "https://lh3.googleusercontent.com/a/x")))
        #expect(IDTokenClaims.decode(jwt: "garbage") == nil)
    }

    @Test func configNeedsBothValues() throws {
        #expect(!GoogleClientConfig.empty.isConfigured)
        #expect(!GoogleClientConfig(googleClientId: "x", googleClientSecret: " ").isConfigured)
        #expect(config.isConfigured)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("standby-config-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data(#"{"googleClientId": " id ", "googleClientSecret": "secret"}"#.utf8).write(to: url)
        #expect(GoogleClientConfig.load(from: url) == GoogleClientConfig(googleClientId: "id", googleClientSecret: "secret"))
        #expect(GoogleClientConfig.load(from: nil) == .empty)
    }
}
