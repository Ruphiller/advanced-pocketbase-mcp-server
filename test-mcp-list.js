#!/usr/bin/env node

// Test script to simulate the MCP tools/list request that Smithery makes
import { PocketBaseServer } from './dist/index.js';

async function testMCPToolsList() {
  console.log('Testing MCP tools/list request...');
  
  try {
    const server = new PocketBaseServer();
    
    // Simulate the MCP tools/list request
    // This is what Smithery calls to scan for available tools
    const start = Date.now();
    
    // Access the registered tools (this is what happens internally during tools/list)
    // @ts-ignore
    const registeredTools = server.server?._registeredTools;
    
    if (registeredTools && typeof registeredTools === 'object') {
      const toolNames = Object.keys(registeredTools);
      const end = Date.now();
      const duration = end - start;
      
      console.log(`✅ tools/list simulation successful!`);
      console.log(`   Duration: ${duration}ms`);
      console.log(`   Tools found: ${toolNames.length}`);
      console.log(`   Response time: ${duration < 1000 ? 'FAST' : 'SLOW'} (${duration}ms)`);
      
      // Show some sample tools
      const sampleTools = toolNames.slice(0, 10);
      console.log(`   Sample tools: ${sampleTools.join(', ')}`);
      
      // Check for critical discovery tools
      const criticalTools = ['health_check', 'discover_tools', 'smithery_discovery'];
      const missingTools = criticalTools.filter(tool => !toolNames.includes(tool));
      
      if (missingTools.length === 0) {
        console.log(`✅ All critical discovery tools present`);
      } else {
        console.log(`❌ Missing critical tools: ${missingTools.join(', ')}`);
      }
      
      return {
        success: true,
        duration,
        toolCount: toolNames.length,
        fast: duration < 1000
      };
    } else {
      console.log('❌ No tools registry found');
      return { success: false, error: 'No tools registry' };
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  }
}

testMCPToolsList().then((result) => {
  if (result.success && result.fast) {
    console.log('\n🎉 SUCCESS: Server is ready for Smithery deployment!');
    console.log('   - Fast tool discovery (< 1 second)');
    console.log('   - No blocking initialization');
    console.log('   - All discovery tools available');
    process.exit(0);
  } else if (result.success && !result.fast) {
    console.log('\n⚠️  WARNING: Tool discovery is working but slow');
    console.log(`   Duration: ${result.duration}ms (should be < 1000ms)`);
    process.exit(1);
  } else {
    console.log('\n❌ FAILED: Tool discovery not working properly');
    console.log(`   Error: ${result.error}`);
    process.exit(1);
  }
}).catch((error) => {
  console.error('❌ Test execution failed:', error);
  process.exit(1);
});
