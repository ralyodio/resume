/**
 * Main Resume Generator Entry Point
 * Converts markdown resume to HTML and PDF with modern styling
 */

import { convertMarkdownToHTML } from './html-generator.js';
import { generatePDF } from './pdf-generator.js';
import { fileURLToPath } from 'url';
import { dirname, join, basename, isAbsolute, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

/**
 * Parse simple --flag value / --flag=value style CLI args.
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          out[key] = next;
          i++;
        } else {
          out[key] = true;
        }
      }
    } else if (a === '-i') {
      out.input = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const inputArg = args.input || 'anthony.ettinger.resume.md';
const inputPath = isAbsolute(inputArg) ? inputArg : resolve(process.cwd(), inputArg);
const resolvedBasename = args.basename || basename(inputPath).replace(/\.md$/i, '');

// Configuration — outputs written next to cwd so resume.sh (which sets cwd to
// project root) can find them for the pandoc step.
const config = {
  input: inputPath,
  outputHTML: resolve(process.cwd(), `${resolvedBasename}.html`),
  outputPDF: resolve(process.cwd(), `${resolvedBasename}.pdf`),
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