import Foundation
import AVFoundation
import Speech

enum TranscriberError: Error {
    case invalidArguments(String)
    case speechPermissionDenied
    case recognizerUnavailable
    case exportFailed(String)
    case transcriptionFailed(String)
}

struct TranscriptWord: Codable {
    let text: String
    let startMs: Int
    let endMs: Int
    let confidence: Double
}

struct TranscriptionResult: Codable {
    let success: Bool
    let locale: String
    let text: String
    let words: [TranscriptWord]
}

struct ErrorResult: Codable {
    let success: Bool
    let code: String
    let message: String
}

struct ParsedArguments {
    let input: String
    let output: String
    let locale: String
    let startMs: Int?
    let durationMs: Int?
}

func parseArguments() throws -> ParsedArguments {
    var input: String?
    var output: String?
    var locale = "en-US"
    var startMs: Int?
    var durationMs: Int?

    var index = 1
    while index < CommandLine.arguments.count {
        let arg = CommandLine.arguments[index]
        switch arg {
        case "--input":
            index += 1
            if index < CommandLine.arguments.count { input = CommandLine.arguments[index] }
        case "--output":
            index += 1
            if index < CommandLine.arguments.count { output = CommandLine.arguments[index] }
        case "--locale":
            index += 1
            if index < CommandLine.arguments.count { locale = CommandLine.arguments[index] }
        case "--start-ms":
            index += 1
            if index < CommandLine.arguments.count {
                let parsed = Int(CommandLine.arguments[index])
                if let parsed {
                    startMs = parsed
                } else {
                    throw TranscriberError.invalidArguments("Invalid --start-ms")
                }
            }
        case "--duration-ms":
            index += 1
            if index < CommandLine.arguments.count {
                let parsed = Int(CommandLine.arguments[index])
                if let parsed {
                    durationMs = parsed
                } else {
                    throw TranscriberError.invalidArguments("Invalid --duration-ms")
                }
            }
        default:
            break
        }
        index += 1
    }

    guard let input = input, !input.isEmpty else {
        throw TranscriberError.invalidArguments("Missing --input")
    }

    guard let output = output, !output.isEmpty else {
        throw TranscriberError.invalidArguments("Missing --output")
    }

    if let startMs, startMs < 0 {
        throw TranscriberError.invalidArguments("--start-ms must be >= 0")
    }

    if let durationMs, durationMs <= 0 {
        throw TranscriberError.invalidArguments("--duration-ms must be > 0")
    }

    return ParsedArguments(
        input: input,
        output: output,
        locale: locale,
        startMs: startMs,
        durationMs: durationMs
    )
}

func writeJSON<T: Encodable>(_ value: T, to outputPath: String) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted]
    let data = try encoder.encode(value)
    let outputURL = URL(fileURLWithPath: outputPath)
    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true,
        attributes: nil
    )
    try data.write(to: outputURL)
}

func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
    await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { status in
            continuation.resume(returning: status)
        }
    }
}

func exportAudioTrack(
    from inputURL: URL,
    to outputURL: URL,
    startMs: Int?,
    durationMs: Int?
) async throws {
    let asset = AVURLAsset(url: inputURL)

    guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
        throw TranscriberError.exportFailed("Failed to create AVAssetExportSession")
    }

    try? FileManager.default.removeItem(at: outputURL)
    exportSession.outputURL = outputURL
    exportSession.outputFileType = .m4a

    if startMs != nil || durationMs != nil {
        let totalDurationSeconds = CMTimeGetSeconds(asset.duration)
        guard totalDurationSeconds.isFinite, totalDurationSeconds > 0 else {
            throw TranscriberError.exportFailed("Unable to read media duration for segmented transcription")
        }

        let startSeconds = max(0, Double(startMs ?? 0) / 1000)
        if startSeconds >= totalDurationSeconds {
            throw TranscriberError.invalidArguments("Segment start exceeds media duration")
        }

        let availableSeconds = max(0, totalDurationSeconds - startSeconds)
        let durationSeconds: Double
        if let durationMs {
            durationSeconds = min(max(0, Double(durationMs) / 1000), availableSeconds)
        } else {
            durationSeconds = availableSeconds
        }

        if durationSeconds <= 0 {
            throw TranscriberError.invalidArguments("Segment duration resolves to 0")
        }

        exportSession.timeRange = CMTimeRange(
            start: CMTime(seconds: startSeconds, preferredTimescale: 600),
            duration: CMTime(seconds: durationSeconds, preferredTimescale: 600)
        )
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        exportSession.exportAsynchronously {
            switch exportSession.status {
            case .completed:
                continuation.resume()
            case .failed, .cancelled:
                continuation.resume(throwing: TranscriberError.exportFailed(exportSession.error?.localizedDescription ?? "Unknown export error"))
            default:
                continuation.resume(throwing: TranscriberError.exportFailed("Unexpected AVAssetExportSession status"))
            }
        }
    }

    guard exportSession.status == .completed else {
        throw TranscriberError.exportFailed(exportSession.error?.localizedDescription ?? "Unknown export error")
    }
}

func transcribeAudio(at audioURL: URL, localeId: String) async throws -> (text: String, words: [TranscriptWord]) {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) ?? SFSpeechRecognizer() else {
        throw TranscriberError.recognizerUnavailable
    }

    let request = SFSpeechURLRecognitionRequest(url: audioURL)
    request.shouldReportPartialResults = false

    if #available(macOS 13.0, *) {
        request.addsPunctuation = true
    }

    return try await withCheckedThrowingContinuation { continuation in
        var task: SFSpeechRecognitionTask?
        task = recognizer.recognitionTask(with: request) { result, error in
            if let error = error {
                task?.cancel()
                continuation.resume(throwing: TranscriberError.transcriptionFailed(error.localizedDescription))
                return
            }

            guard let result = result else {
                return
            }

            if result.isFinal {
                let words = result.bestTranscription.segments.map { segment in
                    TranscriptWord(
                        text: segment.substring,
                        startMs: Int((segment.timestamp * 1000).rounded()),
                        endMs: Int(((segment.timestamp + segment.duration) * 1000).rounded()),
                        confidence: Double(segment.confidence)
                    )
                }
                task?.cancel()
                continuation.resume(returning: (result.bestTranscription.formattedString, words))
            }
        }
    }
}

func mapErrorCode(_ error: Error) -> String {
    switch error {
    case TranscriberError.invalidArguments:
        return "invalid_arguments"
    case TranscriberError.speechPermissionDenied:
        return "speech_permission_denied"
    case TranscriberError.recognizerUnavailable:
        return "recognizer_unavailable"
    case TranscriberError.exportFailed:
        return "audio_export_failed"
    case TranscriberError.transcriptionFailed:
        return "transcription_failed"
    default:
        return "unknown"
    }
}

func mapErrorMessage(_ error: Error) -> String {
    if let transcriberError = error as? TranscriberError {
        switch transcriberError {
        case .invalidArguments(let message):
            return message
        case .speechPermissionDenied:
            return "Speech recognition permission denied"
        case .recognizerUnavailable:
            return "Speech recognizer is unavailable"
        case .exportFailed(let message):
            return message
        case .transcriptionFailed(let message):
            return message
        }
    }

    return String(describing: error)
}

@main
struct SpeechTranscriberCLI {
    static func main() async {
        do {
            let args = try parseArguments()
            let inputURL = URL(fileURLWithPath: args.input)
            let outputPath = args.output

            guard FileManager.default.fileExists(atPath: inputURL.path) else {
                throw TranscriberError.invalidArguments("Input file does not exist")
            }

            let authStatus = await requestSpeechAuthorization()
            guard authStatus == .authorized else {
                throw TranscriberError.speechPermissionDenied
            }

            let tempAudioURL = URL(fileURLWithPath: NSTemporaryDirectory())
                .appendingPathComponent("cursorlens-transcribe-\(UUID().uuidString).m4a")
            defer {
                try? FileManager.default.removeItem(at: tempAudioURL)
            }

            try await exportAudioTrack(
                from: inputURL,
                to: tempAudioURL,
                startMs: args.startMs,
                durationMs: args.durationMs
            )
            let transcript = try await transcribeAudio(at: tempAudioURL, localeId: args.locale)

            let payload = TranscriptionResult(
                success: true,
                locale: args.locale,
                text: transcript.text,
                words: transcript.words
            )
            try writeJSON(payload, to: outputPath)
            fputs("SPEECH_TRANSCRIBER_DONE words=\(transcript.words.count)\n", stdout)
            fflush(stdout)
        } catch {
            let code = mapErrorCode(error)
            let message = mapErrorMessage(error)
            if let args = try? parseArguments() {
                let payload = ErrorResult(success: false, code: code, message: message)
                try? writeJSON(payload, to: args.output)
            }
            fputs("SPEECH_TRANSCRIBER_ERROR code=\(code) message=\(message)\n", stderr)
            fflush(stderr)
            exit(1)
        }
    }
}
