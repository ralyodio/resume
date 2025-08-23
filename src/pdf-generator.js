/**
 * PDF Generator using Puppeteer
 * Converts HTML to high-quality PDF with optimized settings
 */

import puppeteer from 'puppeteer';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default PDF generation options
 */
const defaultPDFOptions = {
  format: 'A4',
  printBackground: true,
  margin: {
    top: '0.5in',
    right: '0.5in',
    bottom: '0.5in',
    left: '0.5in'
  },
  displayHeaderFooter: false,
  preferCSSPageSize: false
};

/**
 * Default browser launch options
 */
const defaultLaunchOptions = {
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ]
};

/**
 * Generate PDF from HTML file
 * @param {string} htmlPath - Path to HTML file
 * @param {string} outputPath - Path for PDF output
 * @param {Object} options - PDF generation options
 * @returns {Promise<void>}
 */
export async function generatePDF(htmlPath, outputPath, options = {}) {
  let browser = null;
  
  try {
    // Resolve absolute path for HTML file
    const absoluteHtmlPath = resolve(htmlPath);
    const fileUrl = `file://${absoluteHtmlPath}`;
    
    console.log(`📖 Reading HTML from: ${absoluteHtmlPath}`);
    
    // Verify HTML file exists
    await readFile(absoluteHtmlPath, 'utf-8');
    
    // Launch browser
    console.log('🌐 Launching browser...');
    browser = await puppeteer.launch(defaultLaunchOptions);
    
    // Create new page
    const page = await browser.newPage();
    
    // Set viewport for consistent rendering
    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 2
    });
    
    // Navigate to HTML file
    console.log(`🔗 Loading HTML: ${fileUrl}`);
    await page.goto(fileUrl, {
      waitUntil: ['networkidle0', 'domcontentloaded'],
      timeout: 30000
    });
    
    // Wait for any dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Inject print-specific styles
    await page.addStyleTag({
      content: `
        @media print {
          body {
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          
          .no-print {
            display: none !important;
          }
          
          .page-break {
            page-break-before: always !important;
          }
          
          .header-section {
            break-inside: avoid !important;
          }
          
          .job-entry {
            break-inside: avoid !important;
            margin-bottom: 20pt !important;
          }
          
          .section {
            break-inside: avoid-page !important;
          }
        }
      `
    });
    
    // Merge options with defaults
    const pdfOptions = {
      ...defaultPDFOptions,
      ...options,
      path: outputPath
    };
    
    console.log('📄 Generating PDF...');
    
    // Generate PDF
    await page.pdf(pdfOptions);
    
    console.log(`✅ PDF generated successfully: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error generating PDF:', error.message);
    throw error;
  } finally {
    // Always close browser
    if (browser) {
      await browser.close();
      console.log('🔒 Browser closed');
    }
  }
}

/**
 * Generate PDF with custom options for different use cases
 * @param {string} htmlPath - Path to HTML file
 * @param {string} outputPath - Path for PDF output
 * @param {string} preset - Preset configuration ('default', 'print', 'screen', 'compact')
 * @returns {Promise<void>}
 */
export async function generatePDFWithPreset(htmlPath, outputPath, preset = 'default') {
  const presets = {
    default: defaultPDFOptions,
    
    print: {
      ...defaultPDFOptions,
      format: 'A4',
      margin: {
        top: '0.75in',
        right: '0.75in',
        bottom: '0.75in',
        left: '0.75in'
      }
    },
    
    screen: {
      ...defaultPDFOptions,
      format: 'A4',
      margin: {
        top: '0.25in',
        right: '0.25in',
        bottom: '0.25in',
        left: '0.25in'
      }
    },
    
    compact: {
      ...defaultPDFOptions,
      format: 'A4',
      margin: {
        top: '0.5in',
        right: '0.4in',
        bottom: '0.5in',
        left: '0.4in'
      },
      scale: 0.9
    }
  };
  
  const options = presets[preset] || presets.default;
  return generatePDF(htmlPath, outputPath, options);
}

/**
 * Generate multiple PDF formats
 * @param {string} htmlPath - Path to HTML file
 * @param {string} baseName - Base name for output files (without extension)
 * @returns {Promise<Array>} Array of generated file paths
 */
export async function generateMultiplePDFs(htmlPath, baseName) {
  const formats = [
    { suffix: '', preset: 'default' },
    { suffix: '-print', preset: 'print' },
    { suffix: '-compact', preset: 'compact' }
  ];
  
  const generatedFiles = [];
  
  for (const format of formats) {
    const outputPath = `${baseName}${format.suffix}.pdf`;
    await generatePDFWithPreset(htmlPath, outputPath, format.preset);
    generatedFiles.push(outputPath);
  }
  
  return generatedFiles;
}

/**
 * Validate HTML before PDF generation
 * @param {string} htmlPath - Path to HTML file
 * @returns {Promise<boolean>} True if HTML is valid for PDF generation
 */
export async function validateHTML(htmlPath) {
  let browser = null;
  
  try {
    const absoluteHtmlPath = resolve(htmlPath);
    const fileUrl = `file://${absoluteHtmlPath}`;
    
    browser = await puppeteer.launch(defaultLaunchOptions);
    const page = await browser.newPage();
    
    // Listen for console errors
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(new Error(msg.text()));
      }
    });
    
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 10000 });
    
    if (errors.length > 0) {
      console.warn('⚠️  HTML validation warnings:');
      errors.forEach(error => console.warn(`   - ${error.message}`));
    }
    
    return errors.length === 0;
    
  } catch (error) {
    console.error('❌ HTML validation failed:', error.message);
    return false;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}