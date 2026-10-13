import Foundation

/// Google Calendar's colours. The API still reports calendars in its older pastel palette, so those are mapped to
/// the colours Google Calendar actually shows today.
public enum GoogleColors {
    /// Event `colorId` 1–11, as named in Google Calendar.
    public static let eventColors: [String: String] = [
        "1": "#7986cb",   // Lavender
        "2": "#33b679",   // Sage
        "3": "#8e24aa",   // Grape
        "4": "#e67c73",   // Flamingo
        "5": "#f6bf26",   // Banana
        "6": "#f4511e",   // Tangerine
        "7": "#039be5",   // Peacock
        "8": "#616161",   // Graphite
        "9": "#3f51b5",   // Blueberry
        "10": "#0b8043",  // Basil
        "11": "#d50000",  // Tomato
    ]

    public static let peacockEventColorID = "7"
    public static let peacock = "#039be5"

    /// Calendar `colorId` 1–24 → the colour Google Calendar's web app displays for it.
    public static let calendarColors: [String: String] = [
        "1": "#795548",   // Cocoa
        "2": "#e67c73",   // Flamingo
        "3": "#d50000",   // Tomato
        "4": "#f4511e",   // Tangerine
        "5": "#ef6c00",   // Pumpkin
        "6": "#f09300",   // Mango
        "7": "#009688",   // Eucalyptus
        "8": "#0b8043",   // Basil
        "9": "#7cb342",   // Pistachio
        "10": "#c0ca33",  // Avocado
        "11": "#e4c441",  // Citron
        "12": "#f6bf26",  // Banana
        "13": "#33b679",  // Sage
        "14": "#039be5",  // Peacock
        "15": "#4285f4",  // Cobalt
        "16": "#3f51b5",  // Blueberry
        "17": "#7986cb",  // Lavender
        "18": "#b39ddb",  // Wisteria
        "19": "#616161",  // Graphite
        "20": "#a79b8e",  // Birch
        "21": "#ad1457",  // Radicchio
        "22": "#d81b60",  // Cherry blossom
        "23": "#8e24aa",  // Grape
        "24": "#9e69af",  // Amethyst
    ]

    /// The legacy pastel `backgroundColor` values the API returns for each calendar `colorId`.
    static let legacyCalendarBackgrounds: [String: String] = [
        "#ac725e": "1", "#d06b64": "2", "#f83a22": "3", "#fa573c": "4", "#ff7537": "5", "#ffad46": "6",
        "#42d692": "7", "#16a765": "8", "#7bd148": "9", "#b3dc6c": "10", "#fbe983": "11", "#fad165": "12",
        "#92e1c0": "13", "#9fe1e7": "14", "#9fc6e7": "15", "#4986e7": "16", "#9a9cff": "17", "#b99aff": "18",
        "#c2c2c2": "19", "#cabdbf": "20", "#cca6ac": "21", "#f691b2": "22", "#cd74e6": "23", "#a47ae2": "24",
    ]

    /// The colour to show for a calendar from its `colorId` and `backgroundColor`.
    public static func calendarDisplayColor(colorID: String?, backgroundColor: String?) -> String {
        if let background = backgroundColor?.lowercased() {
            if let legacyID = legacyCalendarBackgrounds[background], let modern = calendarColors[legacyID] {
                return modern
            }
            if isHexColor(background) { return background }   // A custom colour the user picked.
        }
        if let colorID, let modern = calendarColors[colorID] { return modern }
        return peacock
    }

    public static func eventDisplayColor(colorID: String?) -> String? {
        colorID.flatMap { eventColors[$0] }
    }

    static func isHexColor(_ text: String) -> Bool {
        text.count == 7 && text.hasPrefix("#") && text.dropFirst().allSatisfy(\.isHexDigit)
    }
}
