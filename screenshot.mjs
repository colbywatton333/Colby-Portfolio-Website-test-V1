import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';

const dir = './temporary screenshots';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Auto-increment filename
const existing = fs.readdirSync(dir).filter(f => f.startsWith('screenshot-') && f.endsWith('.png'));
const nums = existing.map(f => parseInt(f.replace('screenshot-', '').replace(/(-.*)?\.png$/, ''))).filter(n => !isNaN(n));
const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
const filename = label ? `screenshot-${next}-${label}.png` : `screenshot-${next}.png`;
const outPath = path.join(dir, filename);

const browser = await puppeteer.launch({
  executablePath: 'C:\\Users\\Colby\\.cache\\puppeteer\\chrome\\win64-146.0.7680.66\\chrome-win64\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

// If entry screen is present, click through it
const enterBtn = await page.$('#enterBtn');
if (enterBtn) {
  await enterBtn.click();
  await new Promise(r => setTimeout(r, 2000));
}

// If label is 'open', click the first project row to show expanded state
if (label === 'open') {
  const firstRow = await page.$('.project-row');
  if (firstRow) {
    await firstRow.click();
    await new Promise(r => setTimeout(r, 700));
  }
}

// Wait a moment for animations/fonts
await new Promise(r => setTimeout(r, 800));

const fullPage = label === 'full';
await page.screenshot({ path: outPath, fullPage });
await browser.close();

console.log(`Screenshot saved: ${outPath}`);
