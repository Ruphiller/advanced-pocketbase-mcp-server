#!/usr/bin/env node

// Test comprehensive automation tools discovery
// This script verifies all automation tools are properly registered

const { spawn } = require('child_process');
const path = require('path');

// Set environment variables for testing
process.env.POCKETBASE_URL = 'http://127.0.0.1:8090';

// List of expected automation tools
const expectedAutomationTools = [
  // Basic PocketBase tools
  'test_tool',
  'list_registered_tools',
  'get_server_info',
  'get_auth_info',
  'list_collections',
  'create_record',
  'create_collection',
  'list_records',
  'update_record',
  'delete_record',
  'authenticate_user',
  'get_record',
  
  // Advanced features
  'setup_advanced_collections',
  'migrate_collection',
  'manage_indexes',
  'upload_file',
  'backup_database',
  'import_data',
  'batch_update_records',
  'batch_delete_records',
  'execute_batch_operations',
  
  // Stripe automation tools (40+ tools)
  'stripe_create_product',
  'stripe_create_customer',
  'stripe_create_checkout_session',
  'stripe_create_payment_intent',
  'stripe_retrieve_customer',
  'stripe_update_customer',
  'stripe_cancel_subscription',
  'list_stripe_products',
  'list_stripe_customers',
  'list_stripe_subscriptions',
  'stripe_handle_webhook',
  'sync_stripe_products',
  
  // Latest Stripe 2025 features
  'stripe_create_treasury_financial_account',
  'stripe_create_climate_order',
  'stripe_create_terminal_connection_token',
  'stripe_create_issuing_card',
  'stripe_create_app_secret',
  'stripe_create_identity_verification_session',
  'stripe_create_tax_calculation',
  
  // Stripe payment methods & modern features
  'stripe_create_payment_method',
  'stripe_attach_payment_method',
  'stripe_list_payment_methods',
  'stripe_create_setup_intent',
  'stripe_create_payment_link',
  'stripe_create_price',
  'stripe_create_coupon',
  'stripe_create_invoice',
  'stripe_finalize_invoice',
  'stripe_create_refund',
  'stripe_list_disputes',
  'stripe_create_transfer',
  'stripe_get_balance',
  'stripe_list_balance_transactions',
  'stripe_list_events',
  'stripe_create_account',
  'stripe_create_account_link',
  
  // Email automation tools
  'send_email',
  'create_email_template',
  'list_email_templates',
  'get_email_logs',
  'email_create_template',
  'email_get_template',
  'email_update_template',
  'email_send_templated',
  'email_send_custom',
  'email_test_connection',
  'email_create_default_templates'
];

console.log('🔍 Testing comprehensive automation tools discovery...');
console.log(`Expected ${expectedAutomationTools.length} automation tools`);

// Test tool discovery
const serverPath = path.join(__dirname, 'build', 'index.js');
const child = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'test' }
});

let output = '';
let errorOutput = '';

child.stdout.on('data', (data) => {
  output += data.toString();
});

child.stderr.on('data', (data) => {
  errorOutput += data.toString();
});

// Send MCP initialization request
const initRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {}
    },
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  }
};

setTimeout(() => {
  child.stdin.write(JSON.stringify(initRequest) + '\n');
  
  // Send tools list request
  setTimeout(() => {
    const toolsRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    };
    child.stdin.write(JSON.stringify(toolsRequest) + '\n');
    
    // Wait for response and close
    setTimeout(() => {
      child.kill();
    }, 3000);
  }, 1000);
}, 500);

child.on('close', (code) => {
  console.log('\n📊 Test Results:');
  console.log('=================');
  
  if (errorOutput) {
    console.log('🐛 Debug output:');
    console.log(errorOutput);
  }
  
  if (output) {
    console.log('\n📋 Server output:');
    
    // Parse MCP responses
    const lines = output.split('\n').filter(line => line.trim());
    let discoveredTools = [];
    
    for (const line of lines) {
      try {
        const response = JSON.parse(line);
        if (response.result && response.result.tools) {
          discoveredTools = response.result.tools.map(tool => tool.name);
          break;
        }
      } catch (e) {
        // Skip non-JSON lines
      }
    }
    
    if (discoveredTools.length > 0) {
      console.log(`✅ Discovered ${discoveredTools.length} tools through MCP protocol`);
      
      // Check for missing automation tools
      const missingTools = expectedAutomationTools.filter(tool => !discoveredTools.includes(tool));
      const extraTools = discoveredTools.filter(tool => !expectedAutomationTools.includes(tool));
      
      if (missingTools.length === 0) {
        console.log('🎉 ALL AUTOMATION TOOLS ARE PROPERLY REGISTERED!');
      } else {
        console.log(`⚠️  Missing ${missingTools.length} expected automation tools:`);
        missingTools.forEach(tool => console.log(`   - ${tool}`));
      }
      
      if (extraTools.length > 0) {
        console.log(`ℹ️  Additional tools found (${extraTools.length}):`);
        extraTools.slice(0, 10).forEach(tool => console.log(`   + ${tool}`));
        if (extraTools.length > 10) {
          console.log(`   + ... and ${extraTools.length - 10} more`);
        }
      }
      
      // Categorize tools
      const stripeTools = discoveredTools.filter(tool => tool.startsWith('stripe_'));
      const emailTools = discoveredTools.filter(tool => tool.startsWith('email_') || tool === 'send_email' || tool === 'create_email_template' || tool === 'list_email_templates' || tool === 'get_email_logs');
      const pbTools = discoveredTools.filter(tool => !tool.startsWith('stripe_') && !tool.startsWith('email_') && tool !== 'send_email' && tool !== 'create_email_template' && tool !== 'list_email_templates' && tool !== 'get_email_logs');
      
      console.log('\n📈 Tool Categories:');
      console.log(`   💰 Stripe Tools: ${stripeTools.length}`);
      console.log(`   📧 Email Tools: ${emailTools.length}`);
      console.log(`   🗄️  PocketBase Tools: ${pbTools.length}`);
      console.log(`   📊 Total Tools: ${discoveredTools.length}`);
      
    } else {
      console.log('❌ No tools discovered through MCP protocol');
      console.log('Raw output:', output);
    }
  } else {
    console.log('❌ No output received from server');
  }
  
  console.log(`\n🏁 Test completed with exit code: ${code}`);
});

child.on('error', (error) => {
  console.error('❌ Failed to start server:', error);
});
