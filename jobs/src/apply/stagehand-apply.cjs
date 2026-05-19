'use strict';

const path = require('path');
const fs = require('fs');

const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || '6323d706-92e1-453d-b591-9ceffa0fbdfd';
const STAGEHAND_MODEL = process.env.STAGEHAND_MODEL || 'claude-sonnet-4-5-20251001';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ACT_TIMEOUT_MS = Number(process.env.STAGEHAND_ACT_TIMEOUT_MS || 45000);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);
}

function buildStagehandOpts() {
  const useCloud = Boolean(process.env.BROWSERBASE_API_KEY);
  const opts = {
    env: useCloud ? 'BROWSERBASE' : 'LOCAL',
    modelName: STAGEHAND_MODEL,
    modelClientOptions: { apiKey: process.env.ANTHROPIC_API_KEY },
    verbose: process.env.STAGEHAND_VERBOSE === '1' ? 1 : 0,
  };
  if (useCloud) {
    opts.apiKey = process.env.BROWSERBASE_API_KEY;
    opts.projectId = BROWSERBASE_PROJECT_ID;
  } else {
    opts.localBrowserLaunchOptions = { headless: true };
  }
  return opts;
}

async function actSafe(stagehand, action) {
  try {
    await withTimeout(stagehand.act(action), ACT_TIMEOUT_MS, action.slice(0, 40));
    return true;
  } catch {
    return false;
  }
}

async function extractSafe(stagehand, instruction, schema) {
  try {
    return await withTimeout(stagehand.extract(instruction, schema), ACT_TIMEOUT_MS, instruction.slice(0, 40));
  } catch {
    return null;
  }
}

async function fillProfile(stagehand, z, profile) {
  const p = profile;
  if (p.firstName) await actSafe(stagehand, `fill in the first name field with "${p.firstName}"`);
  if (p.lastName) await actSafe(stagehand, `fill in the last name field with "${p.lastName}"`);
  if (p.name && !p.firstName) await actSafe(stagehand, `fill in the full name field with "${p.name}"`);
  if (p.email) await actSafe(stagehand, `fill in the email address field with "${p.email}"`);
  if (p.phone) await actSafe(stagehand, `fill in the phone number field with "${p.phone}"`);
  if (p.location) await actSafe(stagehand, `fill in the location or city field with "${p.location}"`);
  if (p.linkedin) await actSafe(stagehand, `fill in the LinkedIn profile URL field with "${p.linkedin}"`);
  if (p.github) await actSafe(stagehand, `fill in the GitHub profile URL field with "${p.github}"`);
  if (p.website) await actSafe(stagehand, `fill in the website or portfolio URL field with "${p.website}"`);
}

async function fillWorkAuth(stagehand, z, workAuth, requiresSponsorship) {
  if (!workAuth) return;
  await actSafe(stagehand, `select or fill in work authorization status with "${workAuth}"`);
  if (requiresSponsorship !== undefined) {
    const sponsorText = requiresSponsorship ? 'Yes' : 'No';
    await actSafe(stagehand, `answer the visa sponsorship question with "${sponsorText}"`);
  }
}

async function fillScreeningQuestions(stagehand, z, payload) {
  const p = payload.profile || {};
  await actSafe(stagehand, 'for any question asking if you are legally authorized to work in the United States, answer "Yes"');
  if (p.requiresSponsorship !== undefined) {
    const ans = p.requiresSponsorship ? 'Yes' : 'No';
    await actSafe(stagehand, `answer any question about visa sponsorship with "${ans}"`);
  }
  if (payload.salary) {
    await actSafe(stagehand, `fill in any salary expectation field with "${payload.salary}"`);
  }
}

async function uploadDocuments(stagehand, resumePath, coverPdfPath, photoPath) {
  if (resumePath && fs.existsSync(resumePath)) {
    await actSafe(stagehand, `upload the resume file located at ${resumePath}`);
  }
  if (coverPdfPath && fs.existsSync(coverPdfPath)) {
    await actSafe(stagehand, `upload the cover letter file at ${coverPdfPath} if a cover letter upload field exists`);
  }
  if (photoPath && fs.existsSync(photoPath)) {
    await actSafe(stagehand, `upload the photo file at ${photoPath} if a photo or profile picture upload field exists`);
  }
}

async function stagehandBrowserApply({ job, payload, opts = {} }) {
  const { Stagehand } = require('@browserbasehq/stagehand');
  const { z } = require('zod');

  if (!fs.existsSync(payload.resumePath)) {
    return { status: 'needs-human-review', reason: `resume-missing:${payload.resumePath}` };
  }

  const stagehand = new Stagehand(buildStagehandOpts());

  try {
    await stagehand.init();

    // v3 API: get page from context
    const page = stagehand.context.pages()[0];
    if (!page) {
      return { status: 'needs-human-review', reason: 'stagehand-no-page' };
    }

    await page.goto(payload.url, { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // Resolve aggregator listing → actual ATS form by extracting the Apply href
    // (clicking opens a new tab which Stagehand doesn't follow)
    const startHostname = new URL(payload.url).hostname;
    const externalApplyHref = await page.evaluate((startHost) => {
      const candidates = Array.from(document.querySelectorAll('a[href]'));
      const applyLink = candidates.find(a => {
        const text = (a.innerText || a.getAttribute('aria-label') || '').trim();
        if (!/^(apply|apply now|apply for this job|apply for job|easy apply|apply here)$/i.test(text)) return false;
        try { return new URL(a.href).hostname !== startHost; } catch { return false; }
      });
      return applyLink ? applyLink.href : null;
    }, startHostname).catch(() => null);

    if (externalApplyHref) {
      await page.goto(externalApplyHref, { waitUntil: 'domcontentloaded' });
      await sleep(2500);
    } else {
      // Fallback: click the Apply button and capture any new tab it opens
      const pageCountBefore = stagehand.context.pages().length;
      await actSafe(stagehand, 'click the "Apply", "Apply Now", or "Apply for this Job" button if one is visible');
      await sleep(2000);
      const pagesAfter = stagehand.context.pages();
      if (pagesAfter.length > pageCountBefore) {
        // New tab opened — grab its URL, close it, navigate current tab there
        const newTab = pagesAfter[pagesAfter.length - 1];
        const newUrl = newTab.url();
        await newTab.close().catch(() => {});
        if (newUrl && newUrl !== 'about:blank') {
          await page.goto(newUrl, { waitUntil: 'domcontentloaded' });
          await sleep(2500);
        }
      }
    }

    const employerInfo = await extractSafe(stagehand, 'find the company or employer name on this page', z.object({
      employer: z.string().optional(),
    }));
    if (employerInfo?.employer) {
      console.error(`[stagehand] employer: ${employerInfo.employer}`);
    }

    // Fill profile fields
    await fillProfile(stagehand, z, payload.profile);
    await fillWorkAuth(stagehand, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);
    await fillScreeningQuestions(stagehand, z, payload);

    // Upload documents
    await uploadDocuments(stagehand, payload.resumePath, payload.coverPdfPath, payload.photoPath);
    await sleep(3000);

    // Fill cover letter
    if (payload.coverLetter) {
      await actSafe(stagehand, `fill in the cover letter or additional information text area with: "${payload.coverLetter.slice(0, 400)}"`);
    }

    // Second pass (multi-page forms)
    await fillProfile(stagehand, z, payload.profile);
    await fillWorkAuth(stagehand, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);

    // Check for blockers
    const blockerCheck = await extractSafe(stagehand, 'check if there is a captcha challenge, login wall, or error message blocking the form', z.object({
      hasCaptcha: z.boolean(),
      hasLoginWall: z.boolean(),
      hasError: z.boolean(),
      details: z.string().optional(),
    }));

    if (blockerCheck?.hasCaptcha) return { status: 'needs-human-review', reason: 'captcha-unsolved' };
    if (blockerCheck?.hasLoginWall) return { status: 'needs-human-review', reason: 'login-wall' };

    if (opts.submit !== true) {
      return { status: 'prepared', reason: 'submit-not-requested' };
    }

    // Multi-step submit loop
    const maxSteps = payload.ats === 'workday' ? 12 : 8;
    let clickedSubmit = false;

    for (let i = 0; i < maxSteps; i++) {
      const beforeUrl = page.url();

      const submitted = await actSafe(stagehand, 'click the final "Submit Application", "Submit", or "Apply" button to submit the form');

      if (submitted) {
        clickedSubmit = true;
        await sleep(4000);

        const pageState = await extractSafe(stagehand, 'what is the current state: did the application succeed, is there a next step/page, or is there a validation error', z.object({
          succeeded: z.boolean(),
          hasNextStep: z.boolean(),
          hasError: z.boolean(),
          errorMessage: z.string().optional(),
        }));

        if (pageState?.succeeded) return { status: 'submitted', reason: 'submission-verified' };

        if (pageState?.hasError) {
          await fillProfile(stagehand, z, payload.profile);
          await fillWorkAuth(stagehand, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);
          await fillScreeningQuestions(stagehand, z, payload);
          continue;
        }

        if (!pageState?.hasNextStep && page.url() !== beforeUrl) {
          // URL changed without explicit success — try to detect
          const success = await extractSafe(stagehand, 'was the job application successfully submitted? look for thank you messages or confirmation', z.object({ success: z.boolean() }));
          if (success?.success) return { status: 'submitted', reason: 'submission-verified' };
        }

        // Still on form — refill and continue
        await fillProfile(stagehand, z, payload.profile);
        await fillWorkAuth(stagehand, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);
        await fillScreeningQuestions(stagehand, z, payload);
        await uploadDocuments(stagehand, payload.resumePath, payload.coverPdfPath, payload.photoPath);
        await sleep(2000);

      } else {
        // No submit button — try Next/Continue
        const progressed = await actSafe(stagehand, 'click the "Next", "Continue", or "Next Step" button to proceed to the next page of the application');
        if (!progressed) break;

        await sleep(2000);
        await fillProfile(stagehand, z, payload.profile);
        await fillWorkAuth(stagehand, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);
        await fillScreeningQuestions(stagehand, z, payload);
        await uploadDocuments(stagehand, payload.resumePath, payload.coverPdfPath, payload.photoPath);
      }
    }

    if (!clickedSubmit) return { status: 'needs-human-review', reason: 'submit-button-not-found' };

    const finalSuccess = await extractSafe(stagehand, 'was the job application successfully submitted?', z.object({ success: z.boolean() }));
    if (finalSuccess?.success) return { status: 'submitted', reason: 'submission-verified' };

    return { status: 'needs-human-review', reason: 'submission-unverified' };

  } finally {
    await stagehand.close().catch(() => {});
  }
}

module.exports = { stagehandBrowserApply };
