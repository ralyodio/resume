'use strict';
/**
 * One-time helper: launches Puppeteer with the existing LinkedIn Chrome profile,
 * extracts all linkedin.com cookies (including the encrypted li_at), and saves
 * them to ~/.cache/hermes-linkedin-cookies.json for Stagehand/Browserbase reuse.
 *
 * Run once: node seed-linkedin-cookies.cjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer');

const CHROME_PROFILE = process.env.CHROME_PROFILE || path.join(os.homedir(), '.cache/hermes-linkedin-chrome');
const COOKIE_FILE = path.join(os.homedir(), '.cache/hermes-linkedin-cookies.json');
const CHROME = process.env.CHROME || puppeteer.executablePath();

async function main() {
  console.log('Launching Chrome with existing LinkedIn profile...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME,
    userDataDir: CHROME_PROFILE,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const cookies = await page.cookies('https://www.linkedin.com');
  const liAt = cookies.find(c => c.name === 'li_at');

  if (!liAt) {
    console.error('li_at cookie not found — LinkedIn session may be expired. Log in manually first:');
    console.error(`  HEADLESS=false node linkedin_easy_apply_daily.cjs`);
    await browser.close();
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log(`Saved ${cookies.length} cookies (including li_at) to ${COOKIE_FILE}`);
  await browser.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
