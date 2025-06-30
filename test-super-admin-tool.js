#!/usr/bin/env node

/**
 * Test Super Admin Authentication Tool
 * 
 * This script tests the new pocketbase_super_admin_auth tool
 * to ensure it's properly integrated and available.
 */

// Simple test to check if our tool is in the switch statement
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const durableObjectPath = path.join(__dirname, 'src', 'durable-object.ts');

try {
  const content = fs.readFileSync(durableObjectPath, 'utf8');
  
  // Check if the tool is in the switch statement
  const hasToolCase = content.includes("case 'pocketbase_super_admin_auth':");
  const hasMethodCall = content.includes('pocketBaseSuperAdminAuth(args.email, args.password)');
  const hasMethodDefinition = content.includes('private async pocketBaseSuperAdminAuth(');
  
  console.log('🧪 Super Admin Auth Tool Integration Test');
  console.log('========================================');
  console.log(`✅ Tool case in switch: ${hasToolCase ? 'FOUND' : 'MISSING'}`);
  console.log(`✅ Method call: ${hasMethodCall ? 'FOUND' : 'MISSING'}`);
  console.log(`✅ Method definition: ${hasMethodDefinition ? 'FOUND' : 'MISSING'}`);
  
  if (hasToolCase && hasMethodCall && hasMethodDefinition) {
    console.log('\n🎉 SUCCESS: Super Admin Auth tool is properly integrated!');
    console.log('\nNext steps:');
    console.log('1. Deploy your updated Durable Object');
    console.log('2. Test with: {"tool": "pocketbase_super_admin_auth", "arguments": {}}');
    console.log('3. Check SUPER_ADMIN_AUTH.md for detailed usage instructions');
  } else {
    console.log('\n❌ FAIL: Tool integration incomplete');
    console.log('Missing components need to be added');
  }
  
} catch (error) {
  console.error('Error reading durable-object.ts:', error.message);
  process.exit(1);
}
