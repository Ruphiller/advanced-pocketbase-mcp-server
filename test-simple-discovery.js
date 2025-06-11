#!/usr/bin/env node

const { spawn } = require('child_process');

console.log('🔍 Testing PocketBase MCP Server Tool Discovery...\n');

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

console.log('📤 Sending tools/list request...');
serverProcess.stdin.write(JSON.stringify(request) + '\n');
serverProcess.stdin.end();

serverProcess.stdout.on('data', (data) => {
  stdout += data.toString();
});

serverProcess.stderr.on('data', (data) => {
  stderr += data.toString();
});

serverProcess.on('close', (code) => {
  console.log('\n📥 Server response received\n');
  
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
      return;
    }

    const tools = response.result.tools;
    const toolNames = tools.map(t => t.name).sort();
    
    console.log(`✅ Found ${toolNames.length} total tools\n`);
    
    // Categorize tools
    const categories = {
      core: toolNames.filter(t => ['test_tool', 'list_registered_tools', 'get_server_info', 'get_auth_info', 'list_collections', 'create_collection', 'create_record', 'update_record', 'delete_record', 'list_records', 'get_record'].includes(t)),
      auth: toolNames.filter(t => t.includes('auth') || t.includes('verification') || t.includes('password') || t.includes('email_change') || t.includes('impersonate') || t.includes('create_user')),
      stripe: toolNames.filter(t => t.startsWith('stripe_')),
      email: toolNames.filter(t => t.includes('email') || t.startsWith('send_') || t.includes('template')),
      database: toolNames.filter(t => ['set_collection_rules', 'update_collection_schema', 'get_collection_schema', 'backup_database', 'import_data', 'migrate_collection', 'manage_indexes'].includes(t)),
      batch: toolNames.filter(t => t.includes('batch') || t.includes('execute_batch')),
      automation: toolNames.filter(t => ['setup_advanced_collections', 'upload_file', 'build_filter', 'set_request_options', 'manage_auth_store', 'subscribe_to_collection'].includes(t))
    };
    
    console.log('📊 Tools by category:');
    Object.entries(categories).forEach(([category, tools]) => {
      if (tools.length > 0) {
        console.log(`\n🔧 ${category.toUpperCase()} (${tools.length}):`);
        tools.forEach(tool => console.log(`   - ${tool}`));
      }
    });
    
    // Check for critical automation tools
    const criticalTools = [
      'setup_advanced_collections',
      'stripe_create_product',
      'stripe_create_customer', 
      'stripe_create_checkout_session',
      'send_email',
      'create_email_template',
      'batch_update_records',
      'backup_database',
      'import_data'
    ];
    
    console.log('\n🎯 Critical automation tools status:');
    criticalTools.forEach(tool => {
      const found = toolNames.includes(tool);
      console.log(`${found ? '✅' : '❌'} ${tool}`);
    });
    
    console.log(`\n📈 SUMMARY: ${toolNames.length} tools total`);
    console.log(`   Core PocketBase: ${categories.core.length}`);
    console.log(`   Authentication: ${categories.auth.length}`);
    console.log(`   Stripe Payments: ${categories.stripe.length}`);
    console.log(`   Email Services: ${categories.email.length}`);
    console.log(`   Database Mgmt: ${categories.database.length}`);
    console.log(`   Batch Operations: ${categories.batch.length}`);
    console.log(`   Automation: ${categories.automation.length}`);
    
  } catch (error) {
    console.error('❌ Error parsing response:', error);
    console.error('STDOUT:', stdout);
    console.error('STDERR:', stderr);
  }
});

serverProcess.on('error', (error) => {
  console.error('❌ Server process error:', error);
});

// Timeout after 10 seconds
setTimeout(() => {
  serverProcess.kill();
  console.log('⏰ Test timeout');
}, 10000);
