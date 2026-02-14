import {
  buildSubtitleCuesFromWords,
  defaultSubtitleGenerationOptions,
  estimateMaxCharsPerLine,
} from './subtitleEngine';
import {
  defaultRoughCutOptions,
  generateRoughCutSuggestions,
} from './roughCutEngine';
import type { TranscriptWord, VideoAnalysisResult } from './types';

export interface BuildVideoAnalysisInput {
  durationMs: number;
  videoWidth: number;
  subtitleWidthRatio: number;
  locale: string;
}

function normalizeWords(words: TranscriptWord[]): TranscriptWord[] {
  return words
    .map((word) => ({
      text: String(word.text ?? '').trim(),
      startMs: Math.max(0, Math.round(Number(word.startMs))),
      endMs: Math.max(0, Math.round(Number(word.endMs))),
      confidence: Number.isFinite(word.confidence) ? Number(word.confidence) : undefined,
    }))
    .filter((word) => word.text.length > 0 && word.endMs > word.startMs)
    .sort((left, right) => left.startMs - right.startMs);
}

export function buildVideoAnalysisResult(
  wordsInput: TranscriptWord[],
  config: BuildVideoAnalysisInput,
): VideoAnalysisResult {
  const words = normalizeWords(wordsInput);
  const subtitleOptions = defaultSubtitleGenerationOptions();
  subtitleOptions.maxCharsPerLine = estimateMaxCharsPerLine(config.videoWidth, config.subtitleWidthRatio);

  const subtitleCues = buildSubtitleCuesFromWords(words, subtitleOptions);
  const roughCutSuggestions = generateRoughCutSuggestions(words, config.durationMs, defaultRoughCutOptions());

  return {
    transcript: {
      locale: config.locale,
      text: words.map((word) => word.text).join(' ').trim(),
      words,
      createdAtMs: Date.now(),
    },
    subtitleCues,
    roughCutSuggestions,
  };
}
