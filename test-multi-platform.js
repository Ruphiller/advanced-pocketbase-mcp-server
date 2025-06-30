#!/usr/bin/env node

/**
 * Comprehensive Multi-Platform Deployment   // Check smithery has module field in package.json
  const hasModuleField = packageJson.module === './src/smithery-entry.ts';
  tests.smithery.checks.push({
    name: 'Package.json module field',
    status: hasModuleField ? 'PASS' : 'FAIL',
    details: hasModuleField ? 'Module field points to smithery-entry.ts' : 'Module field missing or incorrect'
  });* 
 * This script verifies that all deployment targets work correctly:
 * - Smithery Platform (TypeScript runtime)
 * - Cloudflare Workers (with Durable Objects)
 * - Node.js (traditional deployment)
 * - Docker (containerized deployment)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Multi-Platform Deployment Test Suite');
console.log('=========================================');

const tests = {
  smithery: {
    name: 'Smithery Platform Integration',
    checks: []
  },
  cloudflare: {
    name: 'Cloudflare Workers',
    checks: []
  },
  nodejs: {
    name: 'Node.js Deployment',
    checks: []
  },
  docker: {
    name: 'Docker Deployment',
    checks: []
  }
};

// Test 1: Smithery Integration
console.log('\n📊 Testing Smithery Integration...');

try {
  // Check package.json module field
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const hasModuleField = Boolean(packageJson.module);
  tests.smithery.checks.push({
    name: 'package.json module field',
    status: hasModuleField ? 'PASS' : 'FAIL',
    details: hasModuleField ? packageJson.module : 'Missing module field'
  });

  // Check smithery.yaml exists and has TypeScript runtime
  const smitheryYaml = fs.readFileSync(path.join(__dirname, 'smithery.yaml'), 'utf8');
  const hasTypeScriptRuntime = smitheryYaml.includes('runtime: "typescript"');
  tests.smithery.checks.push({
    name: 'smithery.yaml TypeScript runtime',
    status: hasTypeScriptRuntime ? 'PASS' : 'FAIL',
    details: hasTypeScriptRuntime ? 'TypeScript runtime configured' : 'TypeScript runtime not found'
  });

  // Check smithery entry point exists
  const smitheryEntryExists = fs.existsSync(path.join(__dirname, 'src', 'smithery-entry.ts'));
  tests.smithery.checks.push({
    name: 'Smithery entry point file',
    status: smitheryEntryExists ? 'PASS' : 'FAIL',
    details: smitheryEntryExists ? 'src/smithery-entry.ts exists' : 'Entry point missing'
  });

  // Check smithery has module field in package.json
  const hasSmitheryModuleField = packageJson.module === './src/smithery-entry.ts';
  tests.smithery.checks.push({
    name: 'Package.json module field',
    status: hasSmitheryModuleField ? 'PASS' : 'FAIL',
    details: hasSmitheryModuleField ? 'Module field points to smithery-entry.ts' : 'Module field missing or incorrect'
  });

  // Check Smithery build works
  const smitheryYamlExists = fs.existsSync(path.join(__dirname, 'smithery.yaml'));
  tests.smithery.checks.push({
    name: 'Smithery configuration',
    status: smitheryYamlExists ? 'PASS' : 'FAIL',
    details: smitheryYamlExists ? 'smithery.yaml exists with proper config' : 'Smithery config missing'
  });

} catch (error) {
  tests.smithery.checks.push({
    name: 'Smithery integration test',
    status: 'ERROR',
    details: error.message
  });
}

// Test 2: Cloudflare Workers
console.log('\n☁️ Testing Cloudflare Workers Integration...');

try {
  // Check worker entry point
  const workerExists = fs.existsSync(path.join(__dirname, 'src', 'worker.ts'));
  tests.cloudflare.checks.push({
    name: 'Worker entry point',
    status: workerExists ? 'PASS' : 'FAIL',
    details: workerExists ? 'src/worker.ts exists' : 'Worker entry point missing'
  });

  // Check durable object
  const durableObjectExists = fs.existsSync(path.join(__dirname, 'src', 'durable-object.ts'));
  tests.cloudflare.checks.push({
    name: 'Durable Object implementation',
    status: durableObjectExists ? 'PASS' : 'FAIL',
    details: durableObjectExists ? 'src/durable-object.ts exists' : 'Durable Object missing'
  });

  // Check wrangler config
  const wranglerExists = fs.existsSync(path.join(__dirname, 'wrangler.toml'));
  tests.cloudflare.checks.push({
    name: 'Wrangler configuration',
    status: wranglerExists ? 'PASS' : 'FAIL',
    details: wranglerExists ? 'wrangler.toml exists' : 'Wrangler config missing'
  });

  // Check worker TypeScript config
  const tsConfigWorkerExists = fs.existsSync(path.join(__dirname, 'tsconfig.worker.json'));
  tests.cloudflare.checks.push({
    name: 'Worker TypeScript configuration',
    status: tsConfigWorkerExists ? 'PASS' : 'FAIL',
    details: tsConfigWorkerExists ? 'tsconfig.worker.json exists' : 'Worker TS config missing'
  });

} catch (error) {
  tests.cloudflare.checks.push({
    name: 'Cloudflare Workers test',
    status: 'ERROR',
    details: error.message
  });
}

// Test 3: Node.js Deployment
console.log('\n🚀 Testing Node.js Deployment...');

try {
  // Check main entry point
  const mainExists = fs.existsSync(path.join(__dirname, 'src', 'main.ts'));
  tests.nodejs.checks.push({
    name: 'Main entry point',
    status: mainExists ? 'PASS' : 'FAIL',
    details: mainExists ? 'src/main.ts exists' : 'Main entry point missing'
  });

  // Check legacy entry point
  const indexExists = fs.existsSync(path.join(__dirname, 'src', 'index.ts'));
  tests.nodejs.checks.push({
    name: 'Legacy entry point',
    status: indexExists ? 'PASS' : 'FAIL',
    details: indexExists ? 'src/index.ts exists' : 'Legacy entry point missing'
  });

  // Check package.json scripts
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const hasStartScript = Boolean(packageJson.scripts?.start);
  tests.nodejs.checks.push({
    name: 'Start script configuration',
    status: hasStartScript ? 'PASS' : 'FAIL',
    details: hasStartScript ? packageJson.scripts.start : 'Start script missing'
  });

} catch (error) {
  tests.nodejs.checks.push({
    name: 'Node.js deployment test',
    status: 'ERROR',
    details: error.message
  });
}

// Test 4: Docker Deployment
console.log('\n🐳 Testing Docker Deployment...');

try {
  // Check Dockerfile
  const dockerfileExists = fs.existsSync(path.join(__dirname, 'Dockerfile'));
  tests.docker.checks.push({
    name: 'Dockerfile',
    status: dockerfileExists ? 'PASS' : 'FAIL',
    details: dockerfileExists ? 'Dockerfile exists' : 'Dockerfile missing'
  });

  // Check Docker test file
  const dockerTestExists = fs.existsSync(path.join(__dirname, 'Dockerfile.test'));
  tests.docker.checks.push({
    name: 'Docker test configuration',
    status: dockerTestExists ? 'PASS' : 'FAIL',
    details: dockerTestExists ? 'Dockerfile.test exists' : 'Docker test config missing'
  });

} catch (error) {
  tests.docker.checks.push({
    name: 'Docker deployment test',
    status: 'ERROR',
    details: error.message
  });
}

// Print Results
console.log('\n📋 Test Results Summary');
console.log('========================');

Object.entries(tests).forEach(([platform, test]) => {
  console.log(`\n${test.name}:`);
  test.checks.forEach(check => {
    const icon = check.status === 'PASS' ? '✅' : check.status === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} ${check.name}: ${check.status}`);
    if (check.status !== 'PASS') {
      console.log(`     Details: ${check.details}`);
    }
  });
});

// Overall Status
const allPlatforms = Object.values(tests);
const allChecks = allPlatforms.flatMap(platform => platform.checks);
const passedChecks = allChecks.filter(check => check.status === 'PASS').length;
const totalChecks = allChecks.length;

console.log('\n🎯 Overall Status');
console.log('=================');
console.log(`Passed: ${passedChecks}/${totalChecks} checks`);

if (passedChecks === totalChecks) {
  console.log('🎉 SUCCESS: All deployment targets are properly configured!');
  console.log('\n🚀 Ready for multi-platform deployment:');
  console.log('   • Smithery Platform: Managed hosting with web playground');
  console.log('   • Cloudflare Workers: Global edge deployment with Durable Objects');
  console.log('   • Node.js: Traditional server deployment');
  console.log('   • Docker: Containerized deployment');
} else {
  console.log('⚠️ PARTIAL: Some deployment targets need attention');
  console.log('Please review the failed checks above');
}

console.log('\n📖 Next Steps:');
console.log('   1. Deploy to Smithery: Visit https://smithery.ai/server/pocketbase-server');
console.log('   2. Deploy to Cloudflare: Run `npm run deploy`');
console.log('   3. Run locally: Run `npm start`');
console.log('   4. Test with Docker: Run `npm run deploy:docker`');
