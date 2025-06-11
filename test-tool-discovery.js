#!/usr/bin/env node

/**
 * Test script to verify MCP tool discovery works properly
 * This tests that all tools are discoverable even without API keys configured
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testToolDiscovery() {
  console.log('🔍 Testing MCP tool discovery...\n');
  
  return new Promise((resolve, reject) => {
    // Start the MCP server
    const serverPath = join(__dirname, 'build', 'index.js');
    const server = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Intentionally NOT setting API keys to test lazy loading
        POCKETBASE_URL: 'http://localhost:8090',
        // STRIPE_SECRET_KEY: undefined,
        // EMAIL_SMTP_HOST: undefined,
      }
    });
    
    let output = '';
    let errorOutput = '';
    
    server.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    server.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    // Send list_tools request
    const listToolsRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    };
    
    setTimeout(() => {
      server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
    }, 1000);
    
    setTimeout(() => {
      server.kill();
      
      console.log('📤 Server stderr output:');
      console.log(errorOutput);
      console.log('\n📥 Server stdout output:');
      console.log(output);
      
      // Parse the response
      try {
        const lines = output.split('\n').filter(line => line.trim());
        let toolsResponse = null;
        
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.result && parsed.result.tools) {
              toolsResponse = parsed;
              break;
            }
          } catch (e) {
            // Skip non-JSON lines
          }
        }
        
        if (toolsResponse) {
          const tools = toolsResponse.result.tools;
          console.log(`\n✅ Tool discovery successful! Found ${tools.length} tools:`);
          
          // Categorize tools
          const categories = {
            stripe: [],
            email: [],
            pocketbase: [],
            other: []
          };
          
          tools.forEach(tool => {
            if (tool.name.startsWith('stripe_')) {
              categories.stripe.push(tool.name);
            } else if (tool.name.startsWith('email_')) {
              categories.email.push(tool.name);
            } else if (tool.name.includes('collection') || tool.name.includes('record') || tool.name.includes('auth')) {
              categories.pocketbase.push(tool.name);
            } else {
              categories.other.push(tool.name);
            }
          });
          
          console.log(`\n📊 Tool Categories:`);
          console.log(`🏦 Stripe Tools (${categories.stripe.length}):`);
          categories.stripe.forEach(name => console.log(`  - ${name}`));
          
          console.log(`\n📧 Email Tools (${categories.email.length}):`);
          categories.email.forEach(name => console.log(`  - ${name}`));
          
          console.log(`\n💾 PocketBase Tools (${categories.pocketbase.length}):`);
          categories.pocketbase.slice(0, 10).forEach(name => console.log(`  - ${name}`));
          if (categories.pocketbase.length > 10) {
            console.log(`  ... and ${categories.pocketbase.length - 10} more`);
          }
          
          console.log(`\n🔧 Other Tools (${categories.other.length}):`);
          categories.other.forEach(name => console.log(`  - ${name}`));
          
          // Verify key tools are present
          const expectedStripeTools = [
            'stripe_create_product',
            'stripe_create_customer', 
            'stripe_create_checkout_session',
            'stripe_create_payment_intent',
            'stripe_create_payment_method',
            'stripe_create_treasury_financial_account',
            'stripe_create_climate_order'
          ];
          
          const expectedEmailTools = [
            'email_create_template',
            'email_send_templated',
            'email_send_custom',
            'email_test_connection'
          ];
          
          console.log(`\n🎯 Key Tool Verification:`);
          
          let allStripeToolsFound = true;
          expectedStripeTools.forEach(toolName => {
            const found = categories.stripe.includes(toolName);
            console.log(`  ${found ? '✅' : '❌'} ${toolName}`);
            if (!found) allStripeToolsFound = false;
          });
          
          let allEmailToolsFound = true;
          expectedEmailTools.forEach(toolName => {
            const found = categories.email.includes(toolName);
            console.log(`  ${found ? '✅' : '❌'} ${toolName}`);
            if (!found) allEmailToolsFound = false;
          });
          
          console.log(`\n📈 Summary:`);
          console.log(`- Total tools discovered: ${tools.length}`);
          console.log(`- Stripe tools: ${categories.stripe.length} ${allStripeToolsFound ? '✅' : '⚠️'}`);
          console.log(`- Email tools: ${categories.email.length} ${allEmailToolsFound ? '✅' : '⚠️'}`);
          console.log(`- PocketBase tools: ${categories.pocketbase.length}`);
          
          if (allStripeToolsFound && allEmailToolsFound && tools.length > 50) {
            console.log('\n🎉 SUCCESS: Tool discovery working correctly!');
            console.log('✅ All Stripe and email tools are discoverable without API keys');
            console.log('✅ Lazy loading pattern implemented successfully');
            resolve(true);
          } else {
            console.log('\n⚠️  PARTIAL SUCCESS: Some expected tools missing');
            resolve(false);
          }
        } else {
          console.log('\n❌ No tools response found in output');
          console.log('Full output:', output);
          resolve(false);
        }
      } catch (error) {
        console.error('\n❌ Error parsing server response:', error);
        console.log('Raw output:', output);
        resolve(false);
      }
    }, 3000);
  });
}

// Run the test
testToolDiscovery()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
