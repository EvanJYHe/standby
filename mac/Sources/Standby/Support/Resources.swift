import AppKit
import StandbyCore

/// Finds bundled files: `Standby.app/Contents/Resources` in the built app, `mac/Resources` when run from source.
enum Resources {
    static func url(_ name: String, subdirectory: String? = nil) -> URL? {
        var candidates: [URL] = []
        if let base = Bundle.main.resourceURL {
            candidates.append(subdirectory.map { base.appendingPathComponent($0) } ?? base)
        }
        #if DEBUG
        // `swift run` from mac/: fall back to the source tree. Release builds never embed source paths.
        let sourceResources = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // Support
            .deletingLastPathComponent()   // Standby
            .deletingLastPathComponent()   // Sources
            .deletingLastPathComponent()   // mac
            .appendingPathComponent("Resources")
        candidates.append(subdirectory.map { sourceResources.appendingPathComponent($0) } ?? sourceResources)
        #endif
        return candidates
            .map { $0.appendingPathComponent(name) }
            .first { FileManager.default.fileExists(atPath: $0.path) }
    }

    /// The OAuth client copied in from `Config.local.json` by `scripts/build.sh`, if there was one.
    static func googleClientConfig() -> GoogleClientConfig {
        if let bundled = url("GoogleClient.json") { return GoogleClientConfig.load(from: bundled) }
        #if DEBUG
        let local = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Config.local.json")
        return GoogleClientConfig.load(from: local)
        #else
        return .empty
        #endif
    }

    /// An image with its @2x/@3x siblings as representations, so it stays sharp at every scale.
    static func image(_ base: String, ext: String = "png", subdirectory: String, pointSize: NSSize) -> NSImage? {
        let image = NSImage(size: pointSize)
        for suffix in ["", "@2x", "@3x"] {
            guard let url = url("\(base)\(suffix).\(ext)", subdirectory: subdirectory),
                  let rep = NSImageRep(contentsOf: url) else { continue }
            rep.size = pointSize
            image.addRepresentation(rep)
        }
        return image.representations.isEmpty ? nil : image
    }
}
