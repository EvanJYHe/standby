import StandbyCore
import SwiftUI

/// The main screen: header, openings, today's appointments, and the week's count.
struct PopoverView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            if model.isSample { SampleDataLine() }
            if model.needsReconnect, !model.isSample { ReconnectBanner() }
            PopoverHeader()
            AdaptiveScroll {
                VStack(alignment: .leading, spacing: 0) {
                    OpeningsSection()
                    AgendaSection()
                        .padding(.top, 20)
                }
                .padding(.horizontal, 14)
                .padding(.top, 2)
                .padding(.bottom, 16)
            }
            PopoverFooter()
        }
        .frame(width: Theme.popoverSize.width, height: Theme.popoverSize.height)
        .animation(.easeOut(duration: 0.3), value: model.visibleOpenings.map(\.id))
    }
}

// MARK: Top

/// "Sample data · Connect Google in Settings"
private struct SampleDataLine: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 5) {
            Text("Sample data")
            Text("·")
            Button("Connect Google in Settings") { model.openSettings(.account) }
                .buttonStyle(QuietButtonStyle(fontSize: 11.5, color: Theme.muted, hoverColor: Theme.blue))
        }
        .font(Typeface.geist(11.5, .medium))
        .foregroundStyle(Theme.muted)
        .frame(maxWidth: .infinity)
        .frame(height: 28)
        .background(Color.black.opacity(0.028))
        .overlay(alignment: .bottom) { Hairline() }
    }
}

private struct ReconnectBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(Color(rgb: 0xD93025))
            if model.signInState == .waitingForBrowser {
                Text("Finish signing in in your browser.")
                    .font(Typeface.geist(12, .medium))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: 4)
                Button("Cancel") { model.cancelSignIn() }
                    .buttonStyle(QuietButtonStyle(fontSize: 12, color: Theme.blue, hoverColor: Theme.blueHover))
            } else {
                Text("Google needs you to sign in again.")
                    .font(Typeface.geist(12, .medium))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: 4)
                Button("Reconnect Google") { model.reconnectGoogle() }
                    .buttonStyle(QuietButtonStyle(fontSize: 12, color: Theme.blue, hoverColor: Theme.blueHover))
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 32)
        .background(Color(rgb: 0xFCE8E6).opacity(0.7))
        .overlay(alignment: .bottom) { Hairline() }
    }
}

private struct PopoverHeader: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 8) {
            StandbyMark.view(height: 18, color: Theme.blue)
            Text("Standby")
                .font(Typeface.geist(15, .semibold))
                .tracking(-0.45)
                .foregroundStyle(Theme.ink)
            Spacer(minLength: 8)
            StatusPill(watching: model.isWatching) { model.togglePaused() }
            Button {
                model.openSettings(.account)
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 14, weight: .regular))
            }
            .buttonStyle(IconButtonStyle())
            .help("Settings")
            .accessibilityLabel("Settings")
        }
        .padding(.leading, 16)
        .padding(.trailing, 10)
        .frame(height: 54)
    }
}

/// A green dot and "Watching", or a grey dot and "Paused". Clicking it pauses or resumes.
struct StatusPill: View {
    var watching: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Circle()
                    .fill(watching ? Theme.greenDot : Theme.pausedDot)
                    .frame(width: 7, height: 7)
                Text(watching ? "Watching" : "Paused")
                    .font(Typeface.geist(12, .medium))
                    .foregroundStyle(Theme.ink2)
            }
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(Capsule().fill(Color.black.opacity(0.045)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(watching ? "Pause watching" : "Resume watching")
        .accessibilityLabel(watching ? "Watching. Click to pause." : "Paused. Click to resume.")
    }
}

// MARK: Openings

private struct OpeningsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let openings = model.visibleOpenings
        VStack(spacing: 10) {
            if openings.isEmpty {
                AllBookedState()
            } else {
                ForEach(openings) { opening in
                    OpeningCard(opening: opening)
                        .transition(.opacity.combined(with: .offset(y: -6)))
                }
            }
        }
    }
}

/// "All booked. Standby is watching."
private struct AllBookedState: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 12) {
            StandbyMark.view(height: 26, color: Theme.markGrey)
            Text(model.isWatching ? "All booked. Standby is watching." : "Standby is paused.")
                .font(Typeface.serif(22))
                .foregroundStyle(Theme.ink)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 34)
        .padding(.bottom, 30)
        .accessibilityElement(children: .combine)
    }
}

struct OpeningCard: View {
    let opening: Opening
    @Environment(AppModel.self) private var model

    var body: some View {
        if let booking = model.booking(for: opening) {
            BookedRow(booking: booking)
        } else {
            card
        }
    }

    private var offer: OfferState? { model.offers[opening.id] }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.formatting.slot(opening.start, opening.end, now: model.now))
                        .font(Typeface.geist(15, .semibold))
                        .tracking(-0.25)
                        .foregroundStyle(Theme.ink)
                    Text(Copy.openingDetail(opening))
                        .font(Typeface.geist(13))
                        .foregroundStyle(Theme.muted)
                }
                .lineLimit(1)
                Spacer(minLength: 8)
                if offer == nil {
                    Button("Offer it") { model.offer(opening.id) }
                        .buttonStyle(PrimaryButtonStyle(height: 30))
                        .keyboardShortcut(.defaultAction)
                }
            }
            if let offer {
                Hairline()
                    .padding(.vertical, 12)
                OfferProgress(opening: opening, offer: offer)
                    .transition(.opacity)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).fill(.white))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
        .shadow(color: Theme.ink.opacity(0.05), radius: 8, y: 3)
        .contextMenu {
            Button("Dismiss opening") { model.dismiss(opening.id) }
        }
        .animation(.easeOut(duration: 0.25), value: offer)
        .accessibilityElement(children: .contain)
    }
}

/// The offer, in place: calling, then the yes, then booking.
private struct OfferProgress: View {
    let opening: Opening
    let offer: OfferState
    @Environment(AppModel.self) private var model

    var body: some View {
        switch offer {
        case .calling(let id):
            if let person = model.waitlistEntry(id) {
                HStack(spacing: 12) {
                    CallBadge(tint: Theme.blue) { Waveform(color: Theme.blue) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Calling \(person.name)…")
                            .font(Typeface.geist(14, .medium))
                            .foregroundStyle(Theme.ink)
                        Text("Calls are simulated in this version")
                            .font(Typeface.geist(12))
                            .foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
            }
        case .accepted(let id), .booking(let id), .failed(let id, _):
            if let person = model.waitlistEntry(id) {
                accepted(person)
            }
        case .noCandidates:
            HStack(spacing: 10) {
                Text("No one on your waitlist wants this time yet.")
                    .font(Typeface.geist(13))
                    .foregroundStyle(Theme.ink2)
                Spacer(minLength: 4)
                Button("Edit waitlist") { model.openSettings(.waitlist) }
                    .buttonStyle(QuietButtonStyle(fontSize: 13, color: Theme.blue, hoverColor: Theme.blueHover))
            }
        }
    }

    private func accepted(_ person: WaitlistEntry) -> some View {
        let isBooking: Bool = if case .booking = offer { true } else { false }
        let failure: String? = if case .failed(_, let message) = offer { message } else { nil }
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                CallBadge(tint: Theme.green) {
                    Image(systemName: "phone.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.green)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(person.firstName) said yes")
                        .font(Typeface.geist(14, .semibold))
                        .tracking(-0.1)
                        .foregroundStyle(Theme.ink)
                    Text(person.phone.isEmpty ? "Simulated call" : "Simulated call · \(person.phone)")
                        .font(Typeface.geist(12))
                        .foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            if let failure {
                Text(failure)
                    .font(Typeface.geist(12, .medium))
                    .foregroundStyle(Color(rgb: 0xC5221F))
            }
            HStack(spacing: 8) {
                Button(isBooking ? "Booking…" : "Book \(person.firstName)") { model.book(opening.id) }
                    .buttonStyle(PrimaryButtonStyle(height: 30))
                    .keyboardShortcut(.defaultAction)
                    .disabled(isBooking)
                Button("Try someone else") { model.tryNext(opening.id) }
                    .buttonStyle(SecondaryButtonStyle(height: 30))
                    .disabled(isBooking)
                Spacer(minLength: 0)
            }
        }
    }
}

/// A tinted circle holding the call's state: a waveform while ringing, a phone once they answer.
private struct CallBadge<Content: View>: View {
    var tint: Color
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            Circle().fill(tint.opacity(0.1))
            content
        }
        .frame(width: 36, height: 36)
    }
}

/// "Booked · Sarah Chen, 5:00 PM" with a green check.
private struct BookedRow: View {
    let booking: Booking
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 19))
                .symbolRenderingMode(.palette)
                .foregroundStyle(.white, Theme.green)
            VStack(alignment: .leading, spacing: 2) {
                Text("Booked · \(booking.personName), \(model.formatting.time(booking.start))")
                    .font(Typeface.geist(14, .medium))
                    .tracking(-0.1)
                    .foregroundStyle(Theme.ink)
                Text(booking.isSample ? "Added to the sample calendar" : "Added to Google Calendar")
                    .font(Typeface.geist(12))
                    .foregroundStyle(Theme.muted)
            }
            .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).fill(.white))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
        .shadow(color: Theme.ink.opacity(0.04), radius: 6, y: 2)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Today

private struct AgendaSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let agenda = model.agenda
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(agenda.title)
                    .font(Typeface.geist(13, .semibold))
                    .foregroundStyle(Theme.ink)
                Spacer()
                Text(model.formatting.longDate(agenda.date))
                    .font(Typeface.geist(12))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 2)
            .padding(.bottom, 6)

            if agenda.items.isEmpty {
                Text(agenda.isToday ? "Nothing else on your calendar today." : "Nothing on your calendar.")
                    .font(Typeface.geist(13))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 2)
                    .padding(.top, 6)
            } else {
                let lineIndex = agenda.isToday ? nowLineIndex(agenda.items) : nil
                let timeWidth = timeColumnWidth(agenda.items)
                ForEach(Array(agenda.items.enumerated()), id: \.element.id) { index, item in
                    if index == lineIndex { NowLine() }
                    AgendaRow(item: item, isPast: item.end <= model.now, timeWidth: timeWidth)
                }
                if lineIndex == agenda.items.count { NowLine() }
            }
        }
    }

    /// Where the red now-line goes: before the first appointment that hasn't started.
    private func nowLineIndex(_ items: [AgendaItem]) -> Int {
        items.firstIndex { $0.start > model.now } ?? items.count
    }

    /// Wide enough for the longest time range in the list ("11:30 AM–12:15 PM"), so none is cut off.
    private func timeColumnWidth(_ items: [AgendaItem]) -> CGFloat {
        let font = Typeface.nsGeist(12.5, tabular: true)
        let widest = items.map { item in
            (model.formatting.range(item.start, item.end) as NSString).size(withAttributes: [.font: font]).width
        }.max() ?? 0
        return min(max(ceil(widest) + 14, 84), 132)
    }
}

private struct AgendaRow: View {
    let item: AgendaItem
    let isPast: Bool
    let timeWidth: CGFloat
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(Color(hex: item.colorHex).opacity(item.isCancelled ? 0.35 : 1))
                .frame(width: 3, height: 20)
            Text(model.formatting.range(item.start, item.end))
                .font(Typeface.geist(12.5, tabular: true))
                .foregroundStyle(Theme.muted)
                .frame(width: timeWidth, alignment: .leading)
                .lineLimit(1)
            Text(item.title)
                .font(Typeface.geist(13, .medium))
                .foregroundStyle(item.isCancelled ? Theme.muted : Theme.ink)
                .strikethrough(item.isCancelled, color: Theme.muted)
                .lineLimit(1)
            Spacer(minLength: 6)
            if item.isCancelled {
                Text("Cancelled")
                    .font(Typeface.geist(11, .medium))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 7)
                    .frame(height: 18)
                    .background(Capsule().fill(Color.black.opacity(0.05)))
            } else if item.bookedByStandby {
                StandbyMark.view(height: 11, color: Theme.blue)
                    .help("Booked by Standby")
                    .accessibilityLabel("Booked by Standby")
            }
        }
        .padding(.horizontal, 2)
        .frame(height: 34)
        .opacity(isPast && !item.isCancelled ? 0.5 : 1)
        .accessibilityElement(children: .combine)
    }
}

/// Google Calendar's red current-time line.
private struct NowLine: View {
    var body: some View {
        HStack(spacing: 0) {
            Circle().fill(Theme.nowRed).frame(width: 7, height: 7)
            Rectangle().fill(Theme.nowRed).frame(height: 1.5)
        }
        .frame(height: 7)
        .padding(.leading, -1)
        .accessibilityHidden(true)
    }
}

// MARK: Bottom

private struct PopoverFooter: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 8) {
            Text(Copy.filledThisWeek(model.filledThisWeek))
                .font(Typeface.geist(12.5, .medium))
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .layoutPriority(1)
            Spacer(minLength: 8)
            Button {
                model.openGoogleCalendar()
            } label: {
                HStack(spacing: 3) {
                    Text("Open Google Calendar")
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 9, weight: .semibold))
                }
            }
            .buttonStyle(QuietButtonStyle(fontSize: 12.5, color: Theme.muted, hoverColor: Theme.blue))
        }
        .padding(.horizontal, 16)
        .frame(height: 44)
        .overlay(alignment: .top) { Hairline() }
    }
}
