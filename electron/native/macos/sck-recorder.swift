import Foundation
import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import ScreenCaptureKit

struct RecorderArguments {
    let outputPath: String
    let sourceId: String?
    let displayId: String?
    let hideCursor: Bool
    let fps: Int
    let targetWidth: Int?
    let targetHeight: Int?

    static func parse(from argv: [String]) throws -> RecorderArguments {
        var outputPath: String?
        var sourceId: String?
        var displayId: String?
        var hideCursor = false
        var fps = 60
        var targetWidth: Int?
        var targetHeight: Int?

        var idx = 1
        while idx < argv.count {
            let key = argv[idx]
            let next = idx + 1 < argv.count ? argv[idx + 1] : nil
            switch key {
            case "--output":
                guard let value = next else { throw RecorderError.invalidArguments("Missing --output value") }
                outputPath = value
                idx += 2
            case "--source-id":
                sourceId = next
                idx += 2
            case "--display-id":
                displayId = next
                idx += 2
            case "--hide-cursor":
                guard let value = next else { throw RecorderError.invalidArguments("Missing --hide-cursor value") }
                hideCursor = value == "1" || value.lowercased() == "true"
                idx += 2
            case "--fps":
                guard let value = next, let parsed = Int(value), parsed > 0 else {
                    throw RecorderError.invalidArguments("Invalid --fps value")
                }
                fps = max(1, min(120, parsed))
                idx += 2
            case "--width":
                if let value = next, let parsed = Int(value), parsed > 1 {
                    targetWidth = parsed
                }
                idx += 2
            case "--height":
                if let value = next, let parsed = Int(value), parsed > 1 {
                    targetHeight = parsed
                }
                idx += 2
            default:
                idx += 1
            }
        }

        guard let outputPath else {
            throw RecorderError.invalidArguments("--output is required")
        }

        return RecorderArguments(
            outputPath: outputPath,
            sourceId: sourceId,
            displayId: displayId,
            hideCursor: hideCursor,
            fps: fps,
            targetWidth: targetWidth,
            targetHeight: targetHeight
        )
    }
}

enum RecorderError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case sourceNotFound(String)
    case streamNotStarted
    case writerFailed(String)

    var description: String {
        switch self {
        case let .invalidArguments(message):
            return "Invalid arguments: \(message)"
        case let .sourceNotFound(message):
            return "Capture source not found: \(message)"
        case .streamNotStarted:
            return "Stream did not start"
        case let .writerFailed(message):
            return "Writer failed: \(message)"
        }
    }
}

final class StopSignal {
    private var continuation: CheckedContinuation<Void, Never>?
    private var sources: [DispatchSourceSignal] = []

    init() {
        for sig in [SIGINT, SIGTERM] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { [weak self] in
                guard let self else { return }
                self.continuation?.resume()
                self.continuation = nil
            }
            source.resume()
            sources.append(source)
        }
    }

    func wait() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }
}

final class ScreenStreamWriter: NSObject, SCStreamOutput {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private var firstPTS: CMTime?
    private(set) var frameCount = 0

    init(outputURL: URL, width: Int, height: Int, fps: Int) throws {
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: max(width * height * max(1, fps), 6_000_000),
                    AVVideoMaxKeyFrameIntervalKey: max(1, fps),
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                ],
            ]
        )
        input.expectsMediaDataInRealTime = true
        if !writer.canAdd(input) {
            throw RecorderError.writerFailed("Unable to attach AVAssetWriterInput")
        }
        writer.add(input)

        adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
                kCVPixelFormatOpenGLCompatibility as String: true,
            ]
        )
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen else { return }
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstPTS == nil {
            firstPTS = pts
            writer.startWriting()
            writer.startSession(atSourceTime: .zero)
        }

        guard let firstPTS else { return }
        guard input.isReadyForMoreMediaData else { return }

        let relative = CMTimeSubtract(pts, firstPTS)
        if adaptor.append(pixelBuffer, withPresentationTime: relative) {
            frameCount += 1
        }
    }

    func finish() async throws {
        input.markAsFinished()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            writer.finishWriting {
                continuation.resume()
            }
        }
        if writer.status == .failed {
            throw RecorderError.writerFailed(writer.error?.localizedDescription ?? "Unknown AVAssetWriter failure")
        }
        if writer.status != .completed {
            throw RecorderError.writerFailed("AVAssetWriter finished with status=\(writer.status.rawValue)")
        }
    }
}

@available(macOS 13.0, *)
final class SCKRecorder {
    private let args: RecorderArguments
    private var stream: SCStream?
    private var writer: ScreenStreamWriter?

    init(args: RecorderArguments) {
        self.args = args
    }

    func start() async throws -> (width: Int, height: Int, sourceKind: String) {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let resolved = try resolveSource(from: content)

        let outputURL = URL(fileURLWithPath: args.outputPath)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)

        let writer = try ScreenStreamWriter(
            outputURL: outputURL,
            width: resolved.width,
            height: resolved.height,
            fps: args.fps
        )

        let config = SCStreamConfiguration()
        config.width = resolved.width
        config.height = resolved.height
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(args.fps))
        config.queueDepth = 6
        config.capturesAudio = false
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = !args.hideCursor

        let stream = SCStream(filter: resolved.filter, configuration: config, delegate: nil)
        try stream.addStreamOutput(writer, type: .screen, sampleHandlerQueue: DispatchQueue(label: "com.cursorlens.sck-recorder.video"))

        try await stream.startCapture()

        self.writer = writer
        self.stream = stream

        return (width: resolved.width, height: resolved.height, sourceKind: resolved.sourceKind)
    }

    func stop() async throws -> Int {
        guard let stream, let writer else {
            throw RecorderError.streamNotStarted
        }

        try await stream.stopCapture()
        try await writer.finish()
        return writer.frameCount
    }

    private func resolveSource(from content: SCShareableContent) throws -> (filter: SCContentFilter, width: Int, height: Int, sourceKind: String) {
        if let sourceId = args.sourceId, sourceId.hasPrefix("window:"),
           let numericPart = sourceId.split(separator: ":").dropFirst().first,
           let windowId = UInt32(numericPart),
           let window = content.windows.first(where: { $0.windowID == windowId }) {
            let width = max(2, forceEven(args.targetWidth ?? Int(window.frame.width)))
            let height = max(2, forceEven(args.targetHeight ?? Int(window.frame.height)))
            return (
                filter: SCContentFilter(desktopIndependentWindow: window),
                width: width,
                height: height,
                sourceKind: "window"
            )
        }

        let display: SCDisplay
        if let displayIdRaw = args.displayId,
           let displayId = UInt32(displayIdRaw),
           let match = content.displays.first(where: { $0.displayID == displayId }) {
            display = match
        } else if let fallback = content.displays.first {
            display = fallback
        } else {
            throw RecorderError.sourceNotFound("No display available")
        }

        let width = max(2, forceEven(args.targetWidth ?? display.width))
        let height = max(2, forceEven(args.targetHeight ?? display.height))

        return (
            filter: SCContentFilter(display: display, excludingWindows: []),
            width: width,
            height: height,
            sourceKind: "display"
        )
    }

    private func forceEven(_ value: Int) -> Int {
        value % 2 == 0 ? value : value - 1
    }
}

@main
struct NativeRecorderMain {
    static func main() async {
        do {
            let args = try RecorderArguments.parse(from: CommandLine.arguments)
            guard #available(macOS 13.0, *) else {
                throw RecorderError.invalidArguments("ScreenCaptureKit recorder requires macOS 13.0+")
            }

            let recorder = SCKRecorder(args: args)
            let info = try await recorder.start()

            print("SCK_RECORDER_READY width=\(info.width) height=\(info.height) fps=\(args.fps) source=\(info.sourceKind)")
            fflush(stdout)

            let stopSignal = StopSignal()
            await stopSignal.wait()

            let frameCount = try await recorder.stop()
            print("SCK_RECORDER_DONE frames=\(frameCount)")
            fflush(stdout)
            exit(0)
        } catch {
            fputs("SCK_RECORDER_ERROR \(error)\n", stderr)
            fflush(stderr)
            exit(1)
        }
    }
}
