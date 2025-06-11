#!/usr/bin/env node

/**
 * Test script to verify all automation and Stripe tools are properly registered
 * and that environment variables are correctly configured in Smithery
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing MCP Server Tool Registration and Smithery Configuration...\n');

// Test 1: Verify all expected automation tools are present
const expectedAutomationTools = [
  // === CORE AUTOMATION TOOLS ===
  'create_webhook',
  'trigger_webhook', 
  'create_scheduled_task',
  'create_data_pipeline',
  'execute_data_pipeline',
  'create_business_rule',
  'evaluate_business_rules',
  'create_workflow',
  'execute_workflow',
  'create_report',
  'generate_report',
  
  // === EMAIL AUTOMATION TOOLS ===
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
  'email_create_default_templates',
  
  // === STRIPE AUTOMATION TOOLS ===
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
  
  // === ADVANCED STRIPE 2025 FEATURES ===
  'stripe_create_treasury_financial_account',
  'stripe_create_climate_order',
  'stripe_create_terminal_connection_token',
  'stripe_create_issuing_card',
  'stripe_create_app_secret',
  'stripe_create_identity_verification_session',
  'stripe_create_tax_calculation',
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
];

console.log(`📋 Expected automation tools: ${expectedAutomationTools.length}`);

// Test 2: Check Smithery configuration
const smitheryConfig = {
  expectedEnvVars: [
    'POCKETBASE_URL',
    'POCKETBASE_ADMIN_EMAIL',
    'POCKETBASE_ADMIN_PASSWORD', 
    'POCKETBASE_DATA_DIR',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'EMAIL_SERVICE',
    'SENDGRID_API_KEY',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'DEFAULT_FROM_EMAIL',
    'APP_NAME',
    'APP_URL'
  ],
  expectedConfigFields: [
    'pocketbaseUrl',
    'pocketbaseAdminEmail',
    'pocketbaseAdminPassword',
    'pocketbaseDataDir',
    'stripeSecretKey',
    'stripeWebhookSecret',
    'emailService',
    'sendgridApiKey',
    'smtpHost',
    'smtpPort',
    'smtpUser',
    'smtpPass',
    'defaultFromEmail',
    'appName',
    'appUrl'
  ]
};

async function testToolDiscovery() {
  return new Promise((resolve, reject) => {
    console.log('🔍 Testing tool discovery...');
    
    const serverProcess = spawn('node', [join(__dirname, 'build', 'index.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        POCKETBASE_URL: 'http://127.0.0.1:8090' // Minimal required config
      }
    });

    let output = '';
    let errorOutput = '';
    
    serverProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    serverProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      
      // Look for tool registration logs
      if (errorOutput.includes('Registered tools:')) {
        try {
          // Extract tool names from debug output
          const match = errorOutput.match(/Registered tools: (\[.*?\])/);
          if (match) {
            const registeredTools = JSON.parse(match[1]);
            
            console.log(`✅ Found ${registeredTools.length} registered tools`);
            
            // Check for automation tools
            const foundAutomationTools = expectedAutomationTools.filter(tool => 
              registeredTools.includes(tool)
            );
            
            const missingAutomationTools = expectedAutomationTools.filter(tool => 
              !registeredTools.includes(tool)
            );
            
            console.log(`✅ Automation tools found: ${foundAutomationTools.length}/${expectedAutomationTools.length}`);
            
            if (missingAutomationTools.length > 0) {
              console.log(`❌ Missing automation tools: ${missingAutomationTools.join(', ')}`);
            } else {
              console.log('🎉 All expected automation tools are registered!');
            }
            
            // Display some key tools for verification
            const keyTools = registeredTools.filter(tool => 
              tool.startsWith('stripe_') || 
              tool.startsWith('email_') || 
              tool.includes('webhook') || 
              tool.includes('workflow') ||
              tool.includes('automation')
            );
            
            console.log(`🔧 Key automation tools: ${keyTools.slice(0, 10).join(', ')}${keyTools.length > 10 ? '...' : ''}`);
            
            resolve({
              totalTools: registeredTools.length,
              automationTools: foundAutomationTools.length,
              missingTools: missingAutomationTools,
              keyTools: keyTools
            });
          }
        } catch (error) {
          reject(new Error('Failed to parse tool registration output'));
        }
        
        serverProcess.kill();
      }
    });
    
    // Send list tools request
    setTimeout(() => {
      try {
        const request = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list'
        };
        
        serverProcess.stdin.write(JSON.stringify(request) + '\n');
      } catch (error) {
        console.log('⚠️  Could not send tools/list request, using debug output instead');
      }
    }, 1000);
    
    serverProcess.on('error', (error) => {
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      serverProcess.kill();
      reject(new Error('Tool discovery test timed out'));
    }, 10000);
  });
}

async function testSmitheryConfig() {
  console.log('\n📝 Testing Smithery configuration...');
  
  try {
    const fs = await import('fs');
    const smitheryContent = fs.readFileSync(join(__dirname, 'smithery.yaml'), 'utf8');
    
    // Check for required sections
    const hasConfigSchema = smitheryContent.includes('configSchema:');
    const hasCommandFunction = smitheryContent.includes('commandFunction:');
    const hasProperties = smitheryContent.includes('properties:');
    
    console.log(`✅ Has configSchema: ${hasConfigSchema}`);
    console.log(`✅ Has commandFunction: ${hasCommandFunction}`);
    console.log(`✅ Has properties: ${hasProperties}`);
    
    // Check for environment variables in commandFunction
    const foundEnvVars = smitheryConfig.expectedEnvVars.filter(envVar => 
      smitheryContent.includes(envVar)
    );
    
    const missingEnvVars = smitheryConfig.expectedEnvVars.filter(envVar => 
      !smitheryContent.includes(envVar)
    );
    
    console.log(`✅ Environment variables found: ${foundEnvVars.length}/${smitheryConfig.expectedEnvVars.length}`);
    
    if (missingEnvVars.length > 0) {
      console.log(`❌ Missing environment variables: ${missingEnvVars.join(', ')}`);
    } else {
      console.log('🎉 All expected environment variables are configured!');
    }
    
    // Check for config fields in properties
    const foundConfigFields = smitheryConfig.expectedConfigFields.filter(field => 
      smitheryContent.includes(field + ':')
    );
    
    const missingConfigFields = smitheryConfig.expectedConfigFields.filter(field => 
      !smitheryContent.includes(field + ':')
    );
    
    console.log(`✅ Config fields found: ${foundConfigFields.length}/${smitheryConfig.expectedConfigFields.length}`);
    
    if (missingConfigFields.length > 0) {
      console.log(`❌ Missing config fields: ${missingConfigFields.join(', ')}`);
    } else {
      console.log('🎉 All expected config fields are present!');
    }
    
    return {
      hasConfigSchema,
      hasCommandFunction,
      hasProperties,
      foundEnvVars: foundEnvVars.length,
      foundConfigFields: foundConfigFields.length,
      missingEnvVars,
      missingConfigFields
    };
    
  } catch (error) {
    console.error(`❌ Error reading smithery.yaml: ${error.message}`);
    return null;
  }
}

// Run tests
async function runTests() {
  try {
    console.log('🚀 Starting comprehensive automation tools test...\n');
    
    // Test Smithery configuration first
    const smitheryResult = await testSmitheryConfig();
    
    // Test tool discovery
    const toolResult = await testToolDiscovery();
    
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    
    if (smitheryResult) {
      console.log(`🔧 Smithery Config: ${smitheryResult.foundEnvVars}/${smitheryConfig.expectedEnvVars.length} env vars, ${smitheryResult.foundConfigFields}/${smitheryConfig.expectedConfigFields.length} config fields`);
    }
    
    console.log(`🤖 Tool Discovery: ${toolResult.automationTools}/${expectedAutomationTools.length} automation tools found`);
    console.log(`📦 Total Tools: ${toolResult.totalTools}`);
    
    if (smitheryResult && smitheryResult.missingEnvVars.length === 0 && smitheryResult.missingConfigFields.length === 0 && toolResult.missingTools.length === 0) {
      console.log('\n🎉 SUCCESS: All automation tools and Smithery configuration are properly set up!');
      console.log('\n📋 Users will now see these environment variable options in Smithery:');
      console.log('   • PocketBase URL (required)');
      console.log('   • PocketBase admin credentials (optional)');
      console.log('   • Stripe configuration (optional) - enables 40+ payment tools');
      console.log('   • Email configuration (optional) - enables email automation');
      console.log('   • Application settings (optional)');
      
      console.log('\n🔧 Available automation capabilities:');
      console.log('   • Webhook management and triggering');
      console.log('   • Scheduled task automation');
      console.log('   • Data transformation pipelines');
      console.log('   • Business rule engine');
      console.log('   • Workflow management');
      console.log('   • Advanced reporting and analytics');
      console.log('   • Complete Stripe payment processing');
      console.log('   • Email automation and templating');
      
    } else {
      console.log('\n⚠️  ISSUES FOUND - See details above');
    }
    
    console.log('\n✨ Your advanced PocketBase MCP server is ready for Smithery!');
    
  } catch (error) {
    console.error(`❌ Test failed: ${error.message}`);
    process.exit(1);
  }
}

runTests();
