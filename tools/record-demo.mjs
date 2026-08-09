// Records a narrated (caption-only, no audio) walkthrough of the built app as an
// MP4, for use as a demo reel. It drives the real UI in a real browser, so every
// number on screen is genuinely computed during the take.
//
//   npm run build:single
//   npx http-server dist-single -p 4200   # or any static server on 4200
//   node tools/record-demo.mjs            # 16:9  -> TPPSCI-linkedin-1080p.mp4
//   ASPECT=4x5 node tools/record-demo.mjs # 4:5   -> TPPSCI-linkedin-feed-4x5.mp4
//
// Requires the `playwright` and `ffmpeg-static` dev packages, which are not
// project dependencies — install them ad hoc when you need to re-shoot:
//   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -D playwright ffmpeg-static
// Set CHROME_PATH if Playwright's bundled Chromium is not where it expects.
//
// The take is silent. To add the generated backing track, render it at exactly
// the video's length and mux with explicit stream maps (without -map, ffmpeg may
// keep the video's own audio instead of the track you just made):
//
//   node tools/make-music.mjs 54.68 .demo-music.wav
//   ffmpeg -i reel.mp4 -i .demo-music.wav -map 0:v:0 -map 1:a:0 \
//     -filter:a volume=-3dB -c:v copy -c:a aac -b:a 192k -shortest out.mp4
import { chromium } from 'playwright';
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 4:5 fills far more of the mobile feed, and recording at that viewport lets the
// app lay itself out for the shape rather than being letterboxed into it.
const ASPECT = process.env.ASPECT === '4x5' ? '4x5' : '16x9';
const PORTRAIT = ASPECT === '4x5';

const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const PAGE_URL = process.env.DEMO_URL || 'http://localhost:4200/index.html';
const OUT = new URL('../.video-frames-' + ASPECT + '/', import.meta.url).pathname;
const VIDEO = PORTRAIT ? 'TPPSCI-linkedin-feed-4x5.mp4' : 'TPPSCI-linkedin-1080p.mp4';
const W = PORTRAIT ? 1080 : 1920;
const H = PORTRAIT ? 1350 : 1080;
const FPS = 25;          // output frame rate
const CAPTURE_EVERY = 2; // one real screenshot per 2 output frames

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// ---- overlay: captions and full-screen cards, drawn on top of the live app ----
await page.addStyleTag({
  content: `
  #vidCaption {
    position: fixed; left: ${PORTRAIT ? 32 : 48}px; bottom: ${PORTRAIT ? 40 : 48}px; z-index: 99999;
    max-width: ${PORTRAIT ? 84 : 60}%; padding: ${PORTRAIT ? '18px 24px' : '20px 28px'}; border-radius: 14px;
    background: rgba(12,16,24,.86); color: #fff;
    font: 600 ${PORTRAIT ? 30 : 34}px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif;
    box-shadow: 0 18px 50px rgba(0,0,0,.45);
    opacity: 0; transition: opacity .28s ease; pointer-events: none;
    border-left: 6px solid #3b82f6;
  }
  #vidCaption.on { opacity: 1; }
  #vidCaption small {
    display: block; margin-top: 8px;
    font: 400 22px/1.35 system-ui, sans-serif; color: #b9c4d6;
  }
  #vidCard {
    position: fixed; inset: 0; z-index: 100000; display: flex;
    flex-direction: column; align-items: center; justify-content: center; gap: 22px;
    background: linear-gradient(150deg, #0b1220 0%, #131f36 55%, #0b1220 100%);
    color: #fff; text-align: center; opacity: 0;
    transition: opacity .4s ease; pointer-events: none;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  #vidCard.on { opacity: 1; }
  #vidCard .badge {
    font: 700 20px/1 system-ui; letter-spacing: .22em; color: #7dd3fc;
    border: 1px solid rgba(125,211,252,.4); padding: 12px 20px; border-radius: 999px;
  }
  #vidCard h1 { font: 800 ${PORTRAIT ? 58 : 76}px/1.13 system-ui; margin: 0; max-width: ${PORTRAIT ? 900 : 1350}px; }
  #vidCard p  { font: 400 ${PORTRAIT ? 26 : 32}px/1.45 system-ui; margin: 0; color: #aebbd0; max-width: ${PORTRAIT ? 820 : 1050}px; }
  #vidCard .row { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; margin-top: 10px; }
  #vidCard .chip {
    font: 600 22px/1 system-ui; color: #dbe6f5; padding: 14px 22px;
    border-radius: 999px; background: rgba(255,255,255,.07);
    border: 1px solid rgba(255,255,255,.12);
  }
  `,
});
await page.evaluate(() => {
  const cap = document.createElement('div');
  cap.id = 'vidCaption';
  const card = document.createElement('div');
  card.id = 'vidCard';
  document.body.append(cap, card);
});

let frame = 0;
const pad = (n) => String(n).padStart(5, '0');

/** Capture one screenshot and repeat it as CAPTURE_EVERY output frames. */
async function shoot() {
  const first = `${OUT}/f${pad(frame++)}.png`;
  await page.screenshot({ path: first });
  for (let i = 1; i < CAPTURE_EVERY; i++) copyFileSync(first, `${OUT}/f${pad(frame++)}.png`);
}

/** Hold a still shot for `secs`; one screenshot, duplicated — cheap and identical. */
async function hold(secs) {
  const first = `${OUT}/f${pad(frame++)}.png`;
  await page.screenshot({ path: first });
  const total = Math.round(secs * FPS) - 1;
  for (let i = 0; i < total; i++) copyFileSync(first, `${OUT}/f${pad(frame++)}.png`);
}

/** Capture live frames for `secs` while the page animates or scrolls. */
async function record(secs, step = async () => {}) {
  const shots = Math.round((secs * FPS) / CAPTURE_EVERY);
  for (let i = 0; i < shots; i++) {
    await step(i / shots);
    await shoot();
  }
}

async function caption(text, sub = '') {
  await page.evaluate(([t, s]) => {
    const c = document.getElementById('vidCaption');
    c.innerHTML = t + (s ? `<small>${s}</small>` : '');
    c.classList.add('on');
  }, [text, sub]);
  await page.waitForTimeout(300);
}
const clearCaption = () => page.evaluate(() => document.getElementById('vidCaption').classList.remove('on'));

async function card(html, secs) {
  await page.evaluate((h) => {
    const c = document.getElementById('vidCard');
    c.innerHTML = h;
    c.classList.add('on');
  }, html);
  await page.waitForTimeout(450);
  await hold(secs);
}
const hideCard = async () => {
  await page.evaluate(() => document.getElementById('vidCard').classList.remove('on'));
  await page.waitForTimeout(450);
};

/** Smoothly scroll an element and capture the motion. */
async function scrollThrough(selector, secs) {
  const max = await page.evaluate(
    (s) => { const e = document.querySelector(s); return e ? Math.max(0, e.scrollHeight - e.clientHeight) : 0; },
    selector,
  );
  if (max <= 4) { await hold(secs); return; }
  await record(secs, async (t) => {
    await page.evaluate(([s, y]) => { document.querySelector(s).scrollTop = y; }, [selector, max * t]);
  });
}

const tab = async (name) => {
  await page.click(`.tab-btn[data-tab="${name}"]`);
  await page.waitForTimeout(700);
};

// ------------------------------- the walkthrough -------------------------------

await card(`
  <div class="badge">TPPSCI</div>
  <h1>Primavera P6 schedule analysis,<br/>right in the browser</h1>
  <p>DCMA 14-point assessment, Monte Carlo risk and CPM path analysis — with no upload, no backend and no P6 licence.</p>
  <div class="row">
    <span class="chip">XER in</span><span class="chip">Analysis out</span><span class="chip">100% client-side</span>
  </div>`, 3.6);
await hideCard();

// --- XER viewer -----------------------------------------------------------
await caption('Load an .xer export', 'Gantt, WBS tree and data-date line, straight from the file');
await hold(3);
await clearCaption();
await caption('Scaled to the schedule’s own dates');
await scrollThrough('.gantt-bars-container', 3.5);
await clearCaption();

await page.selectOption('#zoomSelect', 'Week');
await page.waitForTimeout(600);
await caption('Month, week or day zoom');
await hold(2.4);
await clearCaption();
await page.selectOption('#zoomSelect', 'Month');
await page.waitForTimeout(500);

await page.check('#viewerCriticalCheck');
await page.waitForTimeout(700);
await caption('Filter to the critical path', 'Status, float, milestones — and export the filtered set to CSV');
await hold(2.8);
await clearCaption();
await page.uncheck('#viewerCriticalCheck');
await page.waitForTimeout(500);

// --- DCMA -----------------------------------------------------------------
await tab('dcma');
await caption('All 14 DCMA checks — computed, not canned', 'Every number comes from the schedule you loaded');
await hold(3.2);
await clearCaption();
await scrollThrough('#tab-dcma', 3.5);

await page.evaluate(() => { document.querySelector('#tab-dcma').scrollTop = 0; });
await page.waitForTimeout(400);
const drill = await page.evaluate(() => {
  const card = document.querySelector('.dcma-card.rag-red') || document.querySelector('.dcma-card.rag-amber') || document.querySelector('.dcma-card');
  if (!card) return false;
  card.click();
  return true;
});
if (drill) {
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('#dcmaDrilldown')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(600);
  await caption('Click any check to see what failed it', 'Down to the individual activities — exportable');
  await hold(3.4);
  await clearCaption();
}

// --- Monte Carlo risk -----------------------------------------------------
await tab('risk');
await caption('Monte Carlo schedule risk (QSRA)');
await hold(2.4);
await clearCaption();
await page.click('#runSimBtn');
await page.waitForTimeout(1400);
await caption('Every iteration re-solves the network', 'So criticality is measured, not assumed — and the seed makes it reproducible');
await hold(3.4);
await clearCaption();
await caption('P10 / P50 / P80 / P90 and the S-curve', 'How much confidence your deterministic date actually carries');
await scrollThrough('#tab-risk', 4.5);
await clearCaption();
await caption('Ranked risk drivers', 'Duration sensitivity by correlation against the project finish');
await hold(3);
await clearCaption();

// --- Path analyser --------------------------------------------------------
await tab('path');
await caption('The true driving chain', 'The predecessor that actually sets each early start — not just everything at zero float');
await hold(3.2);
await clearCaption();
await scrollThrough('#tab-path', 2.5);

// --- Anonymiser -----------------------------------------------------------
await tab('anonymiser');
await caption('Share a schedule without sharing the client', 'Names pseudonymised, logic and dates intact, re-emitted as a valid .xer');
await hold(3.2);
await clearCaption();

// --- Theme ----------------------------------------------------------------
await tab('gantt');
await page.click('#themeToggle');
await page.waitForTimeout(700);
await caption('Light and dark, and it never phones home');
await hold(2.8);
await clearCaption();

await card(`
  <div class="badge">OPEN SOURCE · MIT</div>
  <h1>TPPSCI</h1>
  <p>Project Planning, Scheduling &amp; Control Intelligence<br/>Runs entirely in your browser — your schedule never leaves your machine.</p>
  <div class="row">
    <span class="chip">github.com/Tahir-yamin/tppsci-project-controls-suite</span>
    <span class="chip">Tahir Yamin</span>
  </div>`, 4.2);

await browser.close();

execFileSync(require('ffmpeg-static'), [
  '-y', '-framerate', String(FPS),
  '-pattern_type', 'glob', '-i', `${OUT}/f*.png`,
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-preset', 'slow', '-crf', '21', '-movflags', '+faststart', '-r', String(FPS),
  VIDEO,
], { stdio: 'inherit' });

rmSync(OUT, { recursive: true, force: true });
console.log(`${VIDEO} — ${frame} frames, ${(frame / FPS).toFixed(1)}s, ${W}x${H}`);
