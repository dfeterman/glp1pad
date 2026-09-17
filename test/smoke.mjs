import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const file = 'file://' + path.resolve(process.argv[2] || path.join(here, '..', 'glp1pad.html'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const t0 = Date.now();
await page.goto(file, { waitUntil: 'load' });
if (errs.length) { console.log('EARLY ERRORS:\n' + errs.join('\n')); }
await page.waitForFunction(() => typeof App !== 'undefined');
const loadMs = Date.now() - t0;

const tabs = await page.$$eval('nav.tabs button', bs => bs.map(b => b.dataset.tab));
const rows = [];
for (const t of tabs) {
  await page.click(`nav.tabs button[data-tab="${t}"]`);
  const r = await page.evaluate(tab => {
    const s = document.getElementById('tab-' + tab);
    if (!s) return { ok:false, why:'section missing' };
    const vis = getComputedStyle(s).display !== 'none';
    return { ok: vis, chars: s.innerText.trim().length };
  }, t);
  rows.push([t, r.ok ? 'renders' : 'FAIL ' + (r.why||'hidden'), r.chars + ' chars']);
}
// exercise the shared machinery the tab commits will lean on
const checks = {};
await page.click('nav.tabs button[data-tab="settings"]');
await page.fill('#set-clinic', 'Valley Metabolic Health');
await page.fill('#set-sig', 'Jane Smith, MD\nInternal Medicine');
checks.sigPreview = (await page.innerText('#sig-preview')).includes('Jane Smith');
await page.selectOption('#set-emr', 'epic');
checks.epicTokens = (await page.innerText('#emr-preview')).includes('@NAME@');
await page.selectOption('#set-emr', 'generic');
checks.genericTokens = (await page.innerText('#emr-preview')).includes('[patient name]');
checks.persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('glp1pad_v1')).data.clinic === 'Valley Metabolic Health');
await page.keyboard.press('Control+k');
checks.launcher = await page.isVisible('#qbox');
await page.keyboard.press('Escape');
await page.fill('#globalsearch', 'zzzznomatch');
checks.searchEmpty = (await page.innerText('#search-grid')).includes('No matches');
await page.fill('#globalsearch', '');

// --- tab 8 Document ---
await page.click('nav.tabs button[data-tab="document"]');
checks.phraseCards   = (await page.$$('#phrase-grid .card')).length >= 12;
checks.phraseCats    = (await page.$$('#phrase-cats .chip')).length >= 5;
checks.billingCards  = (await page.$$('#billing-body .comp-section')).length === 4;
checks.codeGroups    = (await page.$$('#code-groups .comp-section')).length === 6;
// a phrase opens, fills, and copies what you actually chose
await page.click('#phrase-grid .card >> nth=0');
checks.modalOpen = await page.isVisible('#modal .filled');
const inputs = await page.$$('#modal .filled input[type=text]');
if (inputs.length) await inputs[0].fill('TESTVALUE');
const collected = await page.evaluate(() => collectText(document.querySelector('#modal .filled')));
checks.fillCollects = inputs.length ? collected.includes('TESTVALUE') : collected.length > 0;
checks.emptyBlanks  = !collected.includes('{');
await page.click('#modal .modal-actions button >> nth=-1');
// the billing card reaches its attestation phrase
await page.click('#billing-body .comp-section >> nth=0 >> button.primary');
checks.billingToPhrase = (await page.innerText('#modal h3')).includes('G2211');
await page.click('#modal .modal-actions button >> nth=-1');
// every ICD-10 code shipped is one the FY2026 set marks billable
const parents = await page.evaluate(() => {
  const bad = ['E66.0','E66.8','E66.81','E88.81','Z68.3','Z68.4','Z91.1','Z91.12','Z91.14'];
  const shipped = [];
  (DATA.codes||[]).forEach(g => g.items.forEach(i => { if (i.code !== 'NOTE') shipped.push(i.code); }));
  return shipped.filter(c => bad.includes(c));
});
checks.noParentCodes = parents.length === 0;
if (parents.length) console.log('  non-billable parent codes shipped:', parents.join(', '));
// the dose-recommendation guard is visible on load
checks.doseGuard = await page.isVisible('#doseguard');

// --- the palette actually applies ---
// A stray tag or a bad rule can leave the whole :root block dropped by CSS
// error recovery while the text still sits in the file, so assert the
// computed values, never the source.
const css = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const need = ['--bg','--card','--ink','--muted','--accent','--accent-soft','--accent-ink','--line',
                '--sev-mild','--sev-mod','--sev-high','--sev-flag','--ok','--radius','--shadow'];
  const unset = need.filter(v => !root.getPropertyValue(v).trim());
  const btn = document.querySelector('nav.tabs button.active');
  return {
    unset,
    accent: root.getPropertyValue('--accent').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    activeTabInk: btn ? getComputedStyle(btn).color : '',
    styleTags: document.querySelectorAll('style').length
  };
});
checks.cssVarsSet   = css.unset.length === 0;
checks.cssAccent    = css.accent === '#116b5e';
checks.cssBodyPaint = css.bodyBg === 'rgb(238, 242, 242)';
checks.cssOneSheet  = css.styleTags === 1;
if (css.unset.length) console.log('  UNSET custom properties:', css.unset.join(', '));
if (css.bodyBg !== 'rgb(238, 242, 242)') console.log('  body background is', css.bodyBg, '- expected the cool surface');

console.log('load: ' + loadMs + ' ms   size: ' + (await page.evaluate(()=>document.documentElement.outerHTML.length)/1024).toFixed(1) + ' KB DOM');
console.log('');
for (const [a,b,c] of rows) console.log('  ' + a.padEnd(10) + b.padEnd(10) + c);
console.log('');
for (const [k,v] of Object.entries(checks)) console.log('  ' + k.padEnd(16) + (v ? 'pass' : 'FAIL'));
console.log('');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console or page errors');
await browser.close();
process.exit(errs.length || rows.some(r=>r[1].startsWith('FAIL')) || Object.values(checks).some(v=>!v) ? 1 : 0);
