/**
 * HTML Template Generator for Resume
 * Converts markdown content to structured HTML matching resume.example.png layout
 */

import { readFile, writeFile } from 'fs/promises';
import { marked } from 'marked';

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
    if (info.includes('**Email**:')) {
      const email = info.replace('**Email**:', '').trim();
      return `<span>📧 <a href="mailto:${email}">${email}</a></span>`;
    }
    
    if (info.includes('**Phone**:')) {
      const phone = info.replace('**Phone**:', '').trim();
      return `<span>📞 ${phone}</span>`;
    }
    
    if (info.includes('**Web**:')) {
      const url = info.replace('**Web**:', '').trim();
      return `<span>🌐 <a href="${url}" target="_blank">${url}</a></span>`;
    }
    
    if (info.includes('**GitHub**:')) {
      const match = info.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        return `<span>🐙 <a href="${match[2]}" target="_blank">${match[1]}</a></span>`;
      }
    }
    
    if (info.includes('**LinkedIn**:')) {
      const match = info.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        return `<span>💼 <a href="${match[2]}" target="_blank">${match[1]}</a></span>`;
      }
    }
    
    if (info.includes('**Location**:')) {
      const location = info.replace('**Location**:', '').trim();
      return `<span>📍 ${location}</span>`;
    }
    
    // Fallback for other formats
    return `<span>${info.replace(/\*\*(.*?)\*\*/g, '$1')}</span>`;
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
        <div class="job-title">${job.title}</div>
        <div class="company-info">
          <span class="company-name">${job.company}</span>
          <div>
            <span class="job-duration">📅 ${job.duration}</span>
            ${job.location ? `<span class="job-location">📍 ${job.location}</span>` : ''}
          </div>
        </div>
      </div>
      ${job.description.length ? `<div class="job-description">${job.description.join(' ')}</div>` : ''}
      ${job.achievements.length ? `
        <ul class="job-achievements">
          ${job.achievements.map(achievement => `<li>${achievement}</li>`).join('\n')}
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
        const items = skillLine.substring(colonIndex + 1).trim();
        // Split by comma and add each skill
        items.split(',').forEach(skill => {
          skills.push(skill.trim());
        });
      } else {
        skills.push(skillLine);
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
  const education = [];
  let currentEd = null;
  
  for (const line of content) {
    if (!line.startsWith('-') && !line.startsWith('#') && line.includes('—') || line.includes('University') || line.includes('College')) {
      if (currentEd) education.push(currentEd);
      
      const parts = line.split('—');
      currentEd = {
        degree: parts[0]?.trim() || line,
        school: parts[1]?.trim() || '',
        duration: '',
        location: ''
      };
    } else if (currentEd && (line.includes('(') || line.match(/\d{4}/))) {
      // Duration and location line
      const match = line.match(/\((.+?)\)/);
      if (match) {
        currentEd.duration = match[1];
      }
    }
  }
  
  if (currentEd) education.push(currentEd);
  
  return education.map(ed => `
    <div class="education-entry">
      <div class="degree-title">${ed.degree}</div>
      <div class="school-info">
        <span class="school-name">${ed.school}</span>
        ${ed.duration ? `<span class="education-duration">📅 ${ed.duration}</span>` : ''}
      </div>
    </div>
  `).join('\n');
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
            <h4>${item.title}</h4>
            <p>${item.description}</p>
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
          <div class="project-name">${project.name}</div>
          ${project.description ? `<div class="project-description">${project.description}</div>` : ''}
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
export async function convertMarkdownToHTML(inputPath, outputPath, cssPath = 'resume.css') {
  try {
    const markdownContent = await readFile(inputPath, 'utf-8');
    const resumeData = parseResumeData(markdownContent);
    const htmlContent = generateHTML(resumeData, cssPath);
    
    await writeFile(outputPath, htmlContent, 'utf-8');
    console.log(`✅ HTML generated successfully: ${outputPath}`);
    
    return htmlContent;
  } catch (error) {
    console.error('❌ Error generating HTML:', error.message);
    throw error;
  }
}