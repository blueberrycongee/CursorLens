import { useState, useEffect, useCallback, useRef } from "react";
import styles from "./LaunchWindow.module.css";
import {
  useScreenRecorder,
  type CaptureFrameRate,
  type CaptureProfile,
  type CaptureResolutionPreset,
} from "../../hooks/useScreenRecorder";
import type { CameraOverlayShape } from "../../hooks/cameraOverlay";
import { Button } from "../ui/button";
import { BsRecordCircle } from "react-icons/bs";
import { FaRegStopCircle } from "react-icons/fa";
import { MdMonitor } from "react-icons/md";
import { RxDragHandleDots2 } from "react-icons/rx";
import { FaFolderMinus } from "react-icons/fa6";
import { FiCamera, FiMinus, FiMousePointer, FiX } from "react-icons/fi";
import { EyeOff, Keyboard, RotateCcw, Shield, SlidersHorizontal, Timer } from "lucide-react";
import { useI18n } from "@/i18n";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { reportUserActionError } from "@/lib/userErrorFeedback";
import { resolveRecordingPermissionReadiness } from "@/lib/permissions/capturePermissions";

const CAMERA_SHAPE_CYCLE: CameraOverlayShape[] = ["rounded", "square", "circle"];
const CAPTURE_PROFILE_CYCLE: CaptureProfile[] = ["balanced", "quality", "ultra"];
const CAPTURE_FRAME_RATE_OPTIONS: CaptureFrameRate[] = [24, 30, 60, 120];
const CAPTURE_RESOLUTION_OPTIONS: CaptureResolutionPreset[] = ["auto", "1080p", "1440p", "2160p"];
const RECORD_COUNTDOWN_CYCLE = [3, 5, 8] as const;
const STOP_SHORTCUT_STORAGE_KEY = "openscreen.stopRecordingShortcut";
const DEFAULT_STOP_RECORDING_SHORTCUT = "CommandOrControl+Shift+2";
const AUTO_HIDE_HUD_ON_RECORD_STORAGE_KEY = "openscreen.autoHideHudOnRecord";
const CAPTURE_MODE_STORAGE_KEY = "openscreen.captureMode";
const CAPTURE_FRAME_RATE_STORAGE_KEY = "openscreen.captureFrameRate";
const CAPTURE_RESOLUTION_STORAGE_KEY = "openscreen.captureResolutionPreset";
type RecordCountdownSeconds = (typeof RECORD_COUNTDOWN_CYCLE)[number];
type CaptureMode = "standard" | "pro";
type SelectedSourceSnapshot = {
  id?: string;
  name?: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isModifierKey(key: string): boolean {
  return key === "Meta" || key === "Control" || key === "Alt" || key === "Shift";
}

function resolveAcceleratorKey(event: KeyboardEvent): string | null {
  const key = event.key;
  if (!key) return null;

  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();

  if (key === " ") return "Space";
  if (key === "Enter") return "Enter";
  if (key === "Tab") return "Tab";
  if (key === "Backspace") return "Backspace";
  if (key === "Delete") return "Delete";
  if (key === "ArrowUp") return "Up";
  if (key === "ArrowDown") return "Down";
  if (key === "ArrowLeft") return "Left";
  if (key === "ArrowRight") return "Right";
  return null;
}

function buildAcceleratorFromEvent(event: KeyboardEvent): string | null {
  if (isModifierKey(event.key)) return null;
  const keyToken = resolveAcceleratorKey(event);
  if (!keyToken) return null;

  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push("Command");
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (modifiers.length === 0) return null;

  return [...modifiers, keyToken].join("+");
}

function normalizeSelectedSourceSnapshot(input: unknown): SelectedSourceSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : undefined;
  const name = typeof row.name === "string" ? row.name : undefined;
  if (!id && !name) return null;
  return { id, name };
}

function formatAccelerator(accelerator: string, isMacPlatform: boolean): string {
  if (!accelerator) return "";

  const parts = accelerator.split("+").map((part) => part.trim()).filter(Boolean);
  const mapped = parts.map((part) => {
    const normalized = part.toLowerCase();
    if (normalized === "commandorcontrol") return isMacPlatform ? "⌘" : "Ctrl";
    if (normalized === "command") return isMacPlatform ? "⌘" : "Cmd";
    if (normalized === "control") return isMacPlatform ? "⌃" : "Ctrl";
    if (normalized === "alt" || normalized === "option") return isMacPlatform ? "⌥" : "Alt";
    if (normalized === "shift") return isMacPlatform ? "⇧" : "Shift";
    return part.length === 1 ? part.toUpperCase() : part;
  });

  return isMacPlatform ? mapped.join("") : mapped.join(" + ");
}

export function LaunchWindow() {
  const { t, locale, setLocale } = useI18n();
  const [includeCamera, setIncludeCamera] = useState(() => {
    try {
      return window.localStorage.getItem("openscreen.includeCamera") === "1";
    } catch {
      return false;
    }
  });
  const [cameraShape, setCameraShape] = useState<CameraOverlayShape>(() => {
    try {
      const value = window.localStorage.getItem("openscreen.cameraShape");
      if (value === "rounded" || value === "square" || value === "circle") {
        return value;
      }
    } catch {
      // no-op
    }
    return "rounded";
  });
  const [cameraSizePercent, setCameraSizePercent] = useState<number>(() => {
    try {
      const value = Number(window.localStorage.getItem("openscreen.cameraSizePercent"));
      if (Number.isFinite(value)) {
        return clamp(Math.round(value), 14, 40);
      }
    } catch {
      // no-op
    }
    return 22;
  });
  const [captureProfile, setCaptureProfile] = useState<CaptureProfile>(() => {
    try {
      const value = window.localStorage.getItem("openscreen.captureProfile");
      if (value === "balanced" || value === "quality" || value === "ultra") {
        return value;
      }
    } catch {
      // no-op
    }
    return "quality";
  });
  const [captureMode, setCaptureMode] = useState<CaptureMode>(() => {
    try {
      const value = window.localStorage.getItem(CAPTURE_MODE_STORAGE_KEY);
      if (value === "pro" || value === "standard") {
        return value;
      }
    } catch {
      // no-op
    }
    return "standard";
  });
  const [captureFrameRate, setCaptureFrameRate] = useState<CaptureFrameRate>(() => {
    try {
      const value = Number(window.localStorage.getItem(CAPTURE_FRAME_RATE_STORAGE_KEY));
      if (value === 24 || value === 30 || value === 60 || value === 120) {
        return value;
      }
    } catch {
      // no-op
    }
    return 60;
  });
  const [captureResolutionPreset, setCaptureResolutionPreset] = useState<CaptureResolutionPreset>(() => {
    try {
      const value = window.localStorage.getItem(CAPTURE_RESOLUTION_STORAGE_KEY);
      if (value === "auto" || value === "1080p" || value === "1440p" || value === "2160p") {
        return value;
      }
    } catch {
      // no-op
    }
    return "auto";
  });
  const [recordSystemCursor, setRecordSystemCursor] = useState(() => {
    try {
      const value = window.localStorage.getItem("openscreen.recordSystemCursor");
      return value === null ? true : value === "1";
    } catch {
      return true;
    }
  });
  const [autoHideHudOnRecord, setAutoHideHudOnRecord] = useState(() => {
    try {
      return window.localStorage.getItem(AUTO_HIDE_HUD_ON_RECORD_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [stopRecordingShortcut, setStopRecordingShortcut] = useState(() => {
    try {
      return window.localStorage.getItem(STOP_SHORTCUT_STORAGE_KEY) || DEFAULT_STOP_RECORDING_SHORTCUT;
    } catch {
      return DEFAULT_STOP_RECORDING_SHORTCUT;
    }
  });
  const [captureStopShortcut, setCaptureStopShortcut] = useState(false);
  const [stopShortcutPopoverOpen, setStopShortcutPopoverOpen] = useState(false);
  const [isMacPlatform, setIsMacPlatform] = useState(() => {
    if (typeof navigator === "undefined") return false;
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  });
  const [recordCountdownSeconds, setRecordCountdownSeconds] = useState<RecordCountdownSeconds>(() => {
    try {
      const value = Number(window.localStorage.getItem("openscreen.recordCountdownSeconds"));
      if (value === 3 || value === 5 || value === 8) {
        return value;
      }
    } catch {
      // no-op
    }
    return 3;
  });
  const { recording, recordingState, toggleRecording } = useScreenRecorder({
    includeCamera,
    cameraShape,
    cameraSizePercent,
    captureProfile,
    captureFrameRate: captureMode === "pro" ? captureFrameRate : undefined,
    captureResolutionPreset: captureMode === "pro" ? captureResolutionPreset : undefined,
    recordSystemCursor,
  });
  const isTransitioning = recordingState === "starting" || recordingState === "stopping";
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const isCountingDown = countdownRemaining !== null;
  const controlsLocked = recording || isTransitioning || isCountingDown;
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousRecordingRef = useRef(false);
  const selectedSourceSyncErrorAtRef = useRef(0);
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (recording) {
      if (!recordingStart) setRecordingStart(Date.now());
      timer = setInterval(() => {
        if (recordingStart) {
          setElapsed(Math.floor((Date.now() - recordingStart) / 1000));
        }
      }, 1000);
    } else {
      setRecordingStart(null);
      setElapsed(0);
      if (timer) clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recording, recordingStart]);

  const clearRecordCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdownRemaining(null);
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const [selectedSource, setSelectedSource] = useState(t("launch.sourceFallback"));
  const [hasSelectedSource, setHasSelectedSource] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem("openscreen.includeCamera", includeCamera ? "1" : "0");
    } catch {
      // no-op
    }
  }, [includeCamera]);

  useEffect(() => {
    try {
      window.localStorage.setItem("openscreen.cameraShape", cameraShape);
    } catch {
      // no-op
    }
  }, [cameraShape]);

  useEffect(() => {
    try {
      window.localStorage.setItem("openscreen.cameraSizePercent", String(cameraSizePercent));
    } catch {
      // no-op
    }
  }, [cameraSizePercent]);

  useEffect(() => {
    try {
      window.localStorage.setItem("openscreen.captureProfile", captureProfile);
    } catch {
      // no-op
    }
  }, [captureProfile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CAPTURE_MODE_STORAGE_KEY, captureMode);
    } catch {
      // no-op
    }
  }, [captureMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CAPTURE_FRAME_RATE_STORAGE_KEY, String(captureFrameRate));
    } catch {
      // no-op
    }
  }, [captureFrameRate]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CAPTURE_RESOLUTION_STORAGE_KEY, captureResolutionPreset);
    } catch {
      // no-op
    }
  }, [captureResolutionPreset]);

  useEffect(() => {
    try {
      window.localStorage.setItem("openscreen.recordSystemCursor", recordSystemCursor ? "1" : "0");
    } catch {
      // no-op
    }
  }, [recordSystemCursor]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_HIDE_HUD_ON_RECORD_STORAGE_KEY, autoHideHudOnRecord ? "1" : "0");
    } catch {
      // no-op
    }
  }, [autoHideHudOnRecord]);

  useEffect(() => {
    try {
      window.localStorage.setItem("openscreen.recordCountdownSeconds", String(recordCountdownSeconds));
    } catch {
      // no-op
    }
  }, [recordCountdownSeconds]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const platform = await window.electronAPI.getPlatform();
        if (!cancelled) {
          setIsMacPlatform(platform === "darwin");
        }
      } catch {
        // ignore platform probe failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyStopRecordingShortcut = useCallback(async (accelerator: string, options?: { silent?: boolean }) => {
    try {
      const result = await window.electronAPI.setStopRecordingShortcut(accelerator);
      const applied = result.accelerator || DEFAULT_STOP_RECORDING_SHORTCUT;
      setStopRecordingShortcut(applied);
      try {
        window.localStorage.setItem(STOP_SHORTCUT_STORAGE_KEY, applied);
      } catch {
        // no-op
      }
      if (!result.success && !options?.silent) {
        reportUserActionError({
          t,
          userMessage: result.message || t("launch.stopShortcutApplyError"),
          error: result.message || t("launch.stopShortcutApplyError"),
          context: "launch-window.apply-stop-shortcut",
          details: { accelerator },
          dedupeKey: `launch-window.apply-stop-shortcut:${accelerator}`,
        });
      }
      return result.success;
    } catch (error) {
      if (!options?.silent) {
        reportUserActionError({
          t,
          userMessage: t("launch.stopShortcutApplyError"),
          error,
          context: "launch-window.apply-stop-shortcut",
          details: { accelerator },
          dedupeKey: `launch-window.apply-stop-shortcut:${accelerator}`,
        });
      }
      return false;
    }
  }, [t]);

  useEffect(() => {
    void applyStopRecordingShortcut(stopRecordingShortcut, { silent: true });
    // apply once using persisted value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasSelectedSource && countdownRemaining !== null) {
      clearRecordCountdown();
    }
  }, [hasSelectedSource, countdownRemaining, clearRecordCountdown]);

  useEffect(() => {
    if (controlsLocked && captureStopShortcut) {
      setCaptureStopShortcut(false);
    }
  }, [captureStopShortcut, controlsLocked]);

  useEffect(() => {
    if (!captureStopShortcut) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setCaptureStopShortcut(false);
        return;
      }

      const accelerator = buildAcceleratorFromEvent(event);
      if (!accelerator) {
        return;
      }

      void (async () => {
        const success = await applyStopRecordingShortcut(accelerator);
        if (success) {
          toast.success(t("launch.stopShortcutUpdated", {
            shortcut: formatAccelerator(accelerator, isMacPlatform),
          }));
          setCaptureStopShortcut(false);
        }
      })();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [applyStopRecordingShortcut, captureStopShortcut, isMacPlatform, t]);

  useEffect(() => {
    return () => {
      clearRecordCountdown();
    };
  }, [clearRecordCountdown]);

  const cycleCameraShape = () => {
    setCameraShape((current) => {
      const index = CAMERA_SHAPE_CYCLE.indexOf(current);
      const nextIndex = index >= 0 ? (index + 1) % CAMERA_SHAPE_CYCLE.length : 0;
      return CAMERA_SHAPE_CYCLE[nextIndex] ?? "rounded";
    });
  };

  const cycleRecordCountdown = () => {
    setRecordCountdownSeconds((current) => {
      const index = RECORD_COUNTDOWN_CYCLE.indexOf(current);
      const nextIndex = index >= 0 ? (index + 1) % RECORD_COUNTDOWN_CYCLE.length : 0;
      return RECORD_COUNTDOWN_CYCLE[nextIndex] ?? 3;
    });
  };

  useEffect(() => {
    const checkSelectedSource = async () => {
      if (!window.electronAPI) return;

      try {
        const source = normalizeSelectedSourceSnapshot(await window.electronAPI.getSelectedSource());
        if (source) {
          setSelectedSource(source.name || t("launch.sourceFallback"));
          setHasSelectedSource(true);
        } else {
          setSelectedSource(t("launch.sourceFallback"));
          setHasSelectedSource(false);
        }
      } catch (error) {
        const now = Date.now();
        if (now - selectedSourceSyncErrorAtRef.current >= 10_000) {
          selectedSourceSyncErrorAtRef.current = now;
          reportUserActionError({
            t,
            userMessage: t("launch.sourceStatusSyncFailed"),
            error,
            context: "launch-window.sync-selected-source",
            dedupeKey: "launch-window.sync-selected-source",
            dedupeMs: 8_000,
          });
        }
      }
    };

    void checkSelectedSource();
    
    const interval = setInterval(checkSelectedSource, 500);
    return () => clearInterval(interval);
  }, [t]);

  const cameraShapeLabelMap: Record<CameraOverlayShape, string> = {
    rounded: t("launch.shape.rounded"),
    square: t("launch.shape.square"),
    circle: t("launch.shape.circle"),
  };
  const captureProfileLabelMap: Record<CaptureProfile, string> = {
    balanced: t("launch.captureProfile.balanced"),
    quality: t("launch.captureProfile.quality"),
    ultra: t("launch.captureProfile.ultra"),
  };
  const captureResolutionLabelMap: Record<CaptureResolutionPreset, string> = {
    auto: t("launch.captureResolution.auto"),
    "1080p": t("launch.captureResolution.1080p"),
    "1440p": t("launch.captureResolution.1440p"),
    "2160p": t("launch.captureResolution.2160p"),
  };
  const captureSummaryLabel = captureMode === "pro"
    ? t("launch.captureProButtonLabel", {
      resolution: captureResolutionLabelMap[captureResolutionPreset],
      fps: captureFrameRate,
    })
    : captureProfileLabelMap[captureProfile];

  const openSourceSelector = useCallback(() => {
    if (!window.electronAPI) return;

    void (async () => {
      try {
        const permissionSnapshot = await window.electronAPI.getCapturePermissionSnapshot();
        const readiness = resolveRecordingPermissionReadiness(permissionSnapshot);
        if (!readiness.ready) {
          await window.electronAPI.openPermissionChecker();
          toast.error(t("permission.missingRequiredHint"));
          return;
        }
        await window.electronAPI.openSourceSelector();
      } catch (error) {
        reportUserActionError({
          t,
          userMessage: t("launch.openSourceSelectorFailed"),
          error,
          context: "launch-window.open-source-selector",
          dedupeKey: "launch-window.open-source-selector",
        });
      }
    })();
  }, [t]);

  const openPermissionChecker = useCallback(() => {
    if (!window.electronAPI) return;
    void (async () => {
      try {
        await window.electronAPI.openPermissionChecker();
      } catch (error) {
        reportUserActionError({
          t,
          userMessage: t("permission.openSettingsFailed"),
          error,
          context: "launch-window.open-permission-checker",
          dedupeKey: "launch-window.open-permission-checker",
        });
      }
    })();
  }, [t]);

  const beginRecordCountdown = useCallback(() => {
    if (!hasSelectedSource || recording || isTransitioning || countdownRemaining !== null) {
      return;
    }

    let remaining = recordCountdownSeconds;
    setCountdownRemaining(remaining);

    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearRecordCountdown();
        toggleRecording();
        return;
      }
      setCountdownRemaining(remaining);
    }, 1000);
  }, [
    countdownRemaining,
    hasSelectedSource,
    isTransitioning,
    recordCountdownSeconds,
    recording,
    clearRecordCountdown,
    toggleRecording,
  ]);

  const handleRecordButtonClick = useCallback(() => {
    if (recording || recordingState === "recording") {
      clearRecordCountdown();
      toggleRecording();
      return;
    }

    if (isTransitioning) return;

    if (!hasSelectedSource) {
      openSourceSelector();
      return;
    }

    if (countdownRemaining !== null) {
      clearRecordCountdown();
      return;
    }

    void (async () => {
      try {
        const permissionSnapshot = await window.electronAPI.getCapturePermissionSnapshot();
        const readiness = resolveRecordingPermissionReadiness(permissionSnapshot);
        if (!readiness.ready) {
          await window.electronAPI.openPermissionChecker();
          toast.error(t("permission.missingRequiredHint"));
          return;
        }
        beginRecordCountdown();
      } catch (error) {
        reportUserActionError({
          t,
          userMessage: t("permission.refreshFailed"),
          error,
          context: "launch-window.record-permission-preflight",
          dedupeKey: "launch-window.record-permission-preflight",
        });
      }
    })();
  }, [
    beginRecordCountdown,
    countdownRemaining,
    hasSelectedSource,
    isTransitioning,
    openSourceSelector,
    recording,
    recordingState,
    clearRecordCountdown,
    toggleRecording,
    t,
  ]);

  const openVideoFile = async () => {
    try {
      const result = await window.electronAPI.openVideoFilePicker(locale);

      if (result.cancelled) {
        return;
      }

      if (!result.success || !result.path) {
        reportUserActionError({
          t,
          userMessage: t("launch.openVideoFailed"),
          error: result,
          context: "launch-window.open-video-file-picker",
          dedupeKey: "launch-window.open-video-file-picker",
        });
        return;
      }

      await window.electronAPI.setCurrentVideoPath(result.path);
      await window.electronAPI.switchToEditor();
    } catch (error) {
      reportUserActionError({
        t,
        userMessage: t("launch.openVideoFailed"),
        error,
        context: "launch-window.open-video-file",
        dedupeKey: "launch-window.open-video-file",
      });
    }
  };

  // IPC events for hide/close
  const sendHudOverlayHide = useCallback(() => {
    if (window.electronAPI && window.electronAPI.hudOverlayHide) {
      window.electronAPI.hudOverlayHide();
    }
  }, []);
  const sendHudOverlayClose = () => {
    if (window.electronAPI && window.electronAPI.hudOverlayClose) {
      window.electronAPI.hudOverlayClose();
    }
  };

  useEffect(() => {
    const justStartedRecording = recording && !previousRecordingRef.current;
    previousRecordingRef.current = recording;
    if (justStartedRecording && autoHideHudOnRecord) {
      sendHudOverlayHide();
    }
  }, [autoHideHudOnRecord, recording, sendHudOverlayHide]);

  const displayedStopShortcut = formatAccelerator(stopRecordingShortcut, isMacPlatform);

  const resetStopRecordingShortcut = () => {
    void (async () => {
      const success = await applyStopRecordingShortcut(DEFAULT_STOP_RECORDING_SHORTCUT);
      if (success) {
        toast.success(t("launch.stopShortcutResetOk", {
          shortcut: formatAccelerator(DEFAULT_STOP_RECORDING_SHORTCUT, isMacPlatform),
        }));
        setCaptureStopShortcut(false);
      }
    })();
  };

  return (
    <div className="w-full h-full flex items-end pb-2 bg-transparent overflow-hidden pointer-events-none">
      <div
        className={`w-full mx-auto flex items-center gap-2 px-3 py-2 pointer-events-auto ${styles.electronDrag}`}
        style={{
          borderRadius: 16,
          background: 'linear-gradient(135deg, rgba(30,30,40,0.92) 0%, rgba(20,20,30,0.85) 100%)',
          backdropFilter: 'blur(32px) saturate(180%)',
          WebkitBackdropFilter: 'blur(32px) saturate(180%)',
          boxShadow: '0 4px 24px 0 rgba(0,0,0,0.28), 0 1px 3px 0 rgba(0,0,0,0.14) inset',
          border: '1px solid rgba(80,80,120,0.22)',
          minHeight: 44,
        }}
      >
        <div className={`flex items-center gap-1 shrink-0 ${styles.electronDrag}`}>
          <RxDragHandleDots2 size={18} className="text-white/40" />
        </div>

        <Button
          variant="link"
          size="sm"
          className={`gap-1 min-w-[220px] shrink-0 overflow-hidden text-white bg-transparent hover:bg-transparent px-1 justify-start text-xs ${styles.electronNoDrag}`}
          style={{ width: 'clamp(220px, 24vw, 420px)' }}
          onClick={openSourceSelector}
          disabled={controlsLocked}
          title={selectedSource}
        >
          <MdMonitor size={14} className="text-white" />
          <span className="truncate max-w-full block pointer-events-none">{selectedSource}</span>
        </Button>

        <Button
          variant="link"
          size="sm"
          onClick={handleRecordButtonClick}
          disabled={isTransitioning}
          className={`relative z-20 gap-1 shrink-0 min-w-[96px] text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-2 text-center text-xs ${styles.electronNoDrag}`}
          title={
            countdownRemaining !== null
              ? t("launch.countdownCancelHint", { seconds: countdownRemaining })
              : undefined
          }
        >
          {recording ? (
            <>
              <FaRegStopCircle size={14} className="text-red-400" />
              <span className="text-red-400">{formatTime(elapsed)}</span>
            </>
          ) : countdownRemaining !== null ? (
            <>
              <BsRecordCircle size={14} className="text-amber-300 animate-pulse" />
              <span className="text-amber-300">{t("launch.countdownStarting", { seconds: countdownRemaining })}</span>
            </>
          ) : recordingState === "starting" ? (
            <>
              <BsRecordCircle size={14} className="text-amber-300 animate-pulse" />
              <span className="text-amber-300">{t("common.loading")}</span>
            </>
          ) : recordingState === "stopping" ? (
            <>
              <FaRegStopCircle size={14} className="text-amber-300 animate-pulse" />
              <span className="text-amber-300">{t("common.processing")}</span>
            </>
          ) : (
            <>
              <BsRecordCircle size={14} className={hasSelectedSource ? "text-white" : "text-white/50"} />
              <span className={hasSelectedSource ? "text-white" : "text-white/50"}>{t("launch.record")}</span>
            </>
          )}
        </Button>

        <Button
          variant="link"
          size="sm"
          className={`gap-1 shrink-0 min-w-[92px] text-white bg-transparent hover:bg-transparent px-1 text-center text-xs ${styles.electronNoDrag}`}
          onClick={() => setIncludeCamera((value) => !value)}
          disabled={controlsLocked}
          title={includeCamera ? t("launch.cameraEnabled") : t("launch.cameraEnable")}
        >
          <FiCamera size={14} className={includeCamera ? "text-cyan-300" : "text-white/50"} />
          <span className={includeCamera ? "text-cyan-300" : "text-white/50"}>{t("launch.camera")}</span>
        </Button>

        <Button
          variant="link"
          size="sm"
          className={`gap-1 shrink-0 min-w-[88px] text-white bg-transparent hover:bg-transparent px-1 text-center text-xs ${styles.electronNoDrag}`}
          onClick={openPermissionChecker}
          disabled={controlsLocked}
          title={t("launch.permissions")}
        >
          <Shield size={13} className="text-white/80" />
          <span className="text-white/90">{t("launch.permissions")}</span>
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="link"
              size="sm"
              className={`gap-1 shrink-0 min-w-[118px] text-white bg-transparent hover:bg-transparent px-1 text-center text-xs ${styles.electronNoDrag}`}
              disabled={controlsLocked}
              title={captureMode === "pro"
                ? t("launch.captureProLabel", {
                  resolution: captureResolutionLabelMap[captureResolutionPreset],
                  fps: captureFrameRate,
                })
                : t("launch.captureProfileLabel", { profile: captureProfileLabelMap[captureProfile] })}
            >
              <SlidersHorizontal size={13} className="text-white/80" />
              <span className="text-white/90">{captureSummaryLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            sideOffset={8}
            align="center"
            collisionPadding={12}
            className={`w-[360px] bg-[#11131a] border border-white/20 text-white p-2.5 ${styles.electronNoDrag}`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] text-white/80">{t("launch.captureSettingsTitle")}</span>
              <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] p-0.5">
                <Button
                  variant="link"
                  size="sm"
                  className={`h-6 px-2 text-[10px] rounded ${captureMode === "standard" ? "bg-white/15 text-white" : "text-white/65 hover:bg-white/10"} ${styles.electronNoDrag}`}
                  onClick={() => setCaptureMode("standard")}
                  disabled={controlsLocked}
                >
                  {t("launch.captureMode.standard")}
                </Button>
                <Button
                  variant="link"
                  size="sm"
                  className={`h-6 px-2 text-[10px] rounded ${captureMode === "pro" ? "bg-cyan-400/20 text-cyan-100" : "text-white/65 hover:bg-white/10"} ${styles.electronNoDrag}`}
                  onClick={() => setCaptureMode("pro")}
                  disabled={controlsLocked}
                >
                  {t("launch.captureMode.pro")}
                </Button>
              </div>
            </div>

            {captureMode === "standard" ? (
              <>
                <div className="text-[10px] text-white/55 mb-2">
                  {t("launch.captureProfileHint")}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {CAPTURE_PROFILE_CYCLE.map((profile) => {
                    const active = profile === captureProfile;
                    return (
                      <Button
                        key={profile}
                        variant="link"
                        size="sm"
                        className={`h-7 px-2 text-[11px] rounded border ${active ? "border-cyan-300/35 bg-cyan-400/20 text-cyan-100" : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"} ${styles.electronNoDrag}`}
                        onClick={() => setCaptureProfile(profile)}
                        disabled={controlsLocked}
                      >
                        {captureProfileLabelMap[profile]}
                      </Button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="text-[10px] text-white/55 mb-2">
                  {t("launch.captureProHint")}
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] text-white/65 mb-1">
                      {t("launch.captureResolution")}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {CAPTURE_RESOLUTION_OPTIONS.map((preset) => {
                        const active = preset === captureResolutionPreset;
                        return (
                          <Button
                            key={preset}
                            variant="link"
                            size="sm"
                            className={`h-7 px-2 text-[11px] rounded border ${active ? "border-cyan-300/35 bg-cyan-400/20 text-cyan-100" : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"} ${styles.electronNoDrag}`}
                            onClick={() => setCaptureResolutionPreset(preset)}
                            disabled={controlsLocked}
                          >
                            {captureResolutionLabelMap[preset]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-white/65 mb-1">
                      {t("launch.captureFrameRate")}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {CAPTURE_FRAME_RATE_OPTIONS.map((fps) => {
                        const active = fps === captureFrameRate;
                        return (
                          <Button
                            key={fps}
                            variant="link"
                            size="sm"
                            className={`h-7 px-2 text-[11px] rounded border ${active ? "border-cyan-300/35 bg-cyan-400/20 text-cyan-100" : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"} ${styles.electronNoDrag}`}
                            onClick={() => setCaptureFrameRate(fps)}
                            disabled={controlsLocked}
                          >
                            {fps}fps
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>

        <Button
          variant="link"
          size="sm"
          className={`gap-1 shrink-0 min-w-[80px] text-white bg-transparent hover:bg-transparent px-1 text-center text-xs ${styles.electronNoDrag}`}
          onClick={cycleRecordCountdown}
          disabled={controlsLocked}
          title={t("launch.countdownLabel", { seconds: recordCountdownSeconds })}
        >
          <Timer size={13} className="text-white/80" />
          <span className="text-white/90">{recordCountdownSeconds}s</span>
        </Button>

        <Button
          variant="link"
          size="sm"
          className={`gap-1 shrink-0 min-w-[90px] text-white bg-transparent hover:bg-transparent px-1 text-center text-xs ${styles.electronNoDrag}`}
          onClick={() => setAutoHideHudOnRecord((value) => !value)}
          disabled={controlsLocked}
          title={autoHideHudOnRecord ? t("launch.autoHideHudOnRecordOn") : t("launch.autoHideHudOnRecordOff")}
        >
          <EyeOff size={13} className={autoHideHudOnRecord ? "text-cyan-300" : "text-white/60"} />
          <span className={autoHideHudOnRecord ? "text-cyan-300" : "text-white/80"}>
            {t("launch.autoHideHudOnRecord")}
          </span>
        </Button>

        <Popover
          open={stopShortcutPopoverOpen}
          onOpenChange={(open) => {
            setStopShortcutPopoverOpen(open);
            if (!open) {
              setCaptureStopShortcut(false);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="link"
              size="sm"
              className={`gap-1 shrink-0 min-w-[100px] text-white bg-transparent hover:bg-transparent px-1 text-center text-xs ${styles.electronNoDrag}`}
              disabled={controlsLocked}
              title={t("launch.stopShortcutLabel", { shortcut: displayedStopShortcut })}
            >
              <Keyboard size={13} className="text-white/80" />
              <span className="text-white/90">{displayedStopShortcut}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            sideOffset={8}
            align="center"
            collisionPadding={12}
            className={`w-[250px] bg-[#11131a] border border-white/20 text-white p-2.5 ${styles.electronNoDrag}`}
          >
            <div className="text-[11px] text-white/80 mb-2">
              {t("launch.stopShortcutConfigTitle")}
            </div>
            <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs mb-2">
              {captureStopShortcut
                ? t("launch.stopShortcutListening")
                : t("launch.stopShortcutCurrent", { shortcut: displayedStopShortcut })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="link"
                size="sm"
                className={`h-7 px-2 text-xs border border-white/15 rounded-md bg-white/5 hover:bg-white/10 ${styles.electronNoDrag}`}
                onClick={() => setCaptureStopShortcut((value) => !value)}
                disabled={controlsLocked}
              >
                {captureStopShortcut ? t("common.cancel") : t("launch.stopShortcutSet")}
              </Button>
              <Button
                variant="link"
                size="sm"
                className={`h-7 px-2 text-xs border border-white/15 rounded-md bg-white/5 hover:bg-white/10 ${styles.electronNoDrag}`}
                onClick={resetStopRecordingShortcut}
                disabled={controlsLocked}
              >
                <RotateCcw size={12} className="mr-1" />
                {t("launch.stopShortcutReset")}
              </Button>
            </div>
            <div className="text-[10px] text-white/50 mt-2">
              {t("launch.stopShortcutHint")}
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="link"
          size="sm"
          className={`gap-1 shrink-0 min-w-[110px] text-white bg-transparent hover:bg-transparent px-1 text-center text-xs ${styles.electronNoDrag}`}
          onClick={() => setRecordSystemCursor((value) => !value)}
          disabled={controlsLocked}
          title={recordSystemCursor ? t("launch.systemCursorShown") : t("launch.systemCursorHidden")}
        >
          <FiMousePointer size={13} className={recordSystemCursor ? "text-white/85" : "text-[#34B27B]"} />
          <span className={recordSystemCursor ? "text-white/85" : "text-[#34B27B]"}>
            {recordSystemCursor ? t("launch.systemCursorOn") : t("launch.systemCursorOff")}
          </span>
        </Button>

        {includeCamera ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="link"
                size="sm"
                className={`gap-1 shrink-0 min-w-[70px] text-cyan-200 bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-300/20 px-1 text-xs ${styles.electronNoDrag}`}
                title={t("launch.cameraShapeLabel", { shape: cameraShapeLabelMap[cameraShape] })}
              >
                <SlidersHorizontal size={13} />
                <span>{t("launch.shape")}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              sideOffset={8}
              align="center"
              collisionPadding={12}
              className={`w-[210px] bg-[#11131a] border border-cyan-300/20 text-cyan-100 p-2 ${styles.electronNoDrag}`}
            >
              <div className="flex items-center justify-between text-[11px] mb-2">
                <span>{t("launch.shape")}</span>
                <span className={styles.cameraConfigBadge}>{cameraShapeLabelMap[cameraShape]}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="link"
                  size="sm"
                  className={`text-cyan-200 bg-transparent hover:bg-cyan-200/10 px-2 h-7 text-sm ${styles.electronNoDrag}`}
                  onClick={cycleCameraShape}
                  disabled={controlsLocked}
                >
                  {cameraShapeLabelMap[cameraShape]}
                </Button>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="link"
                    size="sm"
                    className={`text-cyan-200 bg-transparent hover:bg-cyan-200/10 px-1 h-7 text-xs ${styles.electronNoDrag}`}
                    onClick={() => setCameraSizePercent((value) => clamp(value - 2, 14, 40))}
                    disabled={controlsLocked}
                    title={t("launch.sizeDecrease")}
                  >
                    -
                  </Button>
                  <span className={styles.cameraSizeReadout}>{cameraSizePercent}%</span>
                  <Button
                    variant="link"
                    size="sm"
                    className={`text-cyan-200 bg-transparent hover:bg-cyan-200/10 px-1 h-7 text-xs ${styles.electronNoDrag}`}
                    onClick={() => setCameraSizePercent((value) => clamp(value + 2, 14, 40))}
                    disabled={controlsLocked}
                    title={t("launch.sizeIncrease")}
                  >
                    +
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}


        <Button
          variant="link"
          size="sm"
          onClick={openVideoFile}
          className={`gap-1 shrink-0 min-w-[72px] text-white bg-transparent hover:bg-transparent px-0 text-right text-xs ${styles.electronNoDrag} ${styles.folderButton}`}
          disabled={controlsLocked}
        >
          <FaFolderMinus size={14} className="text-white" />
          <span className={styles.folderText}>{t("launch.open")}</span>
        </Button>

        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value as typeof locale)}
          className={`h-6 w-[92px] shrink-0 rounded bg-white/10 text-[10px] text-white border border-white/20 px-1.5 ${styles.electronNoDrag}`}
          title={t("common.language")}
        >
          <option value="en">{t("common.english")}</option>
          <option value="zh-CN">{t("common.chinese")}</option>
        </select>

        <div className={`flex items-center gap-1 shrink-0 ${styles.electronNoDrag}`}>
          <Button
            variant="link"
            size="icon"
            className={`h-7 w-7 ${styles.electronNoDrag} hudOverlayButton`}
            title={t("launch.hideHud")}
            onClick={sendHudOverlayHide}
          >
            <FiMinus size={18} style={{ color: '#fff', opacity: 0.7 }} />
          </Button>

          <Button
            variant="link"
            size="icon"
            className={`h-7 w-7 ${styles.electronNoDrag} hudOverlayButton`}
            title={t("launch.closeApp")}
            onClick={sendHudOverlayClose}
          >
            <FiX size={18} style={{ color: '#fff', opacity: 0.7 }} />
          </Button>
        </div>
      </div>
    </div>
  );
}
