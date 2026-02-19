# Export Silent Pipeline: Technical Debt Note

## Context

Issue: export could emit fragmented audible audio during MP4 rendering.

Root cause chain (confirmed in code review):

1. Export renderer used Pixi texture creation from `HTMLVideoElement`.
2. Pixi `VideoSource` defaults can trigger implicit playback.
3. Export pipeline previously had a playback-sampling path that explicitly called `video.play()`.

This conflicts with product expectation: export stage must be silent.

## Changes Applied

1. Export frame rendering is now seek-only (no playback-sampling path in main export flow).
2. Export decoder `video` element now enforces silent defaults:
   - `defaultMuted = true`
   - `muted = true`
   - `volume = 0`
3. Export decoder now blocks unexpected `play` events by immediately forcing pause and silent state.
4. Export frame renderer now uses `VideoSource.from(video)` with:
   - `autoPlay = false`
   - `autoUpdate = true`
   and re-applies silent media element state before texture creation.
5. Added targeted test coverage to assert seek-only path does not call `play()`.

## Remaining Debt

1. `HTMLVideoElement` is still part of the export render path.
   - Risk: browser/media-element behavior can vary by platform.
2. Seek-only mode is safer for silence but may reduce throughput versus playback-driven sampling on some machines.
3. Pixi internals are still involved in video frame ingestion.
   - Risk: upstream Pixi behavior changes can affect export assumptions.

## Follow-up Plan

1. Add an optional export benchmark to measure seek-only throughput on representative durations/resolutions.
2. Add an integration test harness in browser environment to assert no `play` lifecycle during export.
3. Evaluate migration to a fully explicit decode path (`WebCodecs` + `VideoFrame`) to remove media-element playback semantics from export.
