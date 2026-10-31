import puppeteer from 'puppeteer-core';

async function snap(w, h, out) {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('sakshi_guide_seen', 'true');
  });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: out });
  await browser.close();
  console.log('Saved to', out);
}

const w = parseInt(process.argv[2] || '1280');
const h = parseInt(process.argv[3] || '800');
const out = process.argv[4] || '/home/anhad/.gemini/antigravity-cli/brain/8d369691-7693-4d59-ab51-afe0828b0d17/snap.png';

snap(w, h, out).catch(console.error);
