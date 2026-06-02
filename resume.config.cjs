'use strict';

// Central non-secret profile/config for resume generation and job applications.
// Runtime secrets and provider keys stay in .env. Environment variables still
// override these values when automation is launched.
module.exports = {
  applicant: {
    name: 'Anthony Ettinger',
    email: 'anthony@profullstack.com',
    phone: '+1-408-656-2473',
    location: 'Los Gatos, CA, USA',
    city: 'Los Gatos',
    state: 'CA',
    postal: '95032',
    address: 'Los Gatos, CA',
    country: 'United States',
    school: 'San Diego State University',
    linkedin: 'https://linkedin.com/in/anthonyettinger',
    github: 'https://github.com/profullstack',
    website: 'https://profullstack.com',
    photo: '/home/ettinger/Desktop/resume/anthony.ettinger.photo.jpeg',
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
  },
};
