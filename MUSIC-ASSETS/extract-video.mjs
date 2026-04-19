import fs from 'fs';

// Read the HTML reference that has the embedded base64 MP4 (user provided it)
// The base64 is inside src="data:video/mp4;base64,...". We'll read from a temp file
// the user pasted, or just hardcode from the doc.
const b64Path = process.argv[2];
const outPath = process.argv[3] || 'record-player.mp4';

const raw = fs.readFileSync(b64Path, 'utf8');
// Extract the base64 between `data:video/mp4;base64,` and the closing quote
const m = raw.match(/data:video\/mp4;base64,([A-Za-z0-9+/=]+)/);
if (!m) { console.error('no base64 match'); process.exit(1); }
const buf = Buffer.from(m[1], 'base64');
fs.writeFileSync(outPath, buf);
console.log('wrote', outPath, buf.length, 'bytes');
