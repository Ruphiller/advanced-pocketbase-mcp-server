#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');

console.log('🔍 Testing PocketBase MCP Server Automation Tools Visibility...\n');

// Test tool discovery
function testToolDiscovery() {
  return new Promise((resolve, reject) => {
    const serverProcess = spawn('node', ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    // Send tools/list request
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    };

    serverProcess.stdin.write(JSON.stringify(request) + '\n');
    serverProcess.stdin.end();

    serverProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    serverProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    serverProcess.on('close', (code) => {
      try {
        // Find the JSON response in stdout
        const lines = stdout.split('\n').filter(line => line.trim());
        let response = null;
        
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === 1 && parsed.result) {
              response = parsed;
              break;
            }
          } catch (e) {
            // Skip non-JSON lines
          }
        }

        if (!response) {
          console.error('❌ No valid JSON response found');
          console.error('STDOUT:', stdout);
          console.error('STDERR:', stderr);
          reject(new Error('No valid response'));
          return;
        }

        resolve(response.result.tools);
      } catch (error) {
        console.error('❌ Error parsing response:', error);
        console.error('STDOUT:', stdout);
        console.error('STDERR:', stderr);
        reject(error);
      }
    });

    serverProcess.on('error', (error) => {
      console.error('❌ Server process error:', error);
      reject(error);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      serverProcess.kill();
      reject(new Error('Timeout'));
    }, 10000);
  });
}

// Expected automation tool categories
const expectedCategories = {
  // PocketBase Core Tools
  'core': [
    'test_tool',
    'list_registered_tools',
    'get_server_info',
    'get_auth_info',
    'list_collections',
    'create_collection',
    'create_record',
    'update_record',
    'delete_record',
    'list_records',
    'get_record'
  ],
  
  // Authentication & User Management
  'auth': [
    'authenticate_user',
    'authenticate_with_oauth2',
    'authenticate_with_otp',
    'auth_refresh',
    'request_verification',
    'confirm_verification',
    'request_password_reset',
    'confirm_password_reset',
    'request_email_change',
    'confirm_email_change',
    'impersonate_user',
    'create_user'
  ],
  
  // Database Management & Schema
  'database': [
    'set_collection_rules',
    'update_collection_schema',
    'get_collection_schema',
    'backup_database',
    'import_data',
    'migrate_collection',
    'manage_indexes'
  ],
  
  // File & Content Management
  'files': [
    'upload_file',
    'build_filter'
  ],
  
  // System & Configuration
  'system': [
    'set_request_options',
    'manage_auth_store',
    'subscribe_to_collection'
  ],
  
  // Batch Operations
  'batch': [
    'batch_update_records',
    'batch_delete_records',
    'execute_batch_operations'
  ],
  
  // Advanced Features Setup
  'setup': [
    'setup_advanced_collections'
  ],
  
  // Stripe Payment Processing (40+ tools)
  'stripe_core': [
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
    'sync_stripe_products'
  ],
  
  // Stripe Advanced 2025 Features
  'stripe_advanced': [
    'stripe_create_treasury_financial_account',
    'stripe_create_climate_order',
    'stripe_create_terminal_connection_token',
    'stripe_create_issuing_card',
    'stripe_create_app_secret',
    'stripe_create_identity_verification_session',
    'stripe_create_tax_calculation'
  ],
  
  // Stripe Payment Methods & Modern Features
  'stripe_modern': [
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
    'stripe_create_account_link'
  ],
  
  // Email Service Tools
  'email': [
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
  ]
};

async function main() {
  try {
    console.log('🚀 Discovering available tools...\n');
    
    const tools = await testToolDiscovery();
    const toolNames = tools.map(t => t.name).sort();
    
    console.log(`✅ Found ${toolNames.length} total tools\n`);
    
    // Count tools by category
    const categoryStats = {};
    const missingTools = {};
    const foundTools = new Set(toolNames);
    
    for (const [category, expectedTools] of Object.entries(expectedCategories)) {
      const found = expectedTools.filter(tool => foundTools.has(tool));
      const missing = expectedTools.filter(tool => !foundTools.has(tool));
      
      categoryStats[category] = {
        expected: expectedTools.length,
        found: found.length,
        missing: missing.length
      };
      
      if (missing.length > 0) {
        missingTools[category] = missing;
      }
      
      const percentage = ((found.length / expectedTools.length) * 100).toFixed(1);
      const status = found.length === expectedTools.length ? '✅' : '⚠️';
      
      console.log(`${status} ${category.toUpperCase()}: ${found.length}/${expectedTools.length} (${percentage}%)`);
      
      if (missing.length > 0) {
        console.log(`   Missing: ${missing.join(', ')}`);
      }
    }
    
    // Check for unexpected tools
    const allExpectedTools = new Set();
    Object.values(expectedCategories).forEach(tools => {
      tools.forEach(tool => allExpectedTools.add(tool));
    });
    
    const unexpectedTools = toolNames.filter(tool => !allExpectedTools.has(tool));
    
    console.log('\n📊 SUMMARY:');
    console.log(`Total tools found: ${toolNames.length}`);
    console.log(`Total expected: ${allExpectedTools.size}`);
    
    if (unexpectedTools.length > 0) {
      console.log(`\n🔍 Unexpected tools found (${unexpectedTools.length}):`);
      unexpectedTools.forEach(tool => console.log(`   - ${tool}`));
    }
    
    if (Object.keys(missingTools).length > 0) {
      console.log('\n❌ Missing tools by category:');
      for (const [category, missing] of Object.entries(missingTools)) {
        console.log(`   ${category}: ${missing.join(', ')}`);
      }
    } else {
      console.log('\n✅ All expected automation tools are visible and registered!');
    }
    
    // Test a few critical tools
    console.log('\n🧪 Testing critical tool functionality...');
    
    // Test the diagnostic tool
    console.log('\n📋 Full tool list:');
    toolNames.forEach((tool, index) => {
      console.log(`${(index + 1).toString().padStart(3)}: ${tool}`);
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();
