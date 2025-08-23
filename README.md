# Resume Generator

Converts `anthony.ettinger.resume.md` to HTML and PDF with modern styling.

## Usage

```bash
./resume.sh
```

## Requirements

- Node.js 20+
- pnpm

## What it does

1. Converts markdown to styled HTML
2. Generates PDF from HTML using Puppeteer
3. Creates DOCX using Pandoc (if available)

## Files

- `src/index.js` - Main generator
- `src/html-generator.js` - Markdown to HTML
- `src/pdf-generator.js` - HTML to PDF
- `resume.css` - Styling
- `resume.sh` - Build script

## Install

```bash
pnpm install
```

That's it.