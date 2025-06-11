#!/usr/bin/env node

// Simple verification script to check if all Stripe tools are present in the source
const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying Stripe Tools Registration...\n');

// Read the source file
const sourceFile = path.join(__dirname, 'src', 'index.ts');
const sourceContent = fs.readFileSync(sourceFile, 'utf8');

// Expected modern Stripe tools that should be present
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

// Advanced Stripe features
const advancedStripeTools = [
  'stripe_create_treasury_financial_account',
  'stripe_create_climate_order',
  'stripe_create_terminal_connection_token',
  'stripe_create_issuing_card',
  'stripe_create_app_secret',
  'stripe_create_identity_verification_session',
  'stripe_create_tax_calculation'
];

// Basic Stripe tools
const basicStripeTools = [
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
];

// Check for all tools
console.log('📊 Checking Modern Stripe Tools:');
let presentModern = 0;
expectedStripeTools.forEach(tool => {
  const isPresent = sourceContent.includes(`'${tool}'`) || sourceContent.includes(`"${tool}"`);
  console.log(`  ${isPresent ? '✅' : '❌'} ${tool}`);
  if (isPresent) presentModern++;
});

console.log(`\n📈 Modern Tools: ${presentModern}/${expectedStripeTools.length} present\n`);

console.log('🚀 Checking Advanced Stripe Features:');
let presentAdvanced = 0;
advancedStripeTools.forEach(tool => {
  const isPresent = sourceContent.includes(`'${tool}'`) || sourceContent.includes(`"${tool}"`);
  console.log(`  ${isPresent ? '✅' : '❌'} ${tool}`);
  if (isPresent) presentAdvanced++;
});

console.log(`\n🔬 Advanced Tools: ${presentAdvanced}/${advancedStripeTools.length} present\n`);

console.log('⚙️ Checking Basic Stripe Tools:');
let presentBasic = 0;
basicStripeTools.forEach(tool => {
  const isPresent = sourceContent.includes(`'${tool}'`) || sourceContent.includes(`"${tool}"`);
  console.log(`  ${isPresent ? '✅' : '❌'} ${tool}`);
  if (isPresent) presentBasic++;
});

console.log(`\n📋 Basic Tools: ${presentBasic}/${basicStripeTools.length} present\n`);

// Check for service initialization
const hasStripeInit = sourceContent.includes('this.stripeService = new StripeService');
const hasEmailInit = sourceContent.includes('this.emailService = new EmailService');

console.log('🔧 Service Initialization:');
console.log(`  ${hasStripeInit ? '✅' : '❌'} Stripe service initialization`);
console.log(`  ${hasEmailInit ? '✅' : '❌'} Email service initialization`);

// Check for conditional tool registration
const hasStripeCondition = sourceContent.includes('if (this.stripeService)');
console.log(`  ${hasStripeCondition ? '✅' : '❌'} Conditional Stripe tool registration`);

// Count total tools
const allTools = [...expectedStripeTools, ...advancedStripeTools, ...basicStripeTools];
const totalPresent = presentModern + presentAdvanced + presentBasic;

console.log('\n📊 Summary:');
console.log(`📈 Total Stripe Tools Expected: ${allTools.length}`);
console.log(`✅ Total Stripe Tools Found: ${totalPresent}`);
console.log(`📊 Coverage: ${Math.round((totalPresent / allTools.length) * 100)}%`);

// Check .env.example for Stripe configuration
const envFile = path.join(__dirname, '.env.example');
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf8');
  const hasStripeKey = envContent.includes('STRIPE_SECRET_KEY');
  console.log(`🔑 Stripe configuration in .env.example: ${hasStripeKey ? '✅' : '❌'}`);
}

// Final assessment
if (totalPresent >= allTools.length * 0.9) {
  console.log('\n🎉 SUCCESS: Comprehensive Stripe integration detected!');
  console.log('   All major Stripe tools are properly registered.');
} else if (totalPresent >= allTools.length * 0.7) {
  console.log('\n⚠️  PARTIAL: Most Stripe tools are present.');
  console.log('   Some advanced features may be missing.');
} else {
  console.log('\n❌ INCOMPLETE: Many Stripe tools are missing.');
  console.log('   Stripe integration may not be fully functional.');
}

console.log('\n✨ Verification completed!');
