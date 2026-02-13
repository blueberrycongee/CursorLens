import { useState, useEffect } from "react";
import styles from "./LaunchWindow.module.css";
import { useScreenRecorder, type CaptureProfile } from "../../hooks/useScreenRecorder";
import type { CameraOverlayShape } from "../../hooks/cameraOverlay";
import { Button } from "../ui/button";
import { BsRecordCircle } from "react-icons/bs";
import { FaRegStopCircle } from "react-icons/fa";
import { MdMonitor } from "react-icons/md";
import { RxDragHandleDots2 } from "react-icons/rx";
import { FaFolderMinus } from "react-icons/fa6";
import { FiCamera, FiMinus, FiMousePointer, FiX } from "react-icons/fi";
import { SlidersHorizontal } from "lucide-react";
import { useI18n } from "@/i18n";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const CAMERA_SHAPE_CYCLE: CameraOverlayShape[] = ["rounded", "square", "circle"];
const CAPTURE_PROFILE_CYCLE: CaptureProfile[] = ["balanced", "quality", "ultra"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const [recordSystemCursor, setRecordSystemCursor] = useState(() => {
    try {
      const value = window.localStorage.getItem("openscreen.recordSystemCursor");
      return value === null ? true : value === "1";
    } catch {
      return true;
    }
  });
  const { recording, recordingState, toggleRecording } = useScreenRecorder({
    includeCamera,
    cameraShape,
    cameraSizePercent,
    captureProfile,
    recordSystemCursor,
  });
  const isTransitioning = recordingState === "starting" || recordingState === "stopping";
  const controlsLocked = recording || isTransitioning;
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
      window.localStorage.setItem("openscreen.recordSystemCursor", recordSystemCursor ? "1" : "0");
    } catch {
      // no-op
    }
  }, [recordSystemCursor]);

  const cycleCameraShape = () => {
    setCameraShape((current) => {
      const index = CAMERA_SHAPE_CYCLE.indexOf(current);
      const nextIndex = index >= 0 ? (index + 1) % CAMERA_SHAPE_CYCLE.length : 0;
      return CAMERA_SHAPE_CYCLE[nextIndex] ?? "rounded";
    });
  };

  const cycleCaptureProfile = () => {
    setCaptureProfile((current) => {
      const index = CAPTURE_PROFILE_CYCLE.indexOf(current);
      const nextIndex = index >= 0 ? (index + 1) % CAPTURE_PROFILE_CYCLE.length : 0;
      return CAPTURE_PROFILE_CYCLE[nextIndex] ?? "quality";
    });
  };

  useEffect(() => {
    const checkSelectedSource = async () => {
      if (window.electronAPI) {
        const source = await window.electronAPI.getSelectedSource();
        if (source) {
          setSelectedSource(source.name);
          setHasSelectedSource(true);
        } else {
          setSelectedSource(t("launch.sourceFallback"));
          setHasSelectedSource(false);
        }
      }
    };

    checkSelectedSource();
    
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

  const openSourceSelector = () => {
    if (window.electronAPI) {
      window.electronAPI.openSourceSelector();
    }
  };

  const openVideoFile = async () => {
    const result = await window.electronAPI.openVideoFilePicker(locale);
    
    if (result.cancelled) {
      return;
    }
    
    if (result.success && result.path) {
      await window.electronAPI.setCurrentVideoPath(result.path);
      await window.electronAPI.switchToEditor();
    }
  };

  // IPC events for hide/close
  const sendHudOverlayHide = () => {
    if (window.electronAPI && window.electronAPI.hudOverlayHide) {
      window.electronAPI.hudOverlayHide();
    }
  };
  const sendHudOverlayClose = () => {
    if (window.electronAPI && window.electronAPI.hudOverlayClose) {
      window.electronAPI.hudOverlayClose();
    }
  };

  return (
    <div className="w-full h-full flex items-center bg-transparent">
      <div
        className={`w-full max-w-[860px] mx-auto flex items-center gap-2 px-3 py-2 ${styles.electronDrag}`}
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
          className={`gap-1 min-w-0 flex-1 overflow-hidden text-white bg-transparent hover:bg-transparent px-1 justify-start text-xs ${styles.electronNoDrag}`}
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
          onClick={hasSelectedSource ? toggleRecording : openSourceSelector}
          disabled={isTransitioning}
          className={`relative z-20 gap-1 shrink-0 min-w-[96px] text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-2 text-center text-xs ${styles.electronNoDrag}`}
        >
          {recording ? (
            <>
              <FaRegStopCircle size={14} className="text-red-400" />
              <span className="text-red-400">{formatTime(elapsed)}</span>
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
          className={`gap-1 shrink-0 min-w-[92px] text-white bg-transparent hover:bg-transparent px-1 text-center text-xs ${styles.electronNoDrag}`}
          onClick={cycleCaptureProfile}
          disabled={controlsLocked}
          title={t("launch.captureProfileLabel", { profile: captureProfileLabelMap[captureProfile] })}
        >
          <SlidersHorizontal size={13} className="text-white/80" />
          <span className="text-white/90">{captureProfileLabelMap[captureProfile]}</span>
        </Button>

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
              sideOffset={8}
              align="center"
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
