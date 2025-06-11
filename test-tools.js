#!/usr/bin/env node

// Temporarily set required environment variables for testing
process.env.POCKETBASE_URL = 'http://localhost:8090';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_initialization';

import('./build/index.js').then(module => {
  try {
    console.log('Testing tool registration...');
    
    // Import the PocketBaseServer class
    const PocketBaseServer = module.default || module.PocketBaseServer;
    
    if (!PocketBaseServer) {
      console.error('PocketBaseServer class not found in module');
      console.log('Available exports:', Object.keys(module));
      return;
    }
    
    const server = new PocketBaseServer();
    console.log('✅ Server initialized successfully');
    
    // Get registered tools
    const tools = server.server._tools || {};
    const toolNames = Object.keys(tools);
    console.log(`\n📊 Total tools registered: ${toolNames.length}`);
    
    // Filter Stripe tools
    const stripeTools = toolNames.filter(name => name.startsWith('stripe_'));
    console.log(`💳 Stripe tools found: ${stripeTools.length}`);
    
    if (stripeTools.length > 0) {
      console.log('\n💳 Stripe Tools:');
      stripeTools.forEach((tool, index) => {
        console.log(`  ${index + 1}. ${tool}`);
      });
    }
    
    // Filter email tools
    const emailTools = toolNames.filter(name => name.includes('email'));
    console.log(`\n📧 Email tools found: ${emailTools.length}`);
    
    if (emailTools.length > 0) {
      console.log('\n📧 Email Tools:');
      emailTools.forEach((tool, index) => {
        console.log(`  ${index + 1}. ${tool}`);
      });
    }
    
    // Show breakdown of tool categories
    const categories = {
      'stripe_': 'Stripe Payment Tools',
      'email': 'Email Tools',
      'create_': 'Creation Tools',
      'list_': 'Listing Tools',
      'update_': 'Update Tools',
      'delete_': 'Deletion Tools',
      'get_': 'Retrieval Tools',
      'auth': 'Authentication Tools',
      'batch_': 'Batch Operations',
      'setup_': 'Setup Tools'
    };
    
    console.log('\n📋 Tool Categories:');
    Object.entries(categories).forEach(([prefix, name]) => {
      const count = toolNames.filter(tool => tool.includes(prefix)).length;
      if (count > 0) {
        console.log(`  ${name}: ${count} tools`);
      }
    });
    
    // Check if all expected modern Stripe tools are present
    const expectedStripeTools = [
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
    
    console.log('\n🔍 Modern Stripe Tools Check:');
    const missingTools = expectedStripeTools.filter(tool => !stripeTools.includes(tool));
    const presentTools = expectedStripeTools.filter(tool => stripeTools.includes(tool));
    
    console.log(`✅ Present: ${presentTools.length}/${expectedStripeTools.length}`);
    if (missingTools.length > 0) {
      console.log('❌ Missing:');
      missingTools.forEach(tool => console.log(`  - ${tool}`));
    } else {
      console.log('🎉 All expected modern Stripe tools are registered!');
    }
    
    // Check for advanced Stripe features
    const advancedStripeTools = stripeTools.filter(tool => 
      tool.includes('treasury') || 
      tool.includes('climate') || 
      tool.includes('terminal') || 
      tool.includes('issuing') || 
      tool.includes('identity') || 
      tool.includes('tax') ||
      tool.includes('apps')
    );
    
    console.log(`\n🚀 Advanced Stripe Features: ${advancedStripeTools.length} tools`);
    if (advancedStripeTools.length > 0) {
      advancedStripeTools.forEach(tool => console.log(`  - ${tool}`));
    }
    
    console.log('\n✨ Tool registration test completed successfully!');
    
  } catch (error) {
    console.error('❌ Initialization error:', error.message);
    console.error('Stack:', error.stack);
  }
}).catch(err => {
  console.error('❌ Import error:', err.message);
  console.error('Stack:', err.stack);
});
