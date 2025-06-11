#!/usr/bin/env node

async function testTools() {
  // Temporarily set required environment variables for testing
  process.env.POCKETBASE_URL = 'http://localhost:8090';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_for_initialization';

  try {
    console.log('Loading module...');
    const module = await import('./build/index.js');
    
    console.log('Module loaded, available exports:', Object.keys(module));
    
    // Check if we can find the class
    let PocketBaseServer = module.default;
    if (!PocketBaseServer && module.PocketBaseServer) {
      PocketBaseServer = module.PocketBaseServer;
    }
    
    if (!PocketBaseServer) {
      console.error('❌ PocketBaseServer class not found');
      return;
    }
    
    console.log('Creating server instance...');    
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
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testTools();
