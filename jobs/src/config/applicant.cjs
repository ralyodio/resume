'use strict';

const path = require('path');

const RESUME_ROOT = path.resolve(__dirname, '..', '..', '..');
const RESUME_CONFIG_PATH = process.env.HERMES_RESUME_CONFIG || path.join(RESUME_ROOT, 'resume.config.cjs');

const DEFAULT_APPLICANT = {
  name: 'Anthony Ettinger',
  email: '',
  phone: '',
  location: 'Los Gatos, CA, USA',
  city: 'Los Gatos',
  state: 'CA',
  postal: '95032',
  address: 'Los Gatos, CA',
  country: 'United States',
  school: 'San Diego State University',
  linkedin: '',
  github: '',
  website: '',
  photo: path.join(RESUME_ROOT, 'anthony.ettinger.photo.jpeg'),
  workAuth: 'US Citizen',
  authorizedToWorkInUS: true,
  requiresSponsorship: 'no',
  desiredSalary: '$350,000',
  hourlyRate: '$135/hour',
  aiYears: '5+ years',
  softwareYears: '20+ years',
  noticePeriod: 'Available immediately / 2 weeks',
  startDate: 'Immediately',
  gender: 'Male',
  race: 'White',
  veteran: 'No',
  disability: 'Prefer not to say',
  currentCompany: 'Independent Consultant',
  timeTrackerOk: 'Yes',
  aiCodingTools: 'Claude Code, Cursor, OpenAI Codex, GitHub Copilot, OpenAI, Anthropic APIs, Gemini',
};

function loadResumeConfig() {
  try {
    delete require.cache[require.resolve(RESUME_CONFIG_PATH)];
    return require(RESUME_CONFIG_PATH) || {};
  } catch {
    return {};
  }
}

function envFirst(keys) {
  for (const k of keys) if (process.env[k]) return process.env[k];
  return '';
}

function coalesce(...values) {
  for (const v of values) if (v !== undefined && v !== null && v !== '') return v;
  return '';
}

function applicantFromConfig() {
  const cfg = loadResumeConfig();
  return { ...DEFAULT_APPLICANT, ...(cfg.applicant || {}) };
}

function applicantProfile(overrides = {}) {
  const base = applicantFromConfig();
  const profile = {
    ...base,
    name: coalesce(overrides.name, envFirst(['HERMES_APPLICANT_NAME', 'APPLICANT_NAME']), base.name),
    email: coalesce(overrides.email, envFirst(['HERMES_APPLICANT_EMAIL', 'APPLICANT_EMAIL']), base.email),
    phone: coalesce(overrides.phone, envFirst(['HERMES_APPLICANT_PHONE', 'APPLICANT_PHONE']), base.phone),
    location: coalesce(overrides.location, envFirst(['HERMES_APPLICANT_LOCATION', 'APPLICANT_LOCATION']), base.location),
    city: coalesce(overrides.city, envFirst(['HERMES_APPLICANT_CITY', 'APPLICANT_CITY']), base.city),
    state: coalesce(overrides.state, envFirst(['HERMES_APPLICANT_STATE', 'APPLICANT_STATE']), base.state),
    postal: coalesce(overrides.postal, envFirst(['HERMES_APPLICANT_POSTAL', 'HERMES_APPLICANT_ZIP', 'APPLICANT_POSTAL', 'APPLICANT_ZIP']), base.postal),
    address: coalesce(overrides.address, envFirst(['HERMES_APPLICANT_ADDRESS', 'APPLICANT_ADDRESS']), base.address),
    country: coalesce(overrides.country, envFirst(['HERMES_APPLICANT_COUNTRY', 'APPLICANT_COUNTRY']), base.country),
    school: coalesce(overrides.school, envFirst(['HERMES_APPLICANT_SCHOOL', 'APPLICANT_SCHOOL']), base.school),
    linkedin: coalesce(overrides.linkedin, envFirst(['HERMES_APPLICANT_LINKEDIN', 'APPLICANT_LINKEDIN']), base.linkedin),
    github: coalesce(overrides.github, envFirst(['HERMES_APPLICANT_GITHUB', 'APPLICANT_GITHUB']), base.github),
    website: coalesce(overrides.website, envFirst(['HERMES_APPLICANT_WEBSITE', 'APPLICANT_WEBSITE']), base.website),
    photo: coalesce(overrides.photo, envFirst(['HERMES_APPLICANT_PHOTO', 'APPLICANT_PHOTO', 'PHOTO_PATH']), base.photo),
    workAuth: coalesce(overrides.workAuth, envFirst(['HERMES_APPLICANT_WORK_AUTH', 'APPLICANT_WORK_AUTH']), base.workAuth),
    requiresSponsorship: coalesce(overrides.requiresSponsorship, envFirst(['HERMES_APPLICANT_REQUIRES_SPONSORSHIP', 'APPLICANT_REQUIRES_SPONSORSHIP']), base.requiresSponsorship),
    desiredSalary: coalesce(overrides.desiredSalary, envFirst(['HERMES_APPLICANT_DESIRED_SALARY', 'APPLICANT_DESIRED_SALARY']), base.desiredSalary),
    hourlyRate: coalesce(overrides.hourlyRate, envFirst(['HERMES_APPLICANT_HOURLY_RATE', 'APPLICANT_HOURLY_RATE']), base.hourlyRate),
    aiYears: coalesce(overrides.aiYears, envFirst(['HERMES_APPLICANT_AI_YEARS', 'APPLICANT_AI_YEARS']), base.aiYears),
    softwareYears: coalesce(overrides.softwareYears, envFirst(['HERMES_APPLICANT_SOFTWARE_YEARS', 'APPLICANT_SOFTWARE_YEARS']), base.softwareYears),
    noticePeriod: coalesce(overrides.noticePeriod, envFirst(['HERMES_APPLICANT_NOTICE_PERIOD', 'APPLICANT_NOTICE_PERIOD']), base.noticePeriod),
    startDate: coalesce(overrides.startDate, envFirst(['HERMES_APPLICANT_START_DATE', 'APPLICANT_START_DATE']), base.startDate),
    gender: coalesce(overrides.gender, envFirst(['HERMES_APPLICANT_GENDER', 'APPLICANT_GENDER']), base.gender),
    race: coalesce(overrides.race, envFirst(['HERMES_APPLICANT_RACE', 'APPLICANT_RACE']), base.race),
    veteran: coalesce(overrides.veteran, envFirst(['HERMES_APPLICANT_VETERAN', 'APPLICANT_VETERAN']), base.veteran),
    disability: coalesce(overrides.disability, envFirst(['HERMES_APPLICANT_DISABILITY', 'APPLICANT_DISABILITY']), base.disability),
    currentCompany: coalesce(overrides.currentCompany, envFirst(['HERMES_APPLICANT_CURRENT_COMPANY', 'APPLICANT_CURRENT_COMPANY']), base.currentCompany),
    timeTrackerOk: coalesce(overrides.timeTrackerOk, envFirst(['HERMES_APPLICANT_TIME_TRACKER_OK', 'APPLICANT_TIME_TRACKER_OK']), base.timeTrackerOk),
    aiCodingTools: coalesce(overrides.aiCodingTools, envFirst(['HERMES_APPLICANT_AI_CODING_TOOLS', 'APPLICANT_AI_CODING_TOOLS']), base.aiCodingTools),
  };
  const [firstName, ...rest] = String(profile.name || '').split(/\s+/).filter(Boolean);
  profile.firstName = coalesce(overrides.firstName, envFirst(['HERMES_APPLICANT_FIRST_NAME', 'APPLICANT_FIRST_NAME']), base.firstName, firstName);
  profile.lastName = coalesce(overrides.lastName, envFirst(['HERMES_APPLICANT_LAST_NAME', 'APPLICANT_LAST_NAME']), base.lastName, rest.join(' '));
  profile.phoneDigits = String(coalesce(overrides.phoneDigits, profile.phone)).replace(/\D+/g, '').replace(/^1(?=\d{10}$)/, '');
  profile.salaryNumeric = String(profile.desiredSalary || '350000').replace(/[^0-9.]/g, '') || '350000';
  profile.salaryText = `${profile.desiredSalary} USD annually or ${profile.hourlyRate}`;
  profile.workAuthSummary = `${profile.workAuth}, authorized to work in the United States without visa sponsorship`;
  return profile;
}

module.exports = {
  RESUME_ROOT,
  RESUME_CONFIG_PATH,
  loadResumeConfig,
  applicantFromConfig,
  applicantProfile,
};
