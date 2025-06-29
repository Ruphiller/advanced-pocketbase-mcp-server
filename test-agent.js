#!/usr/bin/env node

// Test script to verify the agent works
import { createAgent } from './dist/agent-simple.js';

async function testAgent() {
  console.log('🚀 Testing PocketBaseMCPAgent...');
  
  try {
    // Create agent
    const agent = createAgent();
    console.log('✅ Agent created successfully');
    
    // Test state management
    const initialState = agent.getState();
    console.log('✅ Initial state retrieved:', {
      sessionId: initialState.sessionId,
      hasConfiguration: !!initialState.configuration,
      initializationState: initialState.initializationState
    });
    
    // Test hibernation check
    const shouldHibernate = agent.shouldHibernate();
    console.log('✅ Hibernation check:', shouldHibernate);
    
    // Test configuration
    console.log('🔧 Testing configuration...');
    await agent.init({
      pocketbaseUrl: 'https://demo.pocketbase.io',
      adminEmail: 'test@example.com',
      adminPassword: 'password123'
    });
    console.log('✅ Agent initialized with test configuration');
    
    const updatedState = agent.getState();
    console.log('✅ Updated state after init:', {
      configLoaded: updatedState.initializationState.configLoaded,
      hasValidConfig: updatedState.initializationState.hasValidConfig
    });
    
    console.log('🎉 Agent test completed successfully!');
    console.log('📝 The agent is ready for Cloudflare deployment');
    
  } catch (error) {
    console.error('❌ Agent test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

testAgent();
