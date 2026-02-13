import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

if (process.platform !== 'darwin') {
  console.log('[native-helper] non-macOS platform, skipping ScreenCaptureKit helper build');
  process.exit(0);
}

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, 'electron/native/macos/sck-recorder.swift');
const outputPath = path.join(projectRoot, 'electron/native/bin/sck-recorder');

mkdirSync(path.dirname(outputPath), { recursive: true });

const args = [
  'swiftc',
  '-parse-as-library',
  '-O',
  sourcePath,
  '-framework', 'ScreenCaptureKit',
  '-framework', 'AVFoundation',
  '-framework', 'CoreMedia',
  '-framework', 'CoreVideo',
  '-framework', 'CoreGraphics',
  '-framework', 'Foundation',
  '-o', outputPath,
];

console.log('[native-helper] compiling ScreenCaptureKit recorder helper...');
const result = spawnSync('xcrun', args, {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(outputPath)) {
  console.error('[native-helper] expected output binary was not created');
  process.exit(1);
}

spawnSync('chmod', ['755', outputPath], { stdio: 'inherit' });
console.log(`[native-helper] built ${outputPath}`);
