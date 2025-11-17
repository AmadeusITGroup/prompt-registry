#!/bin/bash
# Quick validation for rapid development iteration
# Runs only essential checks (faster than full validation)

set -e

echo "🚀 Quick validation check..."

# 1. Lint
echo "▶ Linting..."
npm run lint

# 2. Compile
echo "▶ Compiling..."
npm run compile

# 3. Unit tests only
echo "▶ Unit tests..."
npm run test:unit

echo ""
echo "✅ Quick check passed! Safe to continue development."
echo "💡 Run ./.github/workflows/scripts/validate-locally.sh before pushing to GitHub"
