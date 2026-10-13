import StandbyCore
import SwiftUI

/// First launch: three steps, each one serif headline, one line, and one button.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Color.white
            Group {
                switch model.onboardingStep {
                case .connect: ConnectStep()
                case .calendars: CalendarsStep()
                case .waitlist: WaitlistStep()
                }
            }
            .id(model.onboardingStep)
            .transition(.asymmetric(
                insertion: .opacity.combined(with: .offset(x: 16)),
                removal: .opacity.combined(with: .offset(x: -16))
            ))
            VStack {
                Spacer()
                StepIndicator(current: model.onboardingStep.rawValue)
                    .padding(.bottom, 26)
            }
        }
        .frame(width: Theme.onboardingSize.width, height: Theme.onboardingSize.height)
        .animation(.easeOut(duration: 0.32), value: model.onboardingStep)
    }
}

/// A headline in Instrument Serif and one line of Geist under it.
private struct StepHeading: View {
    var title: String
    var line: String

    var body: some View {
        VStack(spacing: 12) {
            Text(title)
                .font(Typeface.serif(34))
                .tracking(-0.2)
                .lineSpacing(-2)
                .foregroundStyle(Theme.ink)
            Text(line)
                .font(Typeface.geist(15))
                .lineSpacing(3)
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: 380)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: Step 1

private struct ConnectStep: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            AppIconView(size: 112)
            StepHeading(
                title: "Never lose an empty slot.",
                line: "Standby watches your Google Calendar and refills cancelled appointments from your waitlist."
            )
            .padding(.top, 20)
            Spacer(minLength: 0)
            VStack(spacing: 16) {
                GoogleSignInButton { model.signInWithGoogle() }
                    .disabled(model.signInState == .waitingForBrowser || model.signInState == .finishing)
                SignInStatus()
                Button("Explore with sample data") { model.chooseSampleData() }
                    .buttonStyle(model.signInState == .notConfigured
                        ? QuietButtonStyle(fontSize: 13.5, color: Theme.blue, hoverColor: Theme.blueHover)
                        : QuietButtonStyle(fontSize: 13.5))
            }
            .padding(.bottom, 74)
        }
        .padding(.horizontal, 40)
        .animation(.easeOut(duration: 0.25), value: model.signInState)
    }
}

/// What happened after "Continue with Google": no client in this build, waiting for the browser, or an error.
private struct SignInStatus: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.signInState {
        case .idle:
            EmptyView()
        case .notConfigured:
            Text("This build has no Google client yet, so it can’t sign in to Google. Explore with sample data instead.")
                .font(Typeface.geist(13))
                .lineSpacing(2)
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 330)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.surface2))
                .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity)
        case .waitingForBrowser:
            HStack(spacing: 6) {
                Text("Finish signing in in your browser.")
                    .foregroundStyle(Theme.muted)
                Button("Cancel") { model.cancelSignIn() }
                    .buttonStyle(QuietButtonStyle(fontSize: 13, color: Theme.blue, hoverColor: Theme.blueHover))
            }
            .font(Typeface.geist(13))
            .transition(.opacity)
        case .finishing:
            Text("Loading your calendars…")
                .font(Typeface.geist(13))
                .foregroundStyle(Theme.muted)
        case .failed(let message):
            Text(message)
                .font(Typeface.geist(13, .medium))
                .foregroundStyle(Color(rgb: 0xC5221F))
                .transition(.opacity)
        }
    }
}

// MARK: Step 2

private struct CalendarsStep: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            StepHeading(
                title: "Which calendars should\nStandby watch?",
                line: "Standby checks them for cancellations every minute."
            )
            .padding(.top, 62)
            CalendarList(maxVisibleRows: 5)
                .padding(.top, 28)
                .padding(.horizontal, 56)
            Spacer(minLength: 0)
            Button("Continue") { model.finishCalendarsStep() }
                .buttonStyle(PrimaryButtonStyle(height: 40, fontSize: 14, minWidth: 180))
                .keyboardShortcut(.defaultAction)
                .disabled(model.state.watchedCalendarIDs.isEmpty)
                .padding(.bottom, 74)
        }
    }
}

// MARK: Step 3

private struct WaitlistStep: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            StepHeading(
                title: "Who should get\nthe next opening?",
                line: "Add the people who want an earlier spot."
            )
            .padding(.top, 62)
            WaitlistEditor(maxVisibleRows: 4)
                .padding(.top, 28)
                .padding(.horizontal, 36)
            Spacer(minLength: 0)
            Button("Start watching") { model.finishOnboarding() }
                .buttonStyle(PrimaryButtonStyle(height: 40, fontSize: 14, minWidth: 180))
                .keyboardShortcut(.defaultAction)
                .padding(.bottom, 74)
        }
    }
}

// MARK: Shared lists

/// The user's calendars, each with its Google colour, name and a checkbox. Used in onboarding and Settings.
struct CalendarList: View {
    var maxVisibleRows: Int
    @Environment(AppModel.self) private var model
    @Environment(\.isStaticRender) private var isStaticRender

    var body: some View {
        if model.calendarsLoading && model.availableCalendars.isEmpty {
            Text("Loading your calendars…")
                .font(Typeface.geist(13))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, minHeight: 88)
        } else if let error = model.calendarsError, model.availableCalendars.isEmpty {
            VStack(spacing: 10) {
                Text(error)
                    .font(Typeface.geist(13))
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
                Button("Try again") { Task { await model.loadCalendars() } }
                    .buttonStyle(SecondaryButtonStyle())
            }
            .frame(maxWidth: .infinity, minHeight: 88)
        } else {
            let calendars = model.availableCalendars
            let rows = ListContainer {
                ForEach(Array(calendars.enumerated()), id: \.element.id) { index, calendar in
                    if index > 0 { Hairline().padding(.leading, 40) }
                    CalendarRow(calendar: calendar)
                }
            }
            if calendars.count > maxVisibleRows && !isStaticRender {
                ScrollView { rows }
                    .frame(height: CGFloat(maxVisibleRows) * 44 + 2)
            } else {
                rows
            }
        }
    }
}

private struct CalendarRow: View {
    let calendar: CalendarInfo
    @Environment(AppModel.self) private var model

    var body: some View {
        Toggle(isOn: Binding(get: { model.isWatched(calendar.id) }, set: { model.setWatched(calendar.id, $0) })) {
            HStack(spacing: 14) {
                Circle()
                    .fill(Color(hex: calendar.colorHex))
                    .frame(width: 10, height: 10)
                Text(calendar.name)
                    .font(Typeface.geist(14, .medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
            }
        }
        .toggleStyle(CheckboxStyle())
        .padding(.leading, 16)
        .padding(.trailing, 14)
        .frame(height: 44)
        .accessibilityLabel(calendar.name)
    }
}
