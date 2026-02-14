import type { TrimRegion } from '@/components/video-editor/types';
import type { RoughCutSuggestion } from './types';

function normalizeTrimRegion(region: TrimRegion, durationMs: number): TrimRegion | null {
  const startMs = Math.max(0, Math.round(Number(region.startMs)));
  const endMs = Math.min(Math.round(durationMs), Math.round(Number(region.endMs)));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs <= startMs) return null;
  return {
    id: region.id,
    startMs,
    endMs,
  };
}

function normalizeSuggestions(suggestions: RoughCutSuggestion[], durationMs: number): TrimRegion[] {
  return suggestions
    .map((item, index) => {
      const startMs = Math.max(0, Math.round(Number(item.startMs)));
      const endMs = Math.min(Math.round(durationMs), Math.round(Number(item.endMs)));
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
      if (endMs <= startMs) return null;
      return {
        id: `trim-auto-${index + 1}`,
        startMs,
        endMs,
      } satisfies TrimRegion;
    })
    .filter((item): item is TrimRegion => Boolean(item));
}

function mergeTrimRegions(regions: TrimRegion[]): TrimRegion[] {
  const sorted = regions
    .slice()
    .sort((left, right) => left.startMs - right.startMs);

  if (sorted.length === 0) return [];

  const merged: TrimRegion[] = [];
  for (const region of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || region.startMs > previous.endMs) {
      merged.push({ ...region });
      continue;
    }

    previous.endMs = Math.max(previous.endMs, region.endMs);
  }

  return merged.map((region, index) => ({
    id: `trim-${index + 1}`,
    startMs: region.startMs,
    endMs: region.endMs,
  }));
}

export function applyRoughCutSuggestionsToTrimRegions(
  existingRegions: TrimRegion[],
  suggestions: RoughCutSuggestion[],
  durationMs: number,
): TrimRegion[] {
  if (!suggestions.length) {
    return existingRegions;
  }

  const totalDurationMs = Math.max(0, Math.round(durationMs));
  const normalizedExisting = existingRegions
    .map((region) => normalizeTrimRegion(region, totalDurationMs))
    .filter((region): region is TrimRegion => Boolean(region));
  const normalizedSuggested = normalizeSuggestions(suggestions, totalDurationMs);

  return mergeTrimRegions([...normalizedExisting, ...normalizedSuggested]);
}
