// Screenshot one page: node scripts/snap.mjs <url-path> <width> <height> <out.png> [full]
import puppeteer from 'puppeteer-core';

const [path = '/', w = '1440', h = '900', out = 'snap.png', full] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h });
await page.evaluateOnNewDocument(() => localStorage.setItem('sakshi_guide_seen', 'true'));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 2200));
await page.screenshot({ path: out, fullPage: full === 'full' });
await browser.close();
console.log('saved', out, errors.length ? errors.slice(0, 6) : 'no console errors');
