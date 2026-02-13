import Foundation
import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import CoreImage
import ScreenCaptureKit

enum CameraOverlayShape: String {
    case rounded
    case square
    case circle
}

struct OverlayRect {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
    let cornerRadius: Int
}

struct RecorderArguments {
    let outputPath: String
    let sourceId: String?
    let displayId: String?
    let hideCursor: Bool
    let fps: Int
    let targetWidth: Int?
    let targetHeight: Int?
    let cameraEnabled: Bool
    let cameraShape: CameraOverlayShape
    let cameraSizePercent: Int

    static func parse(from argv: [String]) throws -> RecorderArguments {
        var outputPath: String?
        var sourceId: String?
        var displayId: String?
        var hideCursor = false
        var fps = 60
        var targetWidth: Int?
        var targetHeight: Int?
        var cameraEnabled = false
        var cameraShape: CameraOverlayShape = .rounded
        var cameraSizePercent = 22

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
            case "--camera-enabled":
                guard let value = next else { throw RecorderError.invalidArguments("Missing --camera-enabled value") }
                cameraEnabled = value == "1" || value.lowercased() == "true"
                idx += 2
            case "--camera-shape":
                if let value = next, let shape = CameraOverlayShape(rawValue: value.lowercased()) {
                    cameraShape = shape
                }
                idx += 2
            case "--camera-size-percent":
                if let value = next, let parsed = Int(value) {
                    cameraSizePercent = parsed
                }
                idx += 2
            default:
                idx += 1
            }
        }

        guard let outputPath else {
            throw RecorderError.invalidArguments("--output is required")
        }

        let clampedSizePercent = max(14, min(40, cameraSizePercent))

        return RecorderArguments(
            outputPath: outputPath,
            sourceId: sourceId,
            displayId: displayId,
            hideCursor: hideCursor,
            fps: fps,
            targetWidth: targetWidth,
            targetHeight: targetHeight,
            cameraEnabled: cameraEnabled,
            cameraShape: cameraShape,
            cameraSizePercent: clampedSizePercent
        )
    }
}

enum RecorderError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case sourceNotFound(String)
    case permissionDenied(String)
    case windowNotFound(String)
    case windowCaptureDenied(String)
    case streamStartFailed(String)
    case streamNotStarted
    case writerFailed(String)
    case cameraUnavailable(String)

    var code: String {
        switch self {
        case .invalidArguments:
            return "invalid_arguments"
        case .sourceNotFound:
            return "source_not_found"
        case .permissionDenied:
            return "permission_denied"
        case .windowNotFound:
            return "window_not_found"
        case .windowCaptureDenied:
            return "window_capture_denied"
        case .streamStartFailed:
            return "stream_start_failed"
        case .streamNotStarted:
            return "stream_not_started"
        case .writerFailed:
            return "writer_failed"
        case .cameraUnavailable:
            return "camera_unavailable"
        }
    }

    var description: String {
        switch self {
        case let .invalidArguments(message):
            return "Invalid arguments: \(message)"
        case let .sourceNotFound(message):
            return "Capture source not found: \(message)"
        case let .permissionDenied(message):
            return "Screen Recording permission denied: \(message)"
        case let .windowNotFound(message):
            return "Selected window unavailable: \(message)"
        case let .windowCaptureDenied(message):
            return "Selected window cannot be captured: \(message)"
        case let .streamStartFailed(message):
            return "Failed to start capture stream: \(message)"
        case .streamNotStarted:
            return "Stream did not start"
        case let .writerFailed(message):
            return "Writer failed: \(message)"
        case let .cameraUnavailable(message):
            return "Camera unavailable: \(message)"
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

final class CameraCaptureProvider: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private static let virtualKeywords = [
        "virtual",
        "obs",
        "continuity",
        "desk view",
        "presenter",
        "iphone",
        "epoccam",
        "ndi",
        "snap camera",
    ]

    private let session = AVCaptureSession()
    private let outputQueue = DispatchQueue(label: "com.cursorlens.sck-recorder.camera-output")
    private let storageQueue = DispatchQueue(label: "com.cursorlens.sck-recorder.camera-storage")
    private var latestPixelBuffer: CVPixelBuffer?

    func start() throws {
        guard let device = selectCaptureDevice() else {
            throw RecorderError.cameraUnavailable("No video input device available")
        }

        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
        ]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: outputQueue)

        session.beginConfiguration()
        session.sessionPreset = .high

        guard session.canAddInput(input) else {
            session.commitConfiguration()
            throw RecorderError.cameraUnavailable("Unable to attach camera input")
        }
        session.addInput(input)

        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            throw RecorderError.cameraUnavailable("Unable to attach camera output")
        }
        session.addOutput(output)

        if let connection = output.connection(with: .video), connection.isVideoMirroringSupported {
            connection.isVideoMirrored = false
        }

        session.commitConfiguration()
        session.startRunning()
    }

    func stop() {
        session.stopRunning()
        storageQueue.sync {
            latestPixelBuffer = nil
        }
    }

    func copyLatestPixelBuffer() -> CVPixelBuffer? {
        storageQueue.sync {
            latestPixelBuffer
        }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        storageQueue.sync {
            latestPixelBuffer = pixelBuffer
        }
    }

    private func selectCaptureDevice() -> AVCaptureDevice? {
        var deviceTypes: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera]
        if #available(macOS 14.0, *) {
            deviceTypes.append(.external)
        } else {
            deviceTypes.append(.externalUnknown)
        }
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: deviceTypes,
            mediaType: .video,
            position: .unspecified
        ).devices
        guard !devices.isEmpty else { return nil }

        let nonVirtual = devices.filter { device in
            let label = device.localizedName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return !Self.virtualKeywords.contains(where: { keyword in
                label.contains(keyword)
            })
        }

        return nonVirtual.first ?? devices.first
    }
}

final class ScreenStreamWriter: NSObject, SCStreamOutput {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private let ciContext = CIContext(options: [
        CIContextOption.cacheIntermediates: false,
    ])
    private let colorSpace = CGColorSpaceCreateDeviceRGB()

    private let videoWidth: Int
    private let videoHeight: Int
    private let cameraProvider: CameraCaptureProvider?
    private let overlayRect: OverlayRect?
    private let overlayMaskImage: CIImage?
    private let overlayBorderImage: CIImage?

    private var firstPTS: CMTime?
    private(set) var frameCount = 0

    init(
        outputURL: URL,
        width: Int,
        height: Int,
        fps: Int,
        cameraProvider: CameraCaptureProvider?,
        cameraShape: CameraOverlayShape,
        cameraSizePercent: Int
    ) throws {
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

        videoWidth = width
        videoHeight = height
        self.cameraProvider = cameraProvider

        if cameraProvider != nil {
            let overlay = Self.computeOverlayRect(
                canvasWidth: width,
                canvasHeight: height,
                shape: cameraShape,
                sizePercent: cameraSizePercent
            )
            overlayRect = overlay
            overlayMaskImage = Self.buildMaskImage(canvasWidth: width, canvasHeight: height, overlay: overlay, shape: cameraShape)
            overlayBorderImage = Self.buildBorderImage(canvasWidth: width, canvasHeight: height, overlay: overlay, shape: cameraShape)
        } else {
            overlayRect = nil
            overlayMaskImage = nil
            overlayBorderImage = nil
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen else { return }
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard let screenPixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstPTS == nil {
            firstPTS = pts
            writer.startWriting()
            writer.startSession(atSourceTime: .zero)
        }

        guard let firstPTS else { return }
        guard input.isReadyForMoreMediaData else { return }

        let outputPixelBuffer: CVPixelBuffer
        if let composed = composeFrame(screenPixelBuffer: screenPixelBuffer) {
            outputPixelBuffer = composed
        } else {
            outputPixelBuffer = screenPixelBuffer
        }

        let relative = CMTimeSubtract(pts, firstPTS)
        if adaptor.append(outputPixelBuffer, withPresentationTime: relative) {
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

    private func composeFrame(screenPixelBuffer: CVPixelBuffer) -> CVPixelBuffer? {
        guard cameraProvider != nil else { return nil }
        guard let pool = adaptor.pixelBufferPool else { return nil }

        var outputBuffer: CVPixelBuffer?
        let poolResult = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outputBuffer)
        guard poolResult == kCVReturnSuccess, let outputBuffer else {
            return nil
        }

        var composed = CIImage(cvImageBuffer: screenPixelBuffer)

        if
            let cameraProvider,
            let cameraPixelBuffer = cameraProvider.copyLatestPixelBuffer(),
            let cameraImage = composeCameraImage(cameraPixelBuffer: cameraPixelBuffer)
        {
            if let overlayMaskImage {
                composed = cameraImage.applyingFilter("CIBlendWithMask", parameters: [
                    kCIInputBackgroundImageKey: composed,
                    kCIInputMaskImageKey: overlayMaskImage,
                ])
            } else {
                composed = cameraImage.composited(over: composed)
            }

            if let overlayBorderImage {
                composed = overlayBorderImage.composited(over: composed)
            }
        }

        ciContext.render(
            composed,
            to: outputBuffer,
            bounds: CGRect(x: 0, y: 0, width: videoWidth, height: videoHeight),
            colorSpace: colorSpace
        )

        return outputBuffer
    }

    private func composeCameraImage(cameraPixelBuffer: CVPixelBuffer) -> CIImage? {
        guard let overlayRect else { return nil }

        let targetRect = Self.convertToCISpace(overlayRect: overlayRect, canvasHeight: videoHeight)
        let source = CIImage(cvImageBuffer: cameraPixelBuffer)
        let sourceExtent = source.extent

        guard sourceExtent.width > 1, sourceExtent.height > 1 else {
            return nil
        }

        let sourceAspect = sourceExtent.width / sourceExtent.height
        let targetAspect = targetRect.width / targetRect.height

        var cropRect = sourceExtent
        if sourceAspect > targetAspect {
            let cropWidth = sourceExtent.height * targetAspect
            cropRect.origin.x += (sourceExtent.width - cropWidth) / 2
            cropRect.size.width = cropWidth
        } else if sourceAspect < targetAspect {
            let cropHeight = sourceExtent.width / targetAspect
            cropRect.origin.y += (sourceExtent.height - cropHeight) / 2
            cropRect.size.height = cropHeight
        }

        let cropped = source.cropped(to: cropRect)
        let normalized = cropped.transformed(by: CGAffineTransform(translationX: -cropRect.origin.x, y: -cropRect.origin.y))
        let scaled = normalized.transformed(by: CGAffineTransform(
            scaleX: targetRect.width / cropRect.width,
            y: targetRect.height / cropRect.height
        ))

        return scaled.transformed(by: CGAffineTransform(translationX: targetRect.origin.x, y: targetRect.origin.y))
    }

    private static func clamp(_ value: Int, min: Int, max: Int) -> Int {
        Swift.max(min, Swift.min(max, value))
    }

    private static func computeOverlayRect(
        canvasWidth: Int,
        canvasHeight: Int,
        shape: CameraOverlayShape,
        sizePercent: Int
    ) -> OverlayRect {
        let clampedSizePercent = clamp(sizePercent, min: 14, max: 40)
        let width = clamp(Int(round(Double(canvasWidth) * Double(clampedSizePercent) / 100.0)), min: 180, max: 560)
        let height = shape == .rounded
            ? Int(round(Double(width) * 9.0 / 16.0))
            : width
        let margin = clamp(Int(round(Double(canvasWidth) * 0.015)), min: 16, max: 36)
        let cornerRadius = shape == .rounded
            ? clamp(Int(round(Double(width) * 0.08)), min: 12, max: 26)
            : 0

        return OverlayRect(
            x: canvasWidth - width - margin,
            y: canvasHeight - height - margin,
            width: width,
            height: height,
            cornerRadius: cornerRadius
        )
    }

    private static func convertToCISpace(overlayRect: OverlayRect, canvasHeight: Int) -> CGRect {
        CGRect(
            x: CGFloat(overlayRect.x),
            y: CGFloat(canvasHeight - overlayRect.y - overlayRect.height),
            width: CGFloat(overlayRect.width),
            height: CGFloat(overlayRect.height)
        )
    }

    private static func createOverlayPath(rect: CGRect, shape: CameraOverlayShape, cornerRadius: CGFloat) -> CGPath {
        switch shape {
        case .square:
            return CGPath(rect: rect, transform: nil)
        case .circle:
            return CGPath(ellipseIn: rect, transform: nil)
        case .rounded:
            return CGPath(roundedRect: rect, cornerWidth: cornerRadius, cornerHeight: cornerRadius, transform: nil)
        }
    }

    private static func buildMaskImage(canvasWidth: Int, canvasHeight: Int, overlay: OverlayRect, shape: CameraOverlayShape) -> CIImage? {
        if shape == .square {
            return nil
        }

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(
            data: nil,
            width: canvasWidth,
            height: canvasHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }

        let rect = CGRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight)
        ctx.clear(rect)
        let shapeRect = convertToCISpace(overlayRect: overlay, canvasHeight: canvasHeight)
        let path = createOverlayPath(rect: shapeRect, shape: shape, cornerRadius: CGFloat(overlay.cornerRadius))

        ctx.setShouldAntialias(true)
        ctx.addPath(path)
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fillPath()

        guard let image = ctx.makeImage() else { return nil }
        return CIImage(cgImage: image)
    }

    private static func buildBorderImage(canvasWidth: Int, canvasHeight: Int, overlay: OverlayRect, shape: CameraOverlayShape) -> CIImage? {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(
            data: nil,
            width: canvasWidth,
            height: canvasHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }

        let rect = CGRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight)
        ctx.clear(rect)

        let shapeRect = convertToCISpace(overlayRect: overlay, canvasHeight: canvasHeight)
        let path = createOverlayPath(rect: shapeRect, shape: shape, cornerRadius: CGFloat(overlay.cornerRadius))

        ctx.setShouldAntialias(true)
        ctx.addPath(path)
        ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.45))
        ctx.setLineWidth(2)
        ctx.strokePath()

        guard let image = ctx.makeImage() else { return nil }
        return CIImage(cgImage: image)
    }
}

@available(macOS 13.0, *)
final class SCKRecorder {
    private let args: RecorderArguments
    private var stream: SCStream?
    private var writer: ScreenStreamWriter?
    private var cameraProvider: CameraCaptureProvider?
    private let permissionGuidance = "Allow CursorLens in System Settings > Privacy & Security > Screen Recording, then relaunch the app."

    init(args: RecorderArguments) {
        self.args = args
    }

    func start() async throws -> (width: Int, height: Int, sourceKind: String) {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            throw mapShareableContentError(error)
        }
        let resolved = try resolveSource(from: content)

        let outputURL = URL(fileURLWithPath: args.outputPath)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)

        var cameraProvider: CameraCaptureProvider?
        if args.cameraEnabled {
            let provider = CameraCaptureProvider()
            do {
                try provider.start()
                cameraProvider = provider
            } catch {
                throw RecorderError.cameraUnavailable(String(describing: error))
            }
        }

        let writer: ScreenStreamWriter
        do {
            writer = try ScreenStreamWriter(
                outputURL: outputURL,
                width: resolved.width,
                height: resolved.height,
                fps: args.fps,
                cameraProvider: cameraProvider,
                cameraShape: args.cameraShape,
                cameraSizePercent: args.cameraSizePercent
            )
        } catch {
            cameraProvider?.stop()
            throw error
        }

        let config = SCStreamConfiguration()
        config.width = resolved.width
        config.height = resolved.height
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(args.fps))
        config.queueDepth = 6
        config.capturesAudio = false
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = !args.hideCursor

        let stream = SCStream(filter: resolved.filter, configuration: config, delegate: nil)

        do {
            try stream.addStreamOutput(writer, type: .screen, sampleHandlerQueue: DispatchQueue(label: "com.cursorlens.sck-recorder.video"))
            try await stream.startCapture()
        } catch {
            cameraProvider?.stop()
            throw mapStreamStartError(error, sourceKind: resolved.sourceKind)
        }

        self.writer = writer
        self.stream = stream
        self.cameraProvider = cameraProvider

        return (width: resolved.width, height: resolved.height, sourceKind: resolved.sourceKind)
    }

    func stop() async throws -> Int {
        guard let stream, let writer else {
            throw RecorderError.streamNotStarted
        }

        defer {
            cameraProvider?.stop()
            cameraProvider = nil
        }

        try await stream.stopCapture()
        try await writer.finish()
        return writer.frameCount
    }

    private func resolveSource(from content: SCShareableContent) throws -> (filter: SCContentFilter, width: Int, height: Int, sourceKind: String) {
        if let sourceId = args.sourceId, sourceId.hasPrefix("window:"),
           let numericPart = sourceId.split(separator: ":").dropFirst().first,
           let windowId = UInt32(numericPart) {
            guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
                throw RecorderError.windowNotFound("The selected window is no longer on-screen (it may be minimized, closed, or moved to another Space).")
            }
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

    private func mapStreamStartError(_ error: Error, sourceKind: String) -> RecorderError {
        let nsError = error as NSError
        let localized = nsError.localizedDescription
        let normalized = localized.lowercased()

        if normalized.contains("not authorized") || normalized.contains("permission") || normalized.contains("denied") {
            return .permissionDenied(permissionGuidance)
        }

        if sourceKind == "window" {
            if normalized.contains("protected")
                || normalized.contains("not shar")
                || normalized.contains("cannot be captured")
                || normalized.contains("secure")
            {
                return .windowCaptureDenied("macOS marked this window as protected content and blocked capture.")
            }
            return .windowCaptureDenied("The selected window failed to start capture. Keep the window visible and try again.")
        }

        return .streamStartFailed(localized)
    }

    private func mapShareableContentError(_ error: Error) -> RecorderError {
        let nsError = error as NSError
        let localized = nsError.localizedDescription
        let normalized = localized.lowercased()

        if normalized.contains("not authorized") || normalized.contains("permission") || normalized.contains("denied") {
            return .permissionDenied(permissionGuidance)
        }

        return .streamStartFailed("Failed to enumerate shareable content: \(localized)")
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
            if let recorderError = error as? RecorderError {
                fputs("SCK_RECORDER_ERROR code=\(recorderError.code) message=\(recorderError)\n", stderr)
            } else {
                fputs("SCK_RECORDER_ERROR code=unknown message=\(error)\n", stderr)
            }
            fflush(stderr)
            exit(1)
        }
    }
}
