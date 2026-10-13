// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Standby",
    platforms: [.macOS(.v14)],
    targets: [
        // Calendar logic with no UI: opening detection, ranking, PKCE, Google request building, persistence.
        .target(name: "StandbyCore"),
        // The menu-bar app.
        .executableTarget(
            name: "Standby",
            dependencies: ["StandbyCore"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("Network"),
                .linkedFramework("Security"),
            ]
        ),
        // Run with scripts/test.sh, which adds the Command Line Tools' swift-testing paths when there is no Xcode.
        .testTarget(name: "StandbyCoreTests", dependencies: ["StandbyCore"]),
    ]
)
