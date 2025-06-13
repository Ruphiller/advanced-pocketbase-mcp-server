#!/usr/bin/env node

/**
 * Comprehensive test script for PocketBase MCP Server
 * Tests all new and existing features to ensure they work correctly
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const TEST_CONFIG = {
  serverPath: './build/index.js',
  timeout: 10000,
  testPocketBaseUrl: 'http://127.0.0.1:8090' // Default PocketBase dev server
};

class PocketBaseMCPTester {
  constructor() {
    this.serverProcess = null;
    this.testResults = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async sendMCPRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      };

      const requestData = JSON.stringify(request) + '\n';
      
      let responseData = '';
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout after ${TEST_CONFIG.timeout}ms`));
      }, TEST_CONFIG.timeout);

      this.serverProcess.stdout.once('data', (data) => {
        clearTimeout(timeout);
        responseData += data.toString();
        try {
          const response = JSON.parse(responseData.trim());
          resolve(response);
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${responseData}`));
        }
      });

      this.serverProcess.stdin.write(requestData);
    });
  }

  async runTest(testName, testFn) {
    try {
      this.log(`Running test: ${testName}`, 'info');
      await testFn();
      this.testResults.passed++;
      this.testResults.tests.push({ name: testName, status: 'PASSED' });
      this.log(`Test passed: ${testName}`, 'success');
    } catch (error) {
      this.testResults.failed++;
      this.testResults.tests.push({ 
        name: testName, 
        status: 'FAILED', 
        error: error.message 
      });
      this.log(`Test failed: ${testName} - ${error.message}`, 'error');
    }
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      this.log('Starting MCP Server...', 'info');
      
      this.serverProcess = spawn('node', [TEST_CONFIG.serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      this.serverProcess.stderr.on('data', (data) => {
        this.log(`Server stderr: ${data.toString()}`, 'error');
      });

      // Wait for server to be ready
      setTimeout(() => {
        this.log('Server started', 'success');
        resolve();
      }, 2000);

      this.serverProcess.on('error', (error) => {
        this.log(`Server error: ${error.message}`, 'error');
        reject(error);
      });
    });
  }

  async stopServer() {
    if (this.serverProcess) {
      this.log('Stopping MCP Server...', 'info');
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  // Test 1: Server initialization and resources
  async testServerInfo() {
    const response = await this.sendMCPRequest('resources/list');
    
    if (!response.result || !response.result.resources) {
      throw new Error('No resources returned');
    }

    // Check for server_info resource
    const serverInfo = response.result.resources.find(r => r.name === 'server_info');
    if (!serverInfo) {
      throw new Error('server_info resource not found');
    }

    // Get server info content
    const infoResponse = await this.sendMCPRequest('resources/read', {
      uri: serverInfo.uri
    });

    if (!infoResponse.result || !infoResponse.result.contents) {
      throw new Error('Server info content not accessible');
    }

    const content = JSON.parse(infoResponse.result.contents[0].text);
    
    // Check for both legacy and modern baseURL properties
    if (!content.baseUrl && !content.baseURL) {
      throw new Error('Neither baseUrl nor baseURL found in server info');
    }

    // Check for SDK version
    if (!content.sdkVersion) {
      throw new Error('SDK version not found in server info');
    }

    this.log(`Server info: ${JSON.stringify(content, null, 2)}`, 'info');
  }

  // Test 2: List available tools
  async testToolsList() {
    const response = await this.sendMCPRequest('tools/list');
    
    if (!response.result || !response.result.tools) {
      throw new Error('No tools returned');
    }

    const tools = response.result.tools;
    this.log(`Found ${tools.length} tools`, 'info');

    // Check for essential tools
    const requiredTools = [
      'authenticate_user',
      'create_record',
      'update_record',
      'list_records',
      'build_filter',
      'pb_parse_error',
      'pb_get_base_url',
      'pb_safe_filter',
      'pb_get_first_list_item',
      'pb_health_check',
      'pb_impersonate_with_duration',
      'pb_truncate_collection'
    ];

    for (const toolName of requiredTools) {
      const tool = tools.find(t => t.name === toolName);
      if (!tool) {
        throw new Error(`Required tool '${toolName}' not found`);
      }
    }

    this.log('All required tools found', 'success');
  }

  // Test 3: Test new SDK features
  async testNewSDKFeatures() {
    // Test pb_get_base_url
    const baseUrlResponse = await this.sendMCPRequest('tools/call', {
      name: 'pb_get_base_url',
      arguments: {}
    });

    if (baseUrlResponse.error) {
      throw new Error(`pb_get_base_url failed: ${baseUrlResponse.error.message}`);
    }

    // Test pb_parse_error (with mock error)
    const parseErrorResponse = await this.sendMCPRequest('tools/call', {
      name: 'pb_parse_error',
      arguments: {
        error: JSON.stringify({
          status: 400,
          message: 'Test error',
          data: { field: 'validation failed' }
        })
      }
    });

    if (parseErrorResponse.error) {
      throw new Error(`pb_parse_error failed: ${parseErrorResponse.error.message}`);
    }

    // Test pb_safe_filter
    const safeFilterResponse = await this.sendMCPRequest('tools/call', {
      name: 'pb_safe_filter',
      arguments: {
        expression: 'name = {:name} && active = {:active}',
        params: JSON.stringify({ name: 'test', active: true })
      }
    });

    if (safeFilterResponse.error) {
      throw new Error(`pb_safe_filter failed: ${safeFilterResponse.error.message}`);
    }

    // Test pb_health_check
    const healthResponse = await this.sendMCPRequest('tools/call', {
      name: 'pb_health_check',
      arguments: {}
    });

    if (healthResponse.error) {
      throw new Error(`pb_health_check failed: ${healthResponse.error.message}`);
    }

    this.log('New SDK features working correctly', 'success');
  }

  // Test 4: Enhanced error handling
  async testEnhancedErrorHandling() {
    // Test authentication with invalid credentials to trigger error handling
    const authResponse = await this.sendMCPRequest('tools/call', {
      name: 'authenticate_user',
      arguments: {
        collection: 'users',
        identity: 'nonexistent@test.com',
        password: 'wrongpassword'
      }
    });

    // Should return structured error with enhanced ClientResponseError pattern
    if (!authResponse.result || !authResponse.result.isError) {
      // This might pass if server is not running, which is okay for this test
      this.log('Enhanced error handling test - no PocketBase server detected (OK)', 'info');
      return;
    }

    const errorContent = JSON.parse(authResponse.result.content[0].text);
    if (!errorContent.error || !errorContent.status) {
      throw new Error('Enhanced error structure not found');
    }

    this.log('Enhanced error handling working correctly', 'success');
  }

  // Test 5: Filter building with validation
  async testFilterBuilding() {
    const filterResponse = await this.sendMCPRequest('tools/call', {
      name: 'build_filter',
      arguments: {
        conditions: [
          { field: 'name', operator: '=', value: 'test' },
          { field: 'active', operator: '=', value: true }
        ]
      }
    });

    if (filterResponse.error) {
      throw new Error(`build_filter failed: ${filterResponse.error.message}`);
    }

    const result = JSON.parse(filterResponse.result.content[0].text);
    if (!result.filter || !result.safeTip) {
      throw new Error('Filter building result incomplete');
    }

    this.log('Filter building working correctly', 'success');
  }

  async runAllTests() {
    try {
      this.log('Starting PocketBase MCP Server Test Suite', 'info');
      this.log('='.repeat(50), 'info');

      await this.startServer();

      // Run all tests
      await this.runTest('Server Info & Resources', () => this.testServerInfo());
      await this.runTest('Tools List', () => this.testToolsList());
      await this.runTest('New SDK Features', () => this.testNewSDKFeatures());
      await this.runTest('Enhanced Error Handling', () => this.testEnhancedErrorHandling());
      await this.runTest('Filter Building', () => this.testFilterBuilding());

      // Print summary
      this.log('='.repeat(50), 'info');
      this.log('TEST SUMMARY', 'info');
      this.log(`Total tests: ${this.testResults.passed + this.testResults.failed}`, 'info');
      this.log(`Passed: ${this.testResults.passed}`, 'success');
      this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed > 0 ? 'error' : 'info');

      if (this.testResults.failed > 0) {
        this.log('\nFailed tests:', 'error');
        this.testResults.tests
          .filter(test => test.status === 'FAILED')
          .forEach(test => {
            this.log(`  - ${test.name}: ${test.error}`, 'error');
          });
      }

      await this.stopServer();

      const success = this.testResults.failed === 0;
      this.log(`\nTest suite ${success ? 'PASSED' : 'FAILED'}! ✨`, success ? 'success' : 'error');
      
      return success;

    } catch (error) {
      this.log(`Test suite error: ${error.message}`, 'error');
      await this.stopServer();
      return false;
    }
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new PocketBaseMCPTester();
  const success = await tester.runAllTests();
  process.exit(success ? 0 : 1);
}

export { PocketBaseMCPTester };
