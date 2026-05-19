'use strict';

const path = require('path');
const fs = require('fs');

const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || '6323d706-92e1-453d-b591-9ceffa0fbdfd';
const STAGEHAND_MODEL = process.env.STAGEHAND_MODEL || 'claude-sonnet-4-5-20251001';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function loadStagehand() {
  const { Stagehand } = require('@browserbasehq/stagehand');
  return Stagehand;
}

async function loadZod() {
  const { z } = require('zod');
  return z;
}

function buildStagehandOpts() {
  const useCloud = Boolean(BROWSERBASE_API_KEY);
  const opts = {
    env: useCloud ? 'BROWSERBASE' : 'LOCAL',
    modelName: STAGEHAND_MODEL,
    modelClientOptions: { apiKey: process.env.ANTHROPIC_API_KEY },
    verbose: process.env.STAGEHAND_VERBOSE === '1' ? 1 : 0,
    headless: useCloud ? undefined : true,
  };
  if (useCloud) {
    opts.apiKey = BROWSERBASE_API_KEY;
    opts.projectId = BROWSERBASE_PROJECT_ID;
  }
  return opts;
}

async function actSafe(page, action, opts = {}) {
  try {
    await page.act({ action, ...opts });
    return true;
  } catch {
    return false;
  }
}

async function extractSafe(page, instruction, schema) {
  try {
    return await page.extract({ instruction, schema });
  } catch {
    return null;
  }
}

async function fillField(page, z, description, value) {
  if (!value) return false;
  return actSafe(page, `fill in the ${description} field with "${value}"`);
}

async function fillProfile(page, z, profile) {
  const p = profile;
  await fillField(page, z, 'first name', p.firstName);
  await fillField(page, z, 'last name', p.lastName);
  if (p.name && !p.firstName) await fillField(page, z, 'full name', p.name);
  await fillField(page, z, 'email address', p.email);
  await fillField(page, z, 'phone number', p.phone);
  await fillField(page, z, 'location or city', p.location);
  await fillField(page, z, 'LinkedIn profile URL', p.linkedin);
  await fillField(page, z, 'GitHub profile URL', p.github);
  await fillField(page, z, 'website or portfolio URL', p.website);
}

async function fillWorkAuth(page, z, workAuth, requiresSponsorship) {
  if (!workAuth) return;
  await actSafe(page, `select or fill in work authorization status with "${workAuth}"`);
  if (requiresSponsorship !== undefined) {
    const sponsorText = requiresSponsorship ? 'Yes' : 'No';
    await actSafe(page, `answer the visa sponsorship question with "${sponsorText}"`);
  }
}

async function fillCoverLetter(page, z, coverLetter) {
  if (!coverLetter) return;
  await actSafe(page, `fill in the cover letter or additional information text area with the following text: "${coverLetter.slice(0, 500)}"`);
}

async function uploadResume(page, resumePath, coverPdfPath, photoPath) {
  if (resumePath && fs.existsSync(resumePath)) {
    await actSafe(page, `upload the resume file at path ${resumePath}`);
  }
  if (coverPdfPath && fs.existsSync(coverPdfPath)) {
    await actSafe(page, `upload the cover letter file at path ${coverPdfPath} if there is a cover letter upload field`);
  }
  if (photoPath && fs.existsSync(photoPath)) {
    await actSafe(page, `upload the photo file at path ${photoPath} if there is a photo or profile picture upload field`);
  }
}

async function clickInitialApply(page) {
  return actSafe(page, 'click the "Apply", "Apply Now", or "Apply for this Job" button if one is visible on the page');
}

async function fillKnownScreeningQuestions(page, z, payload) {
  const p = payload.profile || {};
  // Common yes/no screening questions
  await actSafe(page, 'for any question asking if you are legally authorized to work in the United States, answer "Yes"');
  await actSafe(page, 'for any question asking if you require visa sponsorship now or in the future, answer based on your work authorization status');
  if (p.requiresSponsorship !== undefined) {
    const ans = p.requiresSponsorship ? 'Yes' : 'No';
    await actSafe(page, `answer any sponsorship question with "${ans}"`);
  }
  // Salary
  if (payload.salary) {
    await actSafe(page, `fill in any salary expectation field with "${payload.salary}"`);
  }
  // Remote preference
  await actSafe(page, 'for any question about remote work preference or availability, indicate preference for remote work');
}

async function detectSubmissionSuccess(page, z) {
  const result = await extractSafe(page, 'determine if the application was successfully submitted', z.object({
    success: z.boolean(),
    message: z.string().optional(),
  }));
  return result?.success === true;
}

async function stagehandBrowserApply({ job, payload, opts = {} }) {
  const Stagehand = await loadStagehand();
  const z = await loadZod();

  if (!fs.existsSync(payload.resumePath)) {
    return { status: 'needs-human-review', reason: `resume-missing:${payload.resumePath}` };
  }

  const stagehand = new Stagehand(buildStagehandOpts());

  try {
    await stagehand.init();
    const page = stagehand.page;

    await page.goto(payload.url, { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // Try to click the initial apply button (job listing pages link to the actual form)
    await clickInitialApply(page);
    await sleep(2000);
    await clickInitialApply(page); // second pass for multi-step redirects

    await sleep(1500);

    // Extract employer name from page for cover letter personalization
    const employerInfo = await extractSafe(page, 'find the company or employer name on this page', z.object({
      employer: z.string().optional(),
    }));
    if (employerInfo?.employer) {
      console.error(`[stagehand] employer detected: ${employerInfo.employer}`);
    }

    // Fill core profile fields
    await fillProfile(page, z, payload.profile);
    await sleep(500);

    // Fill work authorization
    await fillWorkAuth(page, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);

    // Fill screening questions
    await fillKnownScreeningQuestions(page, z, payload);

    // Upload documents
    await uploadResume(page, payload.resumePath, payload.coverPdfPath, payload.photoPath);
    await sleep(3000);

    // Fill cover letter text area
    await fillCoverLetter(page, z, payload.coverLetter);

    // Second pass on profile fields (for multi-page forms)
    await fillProfile(page, z, payload.profile);
    await fillWorkAuth(page, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);

    // Check for blockers before submitting
    const blockerCheck = await extractSafe(page, 'check if there are any captcha challenges, error messages, or login walls blocking the application form', z.object({
      hasCaptcha: z.boolean(),
      hasLoginWall: z.boolean(),
      hasError: z.boolean(),
      details: z.string().optional(),
    }));

    if (blockerCheck?.hasCaptcha) {
      return { status: 'needs-human-review', reason: 'captcha-unsolved' };
    }
    if (blockerCheck?.hasLoginWall) {
      return { status: 'needs-human-review', reason: 'login-wall' };
    }

    if (opts.submit !== true) {
      return { status: 'prepared', reason: 'submit-not-requested' };
    }

    // Multi-step submit loop
    const maxSteps = payload.ats === 'workday' ? 12 : 8;
    let clickedSubmit = false;

    for (let i = 0; i < maxSteps; i++) {
      const beforeUrl = page.url();

      // Try to submit
      const submitted = await actSafe(page, 'click the "Submit Application", "Submit", or "Apply" button to submit the application form');

      if (submitted) {
        clickedSubmit = true;
        await sleep(4000);

        // Check if there's a "Next" step or if we succeeded
        const pageState = await extractSafe(page, 'determine the current state: did the application succeed, is there a next step, or is there an error', z.object({
          succeeded: z.boolean(),
          hasNextStep: z.boolean(),
          hasError: z.boolean(),
          errorMessage: z.string().optional(),
        }));

        if (pageState?.succeeded) {
          return { status: 'submitted', reason: 'submission-verified' };
        }

        if (pageState?.hasError) {
          // Refill any fields that caused errors
          await fillProfile(page, z, payload.profile);
          await fillWorkAuth(page, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);
          await fillKnownScreeningQuestions(page, z, payload);
          continue;
        }

        if (pageState?.hasNextStep || page.url() === beforeUrl) {
          // Multi-page form - fill new fields and continue
          await fillProfile(page, z, payload.profile);
          await fillWorkAuth(page, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);
          await fillKnownScreeningQuestions(page, z, payload);
          await uploadResume(page, payload.resumePath, payload.coverPdfPath, payload.photoPath);
          await sleep(2000);
          continue;
        }

        // URL changed - likely succeeded or moved to next page
        const success = await detectSubmissionSuccess(page, z);
        if (success) return { status: 'submitted', reason: 'submission-verified' };
      } else {
        // No submit button found - try "Next" or "Continue"
        const progressed = await actSafe(page, 'click the "Next", "Continue", or "Next Step" button to proceed to the next page of the application');
        if (!progressed) break;

        await sleep(2000);
        await fillProfile(page, z, payload.profile);
        await fillWorkAuth(page, z, payload.profile?.workAuth, payload.profile?.requiresSponsorship);
        await fillKnownScreeningQuestions(page, z, payload);
        await uploadResume(page, payload.resumePath, payload.coverPdfPath, payload.photoPath);
      }
    }

    if (!clickedSubmit) {
      return { status: 'needs-human-review', reason: 'submit-button-not-found' };
    }

    const finalSuccess = await detectSubmissionSuccess(page, z);
    if (finalSuccess) return { status: 'submitted', reason: 'submission-verified' };

    return { status: 'needs-human-review', reason: 'submission-unverified' };

  } finally {
    await stagehand.close().catch(() => {});
  }
}

module.exports = { stagehandBrowserApply };
