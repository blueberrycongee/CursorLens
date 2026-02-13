# CursorLens

[简体中文](./README.zh-CN.md)

CursorLens is an open-source desktop screen recorder and editor for creating product demos, tutorials, and walkthrough videos.

This project is based on [OpenScreen](https://github.com/siddharthvaddem/openscreen) and has been extended with a stronger macOS-native capture path, improved cursor handling, and audio-focused recording/export workflows.

## Highlights

- Native macOS recorder helper integration (ScreenCaptureKit-based workflow).
- Native cursor visibility control during capture.
- Improved window capture reliability on macOS.
- Cursor metadata and rendering upgrades (including cursor kind support).
- Camera overlay capture routed through the native macOS pipeline.
- Microphone capture support during recording.
- MP4 export preserves source audio.
- Editor-level audio controls (enable/disable and volume) with timeline audio status.
- Ongoing UX, reliability, and localization improvements.

## Features

- Capture an entire display or a selected window.
- Optional camera overlay recording.
- Optional microphone recording.
- Cursor-aware preview and export.
- Zoom regions, trim regions, crop, and annotation editing.
- MP4 and GIF export.
- Multiple aspect ratios and quality profiles.

## Installation

Download prebuilt packages from:

- [CursorLens Releases](https://github.com/blueberrycongee/CursorLens/releases)

### macOS

Unsigned local builds may be blocked by Gatekeeper. If needed:

```bash
xattr -rd com.apple.quarantine /Applications/Openscreen.app
```

Then grant required permissions in **System Settings -> Privacy & Security**:

- Screen Recording
- Accessibility
- Microphone (if recording voice)
- Camera (if using camera overlay)

## Development

### Requirements

- Node.js 20+
- npm 10+
- macOS + Xcode Command Line Tools (for native helper builds)

### Run in Development

```bash
npm install
npm run dev
```

### Build

```bash
npm run build:mac
```

## Acknowledgements

- Upstream project: [siddharthvaddem/openscreen](https://github.com/siddharthvaddem/openscreen)

## License

This repository is licensed under the [MIT License](./LICENSE).
