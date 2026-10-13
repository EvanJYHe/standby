import StandbyCore
import SwiftUI

/// The waitlist as an editable table: name, phone, and the service each person wants. Used in onboarding and Settings.
struct WaitlistEditor: View {
    var maxVisibleRows: Int
    @Environment(AppModel.self) private var model
    @Environment(\.isStaticRender) private var isStaticRender
    @FocusState private var focusedEntry: UUID?

    static let rowHeight: CGFloat = 40

    var body: some View {
        let entries = model.state.waitlist
        ListContainer {
            header
            Hairline()
            if entries.isEmpty {
                Text("No one yet. Add the people who want an earlier spot.")
                    .font(Typeface.geist(13))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, minHeight: Self.rowHeight * 1.5)
            } else if entries.count > maxVisibleRows && !isStaticRender {
                ScrollViewReader { proxy in
                    ScrollView {
                        rows(entries)
                    }
                    .frame(height: CGFloat(maxVisibleRows) * Self.rowHeight)
                    .onChange(of: entries.count) { old, new in
                        if new > old, let last = entries.last { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                }
            } else {
                rows(entries)
            }
            Hairline()
            Button {
                model.addWaitlistEntry()
                focusedEntry = model.state.waitlist.last?.id
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .semibold))
                    Text("Add person")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .frame(height: 38)
            }
            .buttonStyle(QuietButtonStyle(fontSize: 13, color: Theme.blue, hoverColor: Theme.blueHover))
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text("Name").frame(maxWidth: .infinity, alignment: .leading)
            Text("Phone").frame(width: WaitlistRow.phoneWidth, alignment: .leading)
            Text("Service").frame(width: WaitlistRow.serviceWidth, alignment: .leading)
            Color.clear.frame(width: WaitlistRow.removeWidth)
        }
        .font(Typeface.geist(11.5, .medium))
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 14)
        .frame(height: 30)
    }

    private func rows(_ entries: [WaitlistEntry]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                if index > 0 { Hairline().padding(.leading, 14) }
                WaitlistRow(entry: entry, focusedEntry: $focusedEntry)
                    .id(entry.id)
            }
        }
    }
}

private struct WaitlistRow: View {
    static let phoneWidth: CGFloat = 108
    static let serviceWidth: CGFloat = 98
    static let removeWidth: CGFloat = 20

    let entry: WaitlistEntry
    var focusedEntry: FocusState<UUID?>.Binding
    @Environment(AppModel.self) private var model
    @Environment(\.isStaticRender) private var isStaticRender
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 10) {
            field("Name", text: binding(\.name))
                .focused(focusedEntry, equals: entry.id)
                .frame(maxWidth: .infinity, alignment: .leading)
            field("Phone", text: binding(\.phone))
                .frame(width: Self.phoneWidth, alignment: .leading)
            serviceMenu
                .frame(width: Self.serviceWidth, alignment: .leading)
            Button {
                model.removeWaitlistEntry(entry.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9.5, weight: .semibold))
                    .frame(width: Self.removeWidth, height: Self.removeWidth)
            }
            .buttonStyle(IconButtonStyle(size: Self.removeWidth))
            .opacity(hovering ? 1 : 0.55)
            .help("Remove \(entry.isBlank ? "this person" : entry.name)")
            .accessibilityLabel("Remove \(entry.isBlank ? "this person" : entry.name)")
        }
        .padding(.horizontal, 14)
        .frame(height: WaitlistEditor.rowHeight)
        .onHover { hovering = $0 }
    }

    @ViewBuilder
    private func field(_ placeholder: String, text: Binding<String>) -> some View {
        if isStaticRender {
            Text(text.wrappedValue.isEmpty ? placeholder : text.wrappedValue)
                .font(Typeface.geist(13.5))
                .foregroundStyle(text.wrappedValue.isEmpty ? Theme.muted : Theme.ink)
                .lineLimit(1)
        } else {
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(Typeface.geist(13.5))
                .foregroundStyle(Theme.ink)
        }
    }

    private var serviceMenu: some View {
        Menu {
            Picker("Service", selection: binding(\.service)) {
                ForEach(model.serviceOptions, id: \.self) { Text($0).tag($0) }
                Divider()
                Text(WaitlistEntry.anyService).tag(WaitlistEntry.anyService)
            }
            .pickerStyle(.inline)
            .labelsHidden()
        } label: {
            Text(entry.service)
                .font(Typeface.geist(13))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.visible)
        .fixedSize()
        .accessibilityLabel("Service for \(entry.name)")
    }

    private func binding(_ keyPath: WritableKeyPath<WaitlistEntry, String>) -> Binding<String> {
        Binding(
            get: { model.waitlistEntry(entry.id)?[keyPath: keyPath] ?? entry[keyPath: keyPath] },
            set: { value in
                guard var current = model.waitlistEntry(entry.id) else { return }
                current[keyPath: keyPath] = value
                model.updateWaitlistEntry(current)
            }
        )
    }
}
