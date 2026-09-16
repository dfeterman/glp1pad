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

console.log('load: ' + loadMs + ' ms   size: ' + (await page.evaluate(()=>document.documentElement.outerHTML.length)/1024).toFixed(1) + ' KB DOM');
console.log('');
for (const [a,b,c] of rows) console.log('  ' + a.padEnd(10) + b.padEnd(10) + c);
console.log('');
for (const [k,v] of Object.entries(checks)) console.log('  ' + k.padEnd(16) + (v ? 'pass' : 'FAIL'));
console.log('');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console or page errors');
await browser.close();
process.exit(errs.length || rows.some(r=>r[1].startsWith('FAIL')) || Object.values(checks).some(v=>!v) ? 1 : 0);
