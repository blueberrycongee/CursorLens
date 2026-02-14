const PREVIEW_BACKGROUND_BLUR_PX = 2;

function normalizePositive(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Number(value));
}

export function getPreviewBackgroundFilter(showBlur: boolean): string {
  if (!showBlur) return 'none';
  return `blur(${PREVIEW_BACKGROUND_BLUR_PX}px)`;
}

export function getExportBackgroundFilter(options: {
  showBlur: boolean;
  outputWidth: number;
  previewWidth?: number;
}): string {
  if (!options.showBlur) return 'none';

  const safeOutputWidth = normalizePositive(options.outputWidth) ?? 1;
  const safePreviewWidth = normalizePositive(options.previewWidth) ?? safeOutputWidth;
  const blurScale = Math.max(1, safeOutputWidth / safePreviewWidth);
  const blurPx = Number((PREVIEW_BACKGROUND_BLUR_PX * blurScale).toFixed(2));

  return `blur(${blurPx}px)`;
}
