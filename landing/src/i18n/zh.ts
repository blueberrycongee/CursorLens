export default {
  nav: {
    features: '功能',
    screenshots: '截图',
    download: '下载',
    github: 'GitHub',
    lang: 'EN',
    langHref: '/CursorLens/',
  },
  hero: {
    title: '屏幕录制，',
    titleHighlight: '重新定义。',
    subtitle: '免费开源的屏幕录制与编辑工具，为创作者、开发者和团队打造。录制、编辑并分享精美的产品演示。',
    cta: '立即下载',
    ctaSecondary: '在 GitHub 上查看',
  },
  features: {
    title: '一应俱全',
    subtitle: '强大功能，轻量原生。',
    items: [
      { icon: '🖥️', title: '原生屏幕捕获', desc: '高性能 macOS 原生录制，支持窗口和区域选择。' },
      { icon: '🎥', title: '摄像头叠加', desc: '为录制添加摄像头画中画，增添个人风格。' },
      { icon: '✂️', title: '时间线编辑', desc: '在直观的拖拽时间线上裁剪、分割和排列片段。' },
      { icon: '🔍', title: '缩放与平移', desc: '添加平滑的缩放和平移效果，突出关键时刻。' },
      { icon: '🖱️', title: '光标特效', desc: '自动光标高亮和点击动画效果。' },
      { icon: '📐', title: '多比例导出', desc: '支持 16:9、9:16、1:1 等多种比例导出。' },
      { icon: '🎤', title: '音频控制', desc: '增益调节、音频标准化和麦克风录制。' },
      { icon: '💬', title: '自动字幕', desc: '从录制内容自动生成字幕。' },
    ],
  },
  screenshots: {
    title: '实际效果',
    subtitle: '简洁直观的界面，为高效而设计。',
    alts: ['录制界面', '时间线编辑器', '导出设置', '光标特效'],
  },
  download: {
    title: '获取 CursorLens',
    subtitle: '免费开源，支持所有主流平台。',
    platforms: [
      { name: 'macOS', icon: '🍎', note: 'Apple Silicon 与 Intel', href: 'https://github.com/blueberrycongee/CursorLens/releases/download/v1.2.5/CursorLens-Mac-arm64-1.2.5-Installer.dmg' },
      { name: 'Windows', icon: '🪟', note: 'Windows 10+', href: 'https://github.com/blueberrycongee/CursorLens/releases/download/v1.2.5/CursorLens-Setup-1.2.5.exe' },
      { name: 'Linux', icon: '🐧', note: 'AppImage', href: 'https://github.com/blueberrycongee/CursorLens/releases/download/v1.2.5/CursorLens-Linux-1.2.5.AppImage' },
    ],
    button: '下载',
    allReleases: '在 GitHub 上查看所有版本 →',
  },
  footer: {
    copyright: '© 2024 CursorLens. 基于 MIT 许可证开源。',
    links: [
      { label: 'GitHub', href: 'https://github.com/blueberrycongee/CursorLens' },
      { label: '版本发布', href: 'https://github.com/blueberrycongee/CursorLens/releases' },
      { label: '问题反馈', href: 'https://github.com/blueberrycongee/CursorLens/issues' },
    ],
  },
};
