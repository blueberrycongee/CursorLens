# CursorLens

[English](./README.md)

CursorLens 是一个开源桌面录屏与编辑工具，适用于产品演示、教程和讲解视频制作。

本项目基于 [OpenScreen](https://github.com/siddharthvaddem/openscreen) 演进，重点增强了 macOS 原生采集链路、光标工作流与音频录制/导出能力。

## 主要改进

- 接入 macOS 原生录制 helper（基于 ScreenCaptureKit 工作流）。
- 支持采集阶段的原生光标可见性控制。
- 提升 macOS 窗口录制稳定性。
- 强化光标元数据与渲染能力（含光标类型支持）。
- 相机叠加录制走 macOS 原生链路。
- 录制阶段支持麦克风采集。
- MP4 导出保留源音轨。
- 编辑器支持音频开关、音量调节与时间线音频状态显示。
- 持续优化交互体验、稳定性和多语言支持。

## 功能特性

- 录制整个屏幕或指定窗口。
- 可选相机叠加录制。
- 可选麦克风录制。
- 光标感知预览与导出。
- 支持缩放片段、裁剪片段、画面裁切与注释编辑。
- 支持 MP4 / GIF 导出。
- 支持多种画幅比例与质量档位。

## 安装

从以下页面下载构建产物：

- [CursorLens Releases](https://github.com/blueberrycongee/CursorLens/releases)

### macOS

本地未签名构建可能被 Gatekeeper 拦截，必要时可执行：

```bash
xattr -rd com.apple.quarantine /Applications/Openscreen.app
```

随后在 **系统设置 -> 隐私与安全性** 中授予权限：

- 屏幕录制
- 辅助功能
- 麦克风（需要录制人声时）
- 摄像头（使用相机叠加时）

## 开发

### 环境要求

- Node.js 20+
- npm 10+
- macOS + Xcode Command Line Tools（用于构建原生 helper）

### 开发运行

```bash
npm install
npm run dev
```

### 构建

```bash
npm run build:mac
```

## 致谢

- 上游项目：[siddharthvaddem/openscreen](https://github.com/siddharthvaddem/openscreen)

## 许可证

本仓库采用 [MIT License](./LICENSE)。
