> [!WARNING]
> CursorLens 目前仍处于 Beta 阶段，部分机器上某些流程可能不稳定。

[English](./README.md)

<p align="center">
  <img src="public/openscreen.png" alt="CursorLens Logo" width="64" />
  <br />
  <br />
  <a href="https://github.com/blueberrycongee/CursorLens">
    <img src="https://img.shields.io/badge/GitHub-CursorLens-181717?logo=github" alt="CursorLens on GitHub" />
  </a>
</p>

# <p align="center">CursorLens</p>

<p align="center"><strong>CursorLens 是一款免费、开源的录屏与编辑工具，面向开发者、创作者和产品团队，用于快速制作产品演示与讲解视频。</strong></p>

CursorLens 基于优秀的 [OpenScreen](https://github.com/siddharthvaddem/openscreen) 继续演进，并在 macOS 原生采集与编辑链路上做了大量重构和增强。

<p align="center">
  <img src="public/preview.png" alt="CursorLens 预览 1" style="height: 320px; margin-right: 12px;" />
  <img src="public/preview2.png" alt="CursorLens 预览 2" style="height: 320px; margin-right: 12px;" />
  <img src="public/preview3.png" alt="CursorLens 预览 3" style="height: 320px; margin-right: 12px;" />
  <img src="public/preview4.png" alt="CursorLens 预览 4" style="height: 320px; margin-right: 12px;" />
</p>

## 核心功能

- 录制整个屏幕或指定应用窗口。
- macOS 原生录制 helper，支持原生级光标隐藏/显示采集。
- 相机叠加走原生录制链路。
- 支持麦克风人声录制，并可在编辑阶段调整增益。
- 时间线编辑：剪切、裁剪、缩放、光标效果与注释。
- 编辑器内支持字幕生成与粗剪流程。
- 支持多画幅导出（16:9、9:16、1:1 等），并支持批量导出。
- 导出音频支持音轨开关、增益、响度标准化、限幅。
- 录制体验支持倒计时、自动隐藏启动栏、自定义结束快捷键、权限诊断。

## 安装

请从 [GitHub Releases](https://github.com/blueberrycongee/CursorLens/releases) 下载对应平台的最新安装包。

### macOS

如果未签名构建被 Gatekeeper 拦截，可执行：

```bash
xattr -rd com.apple.quarantine /Applications/CursorLens.app
```

然后在 **系统设置 -> 隐私与安全性** 中授予必要权限：

- 屏幕录制（新版本 macOS 可能显示为“录屏与系统录音”）
- 辅助功能
- 麦克风（录制人声）
- 摄像头（相机叠加）

### Linux

从 Releases 下载 `.AppImage` 后执行：

```bash
chmod +x CursorLens-Linux-*.AppImage
./CursorLens-Linux-*.AppImage
```

## 开发

### 环境要求

- Node.js 20+
- npm 10+
- macOS + Xcode Command Line Tools（用于构建原生 helper）

### 本地运行

```bash
npm install
npm run dev
```

### 构建

```bash
npm run build
```

## 技术栈

- Electron
- React
- TypeScript
- Vite
- PixiJS
- dnd-timeline

## 参与贡献

欢迎通过 issue 和 PR 参与贡献。

- Issues: [https://github.com/blueberrycongee/CursorLens/issues](https://github.com/blueberrycongee/CursorLens/issues)
- Discussions: [https://github.com/blueberrycongee/CursorLens/discussions](https://github.com/blueberrycongee/CursorLens/discussions)

## 致谢

- 上游项目：[siddharthvaddem/openscreen](https://github.com/siddharthvaddem/openscreen)

## 许可证

本项目采用 [MIT License](./LICENSE)。
