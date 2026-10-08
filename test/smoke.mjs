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
checks.cssAccent    = css.accent === '#6b3f6e';
checks.cssBodyPaint = css.bodyBg === 'rgb(248, 244, 245)';
checks.cssOneSheet  = css.styleTags === 1;
if (css.unset.length) console.log('  UNSET custom properties:', css.unset.join(', '));
if (css.bodyBg !== 'rgb(238, 242, 242)') console.log('  body background is', css.bodyBg, '- expected the warm neutral surface');

// --- tab 4 Coverage ---
await page.click('nav.tabs button[data-tab="coverage"]');
checks.covKinds   = (await page.$$('#cov-kind .chip')).length === 3;
checks.covComorb  = (await page.$$('#cov-comorb .chip')).length >= 14;
checks.covSavings = (await page.$$('#cov-savings .comp-section')).length === 5;
checks.covCompound= (await page.innerText('#cov-compound')).includes('503A');
// BMI arithmetic and the Z68 it maps to
await page.fill('#cov-wt', '232'); await page.fill('#cov-ht', '65');
const bmiNote = await page.innerText('#cov-bminote');
checks.covBmi     = (await page.inputValue('#cov-bmi')) === '38.6' && bmiNote.includes('Z68.38');
// the letter assembles from the fields
await page.fill('#cov-drug', 'semaglutide');
await page.fill('#cov-brand', 'Wegovy');
await page.selectOption('#cov-ind', 'chronic weight management');
await page.fill('#cov-a1c', '6.1');
await page.click('#cov-comorb .chip >> nth=0');
const trialInputs = await page.$$('#cov-trials input');
await trialInputs[0].fill('metformin'); await trialInputs[1].fill('2000 mg daily');
await trialInputs[2].fill('9 months');  await trialInputs[3].fill('inadequate response');
await page.fill('#cov-icd-search', 'E66.813');
await page.click('#cov-icd-results .chip >> nth=0');
const letter = await page.innerText('#cov-out');
checks.covLetter  = ['semaglutide (Wegovy)','chronic weight management','E66.813','metformin at 2000 mg daily for 9 months','Current BMI is 38.6','6.1 percent']
                      .every(f => letter.includes(f));
checks.covNoPHI   = letter.includes('Patient: ***') && letter.includes('Member ID: ***');
// letter type switches shape, and the denial block only shows where it belongs
checks.covDenialHidden = !(await page.isVisible('#cov-denialwrap'));
await page.click('#cov-kind .chip >> nth=1');
checks.covDenialShown  = await page.isVisible('#cov-denialwrap');
checks.covAppeal  = (await page.innerText('#cov-out')).startsWith('RE: Appeal of denial');
await page.click('#cov-kind .chip >> nth=2');
const p2p = await page.innerText('#cov-out');
checks.covP2P     = p2p.startsWith('PEER-TO-PEER PREP SHEET') && p2p.includes('OUTCOME');
// no payer criteria are shipped anywhere in the file
checks.covNoCriteria = await page.evaluate(() =>
  !/\b(BMI (?:of )?(?:27|30|35|40)\s*(?:or (?:above|greater)|\+)|must have (?:failed|tried)|plan requires)/i
    .test(JSON.stringify(COVER.SAVINGS) + COVER.COMORB.join(' ') + JSON.stringify(COVER.KINDS)));
// consequences of non-treatment feed the letter and the P2P sheet
await page.click('nav.tabs button[data-tab="coverage"]');
await page.click('#cov-kind .chip >> nth=0');   // back to the PA letter
checks.covConseqChips = (await page.$$('#cov-conseq .chip')).length === 16;
await page.click('button:has-text("Add the ones that fit")');
const fitted = await page.evaluate(() => COVER.conseq.length);
checks.covConseqFit  = fitted > 0 && fitted < 16;   // indication-scoped, not everything
checks.covConseqWarn = (await page.innerText('#cov-conseq-warn')).includes('selected');
checks.covConseqOnlyMatching = await page.evaluate(() => {
  const ind = document.getElementById('cov-ind').value;
  return COVER.conseq.every(k => COVER.CONSEQ.find(c => c.k === k).ind.includes(ind));
});
await page.fill('#cov-conseq-own', 'A1c has risen 0.8 points over four months despite adherence.');
const withCq = await page.innerText('#cov-out');
checks.covConseqInLetter = withCq.includes('WHAT UNTREATED DISEASE COSTS')
  && withCq.includes('A1c has risen 0.8 points')
  && withCq.indexOf('WHAT UNTREATED DISEASE COSTS') < withCq.indexOf('MEDICAL NECESSITY');
// the section states natural history, never an outcome claim for the drug
checks.covConseqNoDrugClaim = await page.evaluate(() =>
  !/\b(prevents?|reduces? the risk of|shown to (?:prevent|reduce)|proven to)\b/i
    .test(COVER.CONSEQ.map(c => c.t).join(' ')));
await page.click('#cov-kind .chip >> nth=2');
checks.covConseqInP2P = (await page.innerText('#cov-out')).includes('WHAT UNTREATED DISEASE COSTS');
checks.covZ68Complete = await page.evaluate(() => {
  const shipped = new Set();
  (DATA.codes||[]).forEach(g => g.items.forEach(i => { if (/^Z68\./.test(i.code)) shipped.add(i.code); }));
  // every code COVER.z68() can return has to be addable from the picker
  const reachable = [];
  for (let bmi = 20; bmi < 80; bmi += 0.5) reachable.push(COVER.z68(bmi));
  return [...new Set(reachable)].every(c => shipped.has(c));
});
await page.click('#cov-kind .chip >> nth=0');

// --- tab 6 Protect ---
await page.click('nav.tabs button[data-tab="protect"]');
checks.prLevels  = (await page.$$('#pr-level .chip')).length === 3;
checks.prFall    = (await page.$$('#pr-fall .chip')).length === 12;
checks.prEvidence= (await page.$$('#pr-ev .comp-section')).length === 6;
checks.prPillars = (await page.$$('#pr-pillars .chip')).length === 6;
// protein: Devine IBW then adjusted body weight, verified against hand arithmetic
await page.selectOption('#pr-sex','f');
await page.fill('#pr-ht','65'); await page.fill('#pr-wt','232');
const prot = await page.evaluate(() => PROTECT.bodyWeights());
const ibw = 45.5 + 2.3*5, kg = 232/2.20462, abw = ibw + 0.4*(kg - ibw);
checks.prIBW = Math.abs(prot.ibw - ibw) < 0.01 && Math.abs(prot.abw - abw) < 0.01 && prot.over === true;
const ptxt = await page.innerText('#pr-protein-out');
checks.prProteinOut = ptxt.includes('Adjusted body weight') && /\d+ g of protein a day/.test(ptxt);
// below ideal weight there is nothing to adjust, and the output must say so
await page.fill('#pr-wt','100');
const low = await page.evaluate(() => PROTECT.bodyWeights());
checks.prNoAdjustLow = low.over === false && Math.abs(low.abw - low.kg) < 0.01
  && (await page.innerText('#pr-protein-out')).includes('no adjustment is applied');
await page.fill('#pr-wt','232');
// training prescription changes with level, and prints bilingually
const rx1 = await page.innerText('#pr-rx');
await page.click('#pr-level .chip >> nth=2');
checks.prRxChanges = (await page.innerText('#pr-rx')) !== rx1;
await page.click('#pr-level .chip >> nth=0');
// falls: a prior fall alone escalates to the red block
await page.click('#pr-fall .chip >> nth=1');
checks.prFallRed = (await page.$$('#pr-fall-out .redflag')).length === 1;
// calcium arithmetic and the vitamin D bands
await page.fill('#pr-dairy','1'); await page.fill('#pr-vitd','16');
const cad = await page.innerText('#pr-cad-out');
checks.prCalcium = cad.includes('300 mg from food') && cad.includes('below the intake')
  && cad.includes('deficient');
await page.fill('#pr-vitd','34');
checks.prVitDOk = (await page.innerText('#pr-cad-out')).includes('sufficient range');
// the plan builder holds its limits and goes bilingual
await page.click('#pr-pillars .chip >> nth=0');
await page.click('#pr-pillars .chip >> nth=1');
await page.click('#pr-pillars .chip >> nth=2');
checks.prPillarCap = await page.evaluate(() => PROTECT.pillars.length === 2);
const goalChips = await page.$$('#pr-goals .chip');
for (let i = 0; i < 4 && i < goalChips.length; i++) await goalChips[i].click();
checks.prGoalCap = await page.evaluate(() => PROTECT.goals.length === 3);
await page.click('#pr-lang .chip >> nth=1');
checks.prSpanish = await page.evaluate(() => {
  const t = PROTECT.planText('es');
  return t.includes('POR QUÉ ESTO IMPORTA') && t.includes('MI META DE PROTEÍNA') && t.includes('CUÁNDO LLAMARNOS');
});
checks.prEnglish = await page.evaluate(() => PROTECT.planText('en').includes('MY PROTEIN TARGET'));
// every ported goal carries both languages
checks.prBilingualGoals = await page.evaluate(() =>
  PROTECT_DATA.PILLARS.every(p => p.goals.every(g => g.en && g.es && g.en !== g.es)));
await page.click('#pr-lang .chip >> nth=0');
// stopping plan
await page.selectOption('#pr-stopwhy','cost, or coverage has ended');
const stop = await page.innerText('#pr-stop-out');
checks.prStop = stop.includes('WHAT CARRIES OVER') && stop.includes('Manufacturer savings')
  && stop.includes('not as a personal failure');
// the Spanish printables must be Spanish throughout, not Spanish headings
// wrapped around English body text
checks.prRxBilingual = await page.evaluate(() =>
  PROTECT_DATA.LEVELS.every(l =>
    l.daysEs && l.progEs && l.careEs &&
    Array.isArray(l.workEs) && l.workEs.length === l.work.length &&
    l.daysEs !== l.days && l.progEs !== l.prog));
checks.prRxEsPrints = await page.evaluate(() => {
  const out = []; const orig = App.printSheet;
  App.printSheet = (t, body) => out.push(body);
  PROTECT_DATA.LEVELS.forEach(l => { PROTECT.level = l.k; PROTECT.printRx('es'); });
  PROTECT.printStop('es'); App.printSheet = orig; PROTECT.level = 'none';
  const all = out.join('\n');
  // any of these surfacing in a Spanish sheet means an untranslated field leaked
  return !/(sets? of|times a week|repetitions|Soreness|feels easy|dumbbell|push-ups|minutes\b)/i.test(all);
});

console.log('load: ' + loadMs + ' ms   size: ' + (await page.evaluate(()=>document.documentElement.outerHTML.length)/1024).toFixed(1) + ' KB DOM');
console.log('');
for (const [a,b,c] of rows) console.log('  ' + a.padEnd(10) + b.padEnd(10) + c);
console.log('');
for (const [k,v] of Object.entries(checks)) console.log('  ' + k.padEnd(16) + (v ? 'pass' : 'FAIL'));
console.log('');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console or page errors');
await browser.close();
process.exit(errs.length || rows.some(r=>r[1].startsWith('FAIL')) || Object.values(checks).some(v=>!v) ? 1 : 0);
