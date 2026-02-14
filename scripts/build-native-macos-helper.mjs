import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

if (process.platform !== 'darwin') {
  console.log('[native-helper] non-macOS platform, skipping ScreenCaptureKit helper build');
  process.exit(0);
}

const projectRoot = process.cwd();

const helpers = [
  {
    label: 'ScreenCaptureKit recorder helper',
    sourcePath: path.join(projectRoot, 'electron/native/macos/sck-recorder.swift'),
    outputPath: path.join(projectRoot, 'electron/native/bin/sck-recorder'),
    frameworks: [
      'ScreenCaptureKit',
      'AVFoundation',
      'CoreMedia',
      'CoreVideo',
      'CoreGraphics',
      'Foundation',
    ],
  },
  {
    label: 'cursor kind monitor helper',
    sourcePath: path.join(projectRoot, 'electron/native/macos/cursor-kind-monitor.swift'),
    outputPath: path.join(projectRoot, 'electron/native/bin/cursor-kind-monitor'),
    frameworks: [
      'Foundation',
      'AppKit',
      'CryptoKit',
    ],
  },
  {
    label: 'mouse button monitor helper',
    sourcePath: path.join(projectRoot, 'electron/native/macos/mouse-button-monitor.swift'),
    outputPath: path.join(projectRoot, 'electron/native/bin/mouse-button-monitor'),
    frameworks: [
      'Foundation',
      'AppKit',
    ],
  },
  {
    label: 'speech transcriber helper',
    sourcePath: path.join(projectRoot, 'electron/native/macos/speech-transcriber.swift'),
    outputPath: path.join(projectRoot, 'electron/native/bin/speech-transcriber'),
    frameworks: [
      'Foundation',
      'AVFoundation',
      'Speech',
    ],
  },
];

for (const helper of helpers) {
  mkdirSync(path.dirname(helper.outputPath), { recursive: true });

  const args = [
    'swiftc',
    '-parse-as-library',
    '-O',
    helper.sourcePath,
    ...helper.frameworks.flatMap((framework) => ['-framework', framework]),
    '-o', helper.outputPath,
  ];

  console.log(`[native-helper] compiling ${helper.label}...`);
  const result = spawnSync('xcrun', args, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (!existsSync(helper.outputPath)) {
    console.error(`[native-helper] expected output binary was not created: ${helper.outputPath}`);
    process.exit(1);
  }

  spawnSync('chmod', ['755', helper.outputPath], { stdio: 'inherit' });
  console.log(`[native-helper] built ${helper.outputPath}`);
}
