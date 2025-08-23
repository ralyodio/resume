#!/usr/bin/env bash
#
# Modern Resume Generator Script
#
# Converts anthony.ettinger.resume.md into:
#   1) anthony.ettinger.resume.docx  (via Pandoc)
#   2) anthony.ettinger.resume.html  (via custom Node.js generator)
#   3) anthony.ettinger.resume.pdf   (via Puppeteer with modern styling)
#
# Usage: ./resume.sh
# Requirements:
#   - Node.js 20+ with pnpm
#   - Pandoc (for DOCX generation)
#   - Dependencies installed via: pnpm install
#

set -e  # Exit on any error

# Configuration
INPUT_FILE="anthony.ettinger.resume.md"
BASENAME="anthony.ettinger.resume"
CSS_FILE="resume.css"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

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

# Main execution
main() {
    log_info "🚀 Starting modern resume generation..."
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

    # 2. Install dependencies if needed
    if [[ ! -d "node_modules" ]] || [[ ! -f "pnpm-lock.yaml" ]]; then
        log_info "Installing dependencies..."
        pnpm install
        log_success "Dependencies installed"
        echo
    fi

    # 3. Generate HTML and PDF using modern Node.js modules
    log_info "Generating HTML and PDF using modern Node.js generator..."
    node src/index.js
    
    if [[ $? -ne 0 ]]; then
        log_error "Failed to generate HTML/PDF with Node.js"
        exit 1
    fi
    
    log_success "HTML and PDF generated successfully"
    echo

    # 4. Generate DOCX using Pandoc (if available)
    if command -v pandoc &> /dev/null; then
        log_info "Generating DOCX with Pandoc..."
        
        pandoc "$INPUT_FILE" \
            --from markdown \
            --to docx \
            --output "$BASENAME.docx" \
            --reference-doc=reference.docx 2>/dev/null || \
        pandoc "$INPUT_FILE" \
            --from markdown \
            --to docx \
            --output "$BASENAME.docx"
        
        if [[ $? -eq 0 ]]; then
            log_success "DOCX file created: $BASENAME.docx"
        else
            log_error "Failed to generate DOCX"
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
    echo "   • Run 'pnpm run build' to regenerate files"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up temporary files..."
    # Remove any temporary files if they exist
    rm -f puppeteer-generate-pdf.js 2>/dev/null || true
}

# Set trap for cleanup on exit
trap cleanup EXIT

# Run main function
main "$@"
