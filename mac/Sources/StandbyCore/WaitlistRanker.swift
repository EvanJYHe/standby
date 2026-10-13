import Foundation

/// Picks who gets an opening: people who asked for that service first, then people happy with any service; within
/// each group, whoever has waited longest.
public enum WaitlistRanker {
    public static func rank(_ entries: [WaitlistEntry], for service: String?, excluding: Set<UUID> = []) -> [WaitlistEntry] {
        let wanted = service.map(TitleParser.normalized).flatMap { $0.isEmpty ? nil : $0 }
        let any = TitleParser.normalized(WaitlistEntry.anyService)

        let tiered: [(tier: Int, entry: WaitlistEntry)] = entries.compactMap { entry in
            guard !excluding.contains(entry.id), !entry.isBlank else { return nil }
            let theirs = TitleParser.normalized(entry.service)
            if theirs.isEmpty || theirs == any { return (1, entry) }
            guard let wanted else { return (1, entry) }   // The slot's service is unknown: anyone could take it.
            return theirs == wanted ? (0, entry) : nil
        }

        return tiered
            .sorted { a, b in
                if a.tier != b.tier { return a.tier < b.tier }
                if a.entry.addedAt != b.entry.addedAt { return a.entry.addedAt < b.entry.addedAt }
                return a.entry.name.localizedCaseInsensitiveCompare(b.entry.name) == .orderedAscending
            }
            .map(\.entry)
    }
}
