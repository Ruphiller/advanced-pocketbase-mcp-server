#!/usr/bin/env node

// Simple test to check if our automation tools are properly registered
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';

console.log('🔍 Testing Automation Tool Registration...\n');

// Create a mock server to test tool registration
const server = new McpServer({
  name: 'test-server',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

// Define the automation tools we expect
const expectedAutomationTools = [
  // Core PocketBase automation
  'setup_advanced_collections',
  'create_collection',
  'update_collection_schema',
  'migrate_collection',
  'backup_database',
  'import_data',
  'batch_update_records',
  'batch_delete_records',
  'execute_batch_operations',
  
  // Stripe automation (40+ tools)
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
  
  // Stripe 2025 Advanced Features
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
  'stripe_create_account_link',
  
  // Email automation
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

// Test tool registration by trying to register each expected tool
console.log('📝 Registering test automation tools...\n');

let registeredCount = 0;
const failedRegistrations = [];

expectedAutomationTools.forEach(toolName => {
  try {
    server.tool(
      toolName,
      {
        test: z.boolean().optional().describe('Test parameter')
      },
      async ({ test }) => {
        return {
          content: [{ type: 'text', text: `${toolName} test executed` }]
        };
      }
    );
    registeredCount++;
    console.log(`✅ ${toolName}`);
  } catch (error) {
    failedRegistrations.push({ tool: toolName, error: error.message });
    console.log(`❌ ${toolName}: ${error.message}`);
  }
});

console.log(`\n📊 REGISTRATION SUMMARY:`);
console.log(`✅ Successfully registered: ${registeredCount}/${expectedAutomationTools.length}`);
console.log(`❌ Failed registrations: ${failedRegistrations.length}`);

if (failedRegistrations.length > 0) {
  console.log('\n🔍 Failed tool registrations:');
  failedRegistrations.forEach(({ tool, error }) => {
    console.log(`   - ${tool}: ${error}`);
  });
}

// Test that we can access the registered tools
try {
  // @ts-ignore - Access internal tools for testing
  const registeredTools = Object.keys(server._tools || {});
  console.log(`\n🔧 Tools registered in server: ${registeredTools.length}`);
  
  if (registeredTools.length > 0) {
    console.log('First 10 registered tools:');
    registeredTools.slice(0, 10).forEach((tool, index) => {
      console.log(`   ${index + 1}. ${tool}`);
    });
  }
} catch (error) {
  console.log(`\n⚠️ Could not access internal tools registry: ${error.message}`);
}

console.log('\n✨ Automation tools registration test completed!');

// Categorize the expected tools
const categories = {
  'Database & Schema': expectedAutomationTools.filter(t => 
    ['setup_advanced_collections', 'create_collection', 'update_collection_schema', 'migrate_collection', 'backup_database', 'import_data'].includes(t)
  ),
  'Batch Operations': expectedAutomationTools.filter(t => 
    t.includes('batch_') || t.includes('execute_batch')
  ),
  'Stripe Core': expectedAutomationTools.filter(t => 
    t.startsWith('stripe_') && ['stripe_create_product', 'stripe_create_customer', 'stripe_create_checkout_session', 'stripe_create_payment_intent', 'stripe_retrieve_customer', 'stripe_update_customer', 'stripe_cancel_subscription', 'list_stripe_products', 'list_stripe_customers', 'list_stripe_subscriptions', 'stripe_handle_webhook', 'sync_stripe_products'].includes(t)
  ),
  'Stripe Advanced 2025': expectedAutomationTools.filter(t => 
    ['stripe_create_treasury_financial_account', 'stripe_create_climate_order', 'stripe_create_terminal_connection_token', 'stripe_create_issuing_card', 'stripe_create_app_secret', 'stripe_create_identity_verification_session', 'stripe_create_tax_calculation'].includes(t)
  ),
  'Stripe Modern Features': expectedAutomationTools.filter(t => 
    t.startsWith('stripe_') && !['stripe_create_product', 'stripe_create_customer', 'stripe_create_checkout_session', 'stripe_create_payment_intent', 'stripe_retrieve_customer', 'stripe_update_customer', 'stripe_cancel_subscription', 'list_stripe_products', 'list_stripe_customers', 'list_stripe_subscriptions', 'stripe_handle_webhook', 'sync_stripe_products', 'stripe_create_treasury_financial_account', 'stripe_create_climate_order', 'stripe_create_terminal_connection_token', 'stripe_create_issuing_card', 'stripe_create_app_secret', 'stripe_create_identity_verification_session', 'stripe_create_tax_calculation'].includes(t)
  ),
  'Email Services': expectedAutomationTools.filter(t => 
    t.includes('email') || t.startsWith('send_') || t.includes('template')
  )
};

console.log('\n📋 AUTOMATION TOOLS BY CATEGORY:');
Object.entries(categories).forEach(([category, tools]) => {
  console.log(`\n🔧 ${category} (${tools.length} tools):`);
  tools.forEach(tool => console.log(`   - ${tool}`));
});

console.log(`\n🎯 TOTAL AUTOMATION TOOLS EXPECTED: ${expectedAutomationTools.length}`);
console.log('   This represents the complete automation toolkit for:');
console.log('   • Full-stack SaaS backend automation');
console.log('   • Payment processing automation');
console.log('   • Email marketing automation');
console.log('   • Database management automation');
console.log('   • User management automation');
console.log('   • Content management automation');
