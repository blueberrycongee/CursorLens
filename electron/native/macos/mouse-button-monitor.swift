import AppKit
import Foundation

private enum LeftButtonState: String {
    case down
    case up
}

private func isLeftButtonDown() -> Bool {
    (NSEvent.pressedMouseButtons & 1) != 0
}

private func currentMonotonicMs() -> Int64 {
    Int64(ProcessInfo.processInfo.systemUptime * 1_000)
}

@main
struct MouseButtonMonitorMain {
    static func main() {
        var previousState: LeftButtonState = isLeftButtonDown() ? .down : .up

        while true {
            autoreleasepool {
                let currentState: LeftButtonState = isLeftButtonDown() ? .down : .up
                if currentState != previousState {
                    print("LEFT_BUTTON \(currentState.rawValue) \(currentMonotonicMs())")
                    fflush(stdout)
                    previousState = currentState
                }
            }
            usleep(8_000)
        }
    }
}
