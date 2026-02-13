import AppKit
import CryptoKit
import Foundation

private let ibeamHashes: Set<String> = [
    // macOS I-beam
    "492dca0bb6751a30607ac728803af992ba69365052b7df2dff1c0dfe463e653c",
    // macOS I-beam vertical
    "024e1d486a7f16368669d419e69c9a326e464ec1b8ed39645e5c89cb183e03c5",
    "c715df2b1e5956f746fea3cdbe259136f3349773e9dbf26cc65b122905c4eb1c",
    // macOS Tahoe I-beam
    "3de4a52b22f76f28db5206dc4c2219dff28a6ee5abfb9c5656a469f2140f7eaa",
]

private enum CursorKind: String {
    case arrow
    case ibeam
}

private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func currentSystemCursor() -> NSCursor {
    if #available(macOS 14.0, *), let current = NSCursor.currentSystem {
        return current
    }
    return NSCursor.current
}

private func resolveCursorKind() -> CursorKind {
    let cursor = currentSystemCursor()
    if let tiff = cursor.image.tiffRepresentation {
        let hash = sha256Hex(tiff)
        if ibeamHashes.contains(hash) {
            return .ibeam
        }
    }

    if let name = cursor.image.name()?.lowercased(),
       name.contains("beam") || name.contains("text") {
        return .ibeam
    }

    return .arrow
}

@main
struct CursorKindMonitorMain {
    static func main() {
        var lastKind: CursorKind?

        while true {
            autoreleasepool {
                let currentKind = resolveCursorKind()
                if currentKind != lastKind {
                    print("CURSOR_KIND \(currentKind.rawValue)")
                    fflush(stdout)
                    lastKind = currentKind
                }
            }
            usleep(16_000)
        }
    }
}
