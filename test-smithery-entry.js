/**
 * Test script to verify Smithery entry point works correctly
 */
import { pathToFileURL } from 'url';
import path from 'path';

async function testSmitheryEntry() {
  try {
    console.log('🔍 Testing Smithery entry point...');
    
    // Import the built entry point
    const entryPath = path.resolve('./dist/smithery/smithery-entry.js');
    const { default: createServer, configSchema } = await import(pathToFileURL(entryPath).href);
    
    console.log('✅ Entry point imports successfully');
    console.log('📋 Config schema available:', !!configSchema);
    console.log('🏗️ Create server function available:', typeof createServer === 'function');
    
    // Test with valid config
    const testConfig = {
      pocketbaseUrl: "https://test.pocketbase.io",
      adminEmail: "admin@test.com",
      adminPassword: "test123",
      debug: true
    };
    
    console.log('🧪 Testing server creation...');
    const server = createServer({ config: testConfig });
    console.log('✅ Server created successfully:', !!server);
    
    // Test with minimal config
    const minimalConfig = {
      pocketbaseUrl: "https://minimal.test.com"
    };
    
    console.log('🧪 Testing minimal config...');
    const minimalServer = createServer({ config: minimalConfig });
    console.log('✅ Minimal server created successfully:', !!minimalServer);
    
    console.log('🎉 All tests passed! Smithery integration is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testSmitheryEntry();
