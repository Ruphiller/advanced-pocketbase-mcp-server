#!/usr/bin/env node

// Test script to simulate Smithery's tool discovery process
import { PocketBaseServer } from './dist/index.js';

async function testToolDiscovery() {
  console.log('Creating server instance...');
  const server = new PocketBaseServer();
  
  console.log('Testing tool discovery...');
  
  try {
    // Access the registered tools
    // @ts-ignore
    const registeredTools = server.server?._registeredTools;
    console.log('Registered tools:', registeredTools);
    
    if (registeredTools && typeof registeredTools === 'object') {
      const toolNames = Object.keys(registeredTools);
      console.log('Available tools:', toolNames);
      
      if (toolNames.length > 0) {
        console.log('✅ Tool discovery successful! Found', toolNames.length, 'tools');
        
        // Check for our fast discovery tools
        const fastTools = ['health_check', 'discover_tools', 'smithery_discovery'];
        fastTools.forEach(toolName => {
          if (toolNames.includes(toolName)) {
            console.log(`✅ ${toolName} tool available`);
          } else {
            console.log(`❌ ${toolName} tool missing`);
          }
        });
        
        // Check for other important tools
        const importantTools = ['test_tool', 'get_server_info', 'list_registered_tools'];
        importantTools.forEach(toolName => {
          if (toolNames.includes(toolName)) {
            console.log(`✅ ${toolName} tool available`);
          } else {
            console.log(`❌ ${toolName} tool missing`);
          }
        });
        
      } else {
        console.log('❌ No tools found in registry');
      }
    } else {
      console.log('❌ _registeredTools is not accessible or not an object');
    }
    
  } catch (error) {
    console.error('❌ Tool discovery failed:', error);
  }
}

testToolDiscovery().then(() => {
  console.log('\n✅ Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
