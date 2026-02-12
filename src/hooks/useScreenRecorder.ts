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
};

type CompositionResources = {
  compositeStream: MediaStream;
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
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef<number>(0);
  const compositionCleanup = useRef<(() => void) | null>(null);

  // Target visually lossless 4K @ 60fps; fall back gracefully when hardware cannot keep up
  const TARGET_FRAME_RATE = 60;
  const TARGET_WIDTH = 3840;
  const TARGET_HEIGHT = 2160;
  const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;
  const selectMimeType = () => {
    const preferred = [
      "video/webm;codecs=av1",
      "video/webm;codecs=h264",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm"
    ];

    return preferred.find(type => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
  };

  const computeBitrate = (width: number, height: number) => {
    const pixels = width * height;
    const highFrameRateBoost = TARGET_FRAME_RATE >= 60 ? 1.7 : 1;

    if (pixels >= FOUR_K_PIXELS) {
      return Math.round(45_000_000 * highFrameRateBoost);
    }

    if (pixels >= 2560 * 1440) {
      return Math.round(28_000_000 * highFrameRateBoost);
    }

    return Math.round(18_000_000 * highFrameRateBoost);
  };

  const createMediaRecorderWithFallback = (
    sourceStream: MediaStream,
    preferredMimeType: string,
    bitrate: number
  ): MediaRecorder => {
    const mimeCandidates = dedupe(
      [preferredMimeType, "video/webm;codecs=vp8", "video/webm"].filter((mime) => MediaRecorder.isTypeSupported(mime)),
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

  const stopRecording = useRef(() => {
    if (mediaRecorder.current?.state === "recording") {
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
      mediaRecorder.current.stop();
      setRecording(false);

      window.electronAPI?.setRecordingState(false);
    }
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
      
      if (mediaRecorder.current?.state === "recording") {
        mediaRecorder.current.stop();
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
  }, []);

  const buildCompositedStream = async (
    desktopStream: MediaStream,
    sourceWidth: number,
    sourceHeight: number,
    sourceFrameRate: number,
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

    let frameToken = 0;
    const drawFrame = () => {
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

      frameToken = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    const compositeStream = canvas.captureStream(Math.max(24, Math.round(sourceFrameRate || 30)));
    return {
      compositeStream,
      cleanup: () => {
        cancelAnimationFrame(frameToken);
        desktopVideo.pause();
        webcamVideo.pause();
        webcamStream.getTracks().forEach(track => track.stop());
      },
    };
  };

  const startRecording = async () => {
    try {
      const selectedSource = await window.electronAPI.getSelectedSource();
      if (!selectedSource) {
        alert("Please select a source to record");
        return;
      }

      const desktopStream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: selectedSource.id,
            maxWidth: TARGET_WIDTH,
            maxHeight: TARGET_HEIGHT,
            maxFrameRate: TARGET_FRAME_RATE,
            minFrameRate: 30,
          },
        },
      });
      stream.current = desktopStream;
      if (!desktopStream) {
        throw new Error("Media stream is not available.");
      }
      const videoTrack = desktopStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("No video track available from desktop stream.");
      }
      try {
        await videoTrack.applyConstraints({
          frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
          width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
          height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
        });
      } catch (error) {
        console.warn("Unable to lock 4K/60fps constraints, using best available track settings.", error);
      }

      let { width = 1920, height = 1080, frameRate = TARGET_FRAME_RATE } = videoTrack.getSettings();
      
      // Ensure dimensions are divisible by 2 for VP9/AV1 codec compatibility
      width = Math.floor(width / 2) * 2;
      height = Math.floor(height / 2) * 2;
      
      const videoBitsPerSecond = computeBitrate(width, height);
      const mimeType = selectMimeType();

      console.log(
        `Recording at ${width}x${height} @ ${frameRate ?? TARGET_FRAME_RATE}fps using ${mimeType} / ${Math.round(
          videoBitsPerSecond / 1_000_000
        )} Mbps`
      );
      
      chunks.current = [];
      let recordingStream: MediaStream = desktopStream;
      if (includeCamera) {
        try {
          const composition = await buildCompositedStream(
            desktopStream,
            width,
            height,
            frameRate ?? TARGET_FRAME_RATE,
            { shape: cameraShape, sizePercent: cameraSizePercent },
          );
          compositionCleanup.current = composition.cleanup;
          recordingStream = composition.compositeStream;
        } catch (error) {
          console.warn("Camera capture failed, fallback to screen-only recording.", error);
        }
      }

      let recorder: MediaRecorder;
      try {
        recorder = createMediaRecorderWithFallback(recordingStream, mimeType, videoBitsPerSecond);
      } catch (error) {
        // Some machines fail MediaRecorder init for canvas capture + certain codecs.
        // Fallback to screen-only stream so recording can still start.
        if (recordingStream !== desktopStream) {
          console.warn("Failed to initialize recorder for camera composited stream, fallback to screen-only.", error);
          if (compositionCleanup.current) {
            compositionCleanup.current();
            compositionCleanup.current = null;
          }
          if (cameraStream.current) {
            cameraStream.current.getTracks().forEach(track => track.stop());
            cameraStream.current = null;
          }
          recorder = createMediaRecorderWithFallback(desktopStream, mimeType, videoBitsPerSecond);
        } else {
          throw error;
        }
      }
      mediaRecorder.current = recorder;
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data);
      };
      recorder.onstop = async () => {
        if (compositionCleanup.current) {
          compositionCleanup.current();
          compositionCleanup.current = null;
        }
        if (cameraStream.current) {
          cameraStream.current.getTracks().forEach(track => track.stop());
          cameraStream.current = null;
        }
        stream.current = null;
        if (chunks.current.length === 0) return;
        const duration = Date.now() - startTime.current;
        const recordedChunks = chunks.current;
        const buggyBlob = new Blob(recordedChunks, { type: mimeType });
        // Clear chunks early to free memory immediately after blob creation
        chunks.current = [];
        const timestamp = Date.now();
        const videoFileName = `recording-${timestamp}.webm`;

        try {
          const videoBlob = await fixWebmDuration(buggyBlob, duration);
          const arrayBuffer = await videoBlob.arrayBuffer();
          const videoResult = await window.electronAPI.storeRecordedVideo(arrayBuffer, videoFileName);
          if (!videoResult.success) {
            console.error('Failed to store video:', videoResult.message);
            return;
          }

          if (videoResult.path) {
            await window.electronAPI.setCurrentVideoPath(videoResult.path);
          }

          await window.electronAPI.switchToEditor();
        } catch (error) {
          console.error('Error saving recording:', error);
        }
      };
      recorder.onerror = () => setRecording(false);
      recorder.start(1000);
      startTime.current = Date.now();
      setRecording(true);
      window.electronAPI?.setRecordingState(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      setRecording(false);
      if (stream.current) {
        stream.current.getTracks().forEach(track => track.stop());
        stream.current = null;
      }
      if (cameraStream.current) {
        cameraStream.current.getTracks().forEach(track => track.stop());
        cameraStream.current = null;
      }
      if (compositionCleanup.current) {
        compositionCleanup.current();
        compositionCleanup.current = null;
      }
    }
  };

  const toggleRecording = () => {
    recording ? stopRecording.current() : startRecording();
  };

  return { recording, toggleRecording };
}
