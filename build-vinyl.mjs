// Encode 243 transparent PNG frames into a single transparent WebM.
// Source: VINYL RECORD 1/VINYL RECORD 1_?????.png (6000x7000 RGBA)
// Output: MUSIC-ASSETS/vinyl-record.webm
//
// Requires ffmpeg on PATH. Install: winget install Gyan.FFmpeg
//
// Run: node build-vinyl.mjs
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const SRC_DIR = './VINYL RECORD 1';
const OUT_DIR = './MUSIC-ASSETS';
const OUT = path.join(OUT_DIR, 'vinyl-record.webm');
const OUT_WEBP = path.join(OUT_DIR, 'vinyl-record.webp');
const FPS = 23; // 20 × 1.15 = 23 (15% faster playback)
// 5x upscale to reduce artifacting on thin line art. Source is 6000x7000 so
// 4400x5135 still downscales (preserving detail without re-upsampling).
const WIDTH = 4400;
const HEIGHT = 5135;
// Animated WebP for Safari: smaller target (still way above display size)
// so the file doesn't balloon. libwebp has per-frame compression, not temporal.
const WEBP_WIDTH = 1800;
const WEBP_HEIGHT = 2100;

// 1. Validate inputs
if (!fs.existsSync(SRC_DIR)) {
  console.error(`Missing source folder: ${SRC_DIR}`); process.exit(1);
}
const frames = fs.readdirSync(SRC_DIR).filter(f => /\.png$/i.test(f)).sort();
if (frames.length === 0) {
  console.error('No PNGs in source folder'); process.exit(1);
}
console.log(`Found ${frames.length} PNG frames in ${SRC_DIR}`);

// ffmpeg needs a contiguous zero-padded numeric sequence. The source filenames
// start at 00058, so we pass the first frame's number as -start_number.
const firstMatch = frames[0].match(/(\d+)\.png$/i);
const startNumber = firstMatch ? parseInt(firstMatch[1], 10) : 0;
// Build the input pattern. Use %05d since the frames use 5-digit zero-padded numbers.
const inputPattern = path.join(SRC_DIR, 'VINYL RECORD 1_%05d.png');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// 2. Build ffmpeg command
// libvpx-vp9 with yuva420p pixel format = transparent WebM.
// -b:v 0 -crf N puts us in constant-quality mode (CRF 28-35 is normal for web;
//   28 is higher quality/larger file, 35 is smaller/lower quality). 30 is a
//   good default for line-art on transparent bg.
const args = [
  '-y',                          // overwrite output
  '-framerate', String(FPS),
  '-start_number', String(startNumber),
  '-i', inputPattern,
  '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
  '-c:v', 'libvpx-vp9',
  '-pix_fmt', 'yuva420p',
  '-b:v', '0',
  // Quality bump: at 5x resolution the extra pixels hide subsampling artifacts
  // much better, and CRF 22 gives crisper line edges.
  '-crf', '22',
  '-row-mt', '1',
  '-threads', '0',
  '-deadline', 'good',
  '-cpu-used', '2',
  OUT,
];

console.log('\nRunning:');
console.log('  ffmpeg ' + args.join(' '));
console.log();

// 3. Run
const started = Date.now();
// Resolve ffmpeg: check the winget install location first (we know it's
// there), then fall back to PATH. winget installs don't refresh PATH in the
// current shell session, so checking the absolute path is more reliable.
function resolveFfmpeg() {
  const wingetPath = 'C:\\Users\\Colby\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe';
  if (fs.existsSync(wingetPath)) return wingetPath;
  return 'ffmpeg';
}
const FFMPEG = resolveFfmpeg();
console.log(`Using: ${FFMPEG}`);
const ff = spawn(FFMPEG, args, { stdio: 'inherit' });
ff.on('error', (err) => {
  console.error('\nffmpeg failed to start. Is it installed and on PATH?');
  console.error(err.message);
  process.exit(1);
});
ff.on('close', (code) => {
  if (code !== 0) {
    console.error(`\nffmpeg exited with code ${code}`);
    process.exit(code);
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const stat = fs.statSync(OUT);
  const mb = (stat.size / 1024 / 1024).toFixed(2);
  console.log(`\nWebM done in ${elapsed}s — ${OUT} (${mb} MB)`);
  encodeWebP();
});

// Second pass: animated WebP for Safari (and as a universal HTML fallback).
// libwebp_anim supports alpha and all modern browsers play it in an <img>.
function encodeWebP() {
  const webpArgs = [
    '-y',
    '-framerate', String(FPS),
    '-start_number', String(startNumber),
    '-i', inputPattern,
    '-vf', `scale=${WEBP_WIDTH}:${WEBP_HEIGHT}:flags=lanczos`,
    '-c:v', 'libwebp_anim',
    '-lossless', '0',
    '-compression_level', '6',
    '-q:v', '70',
    '-loop', '0',
    '-preset', 'picture',
    '-an',
    OUT_WEBP,
  ];
  console.log('\nEncoding animated WebP for Safari compatibility...');
  const startedWebP = Date.now();
  const ffwebp = spawn(FFMPEG, webpArgs, { stdio: 'inherit' });
  ffwebp.on('error', (err) => {
    console.error('WebP encode failed:', err.message);
    console.error('WebM still produced successfully; Safari fallback skipped.');
  });
  ffwebp.on('close', (wcode) => {
    if (wcode !== 0) {
      console.error(`WebP ffmpeg exited with code ${wcode}`);
      return;
    }
    const elapsed = ((Date.now() - startedWebP) / 1000).toFixed(1);
    const stat = fs.statSync(OUT_WEBP);
    const mb = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`\nWebP done in ${elapsed}s — ${OUT_WEBP} (${mb} MB)`);
    console.log(`\nHTML snippet for cross-browser playback:`);
    console.log(`  <img src="MUSIC-ASSETS/vinyl-record.webp" alt="Record player">`);
    console.log(`  (animated WebP plays in Chrome/Firefox/Edge/Safari 16+)`);
  });
}
