import CryptoKit
import Foundation
import Security

/// Proof Key for Code Exchange (RFC 7636) for Google's installed-app OAuth flow.
public enum PKCE {
    /// A high-entropy verifier: 32 random bytes, base64url-encoded (43 characters).
    public static func makeVerifier() -> String {
        base64URL(randomBytes(count: 32))
    }

    /// The S256 challenge for a verifier.
    public static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// An unguessable `state` value to tie the browser's answer to this sign-in.
    public static func makeState() -> String {
        base64URL(randomBytes(count: 16))
    }

    public static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decodeBase64URL(_ text: String) -> Data? {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        return Data(base64Encoded: base64)
    }

    static func randomBytes(count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        if status != errSecSuccess {
            var generator = SystemRandomNumberGenerator()
            for index in bytes.indices { bytes[index] = UInt8.random(in: .min ... .max, using: &generator) }
        }
        return Data(bytes)
    }
}
