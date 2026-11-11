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

// Stand-in image / video for the Meta and TikTok CDNs (unreachable from tests)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+v9/PQAJjgOs1gEe9gAAAABJRU5ErkJggg==', 'base64');
async function stubCdns(page) {
  await page.route(/https:\/\/[^/]*(fbcdn\.net|tiktokcdn\.com)\//, route => {
    const url = route.request().url();
    if (/\.mp4|video/.test(url) && !/image|\.jpg/.test(url)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
}

const stack = await startStack();
const browser = await chromium.launch();
try {
  for (const width of [1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await stubCdns(page);
    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push(e.message));

    await page.goto(stack.base);
    await page.getByLabel('Password').waitFor();
    check(await page.locator('.os-splash').count() === 0, `${width}: loading screen gone once the login form shows`);
    check(!(await page.content()).match(/campaign/i), `${width}: logged-out page shows no campaign data`);
    await page.screenshot({ path: `${out}/login-${width}.png` });

    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').waitFor();
    check((await page.getByRole('alert').innerText()).includes('Incorrect password'), `${width}: wrong password shows an error`);

    await page.getByLabel('Password').fill(PASSWORD);
    await stack.setDelay(width === 1280 ? 1500 : 5); // first run: slow data, to see the loading screen
    await page.getByRole('button', { name: 'Sign in' }).click();
    if (width === 1280) {
      await page.getByTestId('splash').waitFor({ timeout: 3000 });
      const fills = [];
      for (const ms of [300, 900, 1500]) {
        await page.waitForTimeout(ms - (fills.length ? [300, 900, 1500][fills.length - 1] : 0));
        fills.push(await page.locator('.os-logo-fill').evaluate(el => el.offsetTop));
        await page.screenshot({ path: `${out}/splash-${width}-${fills.length}.png` });
      }
      check(new Set(fills).size > 1, `${width}: loading logo animates (fill offsets ${fills.join(', ')})`);
      check(/Loading your dashboard/.test(await page.getByTestId('splash').innerText()), `${width}: loading screen message`);
    }
    await page.getByTestId('splash').waitFor({ state: 'detached', timeout: 25000 });
    check(true, `${width}: loading screen fades out after sign-in`);
    await stack.setDelay(5);
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

    // Top ads (Meta Barista-Series campaign)
    await page.getByRole('button', { name: 'View daily trend for SG_Meta_OATSIDE_Awareness_CPM_Reach_2026_Barista-Series' }).click();
    await page.getByRole('tab', { name: 'Top ads' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('#1').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].some(i => i.complete && i.naturalWidth > 0));
    const cards = await dialog.getByText(/^#\d$/).count();
    check(cards === 3, `${width}: Top ads shows 3 Meta ads (${cards})`);
    check(await dialog.getByText('Lock In with OATSIDE Espresso Roast').count() >= 1, `${width}: Top ads shows the ad headline`);
    check(await dialog.getByText('Preview not available').count() === 1, `${width}: ad without a safe preview shows a placeholder`);
    check(await dialog.locator('a[href*="evil"], img[src*="evil"]').count() === 0, `${width}: no non-CDN links rendered`);
    const ext = await dialog.getByRole('link', { name: /View ad as it appears/ }).first().getAttribute('rel');
    check(/noopener/.test(ext) && /noreferrer/.test(ext), `${width}: preview links open safely`);
    check(!FORBIDDEN.test(await dialog.innerText()), `${width}: Top ads has no internal wording`);
    await page.screenshot({ path: `${out}/top-ads-${width}.png` });
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
    await page.waitForTimeout(500); // let the colour transition finish
    const headerBg = await page.evaluate(() => getComputedStyle(document.querySelector('header')).backgroundColor);
    check(headerBg !== 'rgb(255, 255, 255)', `${width}: dark mode header is dark (${headerBg})`);
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
