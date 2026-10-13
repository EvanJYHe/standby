import AppKit
import Foundation
import StandbyCore

enum GoogleError: Error, Equatable {
    case notConfigured
    /// The refresh token is missing, expired or revoked: the user has to sign in again.
    case reconnectRequired
    case accessDenied
    case cancelled
    case stateMismatch
    case invalidResponse
    case http(Int)
}

/// Google sign-in for installed apps: PKCE, a loopback redirect to 127.0.0.1, the system browser, and tokens kept
/// in the Keychain. Access tokens are refreshed with the stored refresh token.
@MainActor
final class GoogleAuth {
    private struct StoredTokens: Codable {
        var refreshToken: String
        var accessToken: String?
        var expiresAt: Date?
    }

    private static let keychainAccount = "google-oauth"

    let config: GoogleClientConfig
    private let session: URLSession
    private var tokens: StoredTokens?
    private var loadedFromKeychain = false
    private var server: LoopbackServer?
    private var refreshTask: Task<String, Error>?

    init(config: GoogleClientConfig) {
        self.config = config
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        session = URLSession(configuration: configuration)
    }

    var hasStoredCredentials: Bool { storedTokens() != nil }

    /// Opens Google's consent page in the browser and waits for it to come back.
    func signIn() async throws -> AccountProfile {
        guard config.isConfigured else { throw GoogleError.notConfigured }
        server?.cancel()
        let server = LoopbackServer()
        self.server = server
        defer { if self.server === server { self.server = nil } }

        let port: UInt16
        do {
            port = try await server.start()
        } catch {
            throw GoogleError.invalidResponse
        }
        let redirectURI = "http://127.0.0.1:\(port)"
        let verifier = PKCE.makeVerifier()
        let state = PKCE.makeState()
        let url = GoogleOAuth.authorizationURL(
            clientID: config.googleClientId,
            redirectURI: redirectURI,
            codeChallenge: PKCE.challenge(for: verifier),
            state: state
        )
        NSWorkspace.shared.open(url)

        let query: [String: String]
        do {
            query = try await server.waitForRedirect(timeout: 300)
        } catch {
            throw GoogleError.cancelled
        }

        do {
            guard query["state"] == state else { throw GoogleError.stateMismatch }
            if let error = query["error"] { throw error == "access_denied" ? GoogleError.accessDenied : GoogleError.invalidResponse }
            guard let code = query["code"] else { throw GoogleError.invalidResponse }

            let request = GoogleOAuth.codeExchangeRequest(code: code, verifier: verifier, redirectURI: redirectURI, config: config)
            let token = try await tokenResponse(for: request)
            guard let refreshToken = token.refreshToken else { throw GoogleError.invalidResponse }
            let stored = StoredTokens(
                refreshToken: refreshToken,
                accessToken: token.accessToken,
                expiresAt: Date().addingTimeInterval(TimeInterval(token.expiresIn))
            )
            try save(stored)

            var profile = token.idToken.flatMap(IDTokenClaims.decode(jwt:))?.profile
            if profile == nil { profile = try? await userInfo(accessToken: token.accessToken) }
            guard let profile else { throw GoogleError.invalidResponse }
            server.finish(.connected)
            return profile
        } catch {
            server.finish(.failed)
            throw error
        }
    }

    func cancelSignIn() {
        server?.cancel()
        server = nil
    }

    /// A valid access token, refreshed if it is about to expire.
    func accessToken(forceRefresh: Bool = false) async throws -> String {
        guard let stored = storedTokens() else { throw GoogleError.reconnectRequired }
        if !forceRefresh, let token = stored.accessToken, let expiry = stored.expiresAt, expiry > Date().addingTimeInterval(60) {
            return token
        }
        if let refreshTask { return try await refreshTask.value }
        let task = Task { try await self.refresh(using: stored.refreshToken) }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    /// Revokes the grant (best effort) and forgets the tokens.
    func signOut() async {
        let token = storedTokens()?.refreshToken
        tokens = nil
        loadedFromKeychain = true
        Keychain.delete(account: Self.keychainAccount)
        if let token {
            _ = try? await session.data(for: GoogleOAuth.revokeRequest(token: token))
        }
    }

    // MARK: Private

    private func refresh(using refreshToken: String) async throws -> String {
        let request = GoogleOAuth.refreshRequest(refreshToken: refreshToken, config: config)
        let token: TokenResponse
        do {
            token = try await tokenResponse(for: request)
        } catch GoogleError.http(let status) where status == 400 || status == 401 {
            // invalid_grant: the refresh token expired or was revoked.
            throw GoogleError.reconnectRequired
        }
        let stored = StoredTokens(
            refreshToken: token.refreshToken ?? refreshToken,
            accessToken: token.accessToken,
            expiresAt: Date().addingTimeInterval(TimeInterval(token.expiresIn))
        )
        try? save(stored)
        return token.accessToken
    }

    private func tokenResponse(for request: URLRequest) async throws -> TokenResponse {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GoogleError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw GoogleError.http(http.statusCode) }
        guard let token = try? JSONDecoder().decode(TokenResponse.self, from: data) else { throw GoogleError.invalidResponse }
        return token
    }

    private func userInfo(accessToken: String) async throws -> AccountProfile? {
        var request = URLRequest(url: GoogleOAuth.userInfoEndpoint)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await session.data(for: request)
        return try? JSONDecoder().decode(IDTokenClaims.self, from: data).profile
    }

    private func storedTokens() -> StoredTokens? {
        if !loadedFromKeychain {
            loadedFromKeychain = true
            tokens = Keychain.load(account: Self.keychainAccount).flatMap { try? JSONDecoder().decode(StoredTokens.self, from: $0) }
        }
        return tokens
    }

    private func save(_ stored: StoredTokens) throws {
        try Keychain.save(JSONEncoder().encode(stored), account: Self.keychainAccount)
        tokens = stored
        loadedFromKeychain = true
    }
}
