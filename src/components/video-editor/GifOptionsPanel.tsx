import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GIF_FRAME_RATES, GIF_SIZE_PRESETS, type GifFrameRate, type GifSizePreset } from '@/lib/exporter/types';
import { useI18n } from '@/i18n';

interface GifOptionsPanelProps {
  frameRate: GifFrameRate;
  onFrameRateChange: (rate: GifFrameRate) => void;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  sizePreset: GifSizePreset;
  onSizePresetChange: (preset: GifSizePreset) => void;
  outputDimensions: { width: number; height: number };
  disabled?: boolean;
}

export function GifOptionsPanel({
  frameRate,
  onFrameRateChange,
  loop,
  onLoopChange,
  sizePreset,
  onSizePresetChange,
  outputDimensions,
  disabled = false,
}: GifOptionsPanelProps) {
  const { t } = useI18n();
  const sizePresetOptions = Object.entries(GIF_SIZE_PRESETS).map(([key, value]) => ({
    value: key as GifSizePreset,
    label: value.label,
  }));

  return (
    <div className="space-y-4 animate-in slide-in-from-bottom-2 duration-200">
      {/* Frame Rate */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          {t("gif.frameRate")}
        </label>
        <Select
          value={String(frameRate)}
          onValueChange={(value) => onFrameRateChange(Number(value) as GifFrameRate)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 hover:bg-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#1a1a1f] border-white/10 z-[100]">
            {GIF_FRAME_RATES.map((rate) => (
              <SelectItem
                key={rate.value}
                value={String(rate.value)}
                className="text-slate-200 focus:bg-white/10 focus:text-white"
              >
                {rate.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Size Preset */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          {t("gif.outputSize")}
        </label>
        <Select
          value={sizePreset}
          onValueChange={(value) => onSizePresetChange(value as GifSizePreset)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 hover:bg-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#1a1a1f] border-white/10 z-[100]">
            {sizePresetOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-slate-200 focus:bg-white/10 focus:text-white"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-xs text-slate-500">
          Output: {outputDimensions.width} × {outputDimensions.height}px
        </div>
      </div>

      {/* Loop Toggle */}
      <div className="flex items-center justify-between py-2">
        <div>
          <label className="text-sm font-medium text-slate-200">{t("gif.loopAnimation")}</label>
          <p className="text-xs text-slate-500">{t("gif.loopDesc")}</p>
        </div>
        <Switch
          checked={loop}
          onCheckedChange={onLoopChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
