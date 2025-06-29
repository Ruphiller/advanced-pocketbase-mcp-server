#!/bin/sh
# Build script for Docker environment
echo "Checking build environment..."
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Current directory: $(pwd)"
echo "Files present:"
ls -la package*.json 2>/dev/null || echo "No package files visible"

if [ -f "package-lock.json" ]; then
    echo "Found package-lock.json, using npm ci"
    npm ci --verbose
elif [ -f "package.json" ]; then
    echo "Found package.json but no package-lock.json, using npm install"
    npm install --verbose
else
    echo "ERROR: No package.json found!"
    exit 1
fi

echo "Dependencies installed successfully"
