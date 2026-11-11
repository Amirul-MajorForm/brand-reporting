// Browser check against the fake TMR server: node tests/e2e.js [outDir]
// Needs the frontend built (npm run build). Uses the pre-installed Playwright.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { startStack, PASSWORD } from './helpers.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] || 'tests/screenshots';
mkdirSync(out, { recursive: true });

const FORBIDDEN = /MajorView|MajorPace|FOREX|Two Minute|TMR|Opti Notes|LOW SPEND|October ICD|Sales Lens|hidden|not counted|Yoga|Blackmores/i;
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

const stack = await startStack();
const browser = await chromium.launch();
try {
  for (const width of [1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push(e.message));

    await page.goto(stack.base);
    await page.getByLabel('Password').waitFor();
    check(!(await page.content()).match(/campaign/i), `${width}: logged-out page shows no campaign data`);
    await page.screenshot({ path: `${out}/login-${width}.png` });

    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').waitFor();
    check((await page.getByRole('alert').innerText()).includes('Incorrect password'), `${width}: wrong password shows an error`);

    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('Goal Tracking').waitFor();
    await page.getByText('Barista-Series', { exact: false }).first().waitFor();
    await page.getByText(/on track/).waitFor();
    await page.waitForTimeout(400);
    let text = await page.innerText('body');
    check(text.includes('OATSIDE') && text.includes('Prepared by MajorForm'), `${width}: OATSIDE branding and "Prepared by MajorForm"`);
    check(!FORBIDDEN.test(text), `${width}: Brand Lens shows no internal wording (${(text.match(FORBIDDEN) || [''])[0]})`);
    check(/CPLV/i.test(text) && /ThruPlay/i.test(text) && /CPTP/i.test(text), `${width}: Brand Lens columns present`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(!overflow, `${width}: no horizontal page scroll`);
    const tableScroll = await page.evaluate(() => [...document.querySelectorAll('table')].some(t => t.parentElement.scrollWidth > t.parentElement.clientWidth + 1));
    check(!tableScroll, `${width}: Brand tables fit without inner scrolling`);
    await page.screenshot({ path: `${out}/brand-${width}.png`, fullPage: false });

    // Trend chart
    await page.getByRole('button', { name: /View daily trend/ }).first().click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').locator('svg[role="img"]').waitFor();
    check(!FORBIDDEN.test(await page.getByRole('dialog').innerText()), `${width}: trend panel has no internal wording`);
    await page.screenshot({ path: `${out}/trend-${width}.png` });
    await page.keyboard.press('Escape');

    // Market switch
    await page.getByRole('button', { name: 'MY', exact: true }).click();
    await page.getByText('OATSIDE MY').first().waitFor();
    check((await page.innerText('body')).includes('MYR'), `${width}: MY shows MYR for Meta`);

    // Commerce Lens
    await page.getByRole('button', { name: 'SG', exact: true }).click();
    await page.getByRole('button', { name: 'Commerce Lens' }).click();
    await page.getByText('Commerce by month').waitFor();
    await page.getByText('Meta CPAS', { exact: true }).first().waitFor();
    await page.getByText(/Total · \d+ campaign/).first().waitFor();
    await page.getByRole('button', { name: 'All platforms' }).waitFor();
    await page.waitForTimeout(400);
    text = await page.innerText('body');
    check(!FORBIDDEN.test(text), `${width}: Commerce Lens shows no internal wording (${(text.match(FORBIDDEN) || [''])[0]})`);
    check(/ROAS/i.test(text) && /Revenue/i.test(text), `${width}: Commerce columns present`);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)), `${width}: no horizontal page scroll on Commerce`);
    await page.screenshot({ path: `${out}/commerce-${width}.png` });

    // Dark mode then sign out
    await page.getByRole('button', { name: 'Dark mode' }).click();
    await page.screenshot({ path: `${out}/commerce-dark-${width}.png` });
    await page.getByRole('button', { name: 'Light mode' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Password').waitFor();
    await page.reload();
    await page.getByLabel('Password').waitFor();
    check(true, `${width}: sign out returns to the login screen and stays there after reload`);
    check(consoleErrors.filter(e => !/401/.test(e)).length === 0, `${width}: no console errors ${consoleErrors.join(' | ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  await stack.stop();
}
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nAll browser checks passed');
