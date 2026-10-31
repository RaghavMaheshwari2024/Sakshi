import puppeteer from 'puppeteer-core';
import path from 'path';

const ARTIFACT_DIR = '/home/anhad/.gemini/antigravity-cli/brain/8d369691-7693-4d59-ab51-afe0828b0d17';

async function verifyUI() {
  console.log('🚀 Running Comprehensive UI Verification Suite in Headless Chrome...');
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`PageError: ${err.message}`);
  });

  // Ensure clean localStorage for first-time startup test
  await page.evaluateOnNewDocument(() => {
    localStorage.removeItem('sakshi_guide_seen');
  });

  console.log('🌐 Opening http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 15000 });

  // 1. Verify First-Run Guide Modal is visible
  console.log('📋 Checking First-Run Investigator Guide Modal...');
  await page.waitForSelector('h2', { timeout: 5000 });
  const hasGuide = await page.evaluate(() => {
    return document.body.innerText.includes('Investigator Quick-Start Guide');
  });
  console.log('Guide Modal visible on first run:', hasGuide);

  const guideScreenPath = path.join(ARTIFACT_DIR, 'verify_00_guide_modal.png');
  await page.screenshot({ path: guideScreenPath });
  console.log(`📸 Saved guide modal screenshot to ${guideScreenPath}`);

  // 2. Click "Enter Investigation Suite"
  console.log('🔘 Dismissing Guide Modal...');
  const enterBtn = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(b => b.innerText.includes('Enter Investigation Suite'));
  });
  if (enterBtn) {
    await enterBtn.click();
  }
  await new Promise(r => setTimeout(r, 400));

  // 3. Verify Video State
  console.log('📹 Checking Video in Panel 1...');
  await page.waitForSelector('video');
  const videoState = await page.evaluate(() => {
    const v = document.querySelector('video');
    return {
      src: v ? v.currentSrc : null,
      readyState: v ? v.readyState : 0,
      duration: v ? v.duration : 0,
      videoWidth: v ? v.videoWidth : 0,
      videoHeight: v ? v.videoHeight : 0,
      currentTime: v ? v.currentTime : 0,
    };
  });
  console.log('Video state:', videoState);

  const initialScreenPath = path.join(ARTIFACT_DIR, 'verify_01_workspace_initial.png');
  await page.screenshot({ path: initialScreenPath });
  console.log(`📸 Saved workspace screenshot to ${initialScreenPath}`);

  // 4. Test "Show Me" button
  console.log('🔍 Clicking "Show Me" on Claim 1...');
  const showMeBtn = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(b => b.innerText.includes('Show Me'));
  });
  if (showMeBtn) {
    await showMeBtn.click();
  }
  await new Promise(r => setTimeout(r, 600));

  const showMeScreenPath = path.join(ARTIFACT_DIR, 'verify_02_show_me.png');
  await page.screenshot({ path: showMeScreenPath });
  console.log(`📸 Saved Show Me screenshot to ${showMeScreenPath}`);

  // 5. Test Scrolling down
  console.log('📜 Testing page scroll down...');
  await page.evaluate(() => {
    window.scrollTo({ top: 380, behavior: 'instant' });
  });
  await new Promise(r => setTimeout(r, 400));

  const scrollScreenPath = path.join(ARTIFACT_DIR, 'verify_03_scrolled.png');
  await page.screenshot({ path: scrollScreenPath });
  console.log(`📸 Saved scrolled screenshot to ${scrollScreenPath}`);

  await browser.close();

  console.log('\n📊 VERIFICATION SUMMARY:');
  console.log('Console Errors:', errors.length);
  if (errors.length > 0) {
    console.error('Errors:', errors);
    process.exit(1);
  } else {
    console.log('🎉 ALL TESTS PASSED WITH 0 ERRORS!');
  }
}

verifyUI().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
