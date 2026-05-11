const puppeteer = require('puppeteer');
const os = require('os');
const path = require('path');

const searches = ['react next', 'react next.js', 'next.js react', 'frontend react next', 'full stack react next'];
const CHROME = process.env.CHROME || require('puppeteer').executablePath();
const USER_DATA_DIR = process.env.CHROME_PROFILE || path.join(os.homedir(), '.cache/hermes-linkedin-chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS === '1',
    executablePath: CHROME,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--start-maximized'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto('https://www.linkedin.com/feed/', {waitUntil:'domcontentloaded', timeout:60000});
    await sleep(2500);
    const feedText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
    if (/sign in|join now|email or phone|checkpoint|security verification|verify your identity/i.test(feedText) && !/start a post|feed/i.test(feedText)) {
      console.log('LOGIN_OR_CHECKPOINT_BLOCKED');
      console.log(feedText.replace(/\s+/g,' ').slice(0,500));
      return;
    }
    for (const keywords of searches) {
      const url = new URL('https://www.linkedin.com/jobs/search/');
      url.searchParams.set('keywords', keywords);
      url.searchParams.set('location', 'United States');
      url.searchParams.set('f_AL', 'true');
      url.searchParams.set('f_WT', '2');
      url.searchParams.set('sortBy', 'DD');
      await page.goto(url.toString(), {waitUntil:'domcontentloaded', timeout:60000});
      await sleep(3500);
      for (let i=0; i<6; i++) { await page.evaluate(() => window.scrollBy(0, window.innerHeight)); await sleep(800); }
      const data = await page.evaluate(() => {
        const body = document.body.innerText || '';
        const cards = Array.from(document.querySelectorAll('li, .job-card-container, .jobs-search-results__list-item'));
        const jobs = cards.map(card => {
          const a = card.querySelector('a[href*="/jobs/view/"]');
          if (!a) return null;
          const href = new URL(a.href, location.origin).href;
          const id = (href.match(/\/jobs\/view\/(\d+)/)||href.match(/currentJobId=(\d+)/)||[])[1];
          const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
          const title = (a.innerText || text.split(' · ')[0] || '').replace(/\s+/g, ' ').trim();
          return {id, title, href, easy:/easy apply/i.test(text), remote:/remote/i.test(text), text:text.slice(0,220)};
        }).filter(Boolean);
        const uniq = [];
        const seen = new Set();
        for (const j of jobs) { if (j.id && !seen.has(j.id)) { seen.add(j.id); uniq.push(j); } }
        return {bodyHead: body.replace(/\s+/g,' ').slice(0,700), count: uniq.length, easy: uniq.filter(j=>j.easy).length, remote: uniq.filter(j=>j.remote).length, both: uniq.filter(j=>j.easy&&j.remote).length, jobs: uniq.slice(0,12)};
      });
      console.log('\nSEARCH:', keywords);
      console.log(`cards=${data.count} easy=${data.easy} remote=${data.remote} easy+remote=${data.both}`);
      if (data.count === 0) console.log('page:', data.bodyHead);
      for (const j of data.jobs.filter(j=>j.easy || j.remote).slice(0,8)) {
        console.log(`- ${j.title} | easy=${j.easy} remote=${j.remote} | ${j.href}`);
      }
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e.stack || e.message || String(e)); process.exit(1); });
