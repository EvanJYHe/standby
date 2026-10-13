import Foundation
import Network
import StandbyCore

/// A one-shot HTTP listener on 127.0.0.1 that catches Google's OAuth redirect (the loopback flow for desktop apps).
/// It holds the browser's request open until the sign-in finishes, then answers with a small page.
final class LoopbackServer: @unchecked Sendable {
    enum Page {
        case connected
        case failed
    }

    enum Failure: Error {
        case couldNotListen
        case timedOut
        case cancelled
    }

    // Everything below is only touched on `queue`.
    private let queue = DispatchQueue(label: "co.evanhe.standby.oauth-loopback")
    private var listener: NWListener?
    private var startContinuation: CheckedContinuation<UInt16, Error>?
    private var callbackContinuation: CheckedContinuation<[String: String], Error>?
    private var receivedQuery: [String: String]?
    private var pendingConnection: NWConnection?
    private var failure: Error?
    private var answered = false

    /// Starts listening on a free port and returns it.
    func start() async throws -> UInt16 {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                do {
                    let parameters = NWParameters.tcp
                    parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
                    parameters.acceptLocalOnly = true
                    let listener = try NWListener(using: parameters)
                    self.listener = listener
                    self.startContinuation = continuation
                    listener.stateUpdateHandler = { [weak self] state in self?.listenerChanged(state) }
                    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
                    listener.start(queue: self.queue)
                } catch {
                    continuation.resume(throwing: Failure.couldNotListen)
                }
            }
        }
    }

    /// Waits for the redirect and returns its query parameters.
    func waitForRedirect(timeout: TimeInterval) async throws -> [String: String] {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                if let query = self.receivedQuery {
                    continuation.resume(returning: query)
                } else if let failure = self.failure {
                    continuation.resume(throwing: failure)
                } else {
                    self.callbackContinuation = continuation
                    self.queue.asyncAfter(deadline: .now() + timeout) { [weak self] in
                        guard let self, !self.answered else { return }
                        self.fail(Failure.timedOut)
                    }
                }
            }
        }
    }

    /// Answers the waiting browser tab and shuts the listener down.
    func finish(_ page: Page) {
        queue.async {
            if let connection = self.pendingConnection {
                self.respond(connection, status: "200 OK", html: LoopbackPage.html(page))
                self.pendingConnection = nil
            }
            self.stop()
        }
    }

    func cancel() {
        queue.async { self.fail(Failure.cancelled) }
    }

    // MARK: Private (on `queue`)

    private func listenerChanged(_ state: NWListener.State) {
        switch state {
        case .ready:
            if let port = listener?.port?.rawValue {
                startContinuation?.resume(returning: port)
            } else {
                startContinuation?.resume(throwing: Failure.couldNotListen)
            }
            startContinuation = nil
        case .failed, .cancelled:
            startContinuation?.resume(throwing: Failure.couldNotListen)
            startContinuation = nil
        default:
            break
        }
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(on: connection, buffer: Data())
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[..<end.lowerBound], as: UTF8.self)
                route(connection, requestLine: head.components(separatedBy: "\r\n").first ?? "")
            } else if isComplete || error != nil || buffer.count > 65_536 {
                connection.cancel()
            } else {
                receive(on: connection, buffer: buffer)
            }
        }
    }

    private func route(_ connection: NWConnection, requestLine: String) {
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" else {
            respond(connection, status: "405 Method Not Allowed", html: "")
            return
        }
        let query = GoogleOAuth.parseRedirect(target: String(parts[1]))
        // Browsers also ask for /favicon.ico; only the redirect carries a code or an error.
        guard query["code"] != nil || query["error"] != nil else {
            respond(connection, status: "404 Not Found", html: "")
            return
        }
        guard !answered else {
            respond(connection, status: "200 OK", html: LoopbackPage.html(.connected))
            return
        }
        answered = true
        pendingConnection = connection
        if let continuation = callbackContinuation {
            callbackContinuation = nil
            continuation.resume(returning: query)
        } else {
            receivedQuery = query
        }
    }

    private func respond(_ connection: NWConnection, status: String, html: String) {
        let body = Data(html.utf8)
        let head = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
    }

    private func fail(_ error: Error) {
        guard failure == nil else { return }
        failure = error
        callbackContinuation?.resume(throwing: error)
        callbackContinuation = nil
        if let connection = pendingConnection {
            respond(connection, status: "200 OK", html: LoopbackPage.html(.failed))
            pendingConnection = nil
        }
        stop()
    }

    private func stop() {
        listener?.cancel()
        listener = nil
    }
}

/// The page the browser shows after Google sends it back: the mark, one serif line, one muted line.
enum LoopbackPage {
    static func html(_ page: LoopbackServer.Page) -> String {
        let (title, line) = switch page {
        case .connected: ("You’re connected.", "You can close this tab.")
        case .failed: ("Sign-in didn’t finish.", "You can close this tab and try again in Standby.")
        }
        return """
        <!doctype html>
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Standby</title>
        <style>
        \(fontFace)
        html,body{height:100%;margin:0;background:#fff;color:#0b1220;-webkit-font-smoothing:antialiased}
        body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
        main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
        svg{height:44px;width:auto;margin-bottom:28px}
        h1{font:400 48px/1.02 "Instrument Serif",Georgia,serif;letter-spacing:-0.01em;margin:0 0 12px}
        p{color:#6b7380;margin:0}
        </style></head>
        <body><main>
        <svg viewBox="-1.17 -1.29 2.34 2.46" fill="#0867f5" aria-hidden="true">\(markPaths)</svg>
        <h1>\(title)</h1><p>\(line)</p>
        </main></body></html>
        """
    }

    /// Copied from public/landing/v2/standby-mark.svg.
    static let markPaths = """
    <path d="M0.6543 -0.97A1.17 1.17 0 0 1 1.1682 -0.0653L0.8287 -0.0463A0.83 0.83 0 0 0 0.4641 -0.6881Z"/>\
    <path d="M1.1674 0.0775A1.17 1.17 0 0 1 0.6441 0.9768L0.4569 0.6929A0.83 0.83 0 0 0 0.8282 0.055Z"/>\
    <path d="M0.5202 1.048A1.17 1.17 0 0 1 -0.5202 1.048L-0.369 0.7434A0.83 0.83 0 0 0 0.369 0.7434Z"/>\
    <path d="M-0.6441 0.9768A1.17 1.17 0 0 1 -1.1674 0.0775L-0.8282 0.055A0.83 0.83 0 0 0 -0.4569 0.6929Z"/>\
    <path d="M-1.1682 -0.0653A1.17 1.17 0 0 1 -0.6543 -0.97L-0.4641 -0.6881A0.83 0.83 0 0 0 -0.8287 -0.0463Z"/>\
    <rect x="-0.17" y="-1.29" width="0.34" height="1.23"/>
    """

    /// Instrument Serif, inlined so the page needs nothing from the network.
    static let fontFace: String = {
        guard let url = Resources.url("InstrumentSerif-Regular.ttf", subdirectory: "Fonts"),
              let data = try? Data(contentsOf: url) else { return "" }
        return "@font-face{font-family:\"Instrument Serif\";src:url(data:font/ttf;base64,\(data.base64EncodedString())) format(\"truetype\")}"
    }()
}
