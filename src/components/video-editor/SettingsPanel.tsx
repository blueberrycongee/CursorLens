import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { getAssetPath } from "@/lib/assetPath";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import Block from '@uiw/react-color-block';
import { Trash2, Download, Crop, X, Bug, Upload, Star, Film, Image, Sparkles, Palette, Captions, Scissors } from "lucide-react";
import { toast } from "sonner";
import type { ZoomDepth, CropRegion, AnnotationRegion, AnnotationType, FigureData } from "./types";
import { CropControl } from "./CropControl";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import { ASPECT_RATIOS, type AspectRatio } from "@/utils/aspectRatioUtils";
import type { ExportQuality, ExportFormat, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import { GIF_FRAME_RATES, GIF_SIZE_PRESETS } from "@/lib/exporter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useI18n } from "@/i18n";
import { DEFAULT_CURSOR_STYLE, type CursorMovementStyle, type CursorStyleConfig } from "@/lib/cursor";
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL } from "@/lib/supportLinks";
import { reportUserActionError } from "@/lib/userErrorFeedback";

const WALLPAPER_COUNT = 18;
const WALLPAPER_RELATIVE = Array.from({ length: WALLPAPER_COUNT }, (_, i) => `wallpapers/wallpaper${i + 1}.jpg`);
const GRADIENTS = [
  "linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(253,129,82,1) 54.8%, rgba(249,202,86,1) 86.3% )",
  "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
  "radial-gradient( circle farthest-corner at 3.2% 49.6%,  rgba(80,12,139,0.87) 0%, rgba(161,10,144,0.72) 83.6% )",
  "linear-gradient( 111.6deg,  rgba(0,56,68,1) 0%, rgba(163,217,185,1) 51.5%, rgba(231, 148, 6, 1) 88.6% )",
  "linear-gradient( 107.7deg,  rgba(235,230,44,0.55) 8.4%, rgba(252,152,15,1) 90.3% )",
  "linear-gradient( 91deg,  rgba(72,154,78,1) 5.2%, rgba(251,206,70,1) 95.9% )",
  "radial-gradient( circle farthest-corner at 10% 20%,  rgba(2,37,78,1) 0%, rgba(4,56,126,1) 19.7%, rgba(85,245,221,1) 100.2% )",
  "linear-gradient( 109.6deg,  rgba(15,2,2,1) 11.2%, rgba(36,163,190,1) 91.1% )",
  "linear-gradient(135deg, #FBC8B4, #2447B1)",
  "linear-gradient(109.6deg, #F635A6, #36D860)",
  "linear-gradient(90deg, #FF0101, #4DFF01)",
  "linear-gradient(315deg, #EC0101, #5044A9)",
  "linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%)",
  "linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(to right, #ff8177 0%, #ff867a 0%, #ff8c7f 21%, #f99185 52%, #cf556c 78%, #b12a5b 100%)",
  "linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)",
  "linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(to top, #fcc5e4 0%, #fda34b 15%, #ff7882 35%, #c8699e 52%, #7046aa 71%, #0c1db8 87%, #020f75 100%)",
  "linear-gradient(to right, #fa709a 0%, #fee140 100%)",
  "linear-gradient(to top, #30cfd0 0%, #330867 100%)",
  "linear-gradient(to top, #c471f5 0%, #fa71cd 100%)",
  "linear-gradient(to right, #f78ca0 0%, #f9748f 19%, #fd868c 60%, #fe9a8b 100%)",
  "linear-gradient(to top, #48c6ef 0%, #6f86d6 100%)",
  "linear-gradient(to right, #0acffe 0%, #495aff 100%)",
];

interface SettingsPanelProps {
  selected: string;
  onWallpaperChange: (path: string) => void;
  selectedZoomDepth?: ZoomDepth | null;
  onZoomDepthChange?: (depth: ZoomDepth) => void;
  selectedZoomId?: string | null;
  onZoomDelete?: (id: string) => void;
  selectedTrimId?: string | null;
  onTrimDelete?: (id: string) => void;
  shadowIntensity?: number;
  onShadowChange?: (intensity: number) => void;
  showBlur?: boolean;
  onBlurChange?: (showBlur: boolean) => void;
  motionBlurEnabled?: boolean;
  onMotionBlurChange?: (enabled: boolean) => void;
  borderRadius?: number;
  onBorderRadiusChange?: (radius: number) => void;
  padding?: number;
  onPaddingChange?: (padding: number) => void;
  cropRegion?: CropRegion;
  onCropChange?: (region: CropRegion) => void;
  aspectRatio: AspectRatio;
  videoElement?: HTMLVideoElement | null;
  exportQuality?: ExportQuality;
  onExportQualityChange?: (quality: ExportQuality) => void;
  // Export format settings
  exportFormat?: ExportFormat;
  onExportFormatChange?: (format: ExportFormat) => void;
  exportAspectRatios?: AspectRatio[];
  onExportAspectRatiosChange?: (ratios: AspectRatio[]) => void;
  onPreviewAspectRatioChange?: (ratio: AspectRatio) => void;
  gifFrameRate?: GifFrameRate;
  onGifFrameRateChange?: (rate: GifFrameRate) => void;
  gifLoop?: boolean;
  onGifLoopChange?: (loop: boolean) => void;
  gifSizePreset?: GifSizePreset;
  onGifSizePresetChange?: (preset: GifSizePreset) => void;
  gifOutputDimensions?: { width: number; height: number };
  onExport?: () => void;
  selectedAnnotationId?: string | null;
  annotationRegions?: AnnotationRegion[];
  onAnnotationContentChange?: (id: string, content: string) => void;
  onAnnotationTypeChange?: (id: string, type: AnnotationType) => void;
  onAnnotationStyleChange?: (id: string, style: Partial<AnnotationRegion['style']>) => void;
  onAnnotationFigureDataChange?: (id: string, figureData: FigureData) => void;
  onAnnotationDelete?: (id: string) => void;
  hasAudioTrack?: boolean;
  audioEnabled?: boolean;
  onAudioEnabledChange?: (enabled: boolean) => void;
  audioGain?: number;
  onAudioGainChange?: (gain: number) => void;
  audioNormalizeLoudness?: boolean;
  onAudioNormalizeLoudnessChange?: (enabled: boolean) => void;
  audioTargetLufs?: number;
  onAudioTargetLufsChange?: (value: number) => void;
  audioLimiterDb?: number;
  onAudioLimiterDbChange?: (value: number) => void;
  cursorStyle?: CursorStyleConfig;
  onCursorStyleChange?: (style: CursorStyleConfig) => void;
  onAutoEdit?: () => void;
  autoEditDisabled?: boolean;
  onGenerateSubtitles?: () => void;
  onApplyRoughCut?: () => void;
  analysisRunning?: boolean;
  subtitleCueCount?: number;
  roughCutSuggestionCount?: number;
}

export default SettingsPanel;

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
  { depth: 1, label: "1.25×" },
  { depth: 2, label: "1.5×" },
  { depth: 3, label: "1.8×" },
  { depth: 4, label: "2.2×" },
  { depth: 5, label: "3.5×" },
  { depth: 6, label: "5×" },
];

const CURSOR_MOVEMENT_PRESETS: Array<{
  style: Exclude<CursorMovementStyle, "custom">;
  smoothingMs: number;
  labelKey: string;
}> = [
  { style: "rapid", smoothingMs: 0, labelKey: "settings.cursorMovementRapid" },
  { style: "quick", smoothingMs: 36, labelKey: "settings.cursorMovementQuick" },
  { style: "default", smoothingMs: 78, labelKey: "settings.cursorMovementDefault" },
  { style: "slow", smoothingMs: 130, labelKey: "settings.cursorMovementSlow" },
];

export function SettingsPanel({ 
  selected, 
  onWallpaperChange, 
  selectedZoomDepth, 
  onZoomDepthChange, 
  selectedZoomId, 
  onZoomDelete, 
  selectedTrimId,
  onTrimDelete,
  shadowIntensity = 0, 
  onShadowChange, 
  showBlur, 
  onBlurChange, 
  motionBlurEnabled = false,
  onMotionBlurChange, 
  borderRadius = 0, 
  onBorderRadiusChange, 
  padding = 50, 
  onPaddingChange, 
  cropRegion, 
  onCropChange, 
  aspectRatio, 
  videoElement, 
  exportQuality = 'good',
  onExportQualityChange,
  exportFormat = 'mp4',
  onExportFormatChange,
  exportAspectRatios = [],
  onExportAspectRatiosChange,
  onPreviewAspectRatioChange,
  gifFrameRate = 15,
  onGifFrameRateChange,
  gifLoop = true,
  onGifLoopChange,
  gifSizePreset = 'medium',
  onGifSizePresetChange,
  gifOutputDimensions = { width: 1280, height: 720 },
  onExport,
  selectedAnnotationId,
  annotationRegions = [],
  onAnnotationContentChange,
  onAnnotationTypeChange,
  onAnnotationStyleChange,
  onAnnotationFigureDataChange,
  onAnnotationDelete,
  hasAudioTrack = true,
  audioEnabled = true,
  onAudioEnabledChange,
  audioGain = 1,
  onAudioGainChange,
  audioNormalizeLoudness = true,
  onAudioNormalizeLoudnessChange,
  audioTargetLufs = -16,
  onAudioTargetLufsChange,
  audioLimiterDb = -1,
  onAudioLimiterDbChange,
  cursorStyle = DEFAULT_CURSOR_STYLE,
  onCursorStyleChange,
  onAutoEdit,
  autoEditDisabled = false,
  onGenerateSubtitles,
  onApplyRoughCut,
  analysisRunning = false,
  subtitleCueCount = 0,
  roughCutSuggestionCount = 0,
}: SettingsPanelProps) {
  const { t } = useI18n();
  const [wallpaperPaths, setWallpaperPaths] = useState<string[]>([]);
  const [customImages, setCustomImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openSupportUrl = async (url: string, context: string) => {
    try {
      const result = await window.electronAPI.openExternalUrl(url);
      if (!result.success) {
        throw new Error(result.error || "openExternalUrl returned unsuccessful result");
      }
    } catch (error) {
      reportUserActionError({
        t,
        userMessage: t("error.reportOpenFailed"),
        error,
        context,
        details: { url },
        dedupeKey: context,
      });
    }
  };

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const resolved = await Promise.all(WALLPAPER_RELATIVE.map(p => getAssetPath(p)))
        if (mounted) setWallpaperPaths(resolved)
      } catch (err) {
        if (mounted) setWallpaperPaths(WALLPAPER_RELATIVE.map(p => `/${p}`))
      }
    })()
    return () => { mounted = false }
  }, [])
  const colorPalette = [
    '#FF0000', '#FFD700', '#00FF00', '#FFFFFF', '#0000FF', '#FF6B00',
    '#9B59B6', '#E91E63', '#00BCD4', '#FF5722', '#8BC34A', '#FFC107',
    '#34B27B', '#000000', '#607D8B', '#795548',
  ];
  
  const [selectedColor, setSelectedColor] = useState('#ADADAD');
  const [gradient, setGradient] = useState<string>(GRADIENTS[0]);
  const [showCropDropdown, setShowCropDropdown] = useState(false);
  const activeExportAspectRatios = exportAspectRatios;

  const zoomEnabled = Boolean(selectedZoomDepth);
  const trimEnabled = Boolean(selectedTrimId);
  
  const handleDeleteClick = () => {
    if (selectedZoomId && onZoomDelete) {
      onZoomDelete(selectedZoomId);
    }
  };

  const handleTrimDeleteClick = () => {
    if (selectedTrimId && onTrimDelete) {
      onTrimDelete(selectedTrimId);
    }
  };

  const toggleExportAspectRatio = (ratio: AspectRatio) => {
    onPreviewAspectRatioChange?.(ratio);
    if (!onExportAspectRatiosChange) return;
    const currentlySelected = activeExportAspectRatios.includes(ratio);

    const nextSelection = new Set(activeExportAspectRatios);
    if (currentlySelected) {
      nextSelection.delete(ratio);
    } else {
      nextSelection.add(ratio);
    }

    const ordered = ASPECT_RATIOS.filter((candidate) => nextSelection.has(candidate));
    onExportAspectRatiosChange(ordered);
  };

  const updateCursorStyle = (patch: Partial<CursorStyleConfig>) => {
    if (!onCursorStyleChange) return;
    onCursorStyleChange({
      ...cursorStyle,
      ...patch,
    });
  };

  const applyMovementPreset = (style: Exclude<CursorMovementStyle, "custom">) => {
    const preset = CURSOR_MOVEMENT_PRESETS.find((item) => item.style === style);
    if (!preset) return;
    updateCursorStyle({
      movementStyle: preset.style,
      smoothingMs: preset.smoothingMs,
    });
  };

  const activeMovementStyle: CursorMovementStyle = cursorStyle.movementStyle ?? "custom";

  const formatSignedPx = (value: number) => {
    const rounded = Math.round(value);
    return `${rounded > 0 ? "+" : ""}${rounded}px`;
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    
    // Validate file type - only allow JPG/JPEG
    const validTypes = ['image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      toast.error(t("settings.fileTypeInvalid"), {
        description: t("settings.uploadJpgOnly"),
      });
      event.target.value = '';
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        setCustomImages(prev => [...prev, dataUrl]);
        onWallpaperChange(dataUrl);
        toast.success(t("settings.uploadOk"));
      }
    };

    reader.onerror = () => {
      toast.error(t("settings.uploadFailed"), {
        description: t("settings.uploadReadError"),
      });
    };

    reader.readAsDataURL(file);
    // Reset input so the same file can be selected again
    event.target.value = '';
  };

  const handleRemoveCustomImage = (imageUrl: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCustomImages(prev => prev.filter(img => img !== imageUrl));
    // If the removed image was selected, clear selection
    if (selected === imageUrl) {
      onWallpaperChange(wallpaperPaths[0] || WALLPAPER_RELATIVE[0]);
    }
  };

  // Find selected annotation
  const selectedAnnotation = selectedAnnotationId 
    ? annotationRegions.find(a => a.id === selectedAnnotationId)
    : null;

  // If an annotation is selected, show annotation settings instead
  if (selectedAnnotation && onAnnotationContentChange && onAnnotationTypeChange && onAnnotationStyleChange && onAnnotationDelete) {
    return (
      <AnnotationSettingsPanel
        annotation={selectedAnnotation}
        onContentChange={(content) => onAnnotationContentChange(selectedAnnotation.id, content)}
        onTypeChange={(type) => onAnnotationTypeChange(selectedAnnotation.id, type)}
        onStyleChange={(style) => onAnnotationStyleChange(selectedAnnotation.id, style)}
        onFigureDataChange={onAnnotationFigureDataChange ? (figureData) => onAnnotationFigureDataChange(selectedAnnotation.id, figureData) : undefined}
        onDelete={() => onAnnotationDelete(selectedAnnotation.id)}
      />
    );
  }

  return (
    <div className="flex-[2] min-w-0 bg-[#09090b] border border-white/5 rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 pb-0">
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-200">{t("settings.zoomLevel")}</span>
            <div className="flex items-center gap-2">
              {zoomEnabled && selectedZoomDepth && (
                <span className="text-[10px] uppercase tracking-wider font-medium text-[#34B27B] bg-[#34B27B]/10 px-2 py-0.5 rounded-full">
                  {ZOOM_DEPTH_OPTIONS.find(o => o.depth === selectedZoomDepth)?.label}
                </span>
              )}
              <KeyboardShortcutsHelp />
            </div>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {ZOOM_DEPTH_OPTIONS.map((option) => {
              const isActive = selectedZoomDepth === option.depth;
              return (
                <Button
                  key={option.depth}
                  type="button"
                  disabled={!zoomEnabled}
                  onClick={() => onZoomDepthChange?.(option.depth)}
                  className={cn(
                    "h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all",
                    "duration-200 ease-out",
                    zoomEnabled ? "opacity-100 cursor-pointer" : "opacity-40 cursor-not-allowed",
                    isActive
                      ? "border-[#34B27B] bg-[#34B27B] text-white shadow-[#34B27B]/20"
                      : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10 hover:border-white/10 hover:text-slate-200"
                  )}
                >
                  <span className="text-xs font-semibold">{option.label}</span>
                </Button>
              );
            })}
          </div>
          {!zoomEnabled && (
            <p className="text-[10px] text-slate-500 mt-2 text-center">{t("settings.selectZoomToAdjust")}</p>
          )}
          {zoomEnabled && (
            <Button
              onClick={handleDeleteClick}
              variant="destructive"
              size="sm"
              className="mt-2 w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs"
            >
              <Trash2 className="w-3 h-3" />
              {t("settings.deleteZoom")}
            </Button>
          )}
          <Button
            onClick={() => onAutoEdit?.()}
            variant="outline"
            size="sm"
            disabled={autoEditDisabled}
            className="mt-2 w-full gap-2 bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white transition-all h-8 text-xs disabled:opacity-50"
          >
            <Sparkles className="w-3 h-3 text-[#34B27B]" />
            {t("settings.autoEdit")}
          </Button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              onClick={() => onGenerateSubtitles?.()}
              variant="outline"
              size="sm"
              disabled={analysisRunning}
              className="gap-1.5 bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white transition-all h-8 text-[10px] disabled:opacity-50"
            >
              <Captions className="w-3 h-3 text-[#34B27B]" />
              {t("settings.generateSubtitles")}
            </Button>
            <Button
              onClick={() => onApplyRoughCut?.()}
              variant="outline"
              size="sm"
              disabled={analysisRunning || roughCutSuggestionCount <= 0}
              className="gap-1.5 bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white transition-all h-8 text-[10px] disabled:opacity-50"
            >
              <Scissors className="w-3 h-3 text-[#34B27B]" />
              {t("settings.applyRoughCut")}
            </Button>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 px-1">
            <span>{t("timeline.subtitle")}: {subtitleCueCount}</span>
            <span>{t("settings.applyRoughCut")}: {roughCutSuggestionCount}</span>
          </div>
        </div>

        {trimEnabled && (
          <div className="mb-4">
            <Button
              onClick={handleTrimDeleteClick}
              variant="destructive"
              size="sm"
              className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all h-8 text-xs"
            >
              <Trash2 className="w-3 h-3" />
              {t("settings.deleteTrim")}
            </Button>
          </div>
        )}

        <Accordion type="multiple" defaultValue={["effects", "background"]} className="space-y-1">
          <AccordionItem value="effects" className="border-white/5 rounded-xl bg-white/[0.02] px-3">
            <AccordionTrigger className="py-2.5 hover:no-underline">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#34B27B]" />
                <span className="text-xs font-medium">{t("settings.videoEffects")}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5">
                  <div className="text-[10px] font-medium text-slate-300">{t("settings.motionBlur")}</div>
                  <Switch
                    checked={motionBlurEnabled}
                    onCheckedChange={onMotionBlurChange}
                    className="data-[state=checked]:bg-[#34B27B] scale-90"
                  />
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5">
                  <div className="text-[10px] font-medium text-slate-300">{t("settings.blurBg")}</div>
                  <Switch
                    checked={showBlur}
                    onCheckedChange={onBlurChange}
                    className="data-[state=checked]:bg-[#34B27B] scale-90"
                  />
                </div>
              </div>

              <div className="rounded-lg bg-white/5 border border-white/5 p-2 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-medium text-slate-300">{t("settings.cursorComposer")}</div>
                  <Switch
                    checked={cursorStyle.enabled}
                    onCheckedChange={(enabled) => updateCursorStyle({ enabled })}
                    className="data-[state=checked]:bg-[#34B27B] scale-90"
                  />
                </div>
                <div className="rounded-md bg-black/20 border border-white/5 p-2 mb-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-slate-300">{t("settings.cursorMovementStyle")}</div>
                    <span className="text-[10px] text-slate-500">
                      {activeMovementStyle === "custom"
                        ? t("settings.cursorMovementCustom")
                        : t(`settings.cursorMovement${activeMovementStyle.charAt(0).toUpperCase()}${activeMovementStyle.slice(1)}`)}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {CURSOR_MOVEMENT_PRESETS.map((preset) => (
                      <Button
                        key={preset.style}
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-6 px-0 text-[10px] border transition-all",
                          activeMovementStyle === preset.style
                            ? "bg-[#34B27B]/20 border-[#34B27B]/40 text-[#9DF3CB] hover:bg-[#34B27B]/25"
                            : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white",
                        )}
                        onClick={() => applyMovementPreset(preset.style)}
                      >
                        {t(preset.labelKey)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="rounded-md bg-black/20 border border-white/5 p-2 mb-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-slate-300">{t("settings.cursorAutoHideStatic")}</div>
                    <Switch
                      checked={cursorStyle.autoHideStatic}
                      onCheckedChange={(autoHideStatic) => updateCursorStyle({ autoHideStatic })}
                      className="data-[state=checked]:bg-[#34B27B] scale-90"
                    />
                  </div>
                  {cursorStyle.autoHideStatic && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[10px] text-slate-400">{t("settings.cursorStaticHideDelay")}</div>
                          <span className="text-[10px] text-slate-500 font-mono">{Math.round(cursorStyle.staticHideDelayMs)}ms</span>
                        </div>
                        <Slider
                          value={[cursorStyle.staticHideDelayMs]}
                          onValueChange={(values) => updateCursorStyle({ staticHideDelayMs: values[0] })}
                          min={0}
                          max={4000}
                          step={20}
                          className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[10px] text-slate-400">{t("settings.cursorStaticHideFade")}</div>
                          <span className="text-[10px] text-slate-500 font-mono">{Math.round(cursorStyle.staticHideFadeMs)}ms</span>
                        </div>
                        <Slider
                          value={[cursorStyle.staticHideFadeMs]}
                          onValueChange={(values) => updateCursorStyle({ staticHideFadeMs: values[0] })}
                          min={40}
                          max={1200}
                          step={20}
                          className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="rounded-md bg-black/20 border border-white/5 p-2 mb-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] text-slate-300">{t("settings.cursorLoopPosition")}</div>
                    <Switch
                      checked={cursorStyle.loopCursorPosition}
                      onCheckedChange={(loopCursorPosition) => updateCursorStyle({ loopCursorPosition })}
                      className="data-[state=checked]:bg-[#34B27B] scale-90"
                    />
                  </div>
                  {cursorStyle.loopCursorPosition && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[10px] text-slate-400">{t("settings.cursorLoopBlend")}</div>
                        <span className="text-[10px] text-slate-500 font-mono">{Math.round(cursorStyle.loopBlendMs)}ms</span>
                      </div>
                      <Slider
                        value={[cursorStyle.loopBlendMs]}
                        onValueChange={(values) => updateCursorStyle({ loopBlendMs: values[0] })}
                        min={80}
                        max={3000}
                        step={20}
                        className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                      />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] text-slate-400">{t("settings.cursorSize")}</div>
                      <span className="text-[10px] text-slate-500 font-mono">{cursorStyle.size.toFixed(2)}x</span>
                    </div>
                    <Slider
                      value={[cursorStyle.size]}
                      onValueChange={(values) => updateCursorStyle({ size: values[0] })}
                      min={0.8}
                      max={3}
                      step={0.05}
                      className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] text-slate-400">{t("settings.cursorHighlight")}</div>
                      <span className="text-[10px] text-slate-500 font-mono">{Math.round(cursorStyle.highlight * 100)}%</span>
                    </div>
                    <Slider
                      value={[cursorStyle.highlight]}
                      onValueChange={(values) => updateCursorStyle({ highlight: values[0] })}
                      min={0}
                      max={1}
                      step={0.01}
                      className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] text-slate-400">{t("settings.cursorRipple")}</div>
                      <span className="text-[10px] text-slate-500 font-mono">{Math.round(cursorStyle.ripple * 100)}%</span>
                    </div>
                    <Slider
                      value={[cursorStyle.ripple]}
                      onValueChange={(values) => updateCursorStyle({ ripple: values[0] })}
                      min={0}
                      max={1}
                      step={0.01}
                      className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] text-slate-400">{t("settings.cursorSmoothing")}</div>
                      <span className="text-[10px] text-slate-500 font-mono">{Math.round(cursorStyle.smoothingMs)}ms</span>
                    </div>
                    <Slider
                      value={[cursorStyle.smoothingMs]}
                      onValueChange={(values) => updateCursorStyle({ smoothingMs: values[0], movementStyle: "custom" })}
                      min={0}
                      max={200}
                      step={5}
                      className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] text-slate-400">{t("settings.cursorTimeOffset")}</div>
                      <span className="text-[10px] text-slate-500 font-mono">{formatSignedPx(cursorStyle.timeOffsetMs).replace("px", "ms")}</span>
                    </div>
                    <Slider
                      value={[cursorStyle.timeOffsetMs]}
                      onValueChange={(values) => updateCursorStyle({ timeOffsetMs: values[0] })}
                      min={-200}
                      max={200}
                      step={1}
                      className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] text-slate-400">{t("settings.cursorOffsetX")}</div>
                      <span className="text-[10px] text-slate-500 font-mono">{formatSignedPx(cursorStyle.offsetX)}</span>
                    </div>
                    <Slider
                      value={[cursorStyle.offsetX]}
                      onValueChange={(values) => updateCursorStyle({ offsetX: values[0] })}
                      min={-120}
                      max={120}
                      step={1}
                      className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] text-slate-400">{t("settings.cursorOffsetY")}</div>
                      <span className="text-[10px] text-slate-500 font-mono">{formatSignedPx(cursorStyle.offsetY)}</span>
                    </div>
                    <Slider
                      value={[cursorStyle.offsetY]}
                      onValueChange={(values) => updateCursorStyle({ offsetY: values[0] })}
                      min={-120}
                      max={120}
                      step={1}
                      className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px] bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
                      onClick={() => updateCursorStyle({ offsetX: 0, offsetY: 0, timeOffsetMs: 0 })}
                    >
                      {t("settings.cursorOffsetReset")}
                    </Button>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 rounded-lg bg-white/5 border border-white/5 p-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-medium text-slate-300">{t("settings.audioTrack")}</div>
                    <Switch
                      checked={hasAudioTrack && audioEnabled}
                      disabled={!hasAudioTrack}
                      onCheckedChange={onAudioEnabledChange}
                      className="data-[state=checked]:bg-[#34B27B] scale-90 disabled:opacity-50"
                    />
                  </div>
                  {hasAudioTrack ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[10px] text-slate-400">{t("settings.audioVolume")}</div>
                        <span className="text-[10px] text-slate-500 font-mono">{Math.round(audioGain * 100)}%</span>
                      </div>
                      <Slider
                        value={[audioGain]}
                        onValueChange={(values) => onAudioGainChange?.(values[0])}
                        min={0}
                        max={2}
                        step={0.01}
                        disabled={!audioEnabled}
                        className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 disabled:opacity-50"
                      />
                      <div className="mt-1 rounded-md border border-white/10 bg-black/20 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] text-slate-300">{t("settings.audioNormalizeLoudness")}</div>
                          <Switch
                            checked={audioNormalizeLoudness}
                            disabled={!audioEnabled}
                            onCheckedChange={onAudioNormalizeLoudnessChange}
                            className="data-[state=checked]:bg-[#34B27B] scale-90 disabled:opacity-50"
                          />
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">{t("settings.audioNormalizeHint")}</div>
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-[10px] text-slate-400">{t("settings.audioTargetLufs")}</div>
                            <span className="text-[10px] text-slate-500 font-mono">{audioTargetLufs.toFixed(1)} LUFS</span>
                          </div>
                          <Slider
                            value={[audioTargetLufs]}
                            onValueChange={(values) => onAudioTargetLufsChange?.(values[0])}
                            min={-24}
                            max={-12}
                            step={0.5}
                            disabled={!audioEnabled || !audioNormalizeLoudness}
                            className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 disabled:opacity-50"
                          />
                        </div>
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-[10px] text-slate-400">{t("settings.audioLimiterCeiling")}</div>
                            <span className="text-[10px] text-slate-500 font-mono">{audioLimiterDb.toFixed(1)} dBFS</span>
                          </div>
                          <Slider
                            value={[audioLimiterDb]}
                            onValueChange={(values) => onAudioLimiterDbChange?.(values[0])}
                            min={-6}
                            max={-0.1}
                            step={0.1}
                            disabled={!audioEnabled}
                            className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 disabled:opacity-50"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-500">{t("settings.audioTrackMissing")}</div>
                  )}
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] font-medium text-slate-300">{t("settings.shadow")}</div>
                    <span className="text-[10px] text-slate-500 font-mono">{Math.round(shadowIntensity * 100)}%</span>
                  </div>
                  <Slider
                    value={[shadowIntensity]}
                    onValueChange={(values) => onShadowChange?.(values[0])}
                    min={0}
                    max={1}
                    step={0.01}
                    className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                  />
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] font-medium text-slate-300">{t("settings.roundness")}</div>
                    <span className="text-[10px] text-slate-500 font-mono">{borderRadius}px</span>
                  </div>
                  <Slider
                    value={[borderRadius]}
                    onValueChange={(values) => onBorderRadiusChange?.(values[0])}
                    min={0}
                    max={16}
                    step={0.5}
                    className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                  />
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] font-medium text-slate-300">{t("settings.padding")}</div>
                    <span className="text-[10px] text-slate-500 font-mono">{padding}%</span>
                  </div>
                  <Slider
                    value={[padding]}
                    onValueChange={(values) => onPaddingChange?.(values[0])}
                    min={0}
                    max={100}
                    step={1}
                    className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
                  />
                </div>
              </div>

              <Button
                onClick={() => setShowCropDropdown(!showCropDropdown)}
                variant="outline"
                className="w-full mt-2 gap-1.5 bg-white/5 text-slate-200 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white text-[10px] h-8 transition-all"
              >
                <Crop className="w-3 h-3" />
                {t("settings.cropVideo")}
              </Button>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="background" className="border-white/5 rounded-xl bg-white/[0.02] px-3">
            <AccordionTrigger className="py-2.5 hover:no-underline">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-[#34B27B]" />
                <span className="text-xs font-medium">{t("settings.background")}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <Tabs defaultValue="image" className="w-full">
                <TabsList className="mb-2 bg-white/5 border border-white/5 p-0.5 w-full grid grid-cols-3 h-7 rounded-lg">
                  <TabsTrigger value="image" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 text-[10px] py-1 rounded-md transition-all">{t("settings.backgroundImage")}</TabsTrigger>
                  <TabsTrigger value="color" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 text-[10px] py-1 rounded-md transition-all">{t("settings.backgroundColor")}</TabsTrigger>
                  <TabsTrigger value="gradient" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 text-[10px] py-1 rounded-md transition-all">{t("settings.backgroundGradient")}</TabsTrigger>
                </TabsList>
                
                <div className="max-h-[min(200px,25vh)] overflow-y-auto custom-scrollbar">
                  <TabsContent value="image" className="mt-0 space-y-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      accept=".jpg,.jpeg,image/jpeg"
                      className="hidden"
                    />
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="outline"
                      className="w-full gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-[#34B27B] hover:text-white hover:border-[#34B27B] transition-all h-7 text-[10px]"
                    >
                      <Upload className="w-3 h-3" />
                      {t("settings.uploadCustom")}
                    </Button>

                    <div className="grid grid-cols-7 gap-1.5">
                      {customImages.map((imageUrl, idx) => {
                        const isSelected = selected === imageUrl;
                        return (
                          <div
                            key={`custom-${idx}`}
                            className={cn(
                              "aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 relative group shadow-sm",
                              isSelected
                                ? "border-[#34B27B] ring-1 ring-[#34B27B]/30"
                                : "border-white/10 hover:border-[#34B27B]/40 opacity-80 hover:opacity-100 bg-white/5"
                            )}
                            style={{ backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
                            onClick={() => onWallpaperChange(imageUrl)}
                            role="button"
                          >
                            <button
                              onClick={(e) => handleRemoveCustomImage(imageUrl, e)}
                              className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                            >
                              <X className="w-2 h-2 text-white" />
                            </button>
                          </div>
                        );
                      })}

                      {(wallpaperPaths.length > 0 ? wallpaperPaths : WALLPAPER_RELATIVE.map(p => `/${p}`)).map((path) => {
                        const isSelected = (() => {
                          if (!selected) return false;
                          if (selected === path) return true;
                          const clean = (s: string) => s.replace(/^file:\/\//, '').replace(/^\//, '');
                          if (clean(selected).endsWith(clean(path))) return true;
                          if (clean(path).endsWith(clean(selected))) return true;
                          return false;
                        })();
                        return (
                          <div
                            key={path}
                            className={cn(
                              "aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 shadow-sm",
                              isSelected
                                ? "border-[#34B27B] ring-1 ring-[#34B27B]/30"
                                : "border-white/10 hover:border-[#34B27B]/40 opacity-80 hover:opacity-100 bg-white/5"
                            )}
                            style={{ backgroundImage: `url(${path})`, backgroundSize: "cover", backgroundPosition: "center" }}
                            onClick={() => onWallpaperChange(path)}
                            role="button"
                          />
                        )
                      })}
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="color" className="mt-0">
                    <div className="p-1">
                      <Block
                        color={selectedColor}
                        colors={colorPalette}
                        onChange={(color) => {
                          setSelectedColor(color.hex);
                          onWallpaperChange(color.hex);
                        }}
                        style={{
                          width: '100%',
                          borderRadius: '8px',
                        }}
                      />
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="gradient" className="mt-0">
                    <div className="grid grid-cols-7 gap-1.5">
                      {GRADIENTS.map((g, idx) => (
                        <div
                          key={g}
                          className={cn(
                            "aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 shadow-sm",
                            gradient === g 
                              ? "border-[#34B27B] ring-1 ring-[#34B27B]/30" 
                              : "border-white/10 hover:border-[#34B27B]/40 opacity-80 hover:opacity-100 bg-white/5"
                          )}
                          style={{ background: g }}
                          aria-label={`Gradient ${idx + 1}`}
                          onClick={() => { setGradient(g); onWallpaperChange(g); }}
                          role="button"
                        />
                      ))}
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {showCropDropdown && cropRegion && onCropChange && (
        <>
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-in fade-in duration-200"
            onClick={() => setShowCropDropdown(false)}
          />
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] bg-[#09090b] rounded-2xl shadow-2xl border border-white/10 p-8 w-[90vw] max-w-5xl max-h-[90vh] overflow-auto animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div>
                <span className="text-xl font-bold text-slate-200">{t("settings.cropDialogTitle")}</span>
                <p className="text-sm text-slate-400 mt-2">{t("settings.cropDialogDesc")}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowCropDropdown(false)}
                className="hover:bg-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <CropControl
              videoElement={videoElement || null}
              cropRegion={cropRegion}
              onCropChange={onCropChange}
              aspectRatio={aspectRatio}
            />
            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => setShowCropDropdown(false)}
                size="lg"
                className="bg-[#34B27B] hover:bg-[#34B27B]/90 text-white"
              >
                {t("common.done")}
              </Button>
            </div>
          </div>
        </>
      )}

      <div className="flex-shrink-0 p-4 pt-3 border-t border-white/5 bg-[#09090b]">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => onExportFormatChange?.('mp4')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-all text-xs font-medium",
              exportFormat === 'mp4'
                ? "bg-[#34B27B]/10 border-[#34B27B]/50 text-white"
                : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200"
            )}
          >
            <Film className="w-3.5 h-3.5" />
            MP4
          </button>
          <button
            onClick={() => onExportFormatChange?.('gif')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-all text-xs font-medium",
              exportFormat === 'gif'
                ? "bg-[#34B27B]/10 border-[#34B27B]/50 text-white"
                : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200"
            )}
          >
            <Image className="w-3.5 h-3.5" />
            GIF
          </button>
        </div>

        {exportFormat === 'mp4' && (
          <div className="mb-3 space-y-2">
            <div className="bg-white/5 border border-white/5 p-0.5 w-full grid grid-cols-3 h-7 rounded-lg">
              <button
                onClick={() => onExportQualityChange?.('medium')}
                className={cn(
                  "rounded-md transition-all text-[10px] font-medium",
                  exportQuality === 'medium' ? "bg-white text-black" : "text-slate-400 hover:text-slate-200"
                )}
              >
                {t("settings.quality.low")}
              </button>
              <button
                onClick={() => onExportQualityChange?.('good')}
                className={cn(
                  "rounded-md transition-all text-[10px] font-medium",
                  exportQuality === 'good' ? "bg-white text-black" : "text-slate-400 hover:text-slate-200"
                )}
              >
                {t("settings.quality.medium")}
              </button>
              <button
                onClick={() => onExportQualityChange?.('source')}
                className={cn(
                  "rounded-md transition-all text-[10px] font-medium",
                  exportQuality === 'source' ? "bg-white text-black" : "text-slate-400 hover:text-slate-200"
                )}
              >
                {t("settings.quality.high")}
              </button>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-2">
              <div className="mb-2 flex items-center justify-between text-[10px]">
                <span className="uppercase tracking-wide text-slate-400">
                  {t("settings.exportAspectRatios")}
                </span>
                <span className="text-slate-500">
                  {t("settings.exportAspectRatioCount", { count: activeExportAspectRatios.length })}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {ASPECT_RATIOS.map((ratio) => {
                  const isSelected = activeExportAspectRatios.includes(ratio);
                  return (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => toggleExportAspectRatio(ratio)}
                      className={cn(
                        "h-6 rounded-md border text-[10px] font-medium transition-all",
                        isSelected
                          ? "border-[#34B27B]/70 bg-[#34B27B]/20 text-white"
                          : "border-white/10 text-slate-400 hover:border-[#34B27B]/50 hover:text-slate-200",
                      )}
                    >
                      {ratio}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-slate-500">
                {t("settings.exportAspectRatioHint")}
              </p>
            </div>
          </div>
        )}

        {exportFormat === 'gif' && (
          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-white/5 border border-white/5 p-0.5 grid grid-cols-4 h-7 rounded-lg">
                {GIF_FRAME_RATES.map((rate) => (
                  <button
                    key={rate.value}
                    onClick={() => onGifFrameRateChange?.(rate.value)}
                    className={cn(
                      "rounded-md transition-all text-[10px] font-medium",
                      gifFrameRate === rate.value ? "bg-white text-black" : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {rate.value}
                  </button>
                ))}
              </div>
              <div className="flex-1 bg-white/5 border border-white/5 p-0.5 grid grid-cols-3 h-7 rounded-lg">
                {Object.keys(GIF_SIZE_PRESETS).map((key) => (
                  <button
                    key={key}
                    onClick={() => onGifSizePresetChange?.(key as GifSizePreset)}
                    className={cn(
                      "rounded-md transition-all text-[10px] font-medium",
                      gifSizePreset === key ? "bg-white text-black" : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {key === 'original' ? t("settings.gif.original") : key.charAt(0).toUpperCase() + key.slice(1, 3)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">{gifOutputDimensions.width} × {gifOutputDimensions.height}px</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">{t("common.loop")}</span>
                <Switch
                  checked={gifLoop}
                  onCheckedChange={onGifLoopChange}
                  className="data-[state=checked]:bg-[#34B27B] scale-75"
                />
              </div>
            </div>
          </div>
        )}
        
        <Button
          type="button"
          size="lg"
          onClick={onExport}
          className="w-full py-5 text-sm font-semibold flex items-center justify-center gap-2 bg-[#34B27B] text-white rounded-xl shadow-lg shadow-[#34B27B]/20 hover:bg-[#34B27B]/90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
        >
          <Download className="w-4 h-4" />
          {t("settings.exportVideo", { format: exportFormat === 'gif' ? 'GIF' : 'Video' })}
        </Button>

        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={() => {
              void openSupportUrl(GITHUB_ISSUES_URL, 'settings-panel.open-report-bug-link');
            }}
            className="flex-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 py-1.5 transition-colors"
          >
            <Bug className="w-3 h-3 text-[#34B27B]" />
            {t("settings.reportBug")}
          </button>
          <button
            type="button"
            onClick={() => {
              void openSupportUrl(GITHUB_REPO_URL, 'settings-panel.open-star-repo-link');
            }}
            className="flex-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 py-1.5 transition-colors"
          >
            <Star className="w-3 h-3 text-yellow-400" />
            {t("settings.starGithub")}
          </button>
        </div>
      </div>
    </div>
  );
}
