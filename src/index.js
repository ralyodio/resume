/**
 * Main Resume Generator Entry Point
 * Converts markdown resume to HTML and PDF with modern styling
 */

import { convertMarkdownToHTML } from './html-generator.js';
import { generatePDF } from './pdf-generator.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Configuration
const config = {
  input: join(projectRoot, 'anthony.ettinger.resume.md'),
  outputHTML: join(projectRoot, 'anthony.ettinger.resume.html'),
  outputPDF: join(projectRoot, 'anthony.ettinger.resume.pdf'),
  cssPath: 'resume.css'
};

/**
 * Main function to generate resume files
 */
async function generateResume() {
  try {
    console.log('🚀 Starting resume generation...\n');

    // Step 1: Generate HTML from Markdown
    console.log('📝 Converting Markdown to HTML...');
    await convertMarkdownToHTML(config.input, config.outputHTML, config.cssPath);

    // Step 2: Generate PDF from HTML
    console.log('📄 Generating PDF from HTML...');
    await generatePDF(config.outputHTML, config.outputPDF);

    console.log('\n✅ Resume generation completed successfully!');
    console.log(`📁 Files generated:`);
    console.log(`   - HTML: ${config.outputHTML}`);
    console.log(`   - PDF:  ${config.outputPDF}`);

  } catch (error) {
    console.error('\n❌ Error during resume generation:', error.message);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateResume();
}

export { generateResume, config };