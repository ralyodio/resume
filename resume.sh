#!/usr/bin/env bash
#
# convert-resume.sh
#
# Converts anthony.ettinger.resume.md into:
#   1) anthony.ettinger.resume.docx  (via Pandoc)
#   2) anthony.ettinger.resume.html  (via Pandoc, linked to resume.css)
#   3) anthony.ettinger.resume.pdf   (via Puppeteer rendering of .html)
#
# Usage: ./convert-resume.sh
# Make sure:
#   - Pandoc is installed
#   - Node + Puppeteer are installed (npm install puppeteer)
#   - resume.css is in the same directory (if you want to style the HTML/PDF)

INPUT_FILE="anthony.ettinger.resume.md"
BASENAME="anthony.ettinger.resume"
CSS_FILE="resume.css"

# 1. Check if the input file exists
if [[ ! -f "$INPUT_FILE" ]]; then
  echo "Error: Cannot find $INPUT_FILE."
  exit 1
fi

# 2. Convert to DOCX (using Pandoc)
echo "Converting $INPUT_FILE to DOCX..."
pandoc "$INPUT_FILE" \
  -o "$BASENAME.docx"

if [[ $? -ne 0 ]]; then
  echo "Error: Failed to convert to DOCX."
  exit 1
fi
echo "DOCX file created: $BASENAME.docx"

# 3. Convert to HTML + link the CSS (using Pandoc)
echo "Converting $INPUT_FILE to HTML..."

# Check if resume.css is present; if not, warn but still proceed
if [[ ! -f "$CSS_FILE" ]]; then
  echo "Warning: $CSS_FILE not found. The HTML will not have custom styling."
  pandoc "$INPUT_FILE" \
    --standalone \
    --to html5 \
    --output "$BASENAME.html"
else
  pandoc "$INPUT_FILE" \
    --standalone \
    --to html5 \
    --css "$CSS_FILE" \
    --output "$BASENAME.html"
fi

if [[ $? -ne 0 ]]; then
  echo "Error: Failed to convert to HTML."
  exit 1
fi
echo "HTML file created: $BASENAME.html"

# 4. Generate PDF from the HTML using Puppeteer
# Create a small Node.js script on the fly
PUPPETEER_SCRIPT="puppeteer-generate-pdf.js"
cat <<EOF > $PUPPETEER_SCRIPT
const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    // Use absolute path to the HTML file, prefixed by file://
    await page.goto('file://$PWD/$BASENAME.html', { waitUntil: 'networkidle2' });
    await page.pdf({ path: '$BASENAME.pdf', format: 'A4' });
    await browser.close();
  } catch (err) {
    console.error('Error generating PDF with Puppeteer:', err);
    process.exit(1);
  }
})();
EOF

echo "Generating PDF from HTML using Puppeteer..."
node $PUPPETEER_SCRIPT
if [[ $? -ne 0 ]]; then
  echo "Error: Failed to generate PDF with Puppeteer."
  rm -f $PUPPETEER_SCRIPT
  exit 1
fi

echo "PDF file created: $BASENAME.pdf"

# Cleanup the temporary Puppeteer script
rm -f $PUPPETEER_SCRIPT

echo "All conversions completed successfully!"

