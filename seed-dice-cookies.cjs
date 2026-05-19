'use strict';
/**
 * One-time helper: exports Dice.com cookies from the existing Chrome profile
 * to ~/.cache/hermes-dice-cookies.json for Stagehand/Browserbase reuse.
 *
 * Run once: node seed-dice-cookies.cjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer');

const CHROME_PROFILE = process.env.CHROME_PROFILE || path.join(os.homedir(), '.cache/hermes-dice-chrome');
const COOKIE_FILE = path.join(os.homedir(), '.cache/hermes-dice-cookies.json');
const CHROME = process.env.CHROME || puppeteer.executablePath();

async function main() {
  console.log('Launching Chrome with existing Dice profile...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME,
    userDataDir: CHROME_PROFILE,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.goto('https://www.dice.com/home-feed', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const cookies = await page.cookies('https://www.dice.com');
  const sessionCookie = cookies.find(c => c.name === 'DCSID' || c.name === 'dice_session' || c.name === 'auth' || c.name.toLowerCase().includes('session'));
  const text = await page.evaluate(() => document.body.innerText.slice(0, 200));
  const loggedIn = /Anthony Ettinger|Profile Visibility|Your Profile|My Jobs|Recommended Jobs/i.test(text);

  if (!loggedIn) {
    console.error('Dice session not active in Chrome profile. Log in manually first:');
    console.error('  HEADLESS=false node dice_easy_apply_daily.cjs');
    await browser.close();
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log(`Saved ${cookies.length} Dice cookies to ${COOKIE_FILE}`);
  if (sessionCookie) console.log(`  Found session cookie: ${sessionCookie.name}`);
  await browser.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
