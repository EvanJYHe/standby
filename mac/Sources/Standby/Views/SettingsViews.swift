import AppKit
import StandbyCore
import SwiftUI

/// The content of each Settings tab. The window and its toolbar tabs are a standard AppKit preferences window.
struct SettingsTabView: View {
    let tab: SettingsTab

    var body: some View {
        Group {
            switch tab {
            case .account: AccountSettings()
            case .calendars: CalendarsSettings()
            case .waitlist: WaitlistSettings()
            case .about: AboutSettings()
            }
        }
        .frame(width: Theme.settingsWidth)
        .background(Color.white)
    }
}

private struct SettingsNote: View {
    var text: String

    var body: some View {
        Text(text)
            .font(Typeface.geist(12.5))
            .lineSpacing(2)
            .foregroundStyle(Theme.muted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: Account

private struct AccountSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if model.state.mode == .google, let account = model.state.account {
                HStack(spacing: 14) {
                    InitialAvatar(name: account.displayName, size: 44, imageURL: account.pictureURL)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(account.displayName)
                            .font(Typeface.geist(15, .semibold))
                            .tracking(-0.2)
                            .foregroundStyle(Theme.ink)
                        Text(account.email)
                            .font(Typeface.geist(13))
                            .foregroundStyle(Theme.muted)
                    }
                    .lineLimit(1)
                    Spacer(minLength: 8)
                    Button("Disconnect") { model.disconnectGoogle() }
                        .buttonStyle(SecondaryButtonStyle(height: 30))
                }
                Hairline()
                if model.needsReconnect {
                    HStack(spacing: 10) {
                        SettingsNote(text: "Google needs you to sign in again.")
                        Spacer()
                        Button("Reconnect Google") { model.reconnectGoogle() }
                            .buttonStyle(PrimaryButtonStyle(height: 30))
                    }
                } else {
                    SettingsNote(text: syncLine)
                }
            } else {
                HStack(spacing: 14) {
                    ZStack {
                        Circle().fill(Theme.surface2)
                        StandbyMark.view(height: 20, color: Theme.blue)
                    }
                    .frame(width: 44, height: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sample data")
                            .font(Typeface.geist(15, .semibold))
                            .tracking(-0.2)
                            .foregroundStyle(Theme.ink)
                        Text("Not connected to Google")
                            .font(Typeface.geist(13))
                            .foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 8)
                    Button("Reset sample") { model.resetSampleData() }
                        .buttonStyle(SecondaryButtonStyle(height: 30))
                        .help("Start the sample day over")
                }
                Hairline()
                VStack(alignment: .leading, spacing: 12) {
                    SettingsNote(text: "Connect your Google Calendar to watch your real appointments. Your waitlist comes with you.")
                    GoogleSignInButton { model.signInWithGoogle() }
                        .disabled(model.signInState == .waitingForBrowser || model.signInState == .finishing)
                    AccountSignInStatus()
                }
            }
        }
        .padding(24)
        .animation(.easeOut(duration: 0.2), value: model.signInState)
    }

    private var syncLine: String {
        guard let last = model.lastSyncAt else { return "Standby checks your calendars every minute." }
        return "Standby checks every minute. Last checked at \(model.formatting.time(last))."
    }
}

private struct AccountSignInStatus: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.signInState {
        case .idle, .finishing:
            EmptyView()
        case .notConfigured:
            SettingsNote(text: "This build of Standby doesn’t have a Google client yet, so it can’t sign in. Sample data keeps working.")
        case .waitingForBrowser:
            HStack(spacing: 6) {
                SettingsNote(text: "Finish signing in in your browser.")
                Button("Cancel") { model.cancelSignIn() }
                    .buttonStyle(QuietButtonStyle(fontSize: 12.5, color: Theme.blue, hoverColor: Theme.blueHover))
            }
        case .failed(let message):
            Text(message)
                .font(Typeface.geist(12.5, .medium))
                .foregroundStyle(Color(rgb: 0xC5221F))
        }
    }
}

// MARK: Calendars

private struct CalendarsSettings: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SettingsNote(text: model.isSample
                ? "Sample calendars. Standby watches the ones you tick."
                : "Standby watches the calendars you tick for cancellations.")
            CalendarList(maxVisibleRows: 6)
        }
        .padding(24)
        .task { if model.state.mode == .google { await model.loadCalendars() } }
    }
}

// MARK: Waitlist

private struct WaitlistSettings: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SettingsNote(text: "Each opening goes to the first person who wants that service, then to whoever has waited longest.")
            WaitlistEditor(maxVisibleRows: 6)
        }
        .padding(24)
    }
}

// MARK: About

struct AboutSettings: View {
    var body: some View {
        VStack(spacing: 0) {
            AppIconView(size: 80)
            Text("Standby")
                .font(Typeface.geist(18, .semibold))
                .tracking(-0.4)
                .foregroundStyle(Theme.ink)
                .padding(.top, 10)
            Text("Version \(AppInfo.version) (\(AppInfo.build))")
                .font(Typeface.geist(12.5))
                .foregroundStyle(Theme.muted)
                .padding(.top, 3)
            Text("Calls are simulated in this version. Bookings are real and go to your Google Calendar.")
                .font(Typeface.geist(13))
                .lineSpacing(2.5)
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 18)
            Button {
                NSWorkspace.shared.open(AppInfo.website)
            } label: {
                HStack(spacing: 3) {
                    Text(AppInfo.website.host() ?? "Website")
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 9, weight: .semibold))
                }
            }
            .buttonStyle(QuietButtonStyle(fontSize: 13, color: Theme.blue, hoverColor: Theme.blueHover))
            .padding(.top, 12)
            Button("Quit Standby") { NSApp.terminate(nil) }
                .buttonStyle(SecondaryButtonStyle(height: 30))
                .padding(.top, 22)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 28)
        .padding(.bottom, 26)
        .padding(.horizontal, 24)
    }
}

enum AppInfo {
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0" }
    static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1" }
    static let website = URL(string: "https://standby-ai.vercel.app")!
}
