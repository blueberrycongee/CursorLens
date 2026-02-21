import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

if (process.platform !== 'darwin') {
  console.log('[native-helper] non-macOS platform, skipping ScreenCaptureKit helper build');
  process.exit(0);
}

const projectRoot = process.cwd();
const helperEntitlements = path.join(projectRoot, 'build/entitlements.native-helper.plist');
const helperEntitlementsAV = path.join(projectRoot, 'build/entitlements.native-helper-av.plist');

const helpers = [
  {
    label: 'ScreenCaptureKit recorder helper',
    sourcePath: path.join(projectRoot, 'electron/native/macos/sck-recorder.swift'),
    outputPath: path.join(projectRoot, 'electron/native/bin/sck-recorder'),
    entitlements: helperEntitlementsAV,
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
    entitlements: helperEntitlements,
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
    entitlements: helperEntitlements,
    frameworks: [
      'Foundation',
      'AppKit',
    ],
  },
  {
    label: 'speech transcriber helper',
    sourcePath: path.join(projectRoot, 'electron/native/macos/speech-transcriber.swift'),
    outputPath: path.join(projectRoot, 'electron/native/bin/speech-transcriber'),
    entitlements: helperEntitlementsAV,
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

  if (!existsSync(helper.entitlements)) {
    console.error(`[native-helper] entitlements file not found: ${helper.entitlements}`);
    process.exit(1);
  }

  console.log(`[native-helper] signing ${helper.label} with entitlements...`);
  const signResult = spawnSync('codesign', [
    '--sign', '-',
    '--force',
    '--entitlements', helper.entitlements,
    helper.outputPath,
  ], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (signResult.status !== 0) {
    console.error(`[native-helper] codesign failed for ${helper.outputPath}`);
    process.exit(signResult.status ?? 1);
  }

  console.log(`[native-helper] built ${helper.outputPath}`);
}
