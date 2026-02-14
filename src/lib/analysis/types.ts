export interface TranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface SubtitleCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  source: 'asr' | 'manual' | 'agent';
  confidence?: number;
}

export interface SubtitleGenerationOptions {
  minCueDurationMs: number;
  maxCueDurationMs: number;
  splitOnSilenceMs: number;
  maxCharsPerLine: number;
  maxLines: 1 | 2;
  maxCps: number;
}

export type RoughCutReason = 'silence' | 'filler';

export interface RoughCutSuggestion {
  id: string;
  startMs: number;
  endMs: number;
  reason: RoughCutReason;
  confidence: number;
  label: string;
}

export interface RoughCutOptions {
  minSilenceMs: number;
  minFillerDurationMs: number;
  fillerWords: string[];
}

export interface TranscriptData {
  locale: string;
  text: string;
  words: TranscriptWord[];
  createdAtMs: number;
}

export interface VideoAnalysisResult {
  transcript: TranscriptData;
  subtitleCues: SubtitleCue[];
  roughCutSuggestions: RoughCutSuggestion[];
}
