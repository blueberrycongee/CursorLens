import Foundation
import AppKit
import AVFoundation
import AudioToolbox
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

struct RecordingStopSummary {
    let frameCount: Int
    let observedFrameRate: Int
}

struct RecorderArguments {
    let outputPath: String
    let sourceId: String?
    let displayId: String?
    let hideCursor: Bool
    let microphoneEnabled: Bool
    let microphoneGain: Float
    let fps: Int
    let bitrateScale: Double
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
        var microphoneEnabled = true
        var microphoneGain: Float = 1
        var fps = 60
        var bitrateScale = 1.0
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
            case "--microphone-enabled":
                guard let value = next else { throw RecorderError.invalidArguments("Missing --microphone-enabled value") }
                microphoneEnabled = value == "1" || value.lowercased() == "true"
                idx += 2
            case "--microphone-gain":
                if let value = next, let parsed = Float(value), parsed.isFinite {
                    microphoneGain = parsed
                }
                idx += 2
            case "--fps":
                guard let value = next, let parsed = Int(value), parsed > 0 else {
                    throw RecorderError.invalidArguments("Invalid --fps value")
                }
                fps = max(1, min(120, parsed))
                idx += 2
            case "--bitrate-scale":
                if let value = next, let parsed = Double(value), parsed.isFinite {
                    bitrateScale = parsed
                }
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
        let clampedBitrateScale = max(0.5, min(2.0, bitrateScale))
        let clampedMicrophoneGain = max(Float(0.5), min(Float(2), microphoneGain))

        return RecorderArguments(
            outputPath: outputPath,
            sourceId: sourceId,
            displayId: displayId,
            hideCursor: hideCursor,
            microphoneEnabled: microphoneEnabled,
            microphoneGain: clampedMicrophoneGain,
            fps: fps,
            bitrateScale: clampedBitrateScale,
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
    case microphonePermissionDenied(String)
    case microphoneUnavailable(String)
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
        case .microphonePermissionDenied:
            return "microphone_permission_denied"
        case .microphoneUnavailable:
            return "microphone_unavailable"
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
        case let .microphonePermissionDenied(message):
            return "Microphone permission denied: \(message)"
        case let .microphoneUnavailable(message):
            return "Microphone unavailable: \(message)"
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

final class MicrophoneCaptureProvider: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let outputQueue = DispatchQueue(label: "com.cursorlens.sck-recorder.microphone-output")
    private var onSampleBuffer: ((CMSampleBuffer) -> Void)?

    func start(onSampleBuffer: @escaping (CMSampleBuffer) -> Void) throws {
        self.onSampleBuffer = onSampleBuffer

        guard let device = AVCaptureDevice.default(for: .audio) else {
            throw RecorderError.microphoneUnavailable("No microphone input device available")
        }

        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureAudioDataOutput()
        output.audioSettings = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
        ]
        output.setSampleBufferDelegate(self, queue: outputQueue)

        session.beginConfiguration()
        guard session.canAddInput(input) else {
            session.commitConfiguration()
            throw RecorderError.microphoneUnavailable("Unable to attach microphone input")
        }
        session.addInput(input)

        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            throw RecorderError.microphoneUnavailable("Unable to attach microphone output")
        }
        session.addOutput(output)
        session.commitConfiguration()
        session.startRunning()
    }

    func stop() {
        session.stopRunning()
        onSampleBuffer = nil
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
        onSampleBuffer?(sampleBuffer)
    }
}

final class ScreenStreamWriter: NSObject, SCStreamOutput {
    private static let microphoneLimiterCeiling: Float = 0.98

    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let audioInput: AVAssetWriterInput?
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private let ciContext = CIContext(options: [
        CIContextOption.cacheIntermediates: false,
    ])
    private let colorSpace = CGColorSpaceCreateDeviceRGB()
    private let audioQueue = DispatchQueue(label: "com.cursorlens.sck-recorder.audio-writer")
    private let microphoneGain: Float

    private let videoWidth: Int
    private let videoHeight: Int
    private let cameraProvider: CameraCaptureProvider?
    private let overlayRect: OverlayRect?
    private let overlayMaskImage: CIImage?
    private let overlayBorderImage: CIImage?
    let hasMicrophoneAudio: Bool

    private var firstPTS: CMTime?
    private var lastRelativePTS: CMTime?
    private(set) var frameCount = 0

    init(
        outputURL: URL,
        width: Int,
        height: Int,
        fps: Int,
        bitrateScale: Double,
        microphoneEnabled: Bool,
        microphoneGain: Float,
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
                    AVVideoAverageBitRateKey: max(Int(Double(width * height * max(1, fps)) * bitrateScale), 6_000_000),
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

        if microphoneEnabled {
            let audioInput = AVAssetWriterInput(
                mediaType: .audio,
                outputSettings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVEncoderBitRateKey: 128_000,
                    AVSampleRateKey: 44_100,
                    AVNumberOfChannelsKey: 1,
                ]
            )
            audioInput.expectsMediaDataInRealTime = true
            if writer.canAdd(audioInput) {
                writer.add(audioInput)
                self.audioInput = audioInput
            } else {
                throw RecorderError.writerFailed("Unable to attach AVAssetWriter audio input")
            }
        } else {
            audioInput = nil
        }

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
        self.microphoneGain = max(Float(0.5), min(Float(2), microphoneGain))
        self.cameraProvider = cameraProvider
        hasMicrophoneAudio = microphoneEnabled

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
            lastRelativePTS = relative
        }
    }

    func finish() async throws -> RecordingStopSummary {
        input.markAsFinished()
        audioInput?.markAsFinished()
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

        let observedFrameRate = resolveObservedFrameRate()
        return RecordingStopSummary(frameCount: frameCount, observedFrameRate: observedFrameRate)
    }

    private func resolveObservedFrameRate() -> Int {
        guard frameCount > 1 else { return 0 }
        guard let lastRelativePTS else { return 0 }
        let duration = lastRelativePTS.seconds
        guard duration.isFinite, duration > 0 else {
            return 0
        }
        let intervals = max(1, frameCount - 1)
        let estimated = Double(intervals) / duration
        guard estimated.isFinite else { return 0 }
        return max(1, min(240, Int(round(estimated))))
    }

    func appendMicrophoneSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        audioQueue.async { [weak self] in
            guard let self, let audioInput else { return }
            guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
            guard audioInput.isReadyForMoreMediaData else { return }
            guard let firstPTS else { return }

            let originalPTS = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            let relativePTS = CMTimeSubtract(originalPTS, firstPTS)
            guard relativePTS >= .zero else { return }

            guard let shiftedSampleBuffer = self.shiftSampleBufferTiming(sampleBuffer, by: firstPTS) else { return }
            let processedSampleBuffer = self.applyMicrophoneGainAndLimiter(to: shiftedSampleBuffer)
            _ = audioInput.append(processedSampleBuffer)
        }
    }

    private func applyMicrophoneGainAndLimiter(to sampleBuffer: CMSampleBuffer) -> CMSampleBuffer {
        if abs(microphoneGain - 1) < 0.0001 {
            return sampleBuffer
        }

        var mutableSampleBuffer: CMSampleBuffer?
        let copyStatus = CMSampleBufferCreateCopy(
            allocator: kCFAllocatorDefault,
            sampleBuffer: sampleBuffer,
            sampleBufferOut: &mutableSampleBuffer
        )
        guard copyStatus == noErr, let mutableSampleBuffer else {
            return sampleBuffer
        }

        guard let formatDescription = CMSampleBufferGetFormatDescription(mutableSampleBuffer),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            return mutableSampleBuffer
        }
        let asbd = asbdPtr.pointee
        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let isSignedInteger = (asbd.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0
        let bitsPerChannel = Int(asbd.mBitsPerChannel)

        var blockBuffer: CMBlockBuffer?
        var audioBufferList = AudioBufferList(
            mNumberBuffers: 1,
            mBuffers: AudioBuffer(
                mNumberChannels: asbd.mChannelsPerFrame,
                mDataByteSize: 0,
                mData: nil
            )
        )

        let listStatus = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            mutableSampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &audioBufferList,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            blockBufferOut: &blockBuffer
        )
        guard listStatus == noErr else {
            return mutableSampleBuffer
        }

        let limiterCeiling = Self.microphoneLimiterCeiling
        let audioBuffers = UnsafeMutableAudioBufferListPointer(&audioBufferList)

        for audioBuffer in audioBuffers {
            guard let data = audioBuffer.mData else { continue }

            if isFloat && bitsPerChannel == 32 {
                let sampleCount = Int(audioBuffer.mDataByteSize) / MemoryLayout<Float>.size
                let pointer = data.bindMemory(to: Float.self, capacity: sampleCount)
                for sampleIndex in 0..<sampleCount {
                    let amplified = pointer[sampleIndex] * microphoneGain
                    pointer[sampleIndex] = max(-limiterCeiling, min(limiterCeiling, amplified))
                }
                continue
            }

            if isSignedInteger && bitsPerChannel == 16 {
                let sampleCount = Int(audioBuffer.mDataByteSize) / MemoryLayout<Int16>.size
                let pointer = data.bindMemory(to: Int16.self, capacity: sampleCount)
                let maxSample = Float(Int16.max) * limiterCeiling
                for sampleIndex in 0..<sampleCount {
                    let amplified = Float(pointer[sampleIndex]) * microphoneGain
                    let limited = max(-maxSample, min(maxSample, amplified))
                    pointer[sampleIndex] = Int16(limited)
                }
            }
        }

        return mutableSampleBuffer
    }

    private func shiftSampleBufferTiming(_ sampleBuffer: CMSampleBuffer, by offset: CMTime) -> CMSampleBuffer? {
        var count = 0
        var status = CMSampleBufferGetSampleTimingInfoArray(
            sampleBuffer,
            entryCount: 0,
            arrayToFill: nil,
            entriesNeededOut: &count
        )
        guard status == noErr, count > 0 else { return nil }

        var timingInfo = Array(repeating: CMSampleTimingInfo(), count: count)
        status = CMSampleBufferGetSampleTimingInfoArray(
            sampleBuffer,
            entryCount: count,
            arrayToFill: &timingInfo,
            entriesNeededOut: &count
        )
        guard status == noErr else { return nil }

        for idx in 0..<count {
            if timingInfo[idx].presentationTimeStamp.isValid {
                timingInfo[idx].presentationTimeStamp = CMTimeSubtract(timingInfo[idx].presentationTimeStamp, offset)
            }
            if timingInfo[idx].decodeTimeStamp.isValid {
                timingInfo[idx].decodeTimeStamp = CMTimeSubtract(timingInfo[idx].decodeTimeStamp, offset)
            }
        }

        var adjustedSampleBuffer: CMSampleBuffer?
        status = CMSampleBufferCreateCopyWithNewTiming(
            allocator: kCFAllocatorDefault,
            sampleBuffer: sampleBuffer,
            sampleTimingEntryCount: count,
            sampleTimingArray: &timingInfo,
            sampleBufferOut: &adjustedSampleBuffer
        )
        guard status == noErr else { return nil }
        return adjustedSampleBuffer
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
    private var microphoneProvider: MicrophoneCaptureProvider?
    private let permissionGuidance = "Allow CursorLens in System Settings > Privacy & Security > Screen Recording, then relaunch the app."
    private let microphonePermissionGuidance = "Allow CursorLens in System Settings > Privacy & Security > Microphone, then relaunch the app."

    init(args: RecorderArguments) {
        self.args = args
    }

    @MainActor
    func start() async throws -> (width: Int, height: Int, sourceKind: String, hasMicrophoneAudio: Bool) {
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
                bitrateScale: args.bitrateScale,
                microphoneEnabled: args.microphoneEnabled,
                microphoneGain: args.microphoneGain,
                cameraProvider: cameraProvider,
                cameraShape: args.cameraShape,
                cameraSizePercent: args.cameraSizePercent
            )
        } catch {
            cameraProvider?.stop()
            throw error
        }

        var microphoneProvider: MicrophoneCaptureProvider?
        if args.microphoneEnabled {
            try await ensureMicrophonePermission()
            let provider = MicrophoneCaptureProvider()
            do {
                try provider.start { sampleBuffer in
                    writer.appendMicrophoneSampleBuffer(sampleBuffer)
                }
                microphoneProvider = provider
            } catch {
                cameraProvider?.stop()
                throw RecorderError.microphoneUnavailable(String(describing: error))
            }
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
            microphoneProvider?.stop()
            throw mapStreamStartError(error, sourceKind: resolved.sourceKind)
        }

        self.writer = writer
        self.stream = stream
        self.cameraProvider = cameraProvider
        self.microphoneProvider = microphoneProvider

        return (
            width: resolved.width,
            height: resolved.height,
            sourceKind: resolved.sourceKind,
            hasMicrophoneAudio: writer.hasMicrophoneAudio
        )
    }

    func stop() async throws -> RecordingStopSummary {
        guard let stream, let writer else {
            throw RecorderError.streamNotStarted
        }

        defer {
            cameraProvider?.stop()
            cameraProvider = nil
            microphoneProvider?.stop()
            microphoneProvider = nil
        }

        try await stream.stopCapture()
        return try await writer.finish()
    }

    private func resolveSource(from content: SCShareableContent) throws -> (filter: SCContentFilter, width: Int, height: Int, sourceKind: String) {
        if let sourceId = args.sourceId, sourceId.hasPrefix("window:"),
           let numericPart = sourceId.split(separator: ":").dropFirst().first,
           let windowId = UInt32(numericPart) {
            guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
                throw RecorderError.windowNotFound("The selected window is no longer on-screen (it may be minimized, closed, or moved to another Space).")
            }
            let defaultSize = resolveWindowCaptureSize(window: window, displays: content.displays)
            let width = max(2, forceEven(args.targetWidth ?? defaultSize.width))
            let height = max(2, forceEven(args.targetHeight ?? defaultSize.height))
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

        if looksLikePermissionError(nsError) {
            return .permissionDenied(permissionGuidance)
        }

        if sourceKind == "window" {
            let normalized = localized.lowercased()
            if normalized.contains("protected")
                || normalized.contains("not shar")
                || normalized.contains("cannot be captured")
                || normalized.contains("secure")
            {
                return .windowCaptureDenied("macOS marked this window as protected content and blocked capture.")
            }
            return .windowCaptureDenied("The selected window failed to start capture. Keep the window visible and try again. (domain: \(nsError.domain), code: \(nsError.code))")
        }

        return .streamStartFailed("\(localized) (domain: \(nsError.domain), code: \(nsError.code))")
    }

    private func mapShareableContentError(_ error: Error) -> RecorderError {
        let nsError = error as NSError
        let localized = nsError.localizedDescription

        if looksLikePermissionError(nsError) {
            return .permissionDenied(permissionGuidance)
        }

        return .streamStartFailed("Failed to enumerate shareable content: \(localized) (domain: \(nsError.domain), code: \(nsError.code))")
    }

    private func looksLikePermissionError(_ error: NSError) -> Bool {
        let normalized = error.localizedDescription.lowercased()
        let tokens = [
            "permission",
            "not authorized",
            "denied",
            "not permitted",
            "unauthorized",
            "没有权限",
            "無權限",
            "无权限",
            "未授权",
            "未授權",
            "拒绝",
            "拒絕",
            "不允许",
            "不允許",
            "屏幕录制",
            "螢幕錄製",
            "screen recording",
        ]
        if tokens.contains(where: { normalized.contains($0.lowercased()) }) {
            return true
        }

        // ScreenCaptureKit and TCC failures may report localized text; preserve a
        // domain/code fallback so permission failures don't get misclassified.
        return error.domain.lowercased().contains("tcc")
    }

    private func resolveWindowCaptureSize(window: SCWindow, displays: [SCDisplay]) -> (width: Int, height: Int) {
        let windowFrame = window.frame
        var scale = 1.0

        let frameCenter = CGPoint(x: windowFrame.midX, y: windowFrame.midY)
        if let display = displays.first(where: { $0.frame.contains(frameCenter) })
            ?? displays.first(where: { $0.frame.intersects(windowFrame) }) {
            let displayFrame = display.frame
            if displayFrame.width > 0, displayFrame.height > 0 {
                let scaleX = Double(display.width) / Double(displayFrame.width)
                let scaleY = Double(display.height) / Double(displayFrame.height)
                scale = max(1.0, (scaleX + scaleY) / 2.0)
            }
        }

        let width = max(2, forceEven(Int(round(Double(windowFrame.width) * scale))))
        let height = max(2, forceEven(Int(round(Double(windowFrame.height) * scale))))
        return (width: width, height: height)
    }

    private func ensureMicrophonePermission() async throws {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        switch status {
        case .authorized:
            return
        case .notDetermined:
            let granted = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                AVCaptureDevice.requestAccess(for: .audio) { approved in
                    continuation.resume(returning: approved)
                }
            }
            if !granted {
                throw RecorderError.microphonePermissionDenied(microphonePermissionGuidance)
            }
        case .denied, .restricted:
            throw RecorderError.microphonePermissionDenied(microphonePermissionGuidance)
        @unknown default:
            throw RecorderError.microphonePermissionDenied(microphonePermissionGuidance)
        }
    }

    private func forceEven(_ value: Int) -> Int {
        value % 2 == 0 ? value : value - 1
    }
}

@main
struct NativeRecorderMain {
    @MainActor
    private static func initializeWindowCaptureRuntime() {
        // Window-targeted SCContentFilter paths depend on an initialized CGS/AppKit runtime.
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
    }

    static func main() async {
        do {
            let args = try RecorderArguments.parse(from: CommandLine.arguments)
            guard #available(macOS 13.0, *) else {
                throw RecorderError.invalidArguments("ScreenCaptureKit recorder requires macOS 13.0+")
            }

            await MainActor.run {
                initializeWindowCaptureRuntime()
            }

            let recorder = SCKRecorder(args: args)
            let info = try await recorder.start()

            print("SCK_RECORDER_READY width=\(info.width) height=\(info.height) fps=\(args.fps) source=\(info.sourceKind) mic=\(info.hasMicrophoneAudio ? 1 : 0)")
            fflush(stdout)

            let stopSignal = StopSignal()
            await stopSignal.wait()

            let summary = try await recorder.stop()
            print("SCK_RECORDER_DONE frames=\(summary.frameCount) observed_fps=\(summary.observedFrameRate)")
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
