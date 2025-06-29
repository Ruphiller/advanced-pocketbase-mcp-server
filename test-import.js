#!/usr/bin/env node

// Test script to verify that importing the module doesn't cause auto-execution
import('./dist/index.js').then(() => {
  console.log('Module imported successfully without side effects');
  process.exit(0);
}).catch((error) => {
  console.error('Failed to import module:', error);
  process.exit(1);
});
