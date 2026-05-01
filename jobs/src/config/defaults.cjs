const path = require('path');
const defaultHermesJobConfig = {
  remoteOnly: true,
  postedWithinDays: 7,
  preferredPostedWithinDays: 3,
  minScoreForQueue: 70,
  minScoreForAutoApply: 85,
  humanReviewRequiredForNewSources: true,
  knownSafeAutoApplySources: ['linkedin', 'dice'],
  storeDir: process.env.HERMES_JOBS_STORE || '/tmp/hermes-remote-jobs',
  resumeDir: process.env.HERMES_RESUME_DIR || '/home/ettinger/Desktop/resume',
  fallbackResume: process.env.HERMES_FALLBACK_RESUME || '/home/ettinger/Desktop/resume/anthony.ettinger.resume4.pdf',
  excludedSources: ['ziprecruiter','indeed','simplyhired','monster','careerbuilder'],
  preferredSources: ['yc-waas','web3-career','builtin','weworkremotely','remotive','arbeitnow','jobicy','themuse','valueserp-ats','himalayas','cryptocurrencyjobs','laborx'],
  rateLimits: { ycWaas:{searchesPerHour:10,applicationsPerDay:20}, web3Career:{searchesPerHour:20,applicationsPerDay:30}, builtin:{searchesPerHour:10,applicationsPerDay:20}, weworkremotely:{searchesPerHour:20,applicationsPerDay:30} },
};
module.exports = { defaultHermesJobConfig };
