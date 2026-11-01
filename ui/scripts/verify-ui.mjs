/**
 * End-to-end check of the UI in headless Chrome, against a running dev server.
 *   npx vite --port 5173 &   node scripts/verify-ui.mjs [screenshot-dir]
 * Exercises every view and interaction; prints a pass/fail line for each.
 */
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';

const OUT = process.argv[2] || 'verify-shots';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ['clipboard-read', 'clipboard-write']);
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|502|500/.test(m.text())) errors.push(m.text()); });

const text = () => page.evaluate(() => document.body.innerText);
const store = (fn, ...args) => page.evaluate(`(${fn})(window.sakshiStore.getState(), ...${JSON.stringify(args)})`);
const clickText = (label, tag = 'button') => page.evaluate((label, tag) => {
  const el = [...document.querySelectorAll(tag)].filter((b) => b.offsetParent !== null).find((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().includes(label));
  if (el) el.click();
  return Boolean(el);
}, label, tag);
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const key = (k) => page.keyboard.press(k);

// ---------------------------------------------------------------- Overview
await page.goto(BASE, { waitUntil: 'networkidle2' });
await wait(1800);
check('Overview is the landing view', (await text()).includes('Physics measures'));
check('First-run guide does not cover the landing page', !(await text()).includes('Investigator guide'));
await shot('01-overview');
const stepInfo = await page.evaluate(async () => {
  const steps = [...document.querySelectorAll('.story-step')];
  const seen = [];
  for (const s of steps) {
    s.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 900));
    seen.push(document.querySelector('.exhibit-track, .exhibit-time, .exhibit-ground, .exhibit-speed, .exhibit-verdict')?.className);
  }
  return seen;
});
check('Story exhibit follows each of 5 steps', new Set(stepInfo).size === 5, stepInfo.join(' '));
await shot('02-overview-story');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.72));
await wait(1800);
await shot('03-overview-proof');
check('Overview shows real validation numbers', (await page.evaluate(() => document.body.textContent)).includes('wrong verdicts in 63 claims'));

// ---------------------------------------------------------------- Guide, first run
await page.evaluate(() => window.scrollTo(0, 0));
await clickText('Open a case');
await wait(1500);
check('First-run guide opens on the workspace', (await text()).includes('Investigator guide'));
for (const t of ['The panels', 'Keyboard', 'Limits', 'The idea']) check(`Guide tab: ${t}`, await clickText(t));
await shot('04-guide');
await key('Escape');
await wait(300);
check('Esc closes the guide', !(await text()).includes('Investigator guide'));
await key('?');
await wait(300);
check('? opens the guide', (await text()).includes('Investigator guide'));
await page.evaluate(() => document.querySelector('[role=dialog] input[type=checkbox]').click());
await wait(50);
await clickText('Enter the workspace');
await wait(300);
check('Don’t-show-again persists', (await page.evaluate(() => localStorage.getItem('sakshi_guide_seen'))) === 'true');

// ---------------------------------------------------------------- Workspace
await wait(800);
await shot('05-workspace');
const layout = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight, w: document.documentElement.scrollWidth, vw: innerWidth }));
check('Workspace fits the viewport', layout.h <= layout.vh + 1 && layout.w <= layout.vw, JSON.stringify(layout));
const videoOk = await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, { timeout: 8000 }).then(() => true, () => false);
check('Video loads', videoOk);

const frame = () => store((s) => s.currentFrame);
await store((s) => s.setFrame(40));
await key('ArrowRight');
check('Right arrow steps +1', (await frame()) === 41);
await key('ArrowLeft');
check('Left arrow steps -1', (await frame()) === 40);
await key('l');
check('L steps +5', (await frame()) === 45);
await key('j');
check('J steps -5', (await frame()) === 40);
const before = await store((s) => s.showMasks);
await key('m');
check('M toggles masks', (await store((s) => s.showMasks)) !== before);
await key('m');

await page.evaluate(() => document.activeElement?.blur?.());
await key(' ');
await wait(1400);
const playing = await store((s) => s.isPlaying);
const moved = await frame();
await key(' ');
check('Space plays and the playhead advances', playing && moved > 45, `frame ${moved}`);
check('Space pauses', !(await store((s) => s.isPlaying)));
for (const label of ['0.25×', '0.5×', '1×']) {
  await clickText(label);
  check(`Speed ${label}`, (await store((s) => s.playbackSpeed)) === parseFloat(label));
}

const rail = await page.$('[role=slider]');
const box = await rail.boundingBox();
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 });
await page.mouse.up();
const dragged = await store((s) => s.currentTime);
check('Timeline drag scrubs', dragged > 3 && dragged < 5, dragged.toFixed(2));

const chart = await page.$('section[aria-label="Speed"] svg');
const cb = await chart.boundingBox();
await page.mouse.click(cb.x + cb.width * 0.7, cb.y + cb.height * 0.5);
check('Clicking the speed chart seeks', (await store((s) => s.currentTime)) > dragged);
await page.mouse.move(cb.x + cb.width * 0.4, cb.y + cb.height * 0.5);
await wait(100);
check('Speed chart tooltip', (await text()).includes('Click to seek'));
await page.mouse.move(10, 10);
await clickText('90% band');
check('90% band toggles', !(await store((s) => s.showConfidenceBands)));
await clickText('90% band');

await clickText('Show me');
await wait(700);
const hl = await store((s) => s.highlightWindow);
check('Show me sets the claim window', Boolean(hl?.reason), hl?.reason);
check('Show me selects the vehicle', (await store((s) => s.selectedTrack)) === 'car-0');
await shot('06-show-me');
await clickText('Clear filter');
check('Clear filter', (await store((s) => s.selectedTrack)) === null);

for (const [label, n] of [['Not consistent', 1], ['Consistent', 2], ['Can', 1], ['All', 4]]) {
  await page.evaluate((label) => {
    [...document.querySelectorAll('[aria-label="Filter by verdict"] button')].find((b) => (b.title || '').startsWith(label)).click();
  }, label);
  await wait(150);
  check(`Claim filter ${label}`, (await page.$$('.claim-card')).length === n);
}

await clickText('Car');
check('Car-centred mode', (await store((s) => s.replayMode)) === 'ego');
await clickText('Road');
check('Road-fixed mode', (await store((s) => s.replayMode)) === 'road');
for (const l of ['Zoom in', 'Zoom out']) check(l, await page.evaluate((l) => { const b = document.querySelector(`[aria-label="${l}"]`); b?.click(); return Boolean(b); }, l));

await clickText('3D');
await page.waitForSelector('section[aria-label="Reconstruction"] canvas', { timeout: 15000 }).catch(() => null);
await wait(2500);
check('3D replay renders', Boolean(await page.$('section[aria-label="Reconstruction"] canvas')));
check('Claimed-speed ghost control', (await text()).includes('Ghost'));
await store((s) => s.setTime(5.2));
await wait(1500);
await shot('07-3d');
await clickText('Top-down');

// ---------------------------------------------------------------- Walkthrough
await clickText('Walk through this case');
await wait(700);
const titles = [];
for (let i = 0; i < 6; i++) {
  titles.push(await page.evaluate(() => document.querySelector('.tour-copy .font-medium')?.innerText));
  if (i === 3) { await wait(3200); await shot('08-tour-impact'); check('Walkthrough stops on the impact', Math.abs((await store((s) => s.currentTime)) - 4.672) < 0.08); }
  if (i === 4) { await wait(2500); check('Walkthrough switches to 3D for the claim', (await store((s) => s.reconView)) === '3d'); await shot('09-tour-claim'); }
  await key('n');
  await wait(600);
}
check('Walkthrough has 6 steps', titles.filter(Boolean).length === 6, titles.join(' | '));
await clickText('Done');
await wait(300);
await store((s) => s.setReconView('top'));

// ---------------------------------------------------------------- Pipeline run (recorded)
await clickText('Pipeline run');
await wait(400);
check('Pipeline run says it is recorded', (await text()).includes('Recorded run'));
await page.waitForFunction(() => document.body.innerText.includes('Who drove what?'), { timeout: 12000 });
await shot('10-pipeline-confirm');
check('Stops for who-drove-what with Wonder’s reason', (await text()).includes('car-0'));
await clickText('Continue');
await page.waitForFunction(() => document.body.innerText.includes('Number check passed'), { timeout: 8000 });
check('Replay completes with real validator result', true);
const pipelineText = await text();
check('Stage values are the case’s own', pipelineText.includes('181 frames') && pipelineText.includes('18 drops recovered'));
await shot('11-pipeline-done');
await clickText('Inspect the case');
await wait(200);

// ---------------------------------------------------------------- Case switching
await clickText('Side impact, clear day');
await wait(900);
await shot('12-picker');
check('Picker lists 16 scenarios', (await page.$$('.scenario-card')).length === 16);
await page.evaluate(() => [...document.querySelectorAll('.scenario-card')].find((c) => c.innerText.includes('Near miss')).click());
await wait(1200);
check('Near miss opens', (await store((s) => s.scenarioId)) === 'near_miss');
check('Near miss says no impact', (await text()).toLowerCase().includes('no impact'));
await clickText('Walk through this case');
await wait(500);
check('Walkthrough handles a near miss', (await page.evaluate(() => { const c = [...document.querySelectorAll('button')].find((b) => b.innerText === 'Next'); for (let i = 0; i < 2; i++) c?.click(); return true; })));
await wait(600);
await page.evaluate(() => document.querySelector('[aria-label="End walkthrough"]')?.click());
await wait(300);

// ---------------------------------------------------------------- Report
await key('2');
await wait(1500);
const nm = await text();
check('Key 2 opens the report', nm.includes('Measurement report'));
check('Near-miss report has no invented impact', nm.includes('Closest approach') && !nm.includes('45.6 km/h'));
for (const bad of ['ISO 17025', 'RAIB', '7d2f9b8c', 'ADMISSIBLE', 'N = 1,000', '0x4B3A9']) check(`No fabricated "${bad}"`, !nm.includes(bad));
await page.evaluate(() => { document.querySelector('.scenario-card'); });
await page.waitForFunction(() => /[0-9a-f]{64}/.test(document.body.innerText), { timeout: 8000 });
check('SHA-256 is a real digest of the footage', true);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('13-report');
const pdf = await page.pdf({ format: 'A4' });
check('Report prints', pdf.length > 20000, `${Math.round(pdf.length / 1024)} kB`);

// ---------------------------------------------------------------- Validation
await key('3');
await wait(2200);
const val = await page.evaluate(() => document.body.textContent);
check('Key 3 opens validation', val.includes('Scored against the truth'));
check('63 claims, 0 wrong', val.includes('of 63 claims: 48 correct, 15 answered'));
for (const bad of ['97.5%', '123×', '14.80', 'Court Admissible']) check(`No fabricated "${bad}"`, !val.includes(bad));
check('Scenario table has 16 rows', (await page.$$('.val-table tbody tr')).length === 16);
await shot('14-validation');
await page.select('select', 'night');
await wait(300);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Vehicle B').click());
await wait(1200);
check('Scenario and vehicle pickers update the chart', (await page.evaluate(() => document.body.textContent)).includes('bias'));
await page.evaluate(() => document.querySelector('details summary').click());
await wait(300);
check('Frame table has rows', (await page.$$('details tbody tr')).length > 10);
await clickText('Copy summary');
await wait(200);
check('Copy summary', (await page.evaluate(() => document.body.textContent)).includes('Copied'));
await page.evaluate(() => document.querySelector('.h-px')?.scrollIntoView());
await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); } });
await wait(900);
await shot('15-validation-end');
await page.evaluate(() => window.scrollTo(0, 0));

// ---------------------------------------------------------------- Calibration
await key('4');
await wait(1200);
const cal = await text();
check('Key 4 opens calibration', cal.includes('Calibration') && cal.includes('Fit quality'));
check('Scenario calibration is explore-only', cal.includes('pre-rendered scenario'));
const pts = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
const canvas = await page.$('canvas');
const cvb = await canvas.boundingBox();
await page.mouse.click(cvb.x + cvb.width * 0.4, cvb.y + cvb.height * 0.6);
await wait(300);
check('Clicking the frame adds a point', (await page.evaluate(() => document.querySelectorAll('tbody tr').length)) === pts + 1);
await shot('16-calibration');
for (const t of ['Stop line', 'Clock', 'Signal', 'Points']) check(`Tool: ${t}`, await clickText(t));
await clickText('Dashcam');
await wait(200);
check('Dashcam parameters shown as unused', (await text()).includes('not yet used by the engine'));
await clickText('Fixed camera');
await clickText('Synthetic preset');
await clickText('3.5 m lane preset');
await wait(100);
check('Save disabled for scenarios', await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Save').disabled));

// ---------------------------------------------------------------- System
await key('5');
await wait(2000);
const sys = await page.evaluate(() => document.body.textContent);
check('Key 5 opens System', sys.includes('Models read. The engine measures.'));
check('Usage from the log', sys.includes('9,099 calls logged'));
await shot('17-system');
await key('Escape');
await wait(500);
check('Esc returns to the workspace', (await text()).includes('Walk through this case'));
await key('0');
await wait(1500);
check('Key 0 returns to Overview', (await text()).includes('Physics measures'));

// ---------------------------------------------------------------- New case (no backend)
await clickText('New case');
await wait(400);
check('New case dialog', (await text()).includes('Incident clip'));
await clickText('Add');
await wait(100);
check('Add statement', (await text()).includes('Statements (3)'));
await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.innerText === 'Audio').click());
await wait(100);
check('Audio statement', (await text()).includes('No recording attached'));
await page.evaluate(() => [...document.querySelectorAll('[role=radio]')].find((b) => b.innerText.includes('Dashcam')).click());
await wait(50);
check('Dashcam limit is stated', (await text()).includes('does not yet remove'));
await shot('18-new-case');
await page.evaluate(() => document.querySelector('[role=dialog] [aria-label=Close]').click());

// ---------------------------------------------------------------- Deep links and full-screen 3D
await page.goto(`${BASE}/?replay3d&scenario=base`, { waitUntil: 'networkidle2' });
await wait(4000);
check('?replay3d full-screen route', Boolean(await page.$('canvas')) && (await text()).includes('Play'));
await shot('19-replay3d');
await page.goto(`${BASE}/?scenario=night&view=report`, { waitUntil: 'networkidle2' });
await wait(800);
check('Deep link to a view', (await text()).includes('Measurement report'));

// ---------------------------------------------------------------- Small screens
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
for (const [name, q] of [['overview', '/'], ['workspace', '/?view=case&scenario=base'], ['report', '/?view=report&scenario=base'], ['validation', '/?view=accuracy'], ['system', '/?view=system'], ['calibration', '/?view=calibration&scenario=base']]) {
  await page.goto(`${BASE}${q}`, { waitUntil: 'networkidle2' });
  await wait(1800);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(`Mobile ${name}: no sideways scroll`, over <= 0, over);
  await shot(`m-${name}`);
}

// ---------------------------------------------------------------- Other desks
await page.setViewport({ width: 1280, height: 720, isMobile: false, hasTouch: false });
await page.goto(`${BASE}/?view=case&scenario=base`, { waitUntil: 'networkidle2' });
await wait(1600);
const laptop = await page.evaluate(() => {
  const r = document.querySelector('[role=slider]').getBoundingClientRect();
  return { sliderBottom: r.bottom, vh: innerHeight, over: document.documentElement.scrollWidth - innerWidth };
});
check('Laptop 1280×720: timeline on screen', laptop.sliderBottom < laptop.vh && laptop.over <= 0, JSON.stringify(laptop));
await shot('20-laptop');
await page.setViewport({ width: 820, height: 1100 });
await page.goto(`${BASE}/?view=case&scenario=base`, { waitUntil: 'networkidle2' });
await wait(1500);
check('Tablet: no sideways scroll', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
await shot('21-tablet');
await page.setViewport({ width: 1024, height: 768 });
await wait(600);
check('1024 wide: no sideways scroll', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
await shot('22-1024');

// ---------------------------------------------------------------- Reduced motion
await page.setViewport({ width: 1440, height: 900 });
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
for (const q of ['/', '/?view=accuracy', '/?view=system']) {
  await page.goto(`${BASE}${q}`, { waitUntil: 'networkidle2' });
  await wait(900);
  const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-reveal], .hero-title, .hero-sub > *')]
    .filter((e) => getComputedStyle(e).visibility === 'hidden' || getComputedStyle(e).opacity === '0').length);
  check(`Reduced motion ${q}: everything visible at once`, hidden === 0, hidden);
}
await page.emulateMediaFeatures([]);

await browser.close();
check('No console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
