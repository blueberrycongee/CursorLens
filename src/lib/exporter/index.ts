export { VideoExporter } from './videoExporter';
export { VideoFileDecoder } from './videoDecoder';
export { FrameRenderer } from './frameRenderer';
export { VideoMuxer } from './muxer';
export { GifExporter, calculateOutputDimensions } from './gifExporter';
export { calculateMp4ExportPlan, resolveExportFrameRate, normalizeExportSourceFrameRate } from './mp4ExportPlan';
export type { 
  ExportConfig, 
  ExportProgress, 
  ExportResult, 
  VideoFrameData, 
  ExportQuality,
  ExportAudioProcessingConfig,
  ExportFormat,
  GifFrameRate,
  GifSizePreset,
  GifExportConfig,
  ExportSettings,
} from './types';
export { 
  GIF_SIZE_PRESETS, 
  GIF_FRAME_RATES, 
  VALID_GIF_FRAME_RATES, 
  isValidGifFrameRate 
} from './types';
