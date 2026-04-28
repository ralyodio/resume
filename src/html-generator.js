/**
 * HTML Template Generator for Resume
 * Converts markdown content to structured HTML matching resume.example.png layout
 */

import { readFile, writeFile } from 'fs/promises';
import { marked } from 'marked';

function renderInline(value = '') {
  return marked.parseInline(String(value).trim())
    .replace(/^<p>|<\/p>$/g, '')
    .trim();
}

function stripInlineMarkdown(value = '') {
  return String(value)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .trim();
}

/**
 * Parse markdown content and extract structured resume data
 * @param {string} markdownContent - Raw markdown content
 * @returns {Object} Structured resume data
 */
export function parseResumeData(markdownContent) {
  const lines = markdownContent.split('\n');
  const resume = {
    name: '',
    contact: [],
    sections: []
  };

  let currentSection = null;
  let inContactInfo = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (!line) continue;

    // Main name (first H1)
    if (line.startsWith('# ') && !resume.name) {
      resume.name = line.substring(2).trim();
      inContactInfo = true;
      continue;
    }

    // Contact information (bullets after name)
    if (inContactInfo && line.startsWith('- ')) {
      resume.contact.push(line.substring(2).trim());
      continue;
    }

    // Section headers (H2)
    if (line.startsWith('## ')) {
      inContactInfo = false;
      currentSection = {
        title: line.substring(3).trim(),
        content: [],
        type: getSectionType(line.substring(3).trim())
      };
      resume.sections.push(currentSection);
      continue;
    }

    // Add content to current section
    if (currentSection) {
      currentSection.content.push(line);
    }
  }

  return resume;
}

/**
 * Determine section type for special formatting
 * @param {string} title - Section title
 * @returns {string} Section type
 */
function getSectionType(title) {
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes('summary')) return 'summary';
  if (titleLower.includes('experience')) return 'experience';
  if (titleLower.includes('skills') || titleLower.includes('expertise')) return 'skills';
  if (titleLower.includes('education')) return 'education';
  if (titleLower.includes('projects')) return 'projects';
  if (titleLower.includes('highlights')) return 'achievements';
  
  return 'general';
}

/**
 * Generate contact information HTML
 * @param {Array} contactInfo - Array of contact information strings
 * @returns {string} HTML string
 */
function generateContactHTML(contactInfo) {
  return contactInfo.map(info => {
    // Parse different contact formats
    const normalized = stripInlineMarkdown(info);
    const [rawLabel, ...rest] = normalized.split(':');
    const label = rawLabel.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (label === 'email') {
      return `<span><a href="mailto:${value}">${value}</a></span>`;
    }

    if (label === 'phone') {
      return `<span>${value}</span>`;
    }

    if (['web', 'github', 'linkedin'].includes(label)) {
      return `<span><a href="${value}" target="_blank">${value.replace(/^https?:\/\//, '')}</a></span>`;
    }

    if (['location', 'work authorization'].includes(label)) {
      return `<span>${value}</span>`;
    }

    // Fallback for other formats
    return `<span>${renderInline(info)}</span>`;
  }).join('\n');
}

/**
 * Generate work experience HTML
 * @param {Array} content - Section content lines
 * @returns {string} HTML string
 */
function generateExperienceHTML(content) {
  const jobs = [];
  let currentJob = null;
  
  for (const line of content) {
    if (line.startsWith('### ')) {
      // New job entry
      if (currentJob) jobs.push(currentJob);
      
      const titleLine = line.substring(4).trim();
      const parts = titleLine.split(' | ');
      
      currentJob = {
        company: parts[0] || '',
        location: parts[1] || '',
        title: '',
        duration: '',
        description: [],
        achievements: []
      };
    } else if (currentJob && !currentJob.title && !line.startsWith('-')) {
      // Job title and duration line
      const match = line.match(/^(.+?)\s*\((.+?)\)\s*$/);
      if (match) {
        currentJob.title = match[1].trim();
        currentJob.duration = match[2].trim();
      } else {
        currentJob.title = line.trim();
      }
    } else if (currentJob && line.startsWith('- ') && !currentJob.description.length) {
      // First description paragraph (not bullet)
      const desc = line.substring(2).trim();
      if (!desc.startsWith('Achieved') && !desc.startsWith('Generated') && !desc.startsWith('Presented') && !desc.startsWith('Established')) {
        currentJob.description.push(desc);
      } else {
        currentJob.achievements.push(desc);
      }
    } else if (currentJob && line.startsWith('- ')) {
      // Job achievement bullets
      currentJob.achievements.push(line.substring(2).trim());
    } else if (currentJob && line && !line.startsWith('#')) {
      // Description paragraph
      currentJob.description.push(line);
    }
  }
  
  if (currentJob) jobs.push(currentJob);
  
  return jobs.map(job => `
    <div class="experience-entry">
      <div class="job-header">
        <div class="job-title">${renderInline(job.title)}</div>
        <div class="company-info">
          <span class="company-name">${renderInline(job.company)}</span>
          <div>
            <span class="job-duration">${renderInline(job.duration)}</span>
            ${job.location ? `<span class="job-location">| ${renderInline(job.location)}</span>` : ''}
          </div>
        </div>
      </div>
      ${job.description.length ? `<div class="job-description">${job.description.map(renderInline).join(' ')}</div>` : ''}
      ${job.achievements.length ? `
        <ul class="job-achievements">
          ${job.achievements.map(achievement => `<li>${renderInline(achievement)}</li>`).join('\n')}
        </ul>
      ` : ''}
    </div>
  `).join('\n');
}

/**
 * Generate skills section HTML
 * @param {Array} content - Section content lines
 * @returns {string} HTML string
 */
function generateSkillsHTML(content) {
  const skills = [];
  
  for (const line of content) {
    if (line.startsWith('- ')) {
      const skillLine = line.substring(2).trim();
      const colonIndex = skillLine.indexOf(':');
      
      if (colonIndex > 0) {
        const label = skillLine.substring(0, colonIndex).trim();
        const items = skillLine.substring(colonIndex + 1).trim();
        skills.push(`<strong>${renderInline(label)}:</strong> ${renderInline(items)}`);
      } else {
        skills.push(renderInline(skillLine));
      }
    }
  }
  
  return `
    <div class="skills-list">
      ${skills.map(skill => `<span class="skill-item">${skill}</span>`).join('\n')}
    </div>
  `;
}

/**
 * Generate education section HTML
 * @param {Array} content - Section content lines
 * @returns {string} HTML string
 */
function generateEducationHTML(content) {
  const entries = [];
  const notes = [];
  let currentEd = null;

  for (const rawLine of content) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('### ')) {
      if (currentEd) entries.push(currentEd);
      currentEd = {
        school: line.substring(4).trim(),
        degree: '',
        duration: ''
      };
      continue;
    }

    if (currentEd && !currentEd.degree) {
      const match = line.match(/^(.+?)\s*\((.+?)\)\s*$/);
      if (match) {
        currentEd.degree = match[1].trim();
        currentEd.duration = match[2].trim();
      } else {
        currentEd.degree = line;
      }
      continue;
    }

    notes.push(line);
  }

  if (currentEd) entries.push(currentEd);

  return `
    ${entries.map(ed => `
      <div class="education-entry">
        <div class="degree-title">${renderInline(ed.school)}</div>
        <div class="school-info">
          <span class="school-name">${renderInline(ed.degree)}</span>
          ${ed.duration ? `<span class="education-duration">${renderInline(ed.duration)}</span>` : ''}
        </div>
      </div>
    `).join('\n')}
    ${notes.length ? `<div class="education-notes">${marked.parse(notes.join('\n\n'))}</div>` : ''}
  `;
}

/**
 * Generate achievements section HTML (Key Achievements grid)
 * @param {Array} content - Section content lines
 * @returns {string} HTML string
 */
function generateAchievementsHTML(content) {
  const achievements = content.filter(line => line.startsWith('- '))
    .map(line => line.substring(2).trim());
  
  // Create achievement items with icons
  const achievementItems = achievements.map((achievement, index) => {
    const icons = ['🚀', '⚡', '💎', '🌟', '🎯', '💡'];
    const icon = icons[index % icons.length];
    
    // Try to extract title and description
    const colonIndex = achievement.indexOf(':');
    let title, description;
    
    if (colonIndex > 0) {
      title = achievement.substring(0, colonIndex).trim();
      description = achievement.substring(colonIndex + 1).trim();
    } else {
      // Use first few words as title
      const words = achievement.split(' ');
      title = words.slice(0, 3).join(' ');
      description = words.slice(3).join(' ');
    }
    
    return { icon, title, description: description || achievement };
  });
  
  return `
    <div class="achievements-grid">
      ${achievementItems.map(item => `
        <div class="achievement-item">
          <div class="achievement-icon">${item.icon}</div>
          <div class="achievement-content">
            <h4>${renderInline(item.title)}</h4>
            <p>${renderInline(item.description)}</p>
          </div>
        </div>
      `).join('\n')}
    </div>
  `;
}

/**
 * Generate projects section HTML
 * @param {Array} content - Section content lines
 * @returns {string} HTML string
 */
function generateProjectsHTML(content) {
  const projects = [];
  
  for (const line of content) {
    if (line.startsWith('- ')) {
      const projectLine = line.substring(2).trim();
      const dashIndex = projectLine.indexOf(' — ');
      
      if (dashIndex > 0) {
        const name = projectLine.substring(0, dashIndex).trim();
        const description = projectLine.substring(dashIndex + 3).trim();
        projects.push({ name, description });
      } else {
        projects.push({ name: projectLine, description: '' });
      }
    }
  }
  
  return `
    <div class="projects-list">
      ${projects.map(project => `
        <div class="project-item">
          <div class="project-name">${renderInline(project.name)}</div>
          ${project.description ? `<div class="project-description">${renderInline(project.description)}</div>` : ''}
        </div>
      `).join('\n')}
    </div>
  `;
}

/**
 * Generate section content based on type
 * @param {Object} section - Section data
 * @returns {string} HTML string
 */
function generateSectionContent(section) {
  switch (section.type) {
    case 'experience':
      return generateExperienceHTML(section.content);
    case 'skills':
      return generateSkillsHTML(section.content);
    case 'education':
      return generateEducationHTML(section.content);
    case 'achievements':
      return generateAchievementsHTML(section.content);
    case 'projects':
      return generateProjectsHTML(section.content);
    default:
      // General content - convert markdown to HTML
      const markdownContent = section.content.join('\n');
      return marked.parse(markdownContent);
  }
}

/**
 * Generate complete HTML document
 * @param {Object} resumeData - Parsed resume data
 * @param {string} cssPath - Path to CSS file
 * @returns {string} Complete HTML document
 */
export function generateHTML(resumeData, cssPath = 'resume.css') {
  const { name, contact, sections } = resumeData;
  
  // Find professional summary for subtitle
  const summarySection = sections.find(s => s.type === 'summary');
  const subtitle = summarySection ? 
    summarySection.content.join(' ').replace(/Independent Contractor @ /, '').split('.')[0] : 
    'Professional';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name} - Resume</title>
    <link rel="stylesheet" href="${cssPath}">
</head>
<body>
    <header class="header">
        <h1>${name}</h1>
        <div class="subtitle">${subtitle}</div>
        <div class="contact-info">
            ${generateContactHTML(contact)}
        </div>
    </header>

    <main>
        ${sections.filter(s => s.type !== 'summary').map(section => `
            <section class="section">
                <h2>${section.title}</h2>
                ${generateSectionContent(section)}
            </section>
        `).join('\n')}
    </main>
</body>
</html>`;
}

/**
 * Main function to convert markdown file to HTML
 * @param {string} inputPath - Path to markdown file
 * @param {string} outputPath - Path for HTML output
 * @param {string} cssPath - Path to CSS file
 */
/**
 * Generate a generic HTML document for non-resume markdown (e.g. cover letters,
 * project pitches). Falls back to a clean marked-based render when the input
 * doesn't parse as a structured resume.
 * @param {string} markdownContent - Raw markdown content
 * @param {string} cssPath - Path to CSS file
 * @returns {string} Complete HTML document
 */
export function generateGenericHTML(markdownContent, cssPath = 'resume.css') {
  // Try to use the first H1 as the document title
  const h1Match = markdownContent.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : 'Document';

  const body = marked.parse(markdownContent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="${cssPath}">
    <style>
      /* Generic document styling (cover letters, pitches, etc.) */
      body.generic-doc {
        max-width: 7.1in;
        padding: 0.6in 0.7in;
        line-height: 1.55;
      }
      body.generic-doc h1 {
        font-size: 1.8em;
        font-weight: 800;
        border-bottom: 2px solid #111;
        padding-bottom: 0.3em;
        margin-bottom: 0.6em;
      }
      body.generic-doc h2 {
        font-size: 1.1em;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: #111;
        margin: 1.4em 0 0.5em;
      }
      body.generic-doc p { margin-bottom: 0.75em; }
      body.generic-doc ul { list-style: none; padding: 0; margin: 0 0 1em; }
      body.generic-doc ul li {
        padding: 0.4em 0;
        border-bottom: 1px solid #eee;
      }
      body.generic-doc ul li:last-child { border-bottom: none; }
      body.generic-doc a {
        color: #0a58ca;
        text-decoration: none;
        word-break: break-word;
      }
      body.generic-doc a:hover { text-decoration: underline; }
      body.generic-doc hr {
        border: none;
        border-top: 1px solid #ccc;
        margin: 1.4em 0 1em;
      }
    </style>
</head>
<body class="generic-doc">
${body}
</body>
</html>`;
}

/**
 * Decide whether the parsed data actually looks like a resume.
 * Requires an H1 name plus at least one "resume-flavored" section
 * (experience / education / skills / achievements). Avoids hijacking
 * cover letters or project pitches that happen to use H1 + H2.
 * @param {Object} resumeData
 * @returns {boolean}
 */
function looksLikeResume(resumeData) {
  if (!resumeData.name) return false;
  const resumeTypes = new Set(['experience', 'education', 'skills', 'achievements']);
  return resumeData.sections.some(s => resumeTypes.has(s.type));
}

export async function convertMarkdownToHTML(inputPath, outputPath, cssPath = 'resume.css') {
  try {
    const markdownContent = await readFile(inputPath, 'utf-8');
    const resumeData = parseResumeData(markdownContent);

    let htmlContent;
    if (looksLikeResume(resumeData)) {
      htmlContent = generateHTML(resumeData, cssPath);
    } else {
      console.log('ℹ️  Input does not look like a structured resume — using generic markdown renderer.');
      htmlContent = generateGenericHTML(markdownContent, cssPath);
    }

    await writeFile(outputPath, htmlContent, 'utf-8');
    console.log(`✅ HTML generated successfully: ${outputPath}`);

    return htmlContent;
  } catch (error) {
    console.error('❌ Error generating HTML:', error.message);
    throw error;
  }
}