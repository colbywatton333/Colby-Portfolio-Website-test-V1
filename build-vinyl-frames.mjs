// Convert 243 source PNGs (6000x7000, ~600KB each, 140MB total) into a
// downscaled WebP sequence the browser can actually preload. Output goes
// into MUSIC-ASSETS/vinyl-frames/ as frame_0001.webp ... frame_0243.webp.
//
// Run: node build-vinyl-frames.mjs
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const SRC_DIR = './VINYL RECORD 1';
const OUT_DIR = './MUSIC-ASSETS/vinyl-frames';
const WIDTH = 1200;   // 1200×1400 — crisp at ~1200px css display (near retina)
const HEIGHT = 1400;
const QUALITY = 55;   // WebP lossy, line art tolerates it well

const FFMPEG = fs.existsSync('C:\\Users\\Colby\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe')
  ? 'C:\\Users\\Colby\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1-full_build\\bin\\ffmpeg.exe'
  : 'ffmpeg';

const frames = fs.readdirSync(SRC_DIR).filter(f => /\.png$/i.test(f)).sort();
if (!frames.length) { console.error('No source PNGs'); process.exit(1); }
const firstMatch = frames[0].match(/(\d+)\.png$/i);
const startNumber = firstMatch ? parseInt(firstMatch[1], 10) : 0;
console.log(`${frames.length} source frames, starting at #${startNumber}`);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
// Wipe stale frames in case count changed between runs.
for (const f of fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.webp'))) {
  fs.unlinkSync(path.join(OUT_DIR, f));
}

// One ffmpeg pass: image2 pattern input → image2 pattern output. Much faster
// than spawning ffmpeg once per frame.
const args = [
  '-y',
  '-start_number', String(startNumber),
  '-i', path.join(SRC_DIR, 'VINYL RECORD 1_%05d.png'),
  '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
  '-c:v', 'libwebp',
  '-lossless', '0',
  '-q:v', String(QUALITY),
  '-preset', 'picture',
  // Reset the counter in the output so the first frame is frame_0001.webp
  // regardless of what the source numbering started at.
  '-start_number', '1',
  path.join(OUT_DIR, 'frame_%04d.webp'),
];

console.log(`\nUsing: ${FFMPEG}`);
console.log('Output: ' + OUT_DIR + '/frame_%04d.webp');
console.log(`Scale: ${WIDTH}x${HEIGHT}, quality ${QUALITY}\n`);
const started = Date.now();
const ff = spawn(FFMPEG, args, { stdio: 'inherit' });
ff.on('close', (code) => {
  if (code !== 0) { console.error(`ffmpeg exited ${code}`); process.exit(code); }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.webp'));
  let total = 0;
  for (const f of files) total += fs.statSync(path.join(OUT_DIR, f)).size;
  const mb = (total / 1024 / 1024).toFixed(2);
  const avg = (total / files.length / 1024).toFixed(1);
  console.log(`\nDone in ${elapsed}s`);
  console.log(`${files.length} WebP frames, ${mb} MB total (~${avg} KB avg)`);
  console.log(`\nFrame URLs: /MUSIC-ASSETS/vinyl-frames/frame_0001.webp ... frame_${String(files.length).padStart(4, '0')}.webp`);
});
