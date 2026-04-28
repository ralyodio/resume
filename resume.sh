#!/usr/bin/env bash
#
# Modern Resume Generator Script
#
# Converts a markdown resume into:
#   1) <basename>.html  (via custom Node.js generator)
#   2) <basename>.pdf   (via Puppeteer with modern styling)
#   3) <basename>.docx  (via Pandoc from HTML for better formatting)
#
# Usage: ./resume.sh --input path/to/resume.md
#        ./resume.sh -i path/to/resume.md
#        ./resume.sh                            # defaults to anthony.ettinger.resume4.md
#
# Requirements:
#   - Node.js 20+ with pnpm
#   - Pandoc (for DOCX generation)
#

set -e  # Exit on any error

# Defaults
INPUT_FILE="anthony.ettinger.resume4.md"
CSS_FILE="resume.css"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info()    { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error()   { echo -e "${RED}❌ $1${NC}"; }

usage() {
    cat <<EOF
Usage: $0 [--input <path/to/resume.md>]

Options:
  -i, --input <file>   Path to markdown resume (default: $INPUT_FILE)
  -h, --help           Show this help
EOF
}

# Parse CLI args
while [[ $# -gt 0 ]]; do
    case "$1" in
        -i|--input)
            INPUT_FILE="$2"
            shift 2
            ;;
        --input=*)
            INPUT_FILE="${1#*=}"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown argument: $1"
            usage
            exit 1
            ;;
    esac
done

# Check if file exists
check_file() {
    if [[ ! -f "$1" ]]; then
        log_error "Cannot find $1"
        exit 1
    fi
}

# Check if command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 is not installed or not in PATH"
        exit 1
    fi
}

# Derive basename (strip directory + .md extension)
INPUT_BASENAME="$(basename "$INPUT_FILE")"
BASENAME="${INPUT_BASENAME%.md}"

# Resolve absolute path for INPUT_FILE so Node script can read it regardless of cwd
if command -v realpath &> /dev/null; then
    INPUT_ABS="$(realpath "$INPUT_FILE" 2>/dev/null || echo "$INPUT_FILE")"
else
    INPUT_ABS="$INPUT_FILE"
fi

# Main execution
main() {
    log_info "🚀 Starting modern resume generation..."
    log_info "Input:    $INPUT_FILE"
    log_info "Basename: $BASENAME"
    echo

    # 1. Check prerequisites
    log_info "Checking prerequisites..."
    check_file "$INPUT_FILE"
    check_command "node"
    check_command "pnpm"

    # Check Node.js version
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ $NODE_VERSION -lt 20 ]]; then
        log_error "Node.js version 20+ required. Current version: $(node --version)"
        exit 1
    fi

    log_success "Prerequisites check passed"
    echo

    # 2. Install dependencies (always ensure they're present & in sync)
    if [[ ! -d "node_modules" ]]; then
        log_info "node_modules not found. Installing dependencies with pnpm..."
        pnpm install
        log_success "Dependencies installed"
    else
        log_info "Ensuring dependencies are in sync..."
        pnpm install --prefer-offline
        log_success "Dependencies up to date"
    fi
    echo

    # 3. Generate HTML and PDF using modern Node.js modules
    log_info "Generating HTML and PDF using modern Node.js generator..."
    node src/index.js --input "$INPUT_ABS" --basename "$BASENAME"

    if [[ $? -ne 0 ]]; then
        log_error "Failed to generate HTML/PDF with Node.js"
        exit 1
    fi

    log_success "HTML and PDF generated successfully"
    echo

    # 4. Generate DOCX using Pandoc from HTML (if available)
    if command -v pandoc &> /dev/null; then
        log_info "Generating DOCX from HTML with Pandoc..."

        # First try with a reference document for better styling
        pandoc "$BASENAME.html" \
            --from html \
            --to docx \
            --output "$BASENAME.docx" \
            --reference-doc=reference.docx \
            --extract-media=docx-media 2>/dev/null || \
        # Fallback without reference document but with enhanced options
        pandoc "$BASENAME.html" \
            --from html \
            --to docx \
            --output "$BASENAME.docx" \
            --extract-media=docx-media \
            --standalone

        if [[ $? -eq 0 ]]; then
            log_success "DOCX file created from HTML: $BASENAME.docx"
        else
            log_error "Failed to generate DOCX from HTML"
            exit 1
        fi
    else
        log_warning "Pandoc not found. Skipping DOCX generation."
        log_info "To install Pandoc: https://pandoc.org/installing.html"
    fi

    echo
    log_success "🎉 Resume generation completed successfully!"
    echo
    log_info "📁 Generated files:"

    # List generated files with sizes
    for file in "$BASENAME.html" "$BASENAME.pdf" "$BASENAME.docx"; do
        if [[ -f "$file" ]]; then
            size=$(ls -lh "$file" | awk '{print $5}')
            echo "   📄 $file ($size)"
        fi
    done

    echo
    log_info "💡 Tips:"
    echo "   • Open HTML file in browser to preview"
    echo "   • PDF is optimized for printing and digital sharing"
    echo "   • DOCX can be edited in Microsoft Word or Google Docs"
}

# Cleanup function
cleanup() {
    # Remove any temporary files if they exist
    rm -f puppeteer-generate-pdf.js 2>/dev/null || true
}

# Set trap for cleanup on exit
trap cleanup EXIT

# Run main function
main "$@"
