import AppKit
import Observation
import StandbyCore

enum OnboardingStep: Int, CaseIterable {
    case connect
    case calendars
    case waitlist
}

/// Where an opening's (simulated) offer stands.
enum OfferState: Equatable {
    case calling(UUID)
    case accepted(UUID)
    case booking(UUID)
    case failed(UUID, String)
    case noCandidates

    var entryID: UUID? {
        switch self {
        case .calling(let id), .accepted(let id), .booking(let id), .failed(let id, _): id
        case .noCandidates: nil
        }
    }
}

enum SignInState: Equatable {
    case idle
    case notConfigured
    case waitingForBrowser
    case finishing
    case failed(String)
}

enum SettingsTab: Int, CaseIterable {
    case account
    case calendars
    case waitlist
    case about

    var title: String {
        switch self {
        case .account: "Account"
        case .calendars: "Calendars"
        case .waitlist: "Waitlist"
        case .about: "About"
        }
    }

    var symbol: String {
        switch self {
        case .account: "person.crop.circle"
        case .calendars: "calendar"
        case .waitlist: "person.2"
        case .about: "info.circle"
        }
    }
}

/// One row of the popover's day list.
struct AgendaItem: Identifiable, Equatable {
    var id: String
    var title: String
    var start: Date
    var end: Date
    var colorHex: String
    var isCancelled: Bool
    var bookedByStandby: Bool
}

struct Agenda: Equatable {
    var title: String
    var date: Date
    var items: [AgendaItem]
    var isToday: Bool
}

@MainActor
@Observable
final class AppModel {
    static let syncInterval: Duration = .seconds(60)
    static let callDuration: Duration = .seconds(3)

    // MARK: Environment

    let config: GoogleClientConfig
    let isStatic: Bool
    var calendar: Calendar
    var locale: Locale
    @ObservationIgnored private let store: StateStore?
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private let auth: GoogleAuth
    @ObservationIgnored private let client: GoogleCalendarClient

    // MARK: State

    private(set) var state: PersistedState
    private(set) var now: Date
    var onboardingStep: OnboardingStep = .connect
    private(set) var signInState: SignInState = .idle
    private(set) var availableCalendars: [CalendarInfo]
    private(set) var calendarsLoading = false
    private(set) var calendarsError: String?
    private(set) var events: [CalendarEvent] = []
    private(set) var offers: [String: OfferState] = [:]
    private(set) var needsReconnect = false
    private(set) var lastSyncAt: Date?
    /// Titles from a wider look at the calendar, so the waitlist's service menu knows what you offer.
    private(set) var serviceTitles: [String] = []

    // MARK: Hooks for the window controllers

    @ObservationIgnored var onFinishOnboarding: (() -> Void)?
    @ObservationIgnored var onOpenSettings: ((SettingsTab) -> Void)?
    @ObservationIgnored var onRestartOnboarding: (() -> Void)?

    @ObservationIgnored private var syncTask: Task<Void, Never>?
    @ObservationIgnored private var tickTask: Task<Void, Never>?
    @ObservationIgnored private var sampleCancelTask: Task<Void, Never>?
    @ObservationIgnored private var signInTask: Task<Void, Never>?
    @ObservationIgnored private var callTasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var isSyncing = false
    @ObservationIgnored private var saveTask: Task<Void, Never>?

    init(
        config: GoogleClientConfig,
        store: StateStore?,
        clock: @escaping () -> Date = Date.init,
        calendar: Calendar = .current,
        locale: Locale = .current,
        initialState: PersistedState? = nil,
        isStatic: Bool = false
    ) {
        self.config = config
        self.store = store
        self.clock = clock
        self.calendar = calendar
        self.locale = locale
        self.isStatic = isStatic
        let loaded: PersistedState
        if let initialState {
            loaded = initialState
        } else if case .loaded(let saved)? = store?.load() {
            loaded = saved
        } else {
            loaded = PersistedState()
        }
        let auth = GoogleAuth(config: config)
        self.auth = auth
        client = GoogleCalendarClient(auth: auth)
        state = loaded
        now = clock()
        availableCalendars = loaded.mode == .sample ? SampleData.calendars : loaded.knownCalendars
    }

    var formatting: TimeFormatting { TimeFormatting(calendar: calendar, locale: locale) }
    var isSample: Bool { state.mode == .sample }
    var isWatching: Bool { !state.isPaused }

    // MARK: Lifecycle

    func start() {
        guard !isStatic else { return }
        startTicker()
        guard state.onboardingComplete else { return }
        if state.mode == .google, !auth.hasStoredCredentials { needsReconnect = true }
        prepareSampleSessionIfNeeded()
        startSyncLoop()
    }

    func popoverOpened() {
        now = clock()
        guard state.onboardingComplete, !state.isPaused else { return }
        if let lastSyncAt, clock().timeIntervalSince(lastSyncAt) < 10 { return }
        Task { await syncNow() }
    }

    func prepareForQuit() {
        saveTask?.cancel()
        try? store?.save(state)
    }

    // MARK: Onboarding

    func chooseSampleData() {
        cancelSignIn()
        let current = clock()
        state.mode = .sample
        state.account = nil
        state.sample = SampleSession(anchor: SampleData.anchor(for: current, calendar: calendar))
        state.seen = [:]
        state.openings = []
        state.knownCalendars = SampleData.calendars
        availableCalendars = SampleData.calendars
        state.watchedCalendarIDs = [SampleData.appointmentsCalendarID]
        if !state.bookings.contains(where: \.isSample) {
            state.bookings += SampleData.earlierBookings(now: current, calendar: calendar)
        }
        calendarsError = nil
        needsReconnect = false
        persist()
        if state.onboardingComplete {
            prepareSampleSessionIfNeeded()
            startSyncLoop()
        } else {
            onboardingStep = .calendars
        }
    }

    func signInWithGoogle() {
        guard config.isConfigured else {
            signInState = .notConfigured
            return
        }
        signInTask?.cancel()
        signInState = .waitingForBrowser
        signInTask = Task { [weak self] in
            guard let self else { return }
            do {
                let profile = try await auth.signIn()
                NSApp.activate()
                signInState = .finishing
                let reconnected = state.mode == .google && state.account?.email == profile.email
                if reconnected {
                    // Same account signing in again after its token expired: keep everything as it was.
                    state.account = profile
                    needsReconnect = false
                    persist()
                } else {
                    switchToGoogle(profile)
                }
                await loadCalendars()
                signInState = .idle
                if state.onboardingComplete {
                    startSyncLoop()
                    if !reconnected { onOpenSettings?(.calendars) }
                } else {
                    onboardingStep = .calendars
                }
            } catch is CancellationError {
                signInState = .idle
            } catch GoogleError.cancelled {
                signInState = .idle
            } catch GoogleError.accessDenied {
                signInState = .failed("Google sign-in was cancelled.")
            } catch {
                signInState = .failed("Couldn't connect to Google. Try again.")
            }
        }
    }

    func cancelSignIn() {
        auth.cancelSignIn()
        signInTask?.cancel()
        signInTask = nil
        if signInState != .notConfigured { signInState = .idle }
    }

    func finishCalendarsStep() {
        prefillWaitlistIfEmpty()
        onboardingStep = .waitlist
        if state.mode == .google { Task { await discoverServices() } }
    }

    func finishOnboarding() {
        state.waitlist.removeAll(where: \.isBlank)
        state.onboardingComplete = true
        state.seen = [:]
        state.openings = []
        persist()
        prepareSampleSessionIfNeeded()
        startSyncLoop()
        onFinishOnboarding?()
    }

    private func prefillWaitlistIfEmpty() {
        guard state.waitlist.isEmpty else { return }
        state.waitlist = SampleData.waitlist(now: clock())
        persist()
    }

    private func switchToGoogle(_ profile: AccountProfile) {
        sampleCancelTask?.cancel()
        state.mode = .google
        state.account = profile
        state.sample = nil
        state.seen = [:]
        state.openings = []
        state.watchedCalendarIDs = []
        state.knownCalendars = []
        availableCalendars = []
        events = []
        offers = [:]
        needsReconnect = false
        persist()
    }

    // MARK: Calendars

    func loadCalendars() async {
        switch state.mode {
        case .sample:
            availableCalendars = SampleData.calendars
        case .google:
            calendarsLoading = true
            defer { calendarsLoading = false }
            do {
                let calendars = try await client.calendars()
                let writable = calendars.filter(\.canWrite)
                let list = (writable.isEmpty ? calendars : writable).sorted { a, b in
                    if a.isPrimary != b.isPrimary { return a.isPrimary }
                    return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
                }
                availableCalendars = list
                state.knownCalendars = list
                let ids = Set(list.map(\.id))
                state.watchedCalendarIDs.removeAll { !ids.contains($0) }
                if state.watchedCalendarIDs.isEmpty, let primary = list.first(where: \.isPrimary) ?? list.first {
                    state.watchedCalendarIDs = [primary.id]
                }
                calendarsError = nil
                persist()
            } catch GoogleError.reconnectRequired {
                needsReconnect = true
                calendarsError = "Google needs you to sign in again."
            } catch {
                calendarsError = "Couldn't load your calendars. Check your connection and try again."
            }
        case nil:
            break
        }
    }

    func isWatched(_ calendarID: String) -> Bool {
        state.watchedCalendarIDs.contains(calendarID)
    }

    func setWatched(_ calendarID: String, _ watched: Bool) {
        if watched {
            if !state.watchedCalendarIDs.contains(calendarID) { state.watchedCalendarIDs.append(calendarID) }
        } else {
            state.watchedCalendarIDs.removeAll { $0 == calendarID }
            state.seen = OpeningDetector.forgetUnwatched(state.seen, watched: Set(state.watchedCalendarIDs))
            events.removeAll { $0.calendarID == calendarID }
        }
        persist()
        if state.onboardingComplete { Task { await syncNow() } }
    }

    func calendarColor(_ calendarID: String) -> String {
        (availableCalendars + state.knownCalendars).first { $0.id == calendarID }?.colorHex ?? GoogleColors.peacock
    }

    // MARK: Waitlist

    /// Services seen in the calendar's titles, for the waitlist's menu ("Any" is offered separately).
    var serviceOptions: [String] {
        let seen = TitleParser.services(in: events.map(\.title) + serviceTitles + state.seen.values.map(\.title))
        var services: [String] = []
        let candidates = (isSample ? SampleData.services : []) + seen + state.waitlist.map(\.service)
        for service in candidates where service != WaitlistEntry.anyService && !service.trimmingCharacters(in: .whitespaces).isEmpty {
            if !services.contains(where: { TitleParser.normalized($0) == TitleParser.normalized(service) }) {
                services.append(service)
            }
        }
        return services
    }

    func addWaitlistEntry() {
        state.waitlist.append(WaitlistEntry(name: "", phone: "", service: WaitlistEntry.anyService, addedAt: clock()))
        persist()
    }

    func updateWaitlistEntry(_ entry: WaitlistEntry) {
        guard let index = state.waitlist.firstIndex(where: { $0.id == entry.id }) else { return }
        state.waitlist[index] = entry
        persist()
    }

    func removeWaitlistEntry(_ id: UUID) {
        state.waitlist.removeAll { $0.id == id }
        persist()
    }

    func waitlistEntry(_ id: UUID?) -> WaitlistEntry? {
        guard let id else { return nil }
        return state.waitlist.first { $0.id == id }
    }

    private func discoverServices() async {
        guard state.mode == .google else { return }
        let current = clock()
        let window = DateInterval(start: current.addingTimeInterval(-30 * 86_400), end: current.addingTimeInterval(30 * 86_400))
        var titles: [String] = []
        for calendarID in state.watchedCalendarIDs {
            if let events = try? await client.events(calendarID: calendarID, window: window, maxPages: 2, allowPartial: true) {
                titles += events.map(\.title)
            }
        }
        serviceTitles = titles
    }

    // MARK: Watching

    func togglePaused() {
        state.isPaused.toggle()
        persist()
        if !state.isPaused { Task { await syncNow() } }
    }

    private func startSyncLoop() {
        syncTask?.cancel()
        guard !isStatic else { return }
        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.syncNow()
                try? await Task.sleep(for: Self.syncInterval)
            }
        }
    }

    private func startTicker() {
        tickTask?.cancel()
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                guard let self else { return }
                now = clock()
                var pruned = state
                pruned.pruneOpenings(now: now)
                if pruned != state {
                    state = pruned
                    persist()
                }
            }
        }
    }

    /// Fetches every watched calendar and turns cancellations into openings. Network errors are retried quietly on
    /// the next tick; an expired or revoked Google token shows the "Reconnect Google" banner.
    func syncNow() async {
        guard state.onboardingComplete, let mode = state.mode, !state.isPaused, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }

        let current = clock()
        let window = DateInterval(start: current.addingTimeInterval(-3600), end: current.addingTimeInterval(7 * 86_400))
        let watched = state.watchedCalendarIDs
        var seen = state.seen
        var newOpenings: [Opening] = []
        var fetched: [CalendarEvent] = []
        var succeeded = false

        for calendarID in watched {
            do {
                let calendarEvents = try await fetchEvents(calendarID: calendarID, window: window, mode: mode)
                let known = Set(state.openings.map(\.id)).union(newOpenings.map(\.id))
                let result = OpeningDetector.reconcile(
                    calendarID: calendarID,
                    fetched: calendarEvents,
                    window: window,
                    previous: seen,
                    knownOpeningIDs: known,
                    now: current
                )
                seen = result.seen
                newOpenings += result.newOpenings
                fetched += calendarEvents
                succeeded = true
            } catch GoogleError.reconnectRequired {
                needsReconnect = true
                return
            } catch {
                // Keep what was showing for this calendar; try again next time.
                fetched += events.filter { $0.calendarID == calendarID }
            }
        }

        // The user may have switched accounts or modes while the requests were in flight.
        guard succeeded, state.mode == mode, state.watchedCalendarIDs == watched else { return }
        needsReconnect = false
        state.seen = OpeningDetector.forgetUnwatched(seen, watched: Set(watched))
        state.openings += newOpenings
        state.pruneOpenings(now: current)
        events = fetched
        now = current
        lastSyncAt = current
        persist()
    }

    private func fetchEvents(calendarID: String, window: DateInterval, mode: PersistedState.Mode) async throws -> [CalendarEvent] {
        switch mode {
        case .google:
            return try await client.events(calendarID: calendarID, window: window)
        case .sample:
            return sampleEvents(calendarID: calendarID).filter { event in
                guard let start = event.start, let end = event.end else { return true }
                return end > window.start && start < window.end
            }
        }
    }

    // MARK: Sample calendar

    private func sampleEvents(calendarID: String) -> [CalendarEvent] {
        guard calendarID == SampleData.appointmentsCalendarID, let session = state.sample else { return [] }
        return SampleData.events(anchor: session.anchor, cancelled: session.cancelled) + session.createdEvents
    }

    /// Starts a fresh sample day when the last one is over, and has Josh cancel a few seconds after watching starts,
    /// so the opening arrives the way a real one would.
    private func prepareSampleSessionIfNeeded() {
        guard state.mode == .sample, !isStatic else { return }
        let current = clock()
        if state.sample == nil || state.sample!.anchor.addingTimeInterval(3600) <= current {
            state.sample = SampleSession(anchor: SampleData.anchor(for: current, calendar: calendar))
            state.seen = [:]
            state.openings.removeAll { !$0.isBooked }
            persist()
        }
        if state.sample?.cancelled == false { scheduleSampleCancellation() }
    }

    private func scheduleSampleCancellation() {
        sampleCancelTask?.cancel()
        sampleCancelTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard let self, !Task.isCancelled, state.mode == .sample, state.sample?.cancelled == false else { return }
            // Josh has to have been seen booked for his cancellation to count.
            if state.seen[EventKey.make(calendarID: SampleData.appointmentsCalendarID, eventID: "sample-josh")] == nil {
                await syncNow()
            }
            state.sample?.cancelled = true
            persist()
            await syncNow()
        }
    }

    func resetSampleData() {
        guard state.mode == .sample else { return }
        state.sample = nil
        state.openings = []
        state.seen = [:]
        offers = [:]
        if state.waitlist.isEmpty { state.waitlist = SampleData.waitlist(now: clock()) }
        persist()
        prepareSampleSessionIfNeeded()
        startSyncLoop()
    }

    // MARK: Openings

    /// Openings still worth offering, plus today's saves as confirmation rows until their slot ends.
    var visibleOpenings: [Opening] {
        state.openings
            .filter { $0.isOpen(at: now) || ($0.isBooked && $0.end > now) }
            .sorted { $0.start < $1.start }
    }

    var hasUnhandledOpening: Bool {
        state.onboardingComplete && state.openings.contains { $0.isOpen(at: now) }
    }

    var filledThisWeek: Int {
        state.bookingsThisWeek(now: now, calendar: calendar)
    }

    func booking(for opening: Opening) -> Booking? {
        guard let id = opening.bookingID else { return nil }
        return state.bookings.first { $0.id == id }
    }

    /// Ranks the waitlist and "calls" the best match. Calls are simulated: after a few seconds they say yes.
    func offer(_ openingID: String) {
        guard let opening = state.openings.first(where: { $0.id == openingID }), opening.isOpen(at: clock()) else { return }
        let ranked = WaitlistRanker.rank(state.waitlist, for: opening.service, excluding: Set(opening.triedEntryIDs))
        callTasks[openingID]?.cancel()
        guard let person = ranked.first else {
            offers[openingID] = .noCandidates
            return
        }
        offers[openingID] = .calling(person.id)
        callTasks[openingID] = Task { [weak self] in
            try? await Task.sleep(for: Self.callDuration)
            guard let self, !Task.isCancelled, offers[openingID] == .calling(person.id) else { return }
            offers[openingID] = .accepted(person.id)
        }
    }

    func tryNext(_ openingID: String) {
        guard let index = state.openings.firstIndex(where: { $0.id == openingID }),
              let current = offers[openingID]?.entryID else { return }
        state.openings[index].triedEntryIDs.append(current)
        persist()
        offer(openingID)
    }

    func cancelOffer(_ openingID: String) {
        callTasks[openingID]?.cancel()
        offers[openingID] = nil
    }

    func dismiss(_ openingID: String) {
        cancelOffer(openingID)
        guard let index = state.openings.firstIndex(where: { $0.id == openingID }) else { return }
        state.openings[index].dismissed = true
        persist()
    }

    /// Writes the booking to the calendar after checking the slot is still free.
    func book(_ openingID: String) {
        let entryID: UUID
        switch offers[openingID] {
        case .accepted(let id)?, .failed(let id, _)?: entryID = id
        default: return
        }
        guard let opening = state.openings.first(where: { $0.id == openingID }),
              let entry = waitlistEntry(entryID),
              let mode = state.mode else { return }
        offers[openingID] = .booking(entryID)

        Task { [weak self] in
            guard let self else { return }
            do {
                if mode == .google {
                    let slot = DateInterval(start: opening.start, end: opening.end)
                    let clash = try await client.events(calendarID: opening.calendarID, window: slot, maxPages: 1).contains { event in
                        guard event.status != .cancelled, event.key != opening.id, !event.isAllDay,
                              let start = event.start, let end = event.end else { return false }
                        return start < opening.end && end > opening.start
                    }
                    if clash {
                        offers[openingID] = .failed(entryID, "That time was just booked on your calendar.")
                        return
                    }
                }
                let draft = EventDraft.booking(for: entry, opening: opening)
                let created = try await createEvent(calendarID: opening.calendarID, draft: draft, mode: mode)
                record(created, for: opening, entry: entry, mode: mode)
            } catch GoogleError.reconnectRequired {
                needsReconnect = true
                offers[openingID] = .failed(entryID, "Reconnect Google to book this.")
            } catch {
                offers[openingID] = .failed(entryID, "Couldn't add it to your calendar. Try again.")
            }
        }
    }

    private func createEvent(calendarID: String, draft: EventDraft, mode: PersistedState.Mode) async throws -> CalendarEvent {
        switch mode {
        case .google:
            return try await client.insertEvent(calendarID: calendarID, draft: draft)
        case .sample:
            try await Task.sleep(for: .milliseconds(450))
            let event = CalendarEvent(
                id: "sample-booking-\(UUID().uuidString.prefix(8))",
                calendarID: calendarID,
                title: draft.title,
                start: draft.start,
                end: draft.end,
                colorHex: draft.colorID.flatMap { GoogleColors.eventColors[$0] },
                bookedByStandby: true
            )
            state.sample?.createdEvents.append(event)
            return event
        }
    }

    private func record(_ created: CalendarEvent, for opening: Opening, entry: WaitlistEntry, mode: PersistedState.Mode) {
        guard let index = state.openings.firstIndex(where: { $0.id == opening.id }) else { return }
        let booking = Booking(
            openingID: opening.id,
            calendarID: opening.calendarID,
            eventID: created.id,
            personName: entry.name,
            phone: entry.phone,
            service: opening.service ?? (entry.service == WaitlistEntry.anyService ? nil : entry.service),
            start: opening.start,
            end: opening.end,
            bookedAt: clock(),
            isSample: mode == .sample
        )
        state.bookings.append(booking)
        state.openings[index].bookingID = booking.id
        state.waitlist.removeAll { $0.id == entry.id }
        if let start = created.start, let end = created.end {
            state.seen[created.key] = SeenEvent(
                calendarID: created.calendarID,
                eventID: created.id,
                title: created.title,
                start: start,
                end: end,
                status: .confirmed,
                attendeeName: nil
            )
        }
        events.append(created)
        offers[opening.id] = nil
        callTasks[opening.id] = nil
        persist()
    }

    // MARK: Day list

    /// Today's appointments from an hour ago on, or tomorrow's once today is done. Cancelled appointments show only
    /// when Standby turned them into openings.
    var agenda: Agenda {
        let current = now
        let watched = Set(state.watchedCalendarIDs)
        let openingIDs = Set(state.openings.map(\.id))
        let items: [AgendaItem] = events.compactMap { event in
            guard watched.contains(event.calendarID), !event.isAllDay else { return nil }
            let seen = state.seen[event.key]
            guard let start = event.start ?? seen?.start, let end = event.end ?? seen?.end,
                  OpeningDetector.isAppointment(start: start, end: end, isAllDay: false),
                  end > current.addingTimeInterval(-3600) else { return nil }
            if event.status == .cancelled, !openingIDs.contains(event.key) { return nil }
            let title = event.title.isEmpty ? (seen?.title ?? "Busy") : event.title
            return AgendaItem(
                id: event.key,
                title: title,
                start: start,
                end: end,
                colorHex: event.colorHex ?? calendarColor(event.calendarID),
                isCancelled: event.status == .cancelled,
                bookedByStandby: event.bookedByStandby
            )
        }
        .sorted { a, b in
            if a.start != b.start { return a.start < b.start }
            return a.isCancelled && !b.isCancelled
        }

        let today = items.filter { calendar.isDate($0.start, inSameDayAs: current) }
        if let tomorrowDate = calendar.date(byAdding: .day, value: 1, to: current), !today.contains(where: { $0.end > current }) {
            let tomorrow = items.filter { calendar.isDate($0.start, inSameDayAs: tomorrowDate) }
            if !tomorrow.isEmpty { return Agenda(title: "Tomorrow", date: tomorrowDate, items: tomorrow, isToday: false) }
        }
        return Agenda(title: "Today", date: current, items: today, isToday: true)
    }

    // MARK: Account

    func reconnectGoogle() {
        signInWithGoogle()
    }

    func disconnectGoogle() {
        let auth = auth
        Task { await auth.signOut() }
        syncTask?.cancel()
        sampleCancelTask?.cancel()
        state.mode = nil
        state.account = nil
        state.onboardingComplete = false
        state.seen = [:]
        state.openings = []
        state.watchedCalendarIDs = []
        state.knownCalendars = []
        availableCalendars = []
        events = []
        offers = [:]
        needsReconnect = false
        onboardingStep = .connect
        signInState = .idle
        persist()
        onRestartOnboarding?()
    }

    func openSettings(_ tab: SettingsTab) {
        onOpenSettings?(tab)
    }

    func openGoogleCalendar() {
        NSWorkspace.shared.open(URL(string: "https://calendar.google.com")!)
    }

    // MARK: Saving

    /// Coalesces writes, so typing in the waitlist doesn't rewrite the file on every keystroke.
    private func persist() {
        guard let store, !isStatic else { return }
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard let self, !Task.isCancelled else { return }
            do {
                try store.save(state)
            } catch {
                NSLog("Standby: could not save state: %@", error.localizedDescription)
            }
        }
    }

    // MARK: Screenshot scenarios

    /// Sets offers directly, for rendering a state that normally takes a few seconds to reach.
    func setOfferForPreview(_ offer: OfferState?, openingID: String) {
        offers[openingID] = offer
    }

    func setEventsForPreview(_ events: [CalendarEvent]) {
        self.events = events
    }

    func applyPreview(signIn: SignInState? = nil, needsReconnect: Bool? = nil, lastSync: Date? = nil) {
        if let signIn { signInState = signIn }
        if let needsReconnect { self.needsReconnect = needsReconnect }
        if let lastSync { lastSyncAt = lastSync }
    }
}
