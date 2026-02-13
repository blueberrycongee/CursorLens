import { useState, useRef, useEffect } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";
import { computeCameraOverlayRect, type CameraOverlayShape } from "./cameraOverlay";

type UseScreenRecorderReturn = {
  recording: boolean;
  toggleRecording: () => void;
};

type UseScreenRecorderOptions = {
  includeCamera?: boolean;
  cameraShape?: CameraOverlayShape;
  cameraSizePercent?: number;
  captureProfile?: CaptureProfile;
  recordSystemCursor?: boolean;
};

export type CaptureProfile = "balanced" | "quality" | "ultra";
type CursorMode = "always" | "never";

type LegacyDesktopGetUserMedia = (constraints: {
  audio?: MediaTrackConstraints | boolean;
  video?: {
    mandatory?: Record<string, string | number | boolean | undefined>;
    cursor?: CursorMode;
  };
}) => Promise<MediaStream>;

type CompositionResources = {
  compositeStream: MediaStream;
  width: number;
  height: number;
  frameRate: number;
  cleanup: () => void;
};

const VIRTUAL_CAMERA_KEYWORDS = [
  "virtual",
  "obs",
  "continuity",
  "desk view",
  "presenter",
  "iphone",
  "epoccam",
  "ndi",
  "snap camera",
];

function isLikelyVirtualCameraLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return VIRTUAL_CAMERA_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

async function pickPreferredCameraId(): Promise<string | undefined> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    if (cameras.length === 0) return undefined;

    const nonVirtual = cameras.filter((camera) => !isLikelyVirtualCameraLabel(camera.label));
    const preferred = nonVirtual[0] ?? cameras[0];
    return preferred?.deviceId || undefined;
  } catch (error) {
    console.warn("Failed to enumerate camera devices, using system default camera.", error);
    return undefined;
  }
}

export function useScreenRecorder(options: UseScreenRecorderOptions = {}): UseScreenRecorderReturn {
  const includeCamera = options.includeCamera ?? false;
  const cameraShape = options.cameraShape ?? "rounded";
  const cameraSizePercent = options.cameraSizePercent ?? 22;
  const captureProfile = options.captureProfile ?? "quality";
  const recordSystemCursor = options.recordSystemCursor ?? true;
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef<number>(0);
  const compositionCleanup = useRef<(() => void) | null>(null);
  const cursorTrackingActive = useRef(false);
  const nativeRecordingActive = useRef(false);
  const nativeRecordingMetadata = useRef<{
    frameRate: number;
    width: number;
    height: number;
    mimeType: string;
    systemCursorMode: CursorMode;
  } | null>(null);

  const profileSettings: Record<CaptureProfile, { targetFps: number; maxFps: number; bitrateScale: number; cameraCompositeFpsCap: number; maxLongEdge: number }> = {
    balanced: { targetFps: 30, maxFps: 60, bitrateScale: 0.9, cameraCompositeFpsCap: 30, maxLongEdge: 1920 },
    quality: { targetFps: 60, maxFps: 60, bitrateScale: 1.1, cameraCompositeFpsCap: 60, maxLongEdge: 3840 },
    // Experimental profile: only beneficial on devices that can sustain high-refresh desktop capture.
    ultra: { targetFps: 120, maxFps: 120, bitrateScale: 1.25, cameraCompositeFpsCap: 60, maxLongEdge: 5120 },
  };

  const activeProfile = profileSettings[captureProfile];
  const MAX_CAPTURE_FPS = activeProfile.maxFps;
  const TARGET_CAPTURE_FPS = activeProfile.targetFps;

  const ensureEvenDimension = (value: number, fallback: number) => {
    const resolved = Number.isFinite(value) && value > 0 ? value : fallback;
    return Math.max(2, Math.floor(resolved / 2) * 2);
  };

  const normalizeCaptureDimensions = (rawWidth: number, rawHeight: number): { width: number; height: number } => {
    let width = ensureEvenDimension(rawWidth, 1920);
    let height = ensureEvenDimension(rawHeight, 1080);

    const longEdge = Math.max(width, height);
    if (longEdge <= activeProfile.maxLongEdge) {
      return { width, height };
    }

    const scale = activeProfile.maxLongEdge / longEdge;
    width = ensureEvenDimension(Math.round(width * scale), 1920);
    height = ensureEvenDimension(Math.round(height * scale), 1080);
    return { width, height };
  };

  const selectMimeType = () => {
    // Prefer H.264 first for decoding/export compatibility and smoother timeline playback.
    const preferred = [
      "video/webm;codecs=h264",
      "video/mp4;codecs=h264",
      "video/webm;codecs=vp8",
      "video/webm;codecs=vp9",
      "video/webm;codecs=av1",
      "video/webm"
    ];

    return preferred.find(type => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
  };

  const computeBitrate = (width: number, height: number, frameRate: number) => {
    const pixels = width * height;
    const frameRateBoost = frameRate >= 50 ? 1.25 : frameRate >= 30 ? 1 : 0.85;

    if (pixels >= 3840 * 2160) return Math.round(50_000_000 * frameRateBoost * activeProfile.bitrateScale);
    if (pixels >= 2560 * 1440) return Math.round(32_000_000 * frameRateBoost * activeProfile.bitrateScale);
    if (pixels >= 1920 * 1080) return Math.round(20_000_000 * frameRateBoost * activeProfile.bitrateScale);
    return Math.round(12_000_000 * frameRateBoost * activeProfile.bitrateScale);
  };

  const createMediaRecorderWithFallback = (
    sourceStream: MediaStream,
    preferredMimeType: string,
    bitrate: number
  ): MediaRecorder => {
    const mimeCandidates = dedupe(
      [
        preferredMimeType,
        "video/webm;codecs=h264",
        "video/mp4;codecs=h264",
        "video/webm;codecs=vp8",
        "video/webm;codecs=vp9",
        "video/webm",
      ].filter((mime) => MediaRecorder.isTypeSupported(mime)),
    );

    let lastError: unknown = null;
    for (const mimeType of mimeCandidates) {
      try {
        return new MediaRecorder(sourceStream, {
          mimeType,
          videoBitsPerSecond: bitrate,
        });
      } catch (error) {
        lastError = error;
        // Retry same codec without explicit bitrate (some machines reject high-bitrate options)
        try {
          return new MediaRecorder(sourceStream, { mimeType });
        } catch (retryError) {
          lastError = retryError;
        }
      }
    }

    try {
      return new MediaRecorder(sourceStream, { videoBitsPerSecond: bitrate });
    } catch (error) {
      lastError = error;
    }

    throw lastError instanceof Error ? lastError : new Error("Failed to create MediaRecorder with available codecs.");
  };

  const cleanupActiveMedia = (options: { stopNative?: boolean } = {}) => {
    const stopNative = options.stopNative ?? true;

    if (stopNative && nativeRecordingActive.current) {
      nativeRecordingActive.current = false;
      nativeRecordingMetadata.current = null;
      void window.electronAPI?.stopNativeScreenRecording?.().catch((error) => {
        console.warn("Failed to stop native ScreenCaptureKit recorder during cleanup.", error);
      });
      window.electronAPI?.setRecordingState(false);
    }

    if (cursorTrackingActive.current) {
      cursorTrackingActive.current = false;
      void window.electronAPI?.stopCursorTracking?.().catch((error) => {
        console.warn("Failed to stop cursor tracking during cleanup.", error);
      });
    }
    if (compositionCleanup.current) {
      compositionCleanup.current();
      compositionCleanup.current = null;
    }
    if (cameraStream.current) {
      cameraStream.current.getTracks().forEach(track => track.stop());
      cameraStream.current = null;
    }
    if (stream.current) {
      stream.current.getTracks().forEach(track => track.stop());
      stream.current = null;
    }
  };

  const stopNativeRecording = async () => {
    const initialMetadata = nativeRecordingMetadata.current;
    nativeRecordingActive.current = false;
    nativeRecordingMetadata.current = null;

    let capturedCursorTrack:
      | { source?: "recorded" | "synthetic"; samples: Array<{ timeMs: number; x: number; y: number; click?: boolean; visible?: boolean }> }
      | undefined;

    if (cursorTrackingActive.current) {
      cursorTrackingActive.current = false;
      try {
        const cursorResult = await window.electronAPI.stopCursorTracking();
        capturedCursorTrack = cursorResult.track;
      } catch (error) {
        console.warn("Failed to retrieve cursor tracking payload for native recording.", error);
      }
    }

    try {
      const stopResult = await window.electronAPI.stopNativeScreenRecording();
      setRecording(false);
      window.electronAPI?.setRecordingState(false);

      if (!stopResult.success || !stopResult.path) {
        console.error("Failed to stop native ScreenCaptureKit recording:", stopResult.message);
        return;
      }

      const fallbackMetadata = initialMetadata ?? {
        frameRate: 60,
        width: 1920,
        height: 1080,
        mimeType: "video/mp4",
        systemCursorMode: "always" as CursorMode,
      };
      const metadata = stopResult.metadata ?? fallbackMetadata;
      const capturedAt = stopResult.metadata?.capturedAt ?? Date.now();

      await window.electronAPI.setCurrentVideoPath(stopResult.path, {
        frameRate: metadata.frameRate,
        width: metadata.width,
        height: metadata.height,
        mimeType: metadata.mimeType ?? "video/mp4",
        capturedAt,
        systemCursorMode: metadata.systemCursorMode ?? fallbackMetadata.systemCursorMode,
        cursorTrack: capturedCursorTrack,
      });

      await window.electronAPI.switchToEditor();
    } catch (error) {
      console.error("Failed to finalize native ScreenCaptureKit recording:", error);
      setRecording(false);
      window.electronAPI?.setRecordingState(false);
    } finally {
      cleanupActiveMedia({ stopNative: false });
    }
  };

  const stopRecording = useRef(() => {
    if (nativeRecordingActive.current) {
      void stopNativeRecording();
      return;
    }
    const recorder = mediaRecorder.current;
    if (recorder?.state === "recording") {
      recorder.stop();
      setRecording(false);
      window.electronAPI?.setRecordingState(false);
      return;
    }
    cleanupActiveMedia();
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    
    if (window.electronAPI?.onStopRecordingFromTray) {
      cleanup = window.electronAPI.onStopRecordingFromTray(() => {
        stopRecording.current();
      });
    }

    return () => {
      if (cleanup) cleanup();

      const recorder = mediaRecorder.current;
      if (recorder?.state === "recording") {
        recorder.stop();
        return;
      }

      cleanupActiveMedia();
    };
  }, []);

  const buildCompositedStream = async (
    desktopStream: MediaStream,
    sourceWidthHint: number,
    sourceHeightHint: number,
    sourceFrameRateHint: number,
    overlayOptions: { shape: CameraOverlayShape; sizePercent: number }
  ): Promise<CompositionResources> => {
    const preferredCameraId = await pickPreferredCameraId();
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 60 },
    };
    if (preferredCameraId) {
      videoConstraints.deviceId = { exact: preferredCameraId };
    }

    const webcamStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints,
    });
    cameraStream.current = webcamStream;

    const desktopVideo = document.createElement("video");
    desktopVideo.srcObject = desktopStream;
    desktopVideo.muted = true;
    desktopVideo.playsInline = true;
    await desktopVideo.play();

    const webcamVideo = document.createElement("video");
    webcamVideo.srcObject = webcamStream;
    webcamVideo.muted = true;
    webcamVideo.playsInline = true;
    await webcamVideo.play();

    const sourceWidth = ensureEvenDimension(desktopVideo.videoWidth, sourceWidthHint);
    const sourceHeight = ensureEvenDimension(desktopVideo.videoHeight, sourceHeightHint);
    const sourceFrameRate = Math.max(
      24,
      Math.min(
        MAX_CAPTURE_FPS,
        Math.round(
          sourceFrameRateHint ||
            Number(desktopStream.getVideoTracks()[0]?.getSettings().frameRate) ||
            TARGET_CAPTURE_FPS,
        ),
      ),
    );
    const compositeFrameRate = Math.min(sourceFrameRate, activeProfile.cameraCompositeFpsCap);
    console.log(
      `Compositing camera overlay on ${desktopVideo.videoWidth || sourceWidthHint}x${desktopVideo.videoHeight || sourceHeightHint} -> ${sourceWidth}x${sourceHeight} @ ${compositeFrameRate}fps`,
    );

    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create 2D context for camera composition.");
    }

    const overlay = computeCameraOverlayRect(sourceWidth, sourceHeight, overlayOptions);
    const drawVideoCover = (
      ctx2d: CanvasRenderingContext2D,
      video: HTMLVideoElement,
      x: number,
      y: number,
      targetWidth: number,
      targetHeight: number
    ) => {
      const sourceWidthPx = video.videoWidth || targetWidth;
      const sourceHeightPx = video.videoHeight || targetHeight;
      const sourceRatio = sourceWidthPx / sourceHeightPx;
      const targetRatio = targetWidth / targetHeight;

      let cropWidth = sourceWidthPx;
      let cropHeight = sourceHeightPx;
      let cropX = 0;
      let cropY = 0;
      if (sourceRatio > targetRatio) {
        cropWidth = sourceHeightPx * targetRatio;
        cropX = (sourceWidthPx - cropWidth) / 2;
      } else if (sourceRatio < targetRatio) {
        cropHeight = sourceWidthPx / targetRatio;
        cropY = (sourceHeightPx - cropHeight) / 2;
      }
      ctx2d.drawImage(video, cropX, cropY, cropWidth, cropHeight, x, y, targetWidth, targetHeight);
    };
    const drawRoundedRectPath = (
      ctx2d: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number
    ) => {
      const clamped = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
      ctx2d.beginPath();
      ctx2d.moveTo(x + clamped, y);
      ctx2d.lineTo(x + width - clamped, y);
      ctx2d.quadraticCurveTo(x + width, y, x + width, y + clamped);
      ctx2d.lineTo(x + width, y + height - clamped);
      ctx2d.quadraticCurveTo(x + width, y + height, x + width - clamped, y + height);
      ctx2d.lineTo(x + clamped, y + height);
      ctx2d.quadraticCurveTo(x, y + height, x, y + height - clamped);
      ctx2d.lineTo(x, y + clamped);
      ctx2d.quadraticCurveTo(x, y, x + clamped, y);
      ctx2d.closePath();
    };

    let rafToken = 0;
    let videoFrameCallbackToken: number | null = null;
    let running = true;
    let lastDrawTime = 0;
    const frameIntervalMs = 1000 / compositeFrameRate;

    const drawCompositedFrame = () => {
      if (desktopVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        ctx.drawImage(desktopVideo, 0, 0, sourceWidth, sourceHeight);
      }

      if (webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const x = overlay.x;
        const y = overlay.y;
        const w = overlay.width;
        const h = overlay.height;

        ctx.save();
        if (overlayOptions.shape === "circle") {
          const radius = Math.min(w, h) / 2;
          ctx.beginPath();
          ctx.arc(x + w / 2, y + h / 2, radius, 0, Math.PI * 2);
          ctx.closePath();
        } else if (overlayOptions.shape === "square") {
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.closePath();
        } else {
          drawRoundedRectPath(ctx, x, y, w, h, overlay.cornerRadius);
        }
        ctx.clip();
        drawVideoCover(ctx, webcamVideo, x, y, w, h);
        ctx.restore();

        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        if (overlayOptions.shape === "circle") {
          const radius = Math.min(w, h) / 2;
          ctx.beginPath();
          ctx.arc(x + w / 2, y + h / 2, radius, 0, Math.PI * 2);
          ctx.closePath();
          ctx.stroke();
        } else if (overlayOptions.shape === "square") {
          ctx.strokeRect(x, y, w, h);
        } else {
          drawRoundedRectPath(ctx, x, y, w, h, overlay.cornerRadius);
          ctx.stroke();
        }
      }
    };

    const maybeDrawFrame = (timestamp: number) => {
      if (timestamp - lastDrawTime < frameIntervalMs) {
        return;
      }
      lastDrawTime = timestamp;
      drawCompositedFrame();
    };

    const hasVideoFrameCallback = typeof desktopVideo.requestVideoFrameCallback === "function";
    if (hasVideoFrameCallback) {
      const scheduleVideoFrame = () => {
        if (!running) return;
        videoFrameCallbackToken = desktopVideo.requestVideoFrameCallback((timestamp) => {
          maybeDrawFrame(timestamp);
          scheduleVideoFrame();
        });
      };
      scheduleVideoFrame();
    } else {
      const tick = (timestamp: number) => {
        if (!running) return;
        maybeDrawFrame(timestamp);
        rafToken = requestAnimationFrame(tick);
      };
      rafToken = requestAnimationFrame(tick);
    }

    const compositeStream = canvas.captureStream(compositeFrameRate);
    const compositeTrack = compositeStream.getVideoTracks()[0];
    if (compositeTrack && "contentHint" in compositeTrack) {
      compositeTrack.contentHint = "detail";
    }
    return {
      compositeStream,
      width: sourceWidth,
      height: sourceHeight,
      frameRate: compositeFrameRate,
      cleanup: () => {
        running = false;
        cancelAnimationFrame(rafToken);
        if (
          videoFrameCallbackToken !== null
          && typeof desktopVideo.cancelVideoFrameCallback === "function"
        ) {
          desktopVideo.cancelVideoFrameCallback(videoFrameCallbackToken);
        }
        desktopVideo.pause();
        webcamVideo.pause();
        webcamStream.getTracks().forEach(track => track.stop());
      },
    };
  };

  const captureDesktopStream = async (
    selectedSource: { id?: string | null },
    cursorMode: CursorMode,
  ): Promise<MediaStream> => {
    const captureWithLegacyDesktopConstraints = async (): Promise<MediaStream> => {
      const getLegacyUserMedia = navigator.mediaDevices.getUserMedia as unknown as LegacyDesktopGetUserMedia;
      return await getLegacyUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: selectedSource.id ?? undefined,
            maxFrameRate: TARGET_CAPTURE_FPS,
            cursor: cursorMode,
          },
          cursor: cursorMode,
        },
      });
    };

    // Hide-native-cursor path: prefer legacy constraints first because this path is
    // currently more reliable on Electron/macOS for cursor suppression.
    if (cursorMode === "never") {
      try {
        return await captureWithLegacyDesktopConstraints();
      } catch (error) {
        console.warn("Legacy desktop capture failed for cursor hidden mode, trying displayMedia.", error);
      }
    }

    const getDisplayMedia = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);
    if (typeof getDisplayMedia === "function") {
      try {
        return await getDisplayMedia({
          audio: false,
          video: {
            frameRate: { ideal: TARGET_CAPTURE_FPS, max: MAX_CAPTURE_FPS },
            cursor: cursorMode,
          } as MediaTrackConstraints,
        });
      } catch (error) {
        console.warn("getDisplayMedia capture failed, falling back to legacy desktop capture constraints.", error);
      }
    }

    return await captureWithLegacyDesktopConstraints();
  };

  const startRecording = async () => {
    try {
      const selectedSource = await window.electronAPI.getSelectedSource();
      if (!selectedSource) {
        alert("Please select a source to record");
        return;
      }

      const cursorMode: CursorMode = recordSystemCursor ? "always" : "never";
      const systemCursorMode: CursorMode = cursorMode;
      const platform = await window.electronAPI.getPlatform();
      const shouldUseNativeRecorder = platform === "darwin";

      if (shouldUseNativeRecorder) {
        const sourceRef = {
          id: typeof selectedSource.id === "string" ? selectedSource.id : undefined,
          display_id: selectedSource.display_id ?? undefined,
        };
        const startNative = async (cameraEnabled: boolean) =>
          await window.electronAPI.startNativeScreenRecording({
            source: sourceRef,
            cursorMode,
            cameraEnabled,
            cameraShape,
            cameraSizePercent,
            frameRate: TARGET_CAPTURE_FPS,
          });

        let nativeStart = await startNative(includeCamera);
        if (!nativeStart.success && includeCamera) {
          console.warn(
            "Native camera overlay capture failed, retrying native recording without camera overlay.",
            nativeStart.message,
          );
          nativeStart = await startNative(false);
        }

        if (!nativeStart.success) {
          throw new Error(nativeStart.message ?? "Failed to start native ScreenCaptureKit recorder.");
        }

        const nativeWidth = Math.max(2, Math.round(nativeStart.width ?? 1920));
        const nativeHeight = Math.max(2, Math.round(nativeStart.height ?? 1080));
        const nativeFrameRate = Math.max(24, Math.min(MAX_CAPTURE_FPS, Math.round(nativeStart.frameRate ?? TARGET_CAPTURE_FPS)));

        nativeRecordingMetadata.current = {
          frameRate: nativeFrameRate,
          width: nativeWidth,
          height: nativeHeight,
          mimeType: "video/mp4",
          systemCursorMode,
        };
        nativeRecordingActive.current = true;

        try {
          const trackingResult = await window.electronAPI.startCursorTracking({
            source: sourceRef,
            captureSize: { width: nativeWidth, height: nativeHeight },
          });
          cursorTrackingActive.current = Boolean(trackingResult?.success);
        } catch (error) {
          cursorTrackingActive.current = false;
          console.warn("Failed to start cursor tracking for native recording.", error);
        }

        startTime.current = Date.now();
        setRecording(true);
        window.electronAPI?.setRecordingState(true);
        return;
      }

      const desktopStream = await captureDesktopStream(selectedSource, cursorMode);
      stream.current = desktopStream;
      if (!desktopStream) {
        throw new Error("Media stream is not available.");
      }
      const videoTrack = desktopStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("No video track available from desktop stream.");
      }
      if ("contentHint" in videoTrack) {
        videoTrack.contentHint = "detail";
      }
      try {
        await videoTrack.applyConstraints({
          frameRate: { ideal: TARGET_CAPTURE_FPS, max: MAX_CAPTURE_FPS },
          // Keep cursor visibility preference stable across subsequent constraint updates.
          ...( { cursor: cursorMode } as MediaTrackConstraints ),
        } as MediaTrackConstraints);
      } catch (error) {
        console.warn("Unable to lock recording frame-rate constraints, using best available track settings.", error);
      }

      let { width = 1920, height = 1080, frameRate = TARGET_CAPTURE_FPS } = videoTrack.getSettings();
      const normalizedCaptureSize = normalizeCaptureDimensions(width, height);
      width = normalizedCaptureSize.width;
      height = normalizedCaptureSize.height;

      try {
        await videoTrack.applyConstraints({
          width: { ideal: width, max: width },
          height: { ideal: height, max: height },
          frameRate: { ideal: TARGET_CAPTURE_FPS, max: MAX_CAPTURE_FPS },
          ...( { cursor: cursorMode } as MediaTrackConstraints ),
        } as MediaTrackConstraints);
      } catch (error) {
        console.warn("Unable to apply normalized capture dimensions, keeping source track dimensions.", error);
      }

      const finalSettings = videoTrack.getSettings();
      const finalNormalizedCaptureSize = normalizeCaptureDimensions(finalSettings.width ?? width, finalSettings.height ?? height);
      width = finalNormalizedCaptureSize.width;
      height = finalNormalizedCaptureSize.height;
      frameRate = Math.max(
        24,
        Math.min(
          MAX_CAPTURE_FPS,
          Math.round(finalSettings.frameRate || frameRate || TARGET_CAPTURE_FPS),
        ),
      );
      
      chunks.current = [];
      let recordingStream: MediaStream = desktopStream;
      if (includeCamera) {
        try {
          const composition = await buildCompositedStream(
            desktopStream,
            width,
            height,
            frameRate,
            { shape: cameraShape, sizePercent: cameraSizePercent },
          );
          compositionCleanup.current = composition.cleanup;
          recordingStream = composition.compositeStream;
          width = composition.width;
          height = composition.height;
          frameRate = composition.frameRate;
        } catch (error) {
          console.warn("Camera capture failed, fallback to screen-only recording.", error);
        }
      }

      const videoBitsPerSecond = computeBitrate(width, height, frameRate);
      const mimeType = selectMimeType();
      console.log(
      `Recording [${captureProfile}] at ${width}x${height} @ ${frameRate}fps using ${mimeType} / ${Math.round(
          videoBitsPerSecond / 1_000_000
        )} Mbps`
      );

      let recorder: MediaRecorder;
      try {
        recorder = createMediaRecorderWithFallback(recordingStream, mimeType, videoBitsPerSecond);
      } catch (error) {
        // Some machines fail MediaRecorder init for canvas capture + certain codecs.
        // Fallback to screen-only stream so recording can still start.
        if (recordingStream !== desktopStream) {
          console.warn("Failed to initialize recorder for camera composited stream, fallback to screen-only.", error);
          cleanupActiveMedia();
          recorder = createMediaRecorderWithFallback(desktopStream, mimeType, videoBitsPerSecond);
        } else {
          throw error;
        }
      }

      const recordedMimeType = recorder.mimeType || mimeType;
      console.log(`MediaRecorder initialized with ${recordedMimeType}`);

      mediaRecorder.current = recorder;
      recorder.onstart = () => {
        void (async () => {
          try {
            if (mediaRecorder.current !== recorder || recorder.state !== "recording") return;
            const trackingResult = await window.electronAPI.startCursorTracking({
              source: {
                id: typeof selectedSource.id === "string" ? selectedSource.id : undefined,
                display_id: selectedSource.display_id ?? undefined,
              },
              captureSize: { width, height },
            });
            cursorTrackingActive.current = Boolean(trackingResult?.success);
          } catch (error) {
            cursorTrackingActive.current = false;
            console.warn("Failed to start cursor tracking, falling back to synthetic cursor behavior.", error);
          }
        })();
      };
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data);
      };
      recorder.onstop = async () => {
        let capturedCursorTrack:
          | { source?: "recorded" | "synthetic"; samples: Array<{ timeMs: number; x: number; y: number; click?: boolean; visible?: boolean }> }
          | undefined;

        if (cursorTrackingActive.current) {
          cursorTrackingActive.current = false;
          try {
            const cursorResult = await window.electronAPI.stopCursorTracking();
            capturedCursorTrack = cursorResult.track;
          } catch (error) {
            console.warn("Failed to retrieve cursor tracking payload.", error);
          }
        }
        cleanupActiveMedia();
        mediaRecorder.current = null;
        if (chunks.current.length === 0) return;
        const duration = Date.now() - startTime.current;
        const recordedChunks = chunks.current;
        const buggyBlob = new Blob(recordedChunks, { type: recordedMimeType });
        // Clear chunks early to free memory immediately after blob creation
        chunks.current = [];
        const timestamp = Date.now();
        const videoFileName = `recording-${timestamp}.webm`;

        try {
          const videoBlob = await fixWebmDuration(buggyBlob, duration);
          const arrayBuffer = await videoBlob.arrayBuffer();
          const captureMetadata = {
            frameRate,
            width,
            height,
            mimeType: recordedMimeType,
            capturedAt: timestamp,
            systemCursorMode,
            cursorTrack: capturedCursorTrack,
          };
          const videoResult = await window.electronAPI.storeRecordedVideo(arrayBuffer, videoFileName, captureMetadata);
          if (!videoResult.success) {
            console.error('Failed to store video:', videoResult.message);
            return;
          }

          // storeRecordedVideo already updates current video path + metadata in main process.
          // Avoid sending a second large metadata payload over IPC, which can delay editor launch.

          await window.electronAPI.switchToEditor();
        } catch (error) {
          console.error('Error saving recording:', error);
        }
      };
      recorder.onerror = (event) => {
        console.error("MediaRecorder error event:", event);
        setRecording(false);
        window.electronAPI?.setRecordingState(false);
        if (cursorTrackingActive.current) {
          cursorTrackingActive.current = false;
          void window.electronAPI.stopCursorTracking().catch((error) => {
            console.warn("Failed to stop cursor tracking after recorder error.", error);
          });
        }
        cleanupActiveMedia();
      };
      startTime.current = Date.now();
      recorder.start(1000);
      setRecording(true);
      window.electronAPI?.setRecordingState(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      setRecording(false);
      cleanupActiveMedia();
    }
  };

  const toggleRecording = () => {
    recording ? stopRecording.current() : startRecording();
  };

  return { recording, toggleRecording };
}
