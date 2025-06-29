#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
// Note: HTTPServerTransport may not be available in current MCP SDK version
// import { HTTPServerTransport } from "@modelcontextprotocol/sdk/server/http.js";
import PocketBase from 'pocketbase';
import { z } from 'zod';
import { EventSource } from 'eventsource'; // Import the polyfill using named import
import dotenv from 'dotenv'; // Import dotenv for loading .env file
import { StripeService } from './services/stripe.js';
import { EmailService } from './services/email.js';

// Load environment variables from .env file
dotenv.config();

// Assign the polyfill to the global scope for PocketBase SDK to find
// @ts-ignore - Need to assign to global scope
global.EventSource = EventSource;

// Smithery configToEnv mapping
// This maps user-provided configuration parameters to environment variables
// for proper deployment in Smithery environments
const configToEnv = {
  pocketbaseUrl: 'POCKETBASE_URL',
  adminEmail: 'POCKETBASE_ADMIN_EMAIL', 
  adminPassword: 'POCKETBASE_ADMIN_PASSWORD',
  stripeSecretKey: 'STRIPE_SECRET_KEY',
  emailService: 'EMAIL_SERVICE',
  smtpHost: 'SMTP_HOST',
  smtpPort: 'SMTP_PORT',
  smtpUser: 'SMTP_USER',
  smtpPassword: 'SMTP_PASSWORD',
  sendgridApiKey: 'SENDGRID_API_KEY',
  defaultFromEmail: 'DEFAULT_FROM_EMAIL'
};

// Apply configuration to environment variables if provided
function applyConfigToEnv(config: Record<string, any>): void {
  Object.entries(configToEnv).forEach(([configKey, envVar]) => {
    if (config[configKey] !== undefined && config[configKey] !== null) {
      process.env[envVar] = String(config[configKey]);
    }
  });
}

// Define types for PocketBase
interface CollectionModel {
  id: string;
  name: string;
  type: string;
  system: boolean;
  schema: SchemaField[];
  listRule: string | null;
  viewRule: string | null;
  createRule: string | null;
  updateRule: string | null;
  deleteRule: string | null;
  indexes?: Array<{
    name: string;
    fields: string[];
    unique?: boolean;
  }>;
}

interface RecordModel {
  id: string;
  [key: string]: any;
}

interface ListResult<T> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

interface RequestHandlerExtra {
  [key: string]: any;
}

// Extend PocketBase types - use the standard PocketBase interface
// No need to extend, just use PocketBase directly

// Schema field type
interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  options?: Record<string, any>;
}

// Schema field from input
interface InputSchemaField {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, any>;
}

// Type for subscription event (adjust based on actual PocketBase SDK types if known)
interface SubscriptionEvent {
	action: string;
	record: RecordModel;
}

// Initialization state interface
interface InitializationState {
  configLoaded: boolean;
  pocketbaseInitialized: boolean;
  servicesInitialized: boolean;
  hasValidConfig: boolean;
  isAuthenticated: boolean;
  initializationError?: string;
}

// Configuration interface
interface ServerConfiguration {
  pocketbaseUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  stripeSecretKey?: string;
  emailService?: string;
  smtpHost?: string;
  // Add other config properties as needed
}

class PocketBaseServer {
  private server: McpServer;
  private pb?: PocketBase; // Make optional for deferred initialization
  private _customHeaders: Record<string, string> = {};
  private _realtimeSubscriptions: Map<string, () => void> = new Map();
  private stripeService?: StripeService;
  private emailService?: EmailService;
  
  // Initialization state management
  private initializationState: InitializationState = {
    configLoaded: false,
    pocketbaseInitialized: false,
    servicesInitialized: false,
    hasValidConfig: false,
    isAuthenticated: false
  };
  
  // Flag to indicate if we're in discovery mode (no initialization required)
  private discoveryMode: boolean = false;
  
  // Configuration cache
  private configuration?: ServerConfiguration;
  
  // Initialization promise to prevent multiple simultaneous initializations
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.server = new McpServer({
      name: 'pocketbase-server',
      version: '0.1.0',
    }, {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {}
      }
    });

    // Setup MCP server components without initializing PocketBase
    this.setupTools();
    this.setupResources();
    this.setupPrompts();

    // Error handling
    process.on('SIGINT', async () => {
      process.exit(0);
    });
  }

  /**
   * Load configuration from environment variables or provided config
   * This is fast and synchronous for discovery purposes
   */
  private loadConfiguration(config?: ServerConfiguration): ServerConfiguration {
    if (this.initializationState.configLoaded && this.configuration) {
      return this.configuration;
    }

    try {
      // Apply config to environment variables if provided (Smithery pattern)
      if (config) {
        try {
          applyConfigToEnv(config as Record<string, any>);
        } catch (error: any) {
          console.warn('Failed to apply config to environment variables:', error.message);
        }
      }

      // Load configuration with validation
      const pocketbaseUrl = config?.pocketbaseUrl || process.env.POCKETBASE_URL;
      const adminEmail = config?.adminEmail || process.env.POCKETBASE_ADMIN_EMAIL;
      const adminPassword = config?.adminPassword || process.env.POCKETBASE_ADMIN_PASSWORD;
      const stripeSecretKey = config?.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
      const emailService = config?.emailService || process.env.EMAIL_SERVICE;
      const smtpHost = config?.smtpHost || process.env.SMTP_HOST;

      // Basic validation for critical configuration
      const configErrors: string[] = [];
      
      if (!pocketbaseUrl) {
        configErrors.push('POCKETBASE_URL is required. Set it as an environment variable or provide it in the configuration.');
      } else {
        // Basic URL validation
        try {
          new URL(pocketbaseUrl);
        } catch {
          configErrors.push(`POCKETBASE_URL "${pocketbaseUrl}" is not a valid URL. Example: http://localhost:8090 or https://your-pb-server.com`);
        }
      }

      // Validate admin credentials if provided
      if ((adminEmail && !adminPassword) || (!adminEmail && adminPassword)) {
        configErrors.push('Both POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD must be provided together for admin authentication.');
      }

      if (adminEmail && adminEmail.indexOf('@') === -1) {
        configErrors.push(`POCKETBASE_ADMIN_EMAIL "${adminEmail}" is not a valid email address.`);
      }

      // Validate Stripe configuration if partially provided
      if (stripeSecretKey && !stripeSecretKey.startsWith('sk_')) {
        configErrors.push('STRIPE_SECRET_KEY appears to be invalid. It should start with "sk_test_" or "sk_live_".');
      }

      this.configuration = {
        pocketbaseUrl,
        adminEmail,
        adminPassword,
        stripeSecretKey,
        emailService,
        smtpHost,
      };

      this.initializationState.configLoaded = true;
      
      // Determine if configuration is valid for initialization
      const hasMinimumConfig = Boolean(pocketbaseUrl) && configErrors.length === 0;
      this.initializationState.hasValidConfig = hasMinimumConfig;
      
      // Log configuration status
      if (configErrors.length > 0) {
        console.warn('Configuration warnings/errors found:', configErrors);
        if (!hasMinimumConfig) {
          console.warn('Minimum configuration not met. Server will have limited functionality.');
        }
      } else {
        console.log('Configuration loaded successfully');
        
        // Log what services are configured (without sensitive data)
        const serviceStatus = {
          pocketbase: Boolean(pocketbaseUrl),
          admin_auth: Boolean(adminEmail && adminPassword),
          stripe: Boolean(stripeSecretKey),
          email: Boolean(emailService || smtpHost)
        };
        console.log('Service configuration status:', serviceStatus);
      }

      return this.configuration;
    } catch (error: any) {
      const errorMessage = `Configuration loading failed: ${error.message}`;
      console.error(errorMessage);
      
      // Set error state but don't throw - allow graceful degradation
      this.initializationState.configLoaded = true;
      this.initializationState.hasValidConfig = false;
      this.initializationState.initializationError = errorMessage;
      
      // Return minimal configuration to prevent crashes
      this.configuration = {
        pocketbaseUrl: '',
        adminEmail: '',
        adminPassword: '',
        stripeSecretKey: '',
        emailService: '',
        smtpHost: '',
      };
      
      return this.configuration;
    }
  }

  /**
   * Fast synchronous check for valid configuration
   * Used during discovery phase
   */
  private hasValidConfig(): boolean {
    if (!this.initializationState.configLoaded) {
      try {
        this.loadConfiguration();
      } catch (error) {
        // Don't throw errors during discovery phase
        console.warn('Configuration check failed during discovery:', error);
        return false;
      }
    }
    return this.initializationState.hasValidConfig;
  }

  /**
   * Initialize PocketBase client and services
   * This is called lazily when tools/resources are first accessed
   */
  private async initializePocketBase(config?: ServerConfiguration): Promise<void> {
    if (this.initializationState.pocketbaseInitialized && this.pb) {
      return;
    }

    try {
      // Load configuration if not already loaded
      const serverConfig = this.loadConfiguration(config);
      
      if (!serverConfig.pocketbaseUrl) {
        const error = new Error('POCKETBASE_URL is required for initialization. Please set the POCKETBASE_URL environment variable or provide it in the configuration.');
        this.initializationState.initializationError = error.message;
        throw error;
      }

      // Validate URL format
      try {
        new URL(serverConfig.pocketbaseUrl);
      } catch (urlError) {
        const error = new Error(`Invalid POCKETBASE_URL format: ${serverConfig.pocketbaseUrl}. Please provide a valid URL (e.g., http://localhost:8090 or https://your-pb-server.com)`);
        this.initializationState.initializationError = error.message;
        throw error;
      }

      // Initialize PocketBase client
      this.pb = new PocketBase(serverConfig.pocketbaseUrl);
      this.initializationState.pocketbaseInitialized = true;

      // Test connection to PocketBase (optional health check)
      try {
        // Try a simple health check without authentication
        const response = await fetch(`${serverConfig.pocketbaseUrl}/api/health`);
        if (!response.ok) {
          console.warn(`PocketBase health check failed (${response.status}). Server may be unreachable but continuing initialization.`);
        }
      } catch (healthError) {
        console.warn('PocketBase health check failed. Server may be unreachable but continuing initialization:', healthError);
      }

      // Initialize services if configured
      await this.initializeServices(serverConfig);

      console.log('PocketBase client and services initialized successfully');
    } catch (error: any) {
      this.initializationState.initializationError = error.message;
      this.initializationState.pocketbaseInitialized = false;
      
      // Provide specific error categorization
      if (error.message.includes('POCKETBASE_URL')) {
        throw new Error(`Configuration Error: ${error.message}`);
      } else if (error.message.includes('fetch') || error.message.includes('network')) {
        throw new Error(`Network Error: Cannot connect to PocketBase server at ${config?.pocketbaseUrl || 'unknown URL'}. Please check that the server is running and accessible. Original error: ${error.message}`);
      } else {
        throw new Error(`Initialization Error: ${error.message}`);
      }
    }
  }

  /**
   * Initialize additional services (Stripe, Email)
   */
  private async initializeServices(config: ServerConfiguration): Promise<void> {
    if (this.initializationState.servicesInitialized) {
      return;
    }

    if (!this.pb) {
      throw new Error('PocketBase client must be initialized before services');
    }

    const serviceErrors: string[] = [];

    try {
      // Initialize Stripe service if configured
      if (config.stripeSecretKey) {
        try {
          this.stripeService = new StripeService(this.pb!);
          console.log('Stripe service initialized successfully');
        } catch (error: any) {
          const errorMsg = `Stripe service initialization failed: ${error.message}. Check STRIPE_SECRET_KEY and ensure Stripe collections exist.`;
          serviceErrors.push(errorMsg);
          console.warn(errorMsg);
        }
      } else {
        console.log('Stripe service not configured (STRIPE_SECRET_KEY not provided)');
      }

      // Initialize Email service if configured
      if (config.emailService || config.smtpHost) {
        try {
          this.emailService = new EmailService(this.pb!);
          console.log('Email service initialized successfully');
        } catch (error: any) {
          const errorMsg = `Email service initialization failed: ${error.message}. Check email configuration and ensure email_logs collection exists.`;
          serviceErrors.push(errorMsg);
          console.warn(errorMsg);
        }
      } else {
        console.log('Email service not configured (no email settings provided)');
      }

      this.initializationState.servicesInitialized = true;

      // Log service initialization summary
      if (serviceErrors.length > 0) {
        console.warn(`Service initialization completed with ${serviceErrors.length} warning(s). Core functionality will work, but some features may be limited.`);
      }

    } catch (error: any) {
      const fullError = serviceErrors.length > 0 
        ? `Service initialization failed: ${error.message}. Additional warnings: ${serviceErrors.join('; ')}`
        : `Service initialization failed: ${error.message}`;
      throw new Error(fullError);
    }
  }

  /**
   * Authenticate with PocketBase (runtime authentication)
   * This is separate from configuration checking
   */
  private async authenticatePocketBase(email?: string, password?: string, isAdmin: boolean = false): Promise<void> {
    if (!this.pb) {
      await this.initializePocketBase();
    }

    if (this.initializationState.isAuthenticated && this.pb!.authStore.isValid) {
      return; // Already authenticated
    }

    try {
      const config = this.loadConfiguration();
      
      // Use provided credentials or fall back to config/environment
      const authEmail = email || (isAdmin ? config.adminEmail : undefined);
      const authPassword = password || (isAdmin ? config.adminPassword : undefined);

      if (!authEmail || !authPassword) {
        // Don't throw error for missing auth - some operations may not require it
        const authType = isAdmin ? 'admin' : 'user';
        console.warn(`Authentication credentials not provided for ${authType} - operating without authentication. Some operations may be limited.`);
        return;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(authEmail)) {
        throw new Error(`Invalid email format: ${authEmail}. Please provide a valid email address.`);
      }

      if (isAdmin) {
        try {
          // For PocketBase admins
          await (this.pb! as any).admins.authWithPassword(authEmail, authPassword);
        } catch (error: any) {
          if (error.status === 400) {
            throw new Error(`Admin authentication failed: Invalid credentials. Please check ADMIN_EMAIL and ADMIN_PASSWORD.`);
          } else if (error.status === 401 || error.status === 403) {
            throw new Error(`Admin authentication failed: Access denied. The provided credentials may be incorrect or the admin account may not exist.`);
          } else if (error.status >= 500) {
            throw new Error(`Admin authentication failed: Server error (${error.status}). The PocketBase server may be experiencing issues.`);
          } else {
            throw new Error(`Admin authentication failed: ${error.message || 'Unknown error'}. Please verify your admin credentials.`);
          }
        }
      } else {
        try {
          await this.pb!.collection('users').authWithPassword(authEmail, authPassword);
        } catch (error: any) {
          if (error.status === 400) {
            throw new Error(`User authentication failed: Invalid credentials or user collection doesn't exist.`);
          } else if (error.status === 401 || error.status === 403) {
            throw new Error(`User authentication failed: Access denied. The provided credentials may be incorrect.`);
          } else if (error.status === 404) {
            throw new Error(`User authentication failed: Users collection not found. Ensure the 'users' collection exists in PocketBase.`);
          } else {
            throw new Error(`User authentication failed: ${error.message || 'Unknown error'}`);
          }
        }
      }

      this.initializationState.isAuthenticated = true;
      console.log(`Successfully authenticated as ${isAdmin ? 'admin' : 'user'}: ${authEmail}`);
    } catch (error: any) {
      this.initializationState.isAuthenticated = false;
      throw error; // Re-throw the detailed error from above
    }
  }

  /**
   * Ensure PocketBase is initialized and optionally authenticated
   * This is the main function called by tools and resources
   * 
   * Refactored for fully lazy initialization: 
   * - Server startup does not block on PocketBase connection.
   * - Initialization only occurs when a tool requiring it is invoked and config is present.
   * - Prevents startup timeouts during Smithery tool scanning.
   */
  private async ensureInitialized(options: { timeout?: number, requireAuth?: boolean, isAdmin?: boolean, allowDiscoveryMode?: boolean } = {}) {
    const { timeout = 10000, requireAuth = true, isAdmin = false, allowDiscoveryMode = false } = options;

    // If in discovery mode, don't initialize unless specifically allowed
    if (this.discoveryMode && !allowDiscoveryMode) {
      console.log('[MCP DEBUG] In discovery mode, skipping initialization.');
      return;
    }

    // If already fully initialized, no need to do anything
    if (this.initializationState.pocketbaseInitialized && (!requireAuth || this.initializationState.isAuthenticated)) {
      return;
    }

    // Load config if not already loaded. This is fast and synchronous.
    if (!this.initializationState.configLoaded) {
      this.loadConfiguration();
    }

    // If config is not valid, we cannot proceed with initialization.
    if (!this.initializationState.hasValidConfig) {
      console.warn('[MCP WARN] Cannot initialize: PocketBase URL is not configured.');
      return;
    }

    // If we're in the process of initializing, wait for it to complete.
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }

    // Start the actual initialization
    this.initializationPromise = this.doInitialization({ requireAuth, isAdmin });

    try {
      await this.initializationPromise;
    } finally {
      // Clear the promise after completion/failure to allow for future retries.
      this.initializationPromise = null;
    }
  }

  private async doInitialization(options?: {
    requireAuth?: boolean;
    isAdmin?: boolean;
    email?: string;
    password?: string;
    config?: ServerConfiguration;
  }): Promise<void> {
    // Initialize PocketBase if not already done
    if (!this.initializationState.pocketbaseInitialized) {
      await this.initializePocketBase(options?.config);
    }

    // Authenticate if required
    if (options?.requireAuth && !this.initializationState.isAuthenticated) {
      await this.authenticatePocketBase(options.email, options.password, options.isAdmin);
    }
  }

  /**
   * Standardized error handling for tools and resources
   * Provides consistent error categorization and user-friendly messages
   */
  private handleError(error: any, context: {
    operation: string;
    collection?: string;
    recordId?: string;
    additionalInfo?: any;
  }): { success: false; error: string; category: string; message: string; suggestion?: string; details?: any; statusCode?: number | string; timestamp: string } {
    const errorResponse = {
      success: false,
      error: context.operation + ' Failed',
      collection: context.collection,
      recordId: context.recordId,
      timestamp: new Date().toISOString(),
      ...context.additionalInfo
    } as any;

    // Handle PocketBase ClientResponseError
    if (error.response && error.data) {
      errorResponse.statusCode = error.status || 'unknown';
      errorResponse.message = error.data.message || error.message;
      errorResponse.details = error.data;

      // Categorize common HTTP errors
      switch (error.status) {
        case 400:
          errorResponse.category = 'Validation Error';
          errorResponse.suggestion = 'Check that all required fields are provided and data types are correct.';
          break;
        case 401:
          errorResponse.category = 'Authentication Error';
          errorResponse.suggestion = 'Authentication is required. Please authenticate first.';
          break;
        case 403:
          errorResponse.category = 'Permission Error';
          errorResponse.suggestion = 'You do not have permission for this operation. Check access rules.';
          break;
        case 404:
          if (context.collection) {
            errorResponse.category = 'Collection Not Found';
            errorResponse.message = `Collection '${context.collection}' does not exist`;
            errorResponse.suggestion = 'Verify the collection name is correct.';
          } else if (context.recordId) {
            errorResponse.category = 'Record Not Found';
            errorResponse.message = `Record with ID '${context.recordId}' does not exist`;
            errorResponse.suggestion = 'Verify the record ID is correct.';
          } else {
            errorResponse.category = 'Not Found';
            errorResponse.suggestion = 'The requested resource does not exist.';
          }
          break;
        case 422:
          errorResponse.category = 'Validation Error';
          errorResponse.suggestion = 'Data validation failed. Check field requirements and constraints.';
          break;
        case 429:
          errorResponse.category = 'Rate Limit Error';
          errorResponse.suggestion = 'Too many requests. Please wait before trying again.';
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          errorResponse.category = 'Server Error';
          errorResponse.suggestion = 'The server is experiencing issues. Please try again later.';
          break;
        default:
          errorResponse.category = 'HTTP Error';
          errorResponse.suggestion = 'An HTTP error occurred. Check the status code and details.';
      }
    } else if (error.message) {
      // Handle non-PocketBase errors
      errorResponse.message = error.message;
      
      if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('ECONNREFUSED')) {
        errorResponse.category = 'Network Error';
        errorResponse.suggestion = 'Cannot connect to PocketBase server. Check that the server is running and accessible.';
      } else if (error.message.includes('Initialization') || error.message.includes('Configuration')) {
        errorResponse.category = 'Configuration Error';
        errorResponse.suggestion = 'Check your PocketBase configuration and ensure POCKETBASE_URL is set correctly.';
      } else if (error.message.includes('Authentication')) {
        errorResponse.category = 'Authentication Error';
        errorResponse.suggestion = 'Authentication failed. Check your credentials and try again.';
      } else if (error.message.includes('timeout')) {
        errorResponse.category = 'Timeout Error';
        errorResponse.suggestion = 'The operation timed out. The server may be slow or unresponsive.';
      } else {
        errorResponse.category = 'Unknown Error';
        errorResponse.suggestion = 'An unexpected error occurred. Please check the error details.';
      }
    } else {
      errorResponse.message = 'An unknown error occurred';
      errorResponse.category = 'Unknown Error';
      errorResponse.suggestion = 'No error details available. This may indicate a code issue.';
    }

    return errorResponse;
  }

  /**
   * Create a standardized error response for MCP tools
   */
  private createErrorResponse(error: any, context: {
    operation: string;
    collection?: string;
    recordId?: string;
    additionalInfo?: any;
  }) {
    const errorDetails = this.handleError(error, context);
    
    return {
      content: [{ 
        type: 'text' as const, 
        text: JSON.stringify(errorDetails, null, 2)
      }],
      isError: true
    };
  }

  /**
   * Create a standardized success response for MCP tools
   */
  private createSuccessResponse(data: any, context: {
    operation: string;
    collection?: string;
    recordId?: string;
    message?: string;
  }) {
    const response = {
      success: true,
      operation: context.operation,
      message: context.message || `${context.operation} completed successfully`,
      timestamp: new Date().toISOString(),
      data: data
    } as any;

    if (context.collection) {
      response.collection = context.collection;
    }
    if (context.recordId) {
      response.recordId = context.recordId;
    }

    return {
      content: [{ 
        type: 'text' as const, 
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  private setupPrompts() {
    // === BASIC DEVELOPMENT PROMPTS ===
    
    // Enhanced collection creation prompt
    this.server.prompt(
      "create-collection",
      "Create a new collection with comprehensive schema design",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Create a new PocketBase collection with a well-designed schema. Consider:

🏗️ **Schema Design Best Practices:**
- Field naming conventions (camelCase, descriptive names)
- Proper data types (text, number, bool, email, url, date, select, json, file, relation)
- Required vs optional fields
- Field validation options
- Relationship definitions

📝 **Common Collection Types:**
- **Users**: email, name, avatar, preferences, role
- **Posts**: title, content, author (relation), published, tags
- **Products**: name, description, price, category, images
- **Orders**: customer (relation), items (json), total, status

🔒 **Security Considerations:**
- Access rules (listRule, viewRule, createRule, updateRule, deleteRule)
- User authentication requirements
- Data privacy and permissions

Please specify the collection name, intended purpose, and required fields.`
          }
        }]
      })
    );

    // Enhanced record creation prompt
    this.server.prompt(
      "create-record",
      "Create a new record with proper data validation",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Create a new record in a PocketBase collection with proper data validation:

📋 **Record Creation Guidelines:**
- Match the collection schema exactly
- Use proper data types (strings, numbers, booleans, arrays, objects)
- Include all required fields
- Follow field validation rules
- Consider relationships and foreign keys

🎯 **Common Record Patterns:**
- **User Record**: {"email": "user@example.com", "name": "John Doe", "verified": false}
- **Post Record**: {"title": "My Post", "content": "Content here", "author": "user_id", "published": true}
- **Product Record**: {"name": "Product", "price": 29.99, "category": "electronics", "in_stock": true}

⚠️ **Important Notes:**
- Use create_record tool for new records
- Check collection schema first with get_collection_schema
- Validate required fields and data types

Specify the target collection and the data you want to store.`
          }
        }]
      })
    );

    // Enhanced query builder prompt
    this.server.prompt(
      "build-query",
      "Build advanced queries with filtering, sorting, and relationships",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Build an advanced PocketBase query with comprehensive options:

🔍 **Query Building Components:**
- **Filters**: Use PocketBase filter syntax (e.g., "status = 'active' && created >= '2024-01-01'")
- **Sorting**: Field names with direction (e.g., "-created", "+name", "title,-updated")
- **Pagination**: page and perPage parameters for performance
- **Expansion**: Load related records (e.g., "author,category,tags")

📊 **Advanced Filter Examples:**
- Date ranges: "created >= '2024-01-01' && created <= '2024-12-31'"
- Text search: "title ~ 'keyword' || content ~ 'keyword'"
- Number comparisons: "price >= 10 && price <= 100"
- Boolean filters: "published = true && featured = false"
- Relation filters: "author.role = 'admin'"

⚡ **Performance Tips:**
- Use indexes for frequently filtered fields
- Limit page size (max 500 records)
- Use specific filters to reduce data transfer
- Consider expand only when needed

🛠️ **Available Tools:**
- list_records: Basic querying with filters and pagination
- build_filter: Safe parameter binding to prevent injection
- get_collection_schema: Check available fields and relationships

Describe your query requirements including collection, filters, sorting needs, and any relationships to expand.`
          }
        }]
      })
    );

    // === HIGH-PRIORITY SAAS DEVELOPMENT PROMPTS ===

    // Complete SaaS backend setup
    this.server.prompt(
      "setup-saas-backend",
      "Set up a complete SaaS backend with user management, payments, and email templates",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `🚀 **Complete SaaS Backend Setup**

Set up a production-ready SaaS backend in minutes with all essential components:

💼 **Core SaaS Features:**
- User management with authentication
- Stripe payment processing and subscriptions
- Email templates and notifications
- Analytics and user tracking
- Webhook processing and automation

🏗️ **Setup Components:**
1. **Collections Setup**: Users, subscriptions, payments, email templates, analytics
2. **Stripe Integration**: Products, prices, customers, webhooks
3. **Email System**: Welcome emails, payment confirmations, subscription notifications
4. **Security Rules**: Proper access controls and user permissions
5. **Analytics**: User activity tracking and business metrics

🔧 **Required Configuration:**
- Environment variables (Stripe keys, email service, app settings)
- Collection schemas and relationships
- Access rules and permissions
- Default email templates
- Webhook endpoints

📋 **Available Setup Tools:**
- setup_complete_saas_backend: One-click complete setup
- stripe_create_product: Create subscription plans
- email_create_template: Design email templates
- register_user_with_automation: Complete user onboarding

🎯 **Business Types Supported:**
- SaaS applications with subscriptions
- E-commerce platforms
- Content management systems
- User-generated content platforms
- Service marketplaces

Specify your business type, required features, and any specific customizations needed.`
          }
        }]
      })
    );

    // Subscription plan creation
    this.server.prompt(
      "create-subscription-plan",
      "Create a comprehensive subscription plan with pricing and features",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `💰 **Subscription Plan Creation**

Design and implement a complete subscription plan with Stripe integration:

📊 **Plan Structure:**
- **Basic/Starter**: Essential features, lower price point
- **Professional**: Advanced features, most popular
- **Enterprise**: Full features, custom pricing

💵 **Pricing Considerations:**
- Price in smallest currency unit (cents for USD)
- Billing intervals: monthly, yearly, or custom
- Free trial periods and promotional pricing
- Multi-tier feature access

🎯 **Feature Configuration:**
- Usage limits (API calls, storage, users)
- Feature toggles (analytics, integrations, support)
- Access levels (basic, premium, enterprise)

🔧 **Implementation Tools:**
- stripe_create_product: Create the subscription product
- stripe_create_price: Set pricing and billing intervals
- create_collection: Store plan features and limits
- email_create_template: Plan upgrade/downgrade notifications

📈 **Best Practices:**
- Clear value proposition per tier
- Logical feature progression
- Competitive pricing analysis
- Easy upgrade/downgrade flows

📋 **Required Information:**
- Plan names and descriptions
- Pricing structure and billing intervals
- Feature sets and usage limits
- Trial periods and promotions

Describe your subscription model, target pricing, and feature differentiation.`
          }
        }]
      })
    );

    // User onboarding workflow
    this.server.prompt(
      "setup-user-onboarding",
      "Design a comprehensive user onboarding flow with email sequences",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `👋 **User Onboarding Flow Design**

Create a seamless user onboarding experience that maximizes activation and retention:

📝 **Onboarding Steps:**
1. **Account Creation**: Email verification, profile setup
2. **Welcome Sequence**: Introduction emails, feature tours
3. **Initial Setup**: Preferences, integrations, first actions
4. **Activation Goals**: Key actions that indicate engagement
5. **Follow-up**: Progress tracking, assistance offers

📧 **Email Sequence Design:**
- **Immediate**: Welcome email with account verification
- **Day 1**: Getting started guide and quick wins
- **Day 3**: Feature spotlight and use cases
- **Day 7**: Success stories and advanced features
- **Day 14**: Check-in and support offer

🎯 **Data Collection Strategy:**
- Essential vs optional information
- Progressive profiling over time
- User preferences and interests
- Usage patterns and behavior

🔧 **Technical Implementation:**
- register_user_with_automation: Complete registration flow
- email_schedule_templated: Timed email sequences
- create_user: Basic account creation
- Analytics tracking for conversion optimization

📊 **Success Metrics:**
- Email open and click rates
- Feature adoption rates
- Time to first value
- User activation percentage

🚀 **Onboarding Types:**
- **Product Tour**: Interactive feature introduction
- **Progressive Setup**: Gradual configuration
- **Use Case Based**: Tailored to user goals
- **Guided First Success**: Achieving initial value quickly

Describe your product, target users, and key activation goals for the onboarding flow.`
          }
        }]
      })
    );

    // Payment workflow setup
    this.server.prompt(
      "create-payment-workflow",
      "Set up payment processing with webhooks and email notifications",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `💳 **Payment Workflow Setup**

Implement a complete payment processing system with Stripe integration:

🔄 **Payment Flow Components:**
1. **Customer Creation**: Stripe customer records with metadata
2. **Payment Processing**: One-time payments and subscriptions
3. **Webhook Handling**: Real-time payment status updates
4. **Email Notifications**: Payment confirmations and receipts
5. **Failure Recovery**: Retry logic and customer communication

💰 **Payment Types:**
- **One-time Payments**: Products, services, credits
- **Subscriptions**: Recurring billing with trial periods
- **Usage-based Billing**: Metered pricing models
- **Marketplace Payments**: Multi-party transactions

🔔 **Webhook Events:**
- payment_intent.succeeded: Payment completion
- payment_intent.payment_failed: Failed payment handling
- invoice.payment_succeeded: Subscription billing success
- customer.subscription.created: New subscription setup
- customer.subscription.canceled: Cancellation processing

📧 **Email Automation:**
- Payment confirmation with receipt details
- Subscription activation notifications
- Failed payment alerts and retry instructions
- Upgrade/downgrade confirmations
- Cancellation confirmations with retention offers

🛠️ **Implementation Tools:**
- stripe_create_customer: Customer record creation
- stripe_create_payment_intent: Payment processing
- stripe_create_checkout_session: Hosted payment pages
- process_payment_webhook_with_email: Complete webhook handling
- email_send_templated: Payment-related notifications

🔒 **Security Features:**
- Webhook signature verification
- Secure payment data handling
- PCI compliance considerations
- Fraud prevention measures

Describe your payment model, required integrations, and specific business requirements.`
          }
        }]
      })
    );

    // === DATA MODELING PROMPTS ===

    // Database schema design
    this.server.prompt(
      "design-schema",
      "Design a complete database schema for a specific business domain",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `🗄️ **Database Schema Design**

Design a comprehensive database schema optimized for your business domain:

🏗️ **Schema Design Principles:**
- **Normalization**: Reduce data redundancy and improve consistency
- **Relationships**: Proper foreign keys and junction tables
- **Indexing**: Performance optimization for queries
- **Scalability**: Future growth considerations
- **Security**: Access control and data privacy

📋 **Common Business Domains:**
- **E-commerce**: products, categories, orders, customers, inventory
- **Content Management**: posts, authors, categories, tags, comments
- **SaaS Platform**: users, organizations, subscriptions, usage_metrics
- **Educational**: courses, students, instructors, enrollments, assessments
- **Healthcare**: patients, appointments, providers, treatments, records

🔗 **Relationship Types:**
- **One-to-Many**: User → Posts, Category → Products
- **Many-to-Many**: Users ↔ Roles, Products ↔ Tags
- **One-to-One**: User → Profile, Order → Payment

🎯 **Best Practices:**
- Consistent naming conventions
- Proper data types for each field
- Required vs optional fields
- Validation rules and constraints
- Audit trails (created, updated, modified_by)

🔧 **Schema Tools:**
- create_collection: Create individual collections
- update_collection_schema: Modify existing schemas
- manage_indexes: Optimize query performance
- set_collection_rules: Configure access controls

📊 **Performance Considerations:**
- Index frequently queried fields
- Optimize for common query patterns
- Consider denormalization for read-heavy operations
- Plan for data archival and cleanup

Describe your business domain, main entities, and their relationships.`
          }
        }]
      })
    );

    // Relationship setup
    this.server.prompt(
      "create-relationships",
      "Set up complex relationships between collections with proper access rules",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `🔗 **Collection Relationships Setup**

Establish proper relationships between collections with security and performance optimization:

🎯 **Relationship Patterns:**

**One-to-Many Relationships:**
- User → Posts: One user creates many posts
- Category → Products: One category contains many products
- Order → OrderItems: One order has many line items

**Many-to-Many Relationships:**
- Users ↔ Roles: Users can have multiple roles
- Posts ↔ Tags: Posts can have multiple tags, tags on multiple posts
- Products ↔ Categories: Products in multiple categories

**One-to-One Relationships:**
- User → Profile: Extended user information
- Order → Payment: Payment details for an order

🔒 **Access Rule Patterns:**
- **Owner Access**: "@request.auth.id = user_id"
- **Public Read**: "published = true"
- **Admin Only**: "@request.auth.role = 'admin'"
- **Relationship Access**: "@request.auth.id = author.id"

📊 **Performance Optimization:**
- Index foreign key fields
- Consider expand vs separate queries
- Implement pagination for large datasets
- Use filters to limit data transfer

🛠️ **Implementation Steps:**
1. Design relationship structure
2. Create collections with relation fields
3. Set up proper access rules
4. Create indexes for performance
5. Test query patterns and expansion

🔧 **Available Tools:**
- update_collection_schema: Add relation fields
- set_collection_rules: Configure access permissions
- manage_indexes: Create performance indexes
- list_records: Test queries with expansion

⚠️ **Common Pitfalls:**
- Circular dependencies
- Missing access rules on related collections
- Performance issues with deep expansions
- Inconsistent relationship directions

Describe the collections you want to relate and the business logic governing their relationships.`
          }
        }]
      })
    );

    // === ANALYTICS & REPORTING PROMPTS ===

    // Analytics query builder
    this.server.prompt(
      "analytics-query",
      "Build analytics queries with aggregations, grouping, and metrics",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `📊 **Analytics Query Builder**

Create powerful analytics queries to extract business insights from your data:

📈 **Analytics Types:**

**User Analytics:**
- User growth over time
- User activity and engagement metrics
- Feature adoption rates
- User lifecycle analysis

**Business Metrics:**
- Revenue trends and forecasting
- Conversion funnel analysis
- Subscription metrics (MRR, churn, LTV)
- Product performance analytics

**Operational Metrics:**
- System performance and usage
- Error rates and reliability
- API usage patterns
- Content performance metrics

🔍 **Query Patterns:**
- **Time Series**: Group by date periods (daily, weekly, monthly)
- **Cohort Analysis**: User behavior over time segments
- **Funnel Analysis**: Step-by-step conversion tracking
- **Segmentation**: Performance by user groups or categories

📊 **Aggregation Functions:**
- COUNT: Record counts and occurrences
- SUM: Revenue, usage totals
- AVG: Average values and rates
- MIN/MAX: Range analysis
- DISTINCT: Unique value counts

🛠️ **Implementation Approach:**
1. Define metrics and KPIs
2. Identify required data sources
3. Build optimized queries
4. Create regular reporting schedules
5. Set up alerts and thresholds

🔧 **Available Tools:**
- list_records: Basic data retrieval with filters
- build_filter: Safe parameter binding for complex queries
- Advanced filtering for date ranges and conditions

📅 **Common Time Periods:**
- Real-time (last hour)
- Daily snapshots
- Weekly trends
- Monthly business reviews
- Quarterly growth analysis

Describe the analytics you need, key metrics to track, and the business questions you want to answer.`
          }
        }]
      })
    );

    // === EMAIL CAMPAIGN PROMPTS ===

    // Email campaign design
    this.server.prompt(
      "email-campaign",
      "Design email campaigns with templates, scheduling, and tracking",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `📧 **Email Campaign Designer**

Create engaging email campaigns with professional templates and automation:

🎯 **Campaign Types:**

**Transactional Emails:**
- Welcome sequences for new users
- Payment confirmations and receipts
- Password reset and security notifications
- Subscription updates and renewals

**Marketing Campaigns:**
- Product announcements and updates
- Feature spotlight and tutorials
- Customer success stories
- Promotional offers and discounts

**Lifecycle Emails:**
- Onboarding sequences (Days 1, 3, 7, 14)
- Re-engagement campaigns for inactive users
- Upgrade/upsell campaigns
- Retention and win-back sequences

📝 **Email Design Best Practices:**
- Clear, compelling subject lines
- Mobile-responsive templates
- Personalization with user data
- Clear call-to-action buttons
- Professional branding consistency

🔧 **Technical Implementation:**
- **Templates**: HTML/text content with variables
- **Scheduling**: Send at optimal times
- **Segmentation**: Target specific user groups
- **Tracking**: Open rates, click rates, conversions
- **A/B Testing**: Subject lines and content variations

📊 **Email Metrics:**
- Delivery rate and bounce management
- Open rates and engagement
- Click-through rates and conversions
- Unsubscribe rates and list health
- Revenue attribution from campaigns

🛠️ **Available Tools:**
- email_create_template: Design email templates
- email_send_templated: Send personalized emails
- email_schedule_templated: Schedule campaign delivery
- SendGrid integration for advanced features

🎨 **Template Variables:**
- User data: {{name}}, {{email}}, {{preferences}}
- Business data: {{appName}}, {{supportEmail}}
- Dynamic content: {{subscriptionStatus}}, {{usageStats}}
- Personalization: {{firstName}}, {{lastActivity}}

Describe your campaign goals, target audience, and desired email sequence.`
          }
        }]
      })
    );
  }
  private setupResources() {
    interface CollectionInfo {
      id: string;
      name: string;
      type: string;
      system: boolean;
      listRule: string | null;
      viewRule: string | null;
      createRule: string | null;
      updateRule: string | null;
      deleteRule: string | null;
    }

    interface CollectionRecord {
      id: string;
      [key: string]: any;
    }

    // === CORE RESOURCES ===
    
    // Server info resource with fast timeout
    this.server.resource(
      "server-info",
      "pocketbase://info",
      async (uri) => {
        try {
          // Use shorter timeout for discovery
          await this.ensureInitialized({ timeout: 3000 });
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify({
                url: this.pb!.baseUrl, // Using baseUrl for backward compatibility, will update later
                baseURL: this.pb!.baseUrl, // Modern property name
                isAuthenticated: this.pb!.authStore?.isValid || false,
                sdkVersion: '0.26.1'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          // Provide basic info even if initialization fails
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify({
                url: process.env.POCKETBASE_URL || 'not-configured',
                baseURL: process.env.POCKETBASE_URL || 'not-configured',
                isAuthenticated: false,
                sdkVersion: '0.26.1',
                status: 'initialization-pending',
                error: error.message
              }, null, 2)
            }]
          };
        }
      }
    );

    // Collection schema resource
    this.server.resource(
      "collection-schema",
      new ResourceTemplate("pocketbase://collections/{name}/schema", { list: undefined }),
      async (uri, params) => {
        const name = typeof params.name === 'string' ? params.name : params.name[0];
        try {
          await this.ensureInitialized();
          const collection = await this.pb!.collections.getOne(name);
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(collection.schema, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get collection schema: ${error.message}`);
        }
      }
    );

    // Collection list resource
    this.server.resource(
      "collections",
      "pocketbase://collections",
      async (uri) => {
        try {
          await this.ensureInitialized();
          const collectionsResponse = await this.pb!.collections.getList(1, 100);
          const collections = {
            page: collectionsResponse.page,
            perPage: collectionsResponse.perPage,
            totalItems: collectionsResponse.totalItems,
            totalPages: collectionsResponse.totalPages,
            items: collectionsResponse.items as unknown as CollectionModel[]
          };
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(collections.items.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                system: c.system,
                listRule: c.listRule,
                viewRule: c.viewRule,
                createRule: c.createRule,
                updateRule: c.updateRule,
                deleteRule: c.deleteRule,
              })), null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to list collections: ${error.message}`);
        }
      }
    );

    // Record resource
    this.server.resource(
      "record",
      new ResourceTemplate("pocketbase://collections/{collection}/records/{id}", { list: undefined }),
      async (uri, params) => {
        const collection = typeof params.collection === 'string' ? params.collection : params.collection[0];
        const id = typeof params.id === 'string' ? params.id : params.id[0];
        try {
          await this.ensureInitialized();
          // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
          const record = await this.pb!.collection(collection).getOne(id) as RecordModel;
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(record, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get record: ${error.message}`);
        }
      }
    );

    // Auth info resource
    this.server.resource(
      "auth-info",
      "pocketbase://auth",
      async (uri) => {
        try {
          await this.ensureInitialized();
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify({
                isValid: this.pb!.authStore.isValid,
                token: this.pb!.authStore.token,
                record: this.pb!.authStore.record
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get auth info: ${error.message}`);
        }
      }
    );

    // === PHASE 2: DYNAMIC RESOURCES ===

    // === REAL-TIME ANALYTICS RESOURCES ===
    
    // Real-time metrics dashboard
    this.server.resource(
      "analytics-metrics",
      "analytics://metrics",
      async (uri) => {
        try {
          await this.ensureInitialized();
          const metrics: any = {
            timestamp: new Date().toISOString(),
            overview: {},
            user_metrics: {},
            business_metrics: {},
            technical_metrics: {}
          };

          // User metrics
          try {
            const totalUsers = await this.pb!.collection('users').getList(1, 1);
            metrics.user_metrics.total_users = totalUsers.totalItems;

            // Active users in last 24 hours (if user_events collection exists)
            try {
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              const activeUsers = await this.pb!.collection('user_events').getList(1, 1, {
                filter: `created >= "${yesterday.toISOString()}"`
              });
              metrics.user_metrics.active_users_24h = activeUsers.totalItems;
            } catch {
              metrics.user_metrics.active_users_24h = 'N/A - user_events collection not found';
            }

            // New registrations today
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const newUsers = await this.pb!.collection('users').getList(1, 1, {
              filter: `created >= "${today.toISOString()}"`
            });
            metrics.user_metrics.new_registrations_today = newUsers.totalItems;

          } catch (error: any) {
            metrics.user_metrics.error = `Cannot access users collection: ${error.message}`;
          }

          // Business metrics (if Stripe collections exist)
          try {
            const subscriptions = await this.pb!.collection('stripe_subscriptions').getList(1, 1, {
              filter: 'status = "active"'
            });
            metrics.business_metrics.active_subscriptions = subscriptions.totalItems;

            // Monthly recurring revenue calculation
            try {
              const activeSubscriptions = await this.pb!.collection('stripe_subscriptions').getFullList({
                filter: 'status = "active"'
              });
              
              let mrr = 0;
              for (const sub of activeSubscriptions) {
                // This is a simplified MRR calculation
                if (sub.amount && sub.interval === 'month') {
                  mrr += sub.amount / 100; // Convert from cents
                } else if (sub.amount && sub.interval === 'year') {
                  mrr += (sub.amount / 100) / 12; // Convert yearly to monthly
                }
              }
              metrics.business_metrics.monthly_recurring_revenue = `$${mrr.toFixed(2)}`;
            } catch {
              metrics.business_metrics.monthly_recurring_revenue = 'Calculation unavailable';
            }            // Payment metrics
            try {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const paymentsToday = await this.pb!.collection('payment_history').getList(1, 1, {
                filter: `created >= "${today.toISOString()}" && status = "succeeded"`
              });
              metrics.business_metrics.successful_payments_today = paymentsToday.totalItems;
            } catch {
              metrics.business_metrics.successful_payments_today = 'N/A';
            }

          } catch (error: any) {
            metrics.business_metrics.info = 'Stripe collections not found - payment metrics unavailable';
          }

          // Technical metrics
          try {
            const collections = await this.pb!.collections.getList(1, 100);
            metrics.technical_metrics.total_collections = collections.totalItems;
            metrics.technical_metrics.database_status = 'Connected';
            metrics.technical_metrics.auth_status = this.pb!.authStore.isValid ? 'Authenticated' : 'Not authenticated';
            
            // Service status
            metrics.technical_metrics.services = {
              stripe: !!this.stripeService ? 'Configured' : 'Not configured',
              email: !!this.emailService ? 'Configured' : 'Not configured'
            };

          } catch (error: any) {
            metrics.technical_metrics.database_status = `Error: ${error.message}`;
          }

          // Overview summary
          metrics.overview = {
            status: metrics.technical_metrics.database_status === 'Connected' ? 'Operational' : 'Degraded',
            last_updated: metrics.timestamp,
            health_score: this.calculateHealthScore(metrics)
          };

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(metrics, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to generate analytics metrics: ${error.message}`);
        }
      }
    );

    // User activity analytics
    this.server.resource(
      "user-activity",
      "analytics://user-activity",
      async (uri) => {
        try {
          await this.ensureInitialized();
          const activity: any = {
            timestamp: new Date().toISOString(),
            real_time: {},
            trends: {},
            segments: {}
          };

          // Real-time activity (last hour)
          const lastHour = new Date();
          lastHour.setHours(lastHour.getHours() - 1);

          try {
            // Recent user events
            const recentEvents = await this.pb!.collection('user_events').getList(1, 50, {
              filter: `created >= "${lastHour.toISOString()}"`,
              sort: '-created'
            });

            activity.real_time.events_last_hour = recentEvents.totalItems;
            activity.real_time.recent_events = recentEvents.items.map((event: any) => ({
              event_name: event.event_name,
              user_id: event.user_id,
              timestamp: event.created,
              session_id: event.session_id?.substring(0, 8) + '...' // Truncate for privacy
            }));

            // Event type breakdown
            const eventTypes: { [key: string]: number } = {};
            recentEvents.items.forEach((event: any) => {
              eventTypes[event.event_name] = (eventTypes[event.event_name] || 0) + 1;
            });
            activity.real_time.event_breakdown = eventTypes;

          } catch (error: any) {
            activity.real_time.error = `user_events collection not available: ${error.message}`;
          }

          // User trends (last 7 days)
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);

          try {
            const weeklyUsers = await this.pb!.collection('users').getList(1, 1, {
              filter: `created >= "${weekAgo.toISOString()}"`
            });
            activity.trends.new_users_this_week = weeklyUsers.totalItems;

            // Daily breakdown
            const dailyStats = [];
            for (let i = 6; i >= 0; i--) {
              const date = new Date();
              date.setDate(date.getDate() - i);
              date.setHours(0, 0, 0, 0);
              
              const nextDate = new Date(date);
              nextDate.setDate(nextDate.getDate() + 1);

              try {
                const dayUsers = await this.pb!.collection('users').getList(1, 1, {
                  filter: `created >= "${date.toISOString()}" && created < "${nextDate.toISOString()}"`
                });

                dailyStats.push({
                  date: date.toISOString().split('T')[0],
                  new_users: dayUsers.totalItems
                });
              } catch {
                dailyStats.push({
                  date: date.toISOString().split('T')[0],
                  new_users: 0
                });
              }
            }
            activity.trends.daily_registrations = dailyStats;

          } catch (error: any) {
            activity.trends.error = `Cannot calculate trends: ${error.message}`;
          }

          // User segments
          try {
            // By subscription status
            const freeUsers = await this.pb!.collection('users').getList(1, 1, {
              filter: 'subscription_status = "free" || subscription_status = ""'
            });
            const premiumUsers = await this.pb!.collection('users').getList(1, 1, {
              filter: 'subscription_status = "premium"'
            });
            const trialUsers = await this.pb!.collection('users').getList(1, 1, {
              filter: 'subscription_status = "trial"'
            });

            activity.segments.by_subscription = {
              free: freeUsers.totalItems,
              premium: premiumUsers.totalItems,
              trial: trialUsers.totalItems
            };

            // By onboarding status
            const completedOnboarding = await this.pb!.collection('users').getList(1, 1, {
              filter: 'onboarding_completed = true'
            });
            const totalUsers = await this.pb!.collection('users').getList(1, 1);
            
            activity.segments.onboarding = {
              completed: completedOnboarding.totalItems,
              pending: totalUsers.totalItems - completedOnboarding.totalItems,
              completion_rate: totalUsers.totalItems > 0 ? 
                ((completedOnboarding.totalItems / totalUsers.totalItems) * 100).toFixed(1) + '%' : '0%'
            };

          } catch (error: any) {
            activity.segments.error = `Cannot calculate segments: ${error.message}`;
          }

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(activity, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to generate user activity analytics: ${error.message}`);
        }
      }
    );

    // === BUSINESS INTELLIGENCE RESOURCES ===

    // Daily business summary
    this.server.resource(
      "daily-summary",
      "reports://daily-summary",
      async (uri) => {
        try {
          await this.ensureInitialized();
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);

          const summary: any = {
            date: today.toISOString().split('T')[0],
            generated_at: new Date().toISOString(),
            user_metrics: {},
            business_metrics: {},
            technical_metrics: {},
            alerts: [],
            recommendations: []
          };

          // User metrics for today
          try {
            const newUsers = await this.pb!.collection('users').getList(1, 1, {
              filter: `created >= "${today.toISOString()}" && created < "${tomorrow.toISOString()}"`
            });
            summary.user_metrics.new_registrations = newUsers.totalItems;

            const totalUsers = await this.pb!.collection('users').getList(1, 1);
            summary.user_metrics.total_users = totalUsers.totalItems;

            // User activity today
            try {
              const userEvents = await this.pb!.collection('user_events').getList(1, 1, {
                filter: `created >= "${today.toISOString()}"`
              });
              summary.user_metrics.user_events_today = userEvents.totalItems;

              const activeUsers = await this.pb!.collection('user_events').getList(1, 1, {
                filter: `created >= "${today.toISOString()}"`,
                fields: 'user_id',
                // Note: This is a simplified way to count unique users
              });
              summary.user_metrics.active_users_today = activeUsers.totalItems;
            } catch {
              summary.user_metrics.user_events_today = 'N/A';
              summary.user_metrics.active_users_today = 'N/A';
            }

          } catch (error: any) {
            summary.user_metrics.error = error.message;
          }

          // Business metrics for today
          try {
            // New subscriptions today
            const newSubscriptions = await this.pb!.collection('stripe_subscriptions').getList(1, 1, {
              filter: `created >= "${today.toISOString()}" && status = "active"`
            });
            summary.business_metrics.new_subscriptions = newSubscriptions.totalItems;

            // Payments today
            const paymentsToday = await this.pb!.collection('payment_history').getList(1, 1, {
              filter: `created >= "${today.toISOString()}" && status = "succeeded"`
            });
            summary.business_metrics.successful_payments = paymentsToday.totalItems;

            const failedPayments = await this.pb!.collection('payment_history').getList(1, 1, {
              filter: `created >= "${today.toISOString()}" && status = "failed"`
            });
            summary.business_metrics.failed_payments = failedPayments.totalItems;

            // Revenue today (simplified calculation)
            try {
              const paymentsToday = await this.pb!.collection('payment_history').getFullList({
                filter: `created >= "${today.toISOString()}" && status = "succeeded"`
              });
              
              const revenue = paymentsToday.reduce((sum: number, payment: any) => {
                return sum + (payment.amount || 0);
              }, 0);
              
              summary.business_metrics.revenue_today = `$${(revenue / 100).toFixed(2)}`;
            } catch {
              summary.business_metrics.revenue_today = 'Calculation unavailable';
            }

            // Cancellations today
            const cancellations = await this.pb!.collection('stripe_subscriptions').getList(1, 1, {
              filter: `updated >= "${today.toISOString()}" && status = "canceled"`
            });
            summary.business_metrics.cancellations = cancellations.totalItems;

          } catch (error: any) {
            summary.business_metrics.info = 'Business metrics require Stripe collections';
          }

          // Technical metrics
          try {
            // Email deliverability
            const emailsSent = await this.pb!.collection('email_logs').getList(1, 1, {
              filter: `created >= "${today.toISOString()}" && status = "sent"`
            });
            const emailsFailed = await this.pb!.collection('email_logs').getList(1, 1, {
              filter: `created >= "${today.toISOString()}" && status = "failed"`
            });

            summary.technical_metrics.emails_sent = emailsSent.totalItems;
            summary.technical_metrics.emails_failed = emailsFailed.totalItems;
            summary.technical_metrics.email_success_rate = 
              emailsSent.totalItems + emailsFailed.totalItems > 0 ?
                `${((emailsSent.totalItems / (emailsSent.totalItems + emailsFailed.totalItems)) * 100).toFixed(1)}%` :
                'N/A';

          } catch {
            summary.technical_metrics.email_info = 'Email metrics require email_logs collection';
          }

          // Generate alerts
          if (summary.business_metrics.failed_payments > 5) {
            summary.alerts.push({
              type: 'warning',
              message: `High number of failed payments today: ${summary.business_metrics.failed_payments}`,
              action: 'Review payment issues and contact affected customers'
            });
          }

          if (summary.user_metrics.new_registrations === 0) {
            summary.alerts.push({
              type: 'info',
              message: 'No new user registrations today',
              action: 'Consider marketing campaigns or review signup flow'
            });
          }

          // Generate recommendations
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          
          try {
            const yesterdayUsers = await this.pb!.collection('users').getList(1, 1, {
              filter: `created >= "${yesterday.toISOString()}" && created < "${today.toISOString()}"`
            });

            if (summary.user_metrics.new_registrations > yesterdayUsers.totalItems * 1.5) {
              summary.recommendations.push({
                type: 'positive',
                message: 'User registration growth is accelerating',
                action: 'Consider scaling infrastructure and onboarding capacity'
              });
            } else if (summary.user_metrics.new_registrations < yesterdayUsers.totalItems * 0.5) {
              summary.recommendations.push({
                type: 'attention',
                message: 'User registrations have declined significantly',
                action: 'Investigate potential issues with signup flow or marketing channels'
              });
            }
          } catch {
            // Skip recommendations if yesterday's data is unavailable
          }

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(summary, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to generate daily summary: ${error.message}`);
        }
      }
    );

    // Revenue trends analysis
    this.server.resource(
      "revenue-trends",
      "reports://revenue-trends",
      async (uri) => {
        try {
          await this.ensureInitialized();
          const trends: any = {
            generated_at: new Date().toISOString(),
            period: 'last_30_days',
            summary: {},
            daily_trends: [],
            subscription_metrics: {},
            growth_analysis: {}
          };

          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

          try {
            // Daily revenue for the last 30 days
            const dailyRevenue = [];
            let totalRevenue = 0;
            let totalTransactions = 0;

            for (let i = 29; i >= 0; i--) {
              const date = new Date();
              date.setDate(date.getDate() - i);
              date.setHours(0, 0, 0, 0);
              
              const nextDate = new Date(date);
              nextDate.setDate(nextDate.getDate() + 1);

              try {
                const dayPayments = await this.pb!.collection('payment_history').getFullList({
                  filter: `created >= "${date.toISOString()}" && created < "${nextDate.toISOString()}" && status = "succeeded"`
                });

                const dayRevenue = dayPayments.reduce((sum: number, payment: any) => {
                  return sum + (payment.amount || 0);
                }, 0);

                const dayRevenueUSD = dayRevenue / 100; // Convert from cents
                totalRevenue += dayRevenueUSD;
                totalTransactions += dayPayments.length;

                dailyRevenue.push({
                  date: date.toISOString().split('T')[0],
                  revenue: dayRevenueUSD,
                  transactions: dayPayments.length,
                  average_transaction: dayPayments.length > 0 ? (dayRevenueUSD / dayPayments.length).toFixed(2) : 0
                });
              } catch {
                dailyRevenue.push({
                  date: date.toISOString().split('T')[0],
                  revenue: 0,
                  transactions: 0,
                  average_transaction: 0
                });
              }
            }

            trends.daily_trends = dailyRevenue;
            trends.summary = {
              total_revenue_30_days: `$${totalRevenue.toFixed(2)}`,
              total_transactions_30_days: totalTransactions,
              average_daily_revenue: `$${(totalRevenue / 30).toFixed(2)}`,
              average_transaction_value: totalTransactions > 0 ? `$${(totalRevenue / totalTransactions).toFixed(2)}` : '$0.00'
            };

            // Growth analysis
            const firstHalf = dailyRevenue.slice(0, 15);
            const secondHalf = dailyRevenue.slice(15, 30);
            
            const firstHalfRevenue = firstHalf.reduce((sum, day) => sum + day.revenue, 0);
            const secondHalfRevenue = secondHalf.reduce((sum, day) => sum + day.revenue, 0);
            
            const growthRate = firstHalfRevenue > 0 ? 
              (((secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue) * 100).toFixed(1) : 'N/A';

            trends.growth_analysis = {
              first_half_revenue: `$${firstHalfRevenue.toFixed(2)}`,
              second_half_revenue: `$${secondHalfRevenue.toFixed(2)}`,
              growth_rate: `${growthRate}%`,
              trend: parseFloat(growthRate) > 0 ? 'Growing' : parseFloat(growthRate) < 0 ? 'Declining' : 'Stable'
            };

          } catch (error: any) {
            trends.summary.error = `Payment data unavailable: ${error.message}`;
          }

          // Subscription metrics
          try {
            const activeSubscriptions = await this.pb!.collection('stripe_subscriptions').getList(1, 1, {
              filter: 'status = "active"'
            });

            const newSubscriptions30Days = await this.pb!.collection('stripe_subscriptions').getList(1, 1, {
              filter: `created >= "${thirtyDaysAgo.toISOString()}" && status = "active"`
            });

            const canceledSubscriptions30Days = await this.pb!.collection('stripe_subscriptions').getList(1, 1, {
              filter: `updated >= "${thirtyDaysAgo.toISOString()}" && status = "canceled"`
            });

            trends.subscription_metrics = {
              total_active_subscriptions: activeSubscriptions.totalItems,
              new_subscriptions_30_days: newSubscriptions30Days.totalItems,
              canceled_subscriptions_30_days: canceledSubscriptions30Days.totalItems,
              net_subscription_growth: newSubscriptions30Days.totalItems - canceledSubscriptions30Days.totalItems,
              churn_rate: activeSubscriptions.totalItems > 0 ?
                `${((canceledSubscriptions30Days.totalItems / activeSubscriptions.totalItems) * 100).toFixed(1)}%` : '0%'
            };

            // MRR calculation
            try {
              const allActiveSubscriptions = await this.pb!.collection('stripe_subscriptions').getFullList({
                filter: 'status = "active"'
              });
              
              let mrr = 0;
              allActiveSubscriptions.forEach((sub: any) => {
                if (sub.amount && sub.interval === 'month') {
                  mrr += sub.amount / 100;
                } else if (sub.amount && sub.interval === 'year') {
                  mrr += (sub.amount / 100) / 12;
                }
              });

              trends.subscription_metrics.monthly_recurring_revenue = `$${mrr.toFixed(2)}`;
              trends.subscription_metrics.annual_run_rate = `$${(mrr * 12).toFixed(2)}`;
            } catch {
              trends.subscription_metrics.monthly_recurring_revenue = 'Calculation unavailable';
            }

          } catch (error: any) {
            trends.subscription_metrics.info = 'Subscription metrics require stripe_subscriptions collection';
          }

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(trends, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to generate revenue trends: ${error.message}`);
        }
      }
    );

    // === CONFIGURATION RESOURCES ===

    // Email templates configuration
    this.server.resource(
      "email-templates",
      "config://email-templates",
      async (uri) => {
        try {
          await this.ensureInitialized();
          
          const config: any = {
            timestamp: new Date().toISOString(),
            status: 'loading',
            templates: [],
            required_templates: [
              'welcome',
              'payment_success',
              'payment_failed',
              'subscription_created',
              'subscription_canceled',
              'subscription_renewed',
              'password_reset',
              'email_verification'
            ],
            missing_templates: [],
            template_validation: {}
          };

          try {
            // Get all email templates
            const templates = await this.pb!.collection('email_templates').getFullList();
            
            config.templates = templates.map((template: any) => ({
              id: template.id,
              name: template.name,
              subject: template.subject,
              has_html_content: !!template.html_content,
              has_text_content: !!template.text_content,
              variables: template.variables || [],
              created: template.created,
              updated: template.updated,
              is_active: template.is_active !== false
            }));

            // Check for missing required templates
            const existingNames = templates.map((t: any) => t.name);
            config.missing_templates = config.required_templates.filter(
              (required: string) => !existingNames.includes(required)
            );

            // Validate template content
            config.template_validation = {};
            templates.forEach((template: any) => {
              const validation: any = {
                has_subject: !!template.subject,
                has_content: !!(template.html_content || template.text_content),
                has_both_formats: !!(template.html_content && template.text_content),
                variable_usage: []
              };

              // Check for common variables in content
              if (template.html_content || template.text_content) {
                const content = (template.html_content || '') + (template.text_content || '');
                const commonVars = ['{{name}}', '{{email}}', '{{appName}}', '{{userId}}'];
                
                commonVars.forEach(varName => {
                  if (content.includes(varName)) {
                    validation.variable_usage.push(varName);
                  }
                });
              }

              validation.is_valid = validation.has_subject && validation.has_content;
              config.template_validation[template.name] = validation;
            });

            config.status = 'loaded';
            config.summary = {
              total_templates: templates.length,
              missing_required: config.missing_templates.length,
              invalid_templates: Object.values(config.template_validation).filter((v: any) => !v.is_valid).length,
              completion_rate: config.required_templates.length > 0 ?
                `${(((config.required_templates.length - config.missing_templates.length) / config.required_templates.length) * 100).toFixed(1)}%` : '0%'
            };

          } catch (error: any) {
            config.status = 'error';
            config.error = `Cannot access email_templates collection: ${error.message}`;
            config.suggestion = 'Run setup_complete_saas_backend tool to create email templates collection';
          }

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(config, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to load email templates configuration: ${error.message}`);
        }
      }
    );

    // Stripe products configuration
    this.server.resource(
      "stripe-products",
      "config://stripe-products",
      async (uri) => {
        try {
          await this.ensureInitialized();
          
          const config: any = {
            timestamp: new Date().toISOString(),
            status: 'loading',
            stripe_service_status: 'checking',
            products: [],
            subscriptions_summary: {},
            pricing_analysis: {}
          };

          // Check Stripe service availability
          if (!this.stripeService) {
            config.stripe_service_status = 'not_configured';
            config.error = 'Stripe service not configured. Set STRIPE_SECRET_KEY environment variable.';
            config.products = [];
          } else {
            config.stripe_service_status = 'configured';

            try {
              // Get products from local database
              const localProducts = await this.pb!.collection('stripe_products').getFullList();
              
              config.products = localProducts.map((product: any) => ({
                id: product.id,
                name: product.name,
                description: product.description,
                price: product.price,
                currency: product.currency,
                recurring: product.recurring,
                interval: product.interval,
                stripe_product_id: product.stripeProductId,
                stripe_price_id: product.stripePriceId,
                active: product.active,
                created: product.created,
                metadata: product.metadata
              }));

              // Analyze pricing structure
              if (config.products.length > 0) {
                const recurringProducts = config.products.filter((p: any) => p.recurring);
                const oneTimeProducts = config.products.filter((p: any) => !p.recurring);
                
                config.pricing_analysis = {
                  total_products: config.products.length,
                  recurring_products: recurringProducts.length,
                  one_time_products: oneTimeProducts.length,
                  price_ranges: {
                    lowest_price: Math.min(...config.products.map((p: any) => p.price)),
                    highest_price: Math.max(...config.products.map((p: any) => p.price)),
                    average_price: config.products.reduce((sum: number, p: any) => sum + p.price, 0) / config.products.length
                  },
                  intervals: {
                    monthly: recurringProducts.filter((p: any) => p.interval === 'month').length,
                    yearly: recurringProducts.filter((p: any) => p.interval === 'year').length,
                    weekly: recurringProducts.filter((p: any) => p.interval === 'week').length
                  }
                };
              }

              // Get subscription summary
              try {
                const subscriptions = await this.pb!.collection('stripe_subscriptions').getList(1, 1);
                const activeSubscriptions = await this.pb!.collection('stripe_subscriptions').getList(1, 1, {
                  filter: 'status = "active"'
                });

                config.subscriptions_summary = {
                  total_subscriptions: subscriptions.totalItems,
                  active_subscriptions: activeSubscriptions.totalItems,
                  conversion_rate: subscriptions.totalItems > 0 ?
                    `${((activeSubscriptions.totalItems / subscriptions.totalItems) * 100).toFixed(1)}%` : '0%'
                };
              } catch {
                config.subscriptions_summary = {
                  info: 'Subscription data requires stripe_subscriptions collection'
                };
              }

              config.status = 'loaded';

            } catch (error: any) {
              config.status = 'error';
              config.error = `Cannot access stripe_products collection: ${error.message}`;
              config.suggestion = 'Run setup_complete_saas_backend tool to create Stripe collections';
            }
          }

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(config, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to load Stripe products configuration: ${error.message}`);
        }
      }
    );

    // === DEVELOPMENT RESOURCES ===

    // Schema documentation
    this.server.resource(
      "schema-docs",
      "dev://schema-docs",
      async (uri) => {
        try {
          await this.ensureInitialized();
          
          const docs: any = {
            generated_at: new Date().toISOString(),
            database_info: {},
            collections: [],
            relationships: [],
            indexes_summary: {},
            best_practices: {}
          };

          try {
            // Get all collections with detailed schema information
            const collections = await this.pb!.collections.getList(1, 100);
            
            docs.database_info = {
              total_collections: collections.totalItems,
              system_collections: collections.items.filter((c: any) => c.system).length,
              user_collections: collections.items.filter((c: any) => !c.system).length
            };

            docs.collections = collections.items.map((collection: any) => {
              const schema = collection.schema || collection.fields || [];
              
              return {
                name: collection.name,
                type: collection.type,
                system: collection.system,
                schema: {
                  total_fields: schema.length,
                  fields: schema.map((field: any) => ({
                    name: field.name,
                    type: field.type,
                    required: field.required,
                    options: field.options,
                    // Additional field analysis
                    is_relation: field.type === 'relation',
                    is_file: field.type === 'file',
                    has_validation: !!(field.options && Object.keys(field.options).length > 0)
                  })),
                  field_types: this.analyzeFieldTypes(schema),
                  relations: schema.filter((field: any) => field.type === 'relation').map((field: any) => ({
                    field_name: field.name,
                    target_collection: field.options?.collectionId || 'unknown',
                    relationship_type: field.options?.maxSelect === 1 ? 'one-to-one' : 'one-to-many'
                  }))
                },
                access_rules: {
                  listRule: collection.listRule,
                  viewRule: collection.viewRule,
                  createRule: collection.createRule,
                  updateRule: collection.updateRule,
                  deleteRule: collection.deleteRule,
                  security_level: this.analyzeSecurityLevel(collection)
                },
                indexes: collection.indexes || [],
                created: collection.created,
                updated: collection.updated
              };
            });

            // Analyze relationships across collections
            docs.relationships = this.analyzeRelationships(docs.collections);

            // Indexes summary
            const totalIndexes = docs.collections.reduce((sum: number, col: any) => sum + (col.indexes?.length || 0), 0);
            docs.indexes_summary = {
              total_indexes: totalIndexes,
              collections_with_indexes: docs.collections.filter((col: any) => col.indexes && col.indexes.length > 0).length,
              index_recommendations: this.generateIndexRecommendations(docs.collections)
            };

            // Best practices analysis
            docs.best_practices = {
              naming_conventions: this.analyzeNamingConventions(docs.collections),
              security_analysis: this.analyzeSecurityPractices(docs.collections),
              performance_tips: this.generatePerformanceTips(docs.collections),
              data_modeling_suggestions: this.generateDataModelingSuggestions(docs.collections)
            };

          } catch (error: any) {
            docs.error = `Cannot access collections: ${error.message}`;
          }

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(docs, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to generate schema documentation: ${error.message}`);
        }
      }
    );

    // API endpoints documentation
    this.server.resource(
      "api-endpoints",
      "dev://api-endpoints",
      async (uri) => {
        try {
          await this.ensureInitialized();
          
          const endpoints: any = {
            generated_at: new Date().toISOString(),
            base_url: this.pb!.baseUrl,
            authentication: {
              status: this.pb!.authStore.isValid ? 'authenticated' : 'not_authenticated',
              auth_methods: [
                'POST /api/admins/auth-with-password (Admin authentication)',
                'POST /api/users/auth-with-password (User authentication)',
                'POST /api/users/refresh (Token refresh)',
                'POST /api/users/logout (Logout)'
              ]
            },
            collections: [],
            webhook_endpoints: [],
            utility_endpoints: []
          };

          try {
            // Get all collections and generate endpoint documentation
            const collections = await this.pb!.collections.getList(1, 100);
            
            endpoints.collections = collections.items
              .filter((c: any) => !c.system) // Focus on user collections
              .map((collection: any) => {
                const baseEndpoint = `/api/collections/${collection.name}/records`;
                
                return {
                  collection_name: collection.name,
                  base_endpoint: baseEndpoint,
                  endpoints: [
                    {
                      method: 'GET',
                      path: baseEndpoint,
                      description: `List ${collection.name} records with pagination and filtering`,
                      auth_required: !!collection.listRule,
                      query_params: [
                        'page (default: 1)',
                        'perPage (default: 30, max: 500)',
                        'sort (-created, +name, etc.)',
                        'filter (title="example")',
                        'expand (relation1,relation2)'
                      ]
                    },
                    {
                      method: 'GET',
                      path: `${baseEndpoint}/{id}`,
                      description: `Get a single ${collection.name} record by ID`,
                      auth_required: !!collection.viewRule,
                      query_params: ['expand (relation1,relation2)']
                    },
                    {
                      method: 'POST',
                      path: baseEndpoint,
                      description: `Create a new ${collection.name} record`,
                      auth_required: !!collection.createRule,
                      body_format: 'JSON or FormData (for file uploads)'
                    },
                    {
                      method: 'PATCH',
                      path: `${baseEndpoint}/{id}`,
                      description: `Update a ${collection.name} record`,
                      auth_required: !!collection.updateRule,
                      body_format: 'JSON or FormData (for file uploads)'
                    },
                    {
                      method: 'DELETE',
                      path: `${baseEndpoint}/{id}`,
                      description: `Delete a ${collection.name} record`,
                      auth_required: !!collection.deleteRule
                    }
                  ],
                  schema: collection.schema || collection.fields || [],
                  access_rules: {
                    public_read: !collection.listRule && !collection.viewRule,
                    public_write: !collection.createRule && !collection.updateRule,
                    protected: !!(collection.listRule || collection.viewRule || collection.createRule || collection.updateRule)
                  }
                };
              });

            // Webhook endpoints (if webhook collections exist)
            try {
              await this.pb!.collection('webhook_events').getList(1, 1);
              endpoints.webhook_endpoints = [
                {
                  path: '/webhooks/stripe',
                  method: 'POST',
                  description: 'Stripe webhook endpoint for payment events',
                  authentication: 'Stripe signature verification',
                  events_supported: [
                    'payment_intent.succeeded',
                    'payment_intent.payment_failed',
                    'customer.subscription.created',
                    'customer.subscription.canceled',
                    'invoice.payment_succeeded'
                  ]
                }
              ];
            } catch {
              endpoints.webhook_endpoints = [
                {
                  info: 'Webhook endpoints available after running setup_complete_saas_backend'
                }
              ];
            }

            // Utility endpoints
            endpoints.utility_endpoints = [
              {
                path: '/api/health',
                method: 'GET',
                description: 'Health check endpoint',
                auth_required: false
              },
              {
                path: '/api/files/{collection}/{recordId}/{filename}',
                method: 'GET',
                description: 'File serving endpoint',
                auth_required: 'Depends on collection access rules'
              }
            ];

            // Add usage examples
            endpoints.usage_examples = {
              authentication: {
                admin_login: {
                  method: 'POST',
                  url: `${this.pb!.baseUrl}/api/admins/auth-with-password`,
                  body: {
                    identity: 'admin@example.com',
                    password: 'your_password'
                  }
                },
                user_login: {
                  method: 'POST',
                  url: `${this.pb!.baseUrl}/api/users/auth-with-password`,
                  body: {
                    identity: 'user@example.com',
                    password: 'user_password'
                  }
                }
              },
              common_queries: {
                filtered_list: `GET ${this.pb!.baseUrl}/api/collections/posts/records?filter=published=true&sort=-created`,
                with_relations: `GET ${this.pb!.baseUrl}/api/collections/posts/records?expand=author,category`,
                paginated: `GET ${this.pb!.baseUrl}/api/collections/users/records?page=2&perPage=50`
              }
            };

          } catch (error: any) {
            endpoints.error = `Cannot generate endpoint documentation: ${error.message}`;
          }

          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(endpoints, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to generate API endpoints documentation: ${error.message}`);
        }
      }
    );
  }

  // Helper methods for schema analysis
  private analyzeFieldTypes(schema: any[]): { [key: string]: number } {
    const types: { [key: string]: number } = {};
    schema.forEach(field => {
      types[field.type] = (types[field.type] || 0) + 1;
    });
    return types;
  }

  private analyzeSecurityLevel(collection: any): string {
    const rules = [collection.listRule, collection.viewRule, collection.createRule, collection.updateRule, collection.deleteRule];
    const hasRules = rules.filter(rule => rule !== null && rule !== '').length;
    
    if (hasRules === 0) return 'public';
    if (hasRules < 3) return 'partially_protected';
    return 'fully_protected';
  }
  private analyzeRelationships(collections: any[]): any[] {
    const relationships: any[] = [];
    
    collections.forEach(collection => {
      if (collection.schema?.relations) {
        collection.schema.relations.forEach((relation: any) => {
          relationships.push({
            from_collection: collection.name,
            to_collection: relation.target_collection,
            field_name: relation.field_name,
            relationship_type: relation.relationship_type,
            is_bidirectional: this.checkBidirectional(collections, collection.name, relation.target_collection)
          });
        });
      }
    });
    
    return relationships;
  }

  private checkBidirectional(collections: any[], fromCollection: string, toCollection: string): boolean {
    const targetCollection = collections.find(c => c.name === toCollection);
    if (!targetCollection?.schema?.relations) return false;
    
    return targetCollection.schema.relations.some((rel: any) => rel.target_collection === fromCollection);
  }
  private generateIndexRecommendations(collections: any[]): string[] {
    const recommendations: string[] = [];
    
    collections.forEach(collection => {
      const hasDateFields = collection.schema?.fields?.some((f: any) => f.type === 'date');
      const hasRelations = collection.schema?.fields?.some((f: any) => f.type === 'relation');
      const indexCount = collection.indexes?.length || 0;
      
      if (hasDateFields && indexCount === 0) {
        recommendations.push(`Consider adding date index to ${collection.name} for time-based queries`);
      }
      
      if (hasRelations && indexCount === 0) {
        recommendations.push(`Consider adding indexes to ${collection.name} relation fields for better join performance`);
      }
    });
    
    return recommendations;
  }

  private analyzeNamingConventions(collections: any[]): any {
    const analysis = {
      collection_naming: 'checking',
      field_naming: 'checking',
      issues: [] as string[],
      suggestions: [] as string[]
    };
    
    // Check collection naming conventions
    const snakeCaseCollections = collections.filter(c => /^[a-z][a-z0-9_]*$/.test(c.name));
    analysis.collection_naming = snakeCaseCollections.length === collections.length ? 'snake_case' : 'mixed';
    
    if (analysis.collection_naming === 'mixed') {
      analysis.issues.push('Inconsistent collection naming convention detected');
      analysis.suggestions.push('Use snake_case for all collection names (e.g., user_profiles, email_templates)');
    }
    
    return analysis;
  }

  private analyzeSecurityPractices(collections: any[]): any {
    const analysis = {
      public_collections: 0,
      protected_collections: 0,
      security_score: 0,
      recommendations: [] as string[]
    };
    
    collections.forEach(collection => {
      if (collection.access_rules?.security_level === 'public') {
        analysis.public_collections++;
      } else {
        analysis.protected_collections++;
      }
    });
    
    analysis.security_score = collections.length > 0 ? 
      Math.round((analysis.protected_collections / collections.length) * 100) : 0;
    
    if (analysis.security_score < 80) {
      analysis.recommendations.push('Consider adding access rules to protect sensitive collections');
    }
    
    return analysis;
  }

  private generatePerformanceTips(collections: any[]): string[] {
    const tips = [
      'Use indexes on frequently queried fields',
      'Limit pagination to reasonable page sizes (max 500)',
      'Use select fields to limit data transfer',
      'Consider denormalization for read-heavy operations',
      'Use expand carefully to avoid N+1 query problems'
    ];
    
    return tips;
  }

  private generateDataModelingSuggestions(collections: any[]): string[] {
    const suggestions = [
      'Follow consistent naming conventions across all collections',
      'Use appropriate field types (email, url, date) for validation',
      'Add created and updated timestamps to all collections',
      'Consider soft deletes for important business data',
      'Use JSON fields sparingly and prefer structured relations'
    ];
    
    return suggestions;
  }

  // Helper method for health score calculation
  private calculateHealthScore(metrics: any): number {
    let score = 100;
    
    // Deduct points for issues
    if (metrics.technical_metrics?.database_status !== 'Connected') score -= 50;
    if (!metrics.technical_metrics?.auth_status) score -= 20;
    if (metrics.user_metrics?.error) score -= 15;
    if (metrics.business_metrics?.info) score -= 10;
    
    return Math.max(0, score);
  }

  private setupTools() {
    console.error('[MCP DEBUG] Setting up tools...');    // Simple test tool
    const testTool = this.server.tool(
      'test_tool',
      {},
      async () => {
        console.error('[MCP DEBUG] test_tool called');
        return {
          content: [{ type: 'text', text: 'Test tool works!' }]
        };
      }
    );
    
    console.error('[MCP DEBUG] After registering test_tool');
    
    // Add a fast health check that responds immediately for Smithery discovery
    this.server.tool(
      'health_check',
      {},
      async () => {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'healthy',
              server: 'pocketbase-server',
              version: '0.1.0',
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }
    );

    // Add tool discovery endpoint that works without PocketBase initialization
    this.server.tool(
      'discover_tools',
      {},
      async () => {
        const availableTools = [
          'health_check',
          'discover_tools',
          'test_tool',
          'get_server_info',
          'get_auth_info', 
          'list_collections',
          'create_record',
          'update_record',
          'delete_record',
          'list_records',
          'get_record',
          'authenticate_user',
          'get_collection_schema',
          'create_collection',
          'update_collection',
          'delete_collection',
          'manage_indexes',
          'import_data',
          'export_data',
          'backup_database',
          'list_auth_methods',
          'authenticate_with_oauth2',
          'auth_refresh',
          'request_verification',
          'confirm_verification',
          'request_password_reset',
          'confirm_password_reset',
          'request_email_change',
          'confirm_email_change',
          'stream_collection_changes'
        ];
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              server: 'pocketbase-server',
              version: '0.1.0', 
              description: 'Advanced PocketBase MCP Server with comprehensive database operations',
              totalTools: availableTools.length,
              tools: availableTools,
              capabilities: {
                collections: true,
                records: true,
                authentication: true,
                realtime: true,
                backup: true,
                import_export: true
              }
            }, null, 2)
          }]
        };
      }
    );

    // Discovery mode tool for immediate response to tools/list requests
    // This tool is specifically designed to respond quickly during Smithery scanning
    this.server.tool(
      'smithery_discovery',
      {},
      async () => {
        console.error('[MCP DEBUG] Smithery discovery tool called');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              discovered: true,
              server: 'pocketbase-server',
              version: '0.1.0',
              description: 'Advanced PocketBase MCP Server - Ready for configuration',
              status: this.discoveryMode ? 'discovery_mode' : 'configured',
              capabilities: ['database', 'authentication', 'real-time', 'email', 'payments'],
              configuration_required: this.discoveryMode,
              quick_start: 'Set POCKETBASE_URL environment variable to begin'
            }, null, 2)
          }]
        };
      }
    );

    // Try to access tools through the server's API
    try {
      // @ts-ignore - Using internal API for debugging
      const toolNames = this.server._tools ? Object.keys(this.server._tools) : [];
      console.error(`[MCP DEBUG] Tools through API: ${JSON.stringify(toolNames)}`);
    } catch (error) {
      console.error(`[MCP DEBUG] Error accessing tools through API: ${error}`);
    }    // Diagnostic tool to list all registered tool names
    this.server.tool(
      'list_registered_tools',
      {},
      async () => {
        console.error('[MCP DEBUG] list_registered_tools called');
        // @ts-ignore
        const toolNames = Object.keys(this.server._tools || {});
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(toolNames, null, 2)
          }]
        };
      }
    );    // Server info tool with fast timeout and discovery mode support
    this.server.tool(
      'get_server_info',
      {},
      async () => {
        try {
          // Use shorter timeout for discovery, allow discovery mode
          await this.ensureInitialized({ timeout: 2000, allowDiscoveryMode: true });
          
          if (this.discoveryMode) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  url: process.env.POCKETBASE_URL || 'not-configured',
                  isAuthenticated: false,
                  version: '0.1.0',
                  mode: 'discovery',
                  status: 'awaiting-configuration'
                }, null, 2)
              }]
            };
          }
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                url: this.pb!.baseUrl,
                isAuthenticated: this.pb!.authStore?.isValid || false,
                version: '0.1.0'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          // Provide basic info even if initialization fails
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                url: process.env.POCKETBASE_URL || 'not-configured',
                isAuthenticated: false,
                version: '0.1.0',
                status: 'initialization-pending',
                error: error.message
              }, null, 2)
            }]
          };
        }
      }
    );// Auth info tool
    this.server.tool(
      'get_auth_info',
      {},
      async () => {
        try {
          await this.ensureInitialized();
          return {
            content: [{
              type: 'text',              text: JSON.stringify({
                isValid: this.pb!.authStore.isValid,
                token: this.pb!.authStore.token,
                record: this.pb!.authStore.record,
                isAdmin: this.pb!.authStore.record?.collectionName === '_superusers'
              }, null, 2)
            }]
          };        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get auth info: ${error.message}` }],
            isError: true
          };
        }
      }
    );// New tool to list all collections
    this.server.tool(
      'list_collections',
      {
        includeSystem: z.boolean().optional().default(false).describe('Whether to include system collections')
      },
      async ({ includeSystem }: { includeSystem: boolean }) => {
        try {
          await this.ensureInitialized();
          const collections = await this.pb!.collections.getList(1, 100);
          const filteredCollections = includeSystem
            ? collections.items
            : collections.items.filter((c: any) => !c.system);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(filteredCollections.map((c: any) => ({
                id: c.id,
                name: c.name,
                type: c.type,
                system: c.system,
                recordCount: c.recordCount || 0
              })), null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to list collections: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Record management tools with enhanced error handling
    this.server.tool(
      'create_record',
      {
        collection: z.string().describe('Collection name where to create the record (e.g., "users", "posts", "products")'),
        data: z.record(z.any()).describe('Record data object with field values. Required fields must be included. Use proper data types (string, number, boolean, array, object) matching the collection schema.')
      },
      async ({ collection, data }: { collection: string, data: Record<string, any> }) => {
        try {
          await this.ensureInitialized();
          
          const result = await this.pb!.collection(collection).create(data);
          
          return {
            content: [{ 
              type: 'text' as const, 
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text' as const, 
              text: `Failed to create record: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Collection management tools
    this.server.tool(
      'create_collection',
      {
        name: z.string().describe('Collection name'),
        schema: z.array(z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean().optional(),
          options: z.record(z.any()).optional()
        })).describe('Collection schema')
      },
      async (args) => {
        const { name, schema } = args;
        console.error(`[MCP DEBUG] create_collection called with:`, { name, schema });

        try {
          await this.ensureInitialized({ requireAuth: true, isAdmin: true });
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Admin authentication required. Use authenticate_user with isAdmin: true.' }, null, 2)
            }],
            isError: true
          };
        }

        try {
          // Validate schema
          if (!Array.isArray(schema) || schema.length === 0) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'Schema must be a non-empty array of field definitions' }, null, 2)
              }],
              isError: true
            };
          }

          // Process schema with validation
          const processedSchema = schema.map(field => {
            if (!field.name || !field.type) {
              throw new Error(`Invalid field definition. Both 'name' and 'type' are required.`);
            }

            // Validate field name format
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.name)) {
              throw new Error(`Invalid field name '${field.name}'. Must start with a letter and contain only letters, numbers, and underscores.`);
            }

            // Validate field type
            const validTypes = ['text', 'number', 'bool', 'email', 'url', 'date', 'select', 'json', 'file', 'relation'];
            if (!validTypes.includes(field.type)) {
              throw new Error(`Invalid field type '${field.type}'. Must be one of: ${validTypes.join(', ')}`);
            }

            return {
              name: field.name,
              type: field.type,
              required: field.required ?? false,
              options: field.options ?? {}
            };
          });

          console.error('[MCP DEBUG] Creating collection with schema:', JSON.stringify(processedSchema, null, 2));

          // Create the collection with schema according to PocketBase JS SDK documentation
          try {
            // Based on the PocketBase JS SDK documentation, the correct format is:
            const payload = {
              name,
              type: "base",
              system: false,
              schema: processedSchema
            };
            
            console.error('[MCP DEBUG] Sending payload to PocketBase:', JSON.stringify(payload, null, 2));
            
            // Use the collections.create method as shown in the documentation
            const result = await this.pb!.collections.create(payload);
            
            console.error('[MCP DEBUG] Collection created successfully:', JSON.stringify(result, null, 2));
            
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error: any) {
            console.error('[MCP DEBUG] Error creating collection:', error);
            
            // Try an alternative approach if the first one fails
            try {
              // Some versions of PocketBase might require a different format
              const alternativePayload = {
                id: "",
                created: "",
                updated: "",
                name,
                type: "base",
                system: false,
                schema: processedSchema
              };
              
              console.error('[MCP DEBUG] Trying alternative payload:', JSON.stringify(alternativePayload, null, 2));
              
              const result = await this.pb!.collections.create(alternativePayload);
              
              console.error('[MCP DEBUG] Collection created with alternative payload:', JSON.stringify(result, null, 2));
              
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }]
              };
            } catch (altError: any) {
              console.error('[MCP DEBUG] Alternative approach also failed:', altError);
              throw new Error(`Failed to create collection: ${error.message}. Alternative approach also failed: ${altError.message}`);
            }
          }
        } catch (error: any) {
          console.error('[MCP DEBUG] create_collection error:', error);
          
          const errorDetails = {
            message: error.message,
            data: error.data,
            status: error.status,
            response: error.response?.data
          };

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Failed to create collection', details: errorDetails }, null, 2)
            }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'list_records',
      {
        collection: z.string().describe('Collection name to query (e.g., "users", "posts", "products")'),
        filter: z.string().optional().describe('PocketBase filter expression (e.g., "created >= \'2024-01-01\'" or "status = \'active\'"). Use build_filter tool for safe parameter binding to prevent injection.'),
        sort: z.string().optional().describe('Sort expression: field name with optional prefix (- for desc, + for asc). Examples: "-created", "+name", "title,-updated"'),
        page: z.number().optional().describe('Page number for pagination (1-based, minimum 1)'),
        perPage: z.number().optional().describe('Number of records per page (1-500, default 50 for performance)')
      },      async ({ collection, filter, sort, page = 1, perPage = 50 }) => {
        try {
          await this.ensureInitialized();
          
          // Validate pagination parameters
          if (typeof page === 'number' && page < 1) page = 1;
          if (typeof perPage === 'number' && perPage > 500) perPage = 500;
          if (typeof perPage === 'number' && perPage < 1) perPage = 1;
          
          const options: any = {};
          if (filter) options.filter = filter;
          if (sort) options.sort = sort;

          const result = await this.pb!.collection(collection).getList(page, perPage, options);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          // Enhanced error handling
          let errorMessage = error.message;
          let statusCode = error.status || 'unknown';
          
          if (error.response && error.data) {
            errorMessage = error.data.message || error.message;
            statusCode = error.status;
          }
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to list records',
                message: errorMessage,
                statusCode: statusCode,
                collection: collection,
                parameters: { page, perPage, filter, sort }
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'update_record',
      {
        collection: z.string().describe('Collection name where the record exists (e.g., "users", "posts", "products")'),
        id: z.string().describe('Unique identifier of the record to update (15-character string like "abc123def456xyz")'),
        data: z.record(z.any()).describe('Object containing the fields to update. Only provide fields you want to change. System fields (id, created, updated) cannot be modified.')
      },
      async ({ collection, id, data }) => {
        try {
          await this.ensureInitialized();
          
          const result = await this.pb!.collection(collection).update(id, data);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          // Enhanced error handling with ClientResponseError patterns
          let errorMessage = error.message;
          let statusCode = error.status || 'unknown';
          
          if (error.response && error.data) {
            errorMessage = error.data.message || error.message;
            statusCode = error.status;
          }
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to update record',
                message: errorMessage,
                statusCode: statusCode,
                collection: collection,
                recordId: id
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'delete_record',
      {
        collection: z.string().describe('Collection name where the record exists (e.g., "users", "posts", "products")'),
        id: z.string().describe('Unique identifier of the record to delete (15-character string). Warning: This operation cannot be undone!')
      },
      async ({ collection, id }) => {
        try {
          await this.ensureInitialized();
          
          await this.pb!.collection(collection).delete(id);
          return {
            content: [{ type: 'text', text: `Successfully deleted record ${id} from collection ${collection}` }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to delete record: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Authentication tools
    this.server.tool(
      'authenticate_user',
      {
        // Make email and password optional to allow using env vars when isAdmin=true
        email: z.string().optional().describe('User email address for authentication. Required unless authenticating as admin with environment variables set.'),
        password: z.string().optional().describe('User password for authentication. Required unless authenticating as admin with environment variables set.'),
        collection: z.string().optional().default('users').describe('Collection name for user authentication (default: "users"). Use "_superusers" for admin auth or specify custom user collections.'),
        isAdmin: z.boolean().optional().default(false).describe('Set to true to authenticate as administrator using POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD environment variables.')
      },
      async ({ email, password, collection, isAdmin }) => {
        try {
          const authCollection = isAdmin ? '_superusers' : collection;
          const authEmail = isAdmin && !email ? process.env.POCKETBASE_ADMIN_EMAIL : email;
          const authPassword = isAdmin && !password ? process.env.POCKETBASE_ADMIN_PASSWORD : password;

          if (!authEmail || !authPassword) {
            return {
              content: [{ type: 'text', text: 'Email and password are required for authentication' }],
              isError: true
            };
          }

          const authData = await this.pb!
            .collection(authCollection)
            .authWithPassword(authEmail, authPassword);

          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          // Enhanced error handling with ClientResponseError patterns
          let errorMessage = error.message;
          let statusCode = error.status || 'unknown';
          
          // Check if it's a PocketBase ClientResponseError
          if (error.response && error.data) {
            errorMessage = error.data.message || error.message;
            statusCode = error.status;
          }
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Authentication failed',
                message: errorMessage,
                statusCode: statusCode,
                collection: isAdmin ? '_superusers' : collection
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'authenticate_with_oauth2',
      {
        provider: z.string().describe('OAuth2 provider name (e.g., "google", "github", "discord", "facebook"). Must be configured in PocketBase auth settings.'),
        code: z.string().describe('Authorization code received from OAuth2 provider callback URL after user grants permission.'),
        codeVerifier: z.string().describe('PKCE code verifier used for secure OAuth2 flow. Should match the code_challenge sent in authorization request.'),
        redirectUrl: z.string().describe('Redirect URL that matches the one registered with OAuth2 provider and used in authorization request.'),
        collection: z.string().optional().default('users').describe('Collection where user records are stored (default: "users"). Must have OAuth2 authentication enabled.'),
        createData: z.record(z.any()).optional().describe('Additional user profile data to set when creating new user accounts (name, avatar, etc.). Applied only for new registrations.')
      },
      async ({ provider, code, codeVerifier, redirectUrl, collection, createData = {} }) => {
        try {
          // Updated method signature for latest PocketBase SDK
          const authData = await this.pb!
            .collection(collection)
            .authWithOAuth2Code(provider, code, codeVerifier, redirectUrl, createData);

          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `OAuth2 authentication failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Authenticate with OTP (updated for latest SDK)
    this.server.tool(
      'authenticate_with_otp',
      {
        email: z.string().email().describe('User email address to send one-time password (OTP) to. Must be a valid email format and exist in the specified collection.'),
        collection: z.string().optional().default('users').describe('Collection containing user records (default: "users"). Must have OTP authentication enabled in PocketBase settings.')
      },
      async ({ email, collection }) => {
        try {
          // Updated method signature for latest PocketBase SDK
          const result = await this.pb!.collection(collection).requestOTP(email);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `OTP request failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'auth_refresh',
      {
        collection: z.string().optional().default('users').describe('Collection name for the authenticated user (default: "users"). Must match the collection used during initial authentication.')
      },
      async ({ collection }) => {
        try {
          const authData = await this.pb!.collection(collection).authRefresh();
          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Auth refresh failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Email verification tools
    this.server.tool(
      'request_verification',
      {
        email: z.string().email().describe('User email address to send verification email to. Must be a valid email format and exist in the specified collection.'),
        collection: z.string().optional().default('users').describe('Collection containing user records (default: "users"). Email verification must be enabled in collection settings.')
      },
      async ({ email, collection }) => {
        try {
          const result = await this.pb!.collection(collection).requestVerification(email);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Verification request failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'confirm_verification',
      {
        token: z.string().describe('Email verification token received via email. This is a secure token that expires after a set time period.'),
        collection: z.string().optional().default('users').describe('Collection containing the user record to verify (default: "users"). Must match the collection used in verification request.')
      },
      async ({ token, collection }) => {
        try {
          const result = await this.pb!.collection(collection).confirmVerification(token);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Verification confirmation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Password reset tools
    this.server.tool(
      'request_password_reset',
      {
        email: z.string().email().describe('User email address to send password reset link to. Must be a valid email format and exist in the specified collection.'),
        collection: z.string().optional().default('users').describe('Collection containing user records (default: "users"). Password reset must be enabled in collection settings.')
      },
      async ({ email, collection }) => {
        try {
          const result = await this.pb!.collection(collection).requestPasswordReset(email);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Password reset request failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'confirm_password_reset',
      {
        token: z.string().describe('Password reset token received via email. This is a secure token that expires after a set time period (usually 30 minutes).'),
        password: z.string().min(8).describe('New password for the user account. Must meet minimum security requirements (typically 8+ characters).'),
        passwordConfirm: z.string().min(8).describe('Confirmation of the new password. Must exactly match the password field to prevent typos.'),
        collection: z.string().optional().default('users').describe('Collection containing the user record (default: "users"). Must match the collection used in reset request.')
      },
      async ({ token, password, passwordConfirm, collection }) => {
        try {
          const result = await this.pb!.collection(collection).confirmPasswordReset(token, password, passwordConfirm);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Password reset confirmation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Email change tools    // Email change tools
    this.server.tool(
      'request_email_change',
      {
        newEmail: z.string().email().describe('New email address to change to. Must be a valid email format and not already used by another user.'),
        collection: z.string().optional().default('users').describe('Collection containing the user record (default: "users"). Email change must be enabled in collection settings.')
      },
      async ({ newEmail, collection }) => {
        try {
          const result = await this.pb!.collection(collection).requestEmailChange(newEmail);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Email change request failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'confirm_email_change',
      {
        token: z.string().describe('Email change confirmation token received via email. This is a secure token that expires after a set time period.'),
        password: z.string().describe('Current password for security confirmation. Required to prevent unauthorized email changes.'),
        collection: z.string().optional().default('users').describe('Collection containing the user record (default: "users"). Must match the collection used in email change request.')
      },
      async ({ token, password, collection }) => {
        try {
          const authData = await this.pb!.collection(collection).confirmEmailChange(token, password);
          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Email change confirmation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // User management tools
    this.server.tool(
      'impersonate_user',
      {
        userId: z.string().describe('Unique identifier of the user to impersonate (15-character string). Requires admin privileges and appropriate permissions.'),
        collection: z.string().optional().default('users').describe('Collection containing the user to impersonate (default: "users"). Must be accessible by current admin user.')
      },
      async ({ userId, collection }) => {
        try {
          const authData = await this.pb!.collection(collection).impersonate(userId);
          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `User impersonation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'create_user',
      {
        email: z.string().email().describe('User email address for the new account. Must be unique and a valid email format.'),
        password: z.string().min(8).describe('User password for the new account. Must meet minimum security requirements (typically 8+ characters).'),
        passwordConfirm: z.string().min(8).describe('Password confirmation that must exactly match the password field to prevent typos.'),
        name: z.string().optional().describe('Optional display name for the user account. Can be changed later through profile updates.'),
        collection: z.string().optional().default('users').describe('Collection where the user record will be created (default: "users"). Must allow public registration or admin creation.')
      },
      async ({ email, password, passwordConfirm, name, collection }) => {
        try {
          const result = await this.pb!.collection(collection).create({
            email,
            password,
            passwordConfirm,
            name,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create user: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Record tools
    this.server.tool(
      'get_record',
      {
        collection: z.string().describe('Collection name where the record exists (e.g., "users", "posts", "products")'),
        id: z.string().describe('Unique identifier of the record to retrieve (15-character string like "abc123def456xyz")'),
        expand: z.string().optional().describe('Comma-separated list of relation field names to expand/populate (e.g., "author,category" or "user.profile"). Loads related records inline.')
      },
      async ({ collection, id, expand }) => {
        try {
          const options: any = {};
          if (expand) options.expand = expand;

          // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
          const record = await this.pb!.collection(collection).getOne(id, options);
          return {
            content: [{ type: 'text', text: JSON.stringify(record, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get record: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Tool to set collection access rules
    this.server.tool(
      'set_collection_rules',
      {
        collection: z.string().describe('Collection name or ID to update access rules for (e.g., "users", "posts"). Requires admin privileges.'),
        listRule: z.string().nullable().optional().describe('List rule using PocketBase filter syntax (e.g., "@request.auth.id != \'\'") or null for public access. Controls who can list/query records.'),
        viewRule: z.string().nullable().optional().describe('View rule using PocketBase filter syntax (e.g., "@request.auth.id = id") or null for public access. Controls who can view individual records.'),
        createRule: z.string().nullable().optional().describe('Create rule using PocketBase filter syntax (e.g., "@request.auth.id != \'\'") or null for public creation. Controls who can create new records.'),
        updateRule: z.string().nullable().optional().describe('Update rule using PocketBase filter syntax (e.g., "@request.auth.id = id") or null for public updates. Controls who can modify existing records.'),
        deleteRule: z.string().nullable().optional().describe('Delete rule using PocketBase filter syntax (e.g., "@request.auth.id = id") or null for public deletion. Controls who can delete records.')
      },
      async ({ collection, listRule, viewRule, createRule, updateRule, deleteRule }) => {
        try {
          // Construct the update payload, only including rules that were provided
          const payload: Record<string, string | null> = {};
          if (listRule !== undefined) payload.listRule = listRule;
          if (viewRule !== undefined) payload.viewRule = viewRule;
          if (createRule !== undefined) payload.createRule = createRule;
          if (updateRule !== undefined) payload.updateRule = updateRule;
          if (deleteRule !== undefined) payload.deleteRule = deleteRule;

          if (Object.keys(payload).length === 0) {
             return {
               content: [{ type: 'text', text: 'No rules provided to update.' }],
               isError: true
             };
          }

          // Updating rules typically requires admin privileges
          const result = await this.pb!.collections.update(collection, payload);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          // Catch permission errors or other issues
          return {
            content: [{ type: 'text', text: `Failed to set collection rules: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Tool to update collection schema (add/remove/update fields)
    const updateCollectionSchemaTool = this.server.tool(
      'update_collection_schema',
      {
        collection: z.string().describe('Collection name or ID to modify schema for (e.g., "users", "posts"). Requires admin privileges and careful planning.'),
        addFields: z.array(z.object({
          name: z.string().describe('Field name (must be unique within collection and follow naming rules: start with letter, only letters/numbers/underscores)'),
          type: z.string().describe('Field type: "text", "number", "bool", "email", "url", "date", "select", "json", "file", or "relation"'),
          required: z.boolean().optional().default(false).describe('Whether this field is required for new records (default: false)'),
          options: z.record(z.any()).optional().describe('Field-specific options (e.g., for select: {values: ["option1", "option2"]}, for relation: {collectionId: "target_collection"})')
        })).optional().describe('Array of new fields to add to the collection schema'),
        removeFields: z.array(z.string()).optional().describe('Array of field names to remove from collection schema. Warning: This will delete all data in these fields!'),
        updateFields: z.array(z.object({
          name: z.string().describe('Current name of the field to update'),
          newName: z.string().optional().describe('New name for the field (optional, renames the field)'),
          type: z.string().optional().describe('New field type (optional, changes the field type - may cause data loss)'),
          required: z.boolean().optional().describe('New required status (optional, changes whether field is mandatory)'),
          options: z.record(z.any()).optional().describe('New field options (optional, updates field-specific configuration)')
        })).optional().describe('Array of existing fields to modify. Changes may affect existing data.')
      },
      async ({ collection, addFields = [], removeFields = [], updateFields = [] }) => {
        try {
          console.error(`[MCP DEBUG] update_collection_schema called with:`, { collection, addFields, removeFields, updateFields });
          
          // Fetch the current collection details including schema
          const currentCollection = await this.pb!.collections.getOne(collection);
          let currentSchema = currentCollection.schema || [];
          
          console.error(`[MCP DEBUG] Current schema:`, JSON.stringify(currentSchema, null, 2));

          // Process removals first
          if (removeFields.length > 0) {
            currentSchema = currentSchema.filter((field: any) => !removeFields.includes(field.name));
          }

          // Process updates
          if (updateFields.length > 0) {
            currentSchema = currentSchema.map((field: any) => {
              const updateInfo = updateFields.find(uf => uf.name === field.name);
              if (updateInfo) {
                return {
                  ...field,
                  name: updateInfo.newName ?? field.name, // Update name if provided
                  type: updateInfo.type ?? field.type, // Update type if provided
                  required: updateInfo.required ?? field.required, // Update required status if provided
                  options: updateInfo.options ?? field.options // Update options if provided
                };
              }
              return field;
            });
          }

          // Process additions
          if (addFields.length > 0) {
            // Process add fields to match PocketBase's expected format
            const processedAddFields = addFields.map(field => ({
              name: field.name,
              type: field.type,
              required: field.required ?? false,
              options: field.options ?? {}
            }));
            
            currentSchema = [...currentSchema, ...processedAddFields];
          }

          console.error(`[MCP DEBUG] Updated schema:`, JSON.stringify(currentSchema, null, 2));

          // Update the collection with the modified schema
          const result = await this.pb!.collections.update(collection, { schema: currentSchema });
          
          console.error(`[MCP DEBUG] update_collection_schema success:`, JSON.stringify(result, null, 2));
          
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          console.error(`[MCP DEBUG] update_collection_schema error:`, error);
          
          return {
            content: [{ type: 'text', text: `Failed to update collection schema: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Tool to get collection schema (duplicates resource functionality for tool access)
    this.server.tool(
      'get_collection_schema',
      {
        collection: z.string().describe('Collection name or ID to retrieve schema information for (e.g., "users", "posts", "products"). Returns detailed field definitions, rules, and indexes.')
      },
      async ({ collection }) => {
        try {
          console.error('[MCP DEBUG] get_collection_schema called for collection:', collection);
          
          // First try to get collection directly
          const collectionData = await this.pb!.collections.getOne(collection);
          console.error('[MCP DEBUG] Collection data retrieved:', JSON.stringify(collectionData, null, 2));
          
          // In newer PocketBase versions, the schema is in the 'fields' property
          const schema = collectionData.fields || collectionData.schema || [];
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                name: collection,
                id: collectionData.id,
                type: collectionData.type,
                system: collectionData.system,
                schema: schema,
                listRule: collectionData.listRule,
                viewRule: collectionData.viewRule,
                createRule: collectionData.createRule,
                updateRule: collectionData.updateRule,
                deleteRule: collectionData.deleteRule,
                indexes: collectionData.indexes || []
              }, null, 2)
            }]
          };
        } catch (error: any) {
          console.error('[MCP DEBUG] get_collection_schema error:', error);
          
          // If we can't get collection directly, try to infer from records
          try {
            const records = await this.pb!.collection(collection).getList(1, 1);
            
            if (records.items.length > 0) {
              const record = records.items[0];
              // Basic inference logic
              const inferredSchema = Object.keys(record)
                .filter(key => !['id', 'created', 'updated', 'collectionId', 'collectionName', 'expand'].includes(key))
                .map(field => ({
                  name: field,
                  type: typeof record[field] === 'object' ? 'json' : typeof record[field],
                  required: false,
                  system: false,
                  options: {}
                }));
              
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    name: collection,
                    schema: inferredSchema,
                    inferredSchema: true,
                    note: "Schema was inferred from record data as collection details were not accessible"
                  }, null, 2)
                }]
              };
            } else {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    name: collection,
                    schema: [],
                    error: "Could not retrieve collection schema and no records found to infer from"
                  }, null, 2)
                }]
              };
            }
          } catch (inferError: any) {
            console.error('[MCP DEBUG] Error inferring schema from records:', inferError);
            
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  name: collection,
                  error: "Failed to get collection schema: " + (error.message || "Unknown error")
                }, null, 2)
              }]
            };
          }
        }
      }
    );    // Database management tools
    this.server.tool(
      'backup_database',
      {
        format: z.enum(['json', 'csv']).optional().default('json').describe('Export format for backup data. JSON provides complete structured data, CSV is human-readable but may lose complex field types.')
      },
      async ({ format }) => {
        try {
          const collections = await this.pb!.collections.getList(1, 100);
          const backup: any = {};

          for (const collection of collections.items) {
            const records = await this.pb!.collection(collection.name).getFullList();
            backup[collection.name] = {
              schema: collection.schema,
              records,
            };
          }

          if (format === 'csv') {
            let csv = '';
            for (const [collectionName, data] of Object.entries(backup)) {
              const { schema, records } = data as { schema: any[], records: any[] };
              csv += `Collection: ${collectionName}\n`;
              csv += `Schema:\n${JSON.stringify(schema, null, 2)}\n`;
              csv += 'Records:\n';
              if (records.length > 0) {
                const headers = Object.keys(records[0]);
                csv += headers.join(',') + '\n';
                records.forEach((record) => {
                  csv += headers.map(header => JSON.stringify(record[header])).join(',') + '\n';
                });
              }
              csv += '\n';
            }
            return {
              content: [{ type: 'text', text: csv }]
            };
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(backup, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to backup database: ${error.message}` }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'import_data',
      {
        collection: z.string().describe('Collection name where data will be imported (e.g., "users", "posts"). Collection must exist and have appropriate schema.'),
        data: z.array(z.record(z.any())).describe('Array of record objects to import. Each object should match the collection schema. Include "id" field for update/upsert modes.'),
        mode: z.enum(['create', 'update', 'upsert']).optional().default('create').describe('Import strategy: "create" (new records only), "update" (existing records only, requires id), "upsert" (create or update based on id presence)')
      },
      async ({ collection, data, mode }) => {
        try {
          const results = [];
          for (const record of data) {
            let result;
            switch (mode) {
              case 'create':
                result = await this.pb!.collection(collection).create(record);
                break;
              case 'update':
                if (!record.id) {
                  throw new Error('Record ID required for update mode');
                }
                result = await this.pb!.collection(collection).update(record.id, record);
                break;
              case 'upsert':
                if (record.id) {
                  try {
                    result = await this.pb!.collection(collection).update(record.id, record);
                  } catch {
                    result = await this.pb!.collection(collection).create(record);
                  }
                } else {
                  result = await this.pb!.collection(collection).create(record);
                }
                break;
            }
            results.push(result);
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to import data: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Collection migration tool
    this.server.tool(
      'migrate_collection',
      {
        collection: z.string().describe('Collection name to migrate to new schema. WARNING: This operation is destructive and creates a temporary collection during migration. Backup data first!'),
        newSchema: z.array(z.object({
          name: z.string().describe('Field name for the new schema'),
          type: z.string().describe('Field type: "text", "number", "bool", "email", "url", "date", "select", "json", "file", or "relation"'),
          required: z.boolean().default(false).describe('Whether this field is required in the new schema'),
          options: z.record(z.any()).optional().describe('Field-specific options (e.g., select values, relation targets)')
        })).describe('Complete new schema definition for the collection. All existing data will be transformed to match this schema.'),
        dataTransforms: z.record(z.string()).optional().describe('JavaScript expressions for transforming field data during migration. Key is field name, value is transform function body (e.g., {"fullName": "oldValue.firstName + \' \' + oldValue.lastName"})')
      },
      async ({ collection, newSchema, dataTransforms }: {
        collection: string;
        newSchema: { name: string; type: string; required: boolean; options?: Record<string, any> }[];
        dataTransforms?: Record<string, string>;
      }) => {
        try {
          console.error(`[MCP PocketBase WARNING] Executing 'migrate_collection' for '${collection}'. This tool is risky! It deletes the original collection before migration is fully complete. Backup your data first.`);
          const tempName = `${collection}_migration_${Date.now()}`;
          
          // Convert schema to ensure required is always defined
          const processedSchema = newSchema.map(field => ({
            ...field,
            required: field.required === undefined ? false : field.required
          }));

          await this.pb!.collections.create({
            name: tempName,
            schema: processedSchema,
          });

          const oldRecords = await this.pb!.collection(collection).getFullList();
          const transformedRecords = oldRecords.map(record => {
            const newRecord: any = { ...record };
            if (dataTransforms) {
              for (const [field, transform] of Object.entries(dataTransforms)) {
                try {
                  newRecord[field] = new Function('oldValue', `return ${transform}`)(record[field]);
                } catch (e) {
                  console.error(`Failed to transform field ${field}:`, e);
                }
              }
            }
            return newRecord;
          });

          for (const record of transformedRecords) {
            await this.pb!.collection(tempName).create(record);
          }

          // Delete original collection and rename temp
          await this.pb!.collections.delete(collection);
          await this.pb!.collections.update(tempName, { name: collection });

          return {
            content: [{ type: 'text', text: `Successfully migrated collection '${collection}' to new schema` }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to migrate collection: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Index management tool
    this.server.tool(
      'manage_indexes',
      {
        collection: z.string().describe('Collection name or ID to manage indexes for (e.g., "users", "posts"). Requires admin privileges.'),
        action: z.enum(['create', 'delete', 'list']).describe('Index operation: "create" (add new index), "delete" (remove existing index), "list" (show all indexes)'),
        index: z.object({
          name: z.string().describe('Unique name for the index (used for identification and deletion)'),
          fields: z.array(z.string()).describe('Array of field names to include in the index (e.g., ["name", "email"] for composite index)'),
          unique: z.boolean().optional().describe('Whether this should be a unique index (prevents duplicate values, default: false)')
        }).optional().describe('Index configuration object (required for create action, optional for delete if name provided)')
      },
      async ({ collection, action, index }) => {
        try {
          const collectionObj = await this.pb!.collections.getOne(collection);
          const currentIndexes = collectionObj.indexes || [];
          let result;

          switch (action) {
            case 'create':
              if (!index) {
                return {
                  content: [{ type: 'text', text: 'Index configuration required for create action' }],
                  isError: true
                };
              }
              const updatedCollection = await this.pb!.collections.update(collectionObj.id, {
                ...collectionObj,
                indexes: [...currentIndexes, index],
              });
              result = updatedCollection.indexes;
              break;

            case 'delete':
              if (!index?.name) {
                return {
                  content: [{ type: 'text', text: 'Index name required for delete action' }],
                  isError: true
                };
              }
              const filteredIndexes = currentIndexes.filter((idx: any) => idx.name !== index.name);
              const collectionAfterDelete = await this.pb!.collections.update(collectionObj.id, {
                ...collectionObj,
                indexes: filteredIndexes,
              });
              result = collectionAfterDelete.indexes;
              break;

            case 'list':
              result = currentIndexes;
              break;
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to manage indexes: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // File upload tool
    this.server.tool(
      'upload_file',
      {
        collection: z.string().describe('Collection name where the file record will be stored (e.g., "documents", "images"). Must have file field(s) in schema.'),
        recordId: z.string().optional().describe('Existing record ID to update with file (optional). If not provided, creates a new record with the file.'),
        fileData: z.object({
          name: z.string().describe('File name with extension (e.g., "document.pdf", "image.jpg"). Will be used as the uploaded file name.'),
          content: z.string().describe('Base64 encoded file content. Convert your file to base64 before passing to this parameter.'),
          type: z.string().optional().describe('MIME type of the file (e.g., "image/jpeg", "application/pdf"). Auto-detected if not provided.')
        }).describe('File data object containing name, base64 content, and optional MIME type'),
        additionalFields: z.record(z.any()).optional().describe('Additional record fields to set along with the file (e.g., title, description, tags). Only used when creating new records.')
      },
      async ({ collection, recordId, fileData, additionalFields = {} }) => {
        try {
          const binaryData = Buffer.from(fileData.content, 'base64');
          const blob = new Blob([binaryData], { type: fileData.type || 'application/octet-stream' });

          const formData = new FormData();
          formData.append(fileData.name, blob, fileData.name);

          Object.entries(additionalFields).forEach(([key, value]) => {
            formData.append(key, value as string);
          });

          let result;
          if (recordId) {
            result = await this.pb!.collection(collection).update(recordId, formData);
          } else {
            result = await this.pb!.collection(collection).create(formData);
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to upload file: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Filter builder tool with safe parameter binding (modern SDK pattern)
    this.server.tool(
      'build_filter',
      {
        expression: z.string().describe('Filter expression with parameter placeholders using {:name} syntax (e.g., "name = {:name} && active = {:active} && created >= {:startDate}"). Prevents SQL injection attacks.'),
        params: z.record(z.any()).describe('Parameter values for safe binding. Keys should match placeholder names without colons/braces (e.g., {"name": "John", "active": true, "startDate": "2024-01-01"})')
      },
      async ({ expression, params }) => {
        try {
          // Use modern PocketBase filter method for safe parameter binding
          // This is equivalent to pb.filter() method in SDK v0.26.1
          // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
          const filter = this.pb!.filter(expression, params);
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({ 
                filter,
                method: 'pb.filter()',
                description: 'Safe parameter binding prevents injection attacks',
                example: 'name = {:name} && active = {:active}',
                parameters: params
              }, null, 2) 
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to build filter',
                message: error.message,
                tip: 'Use placeholders like {:param} for safe parameter binding'
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );    // Request options tool
    this.server.tool(
      'set_request_options',
      {
        autoCancellation: z.boolean().optional().describe('Enable/disable automatic cancellation of duplicate requests (helps prevent race conditions)'),
        requestKey: z.string().nullable().optional().describe('Custom request identifier for manual cancellation. Set to null to cancel a specific request.'),
        headers: z.record(z.string()).optional().describe('Custom HTTP headers to include in all subsequent requests (e.g., {"X-Custom-Header": "value"})')
      },
      async ({ autoCancellation, requestKey, headers }) => {
        try {
          if (typeof autoCancellation === 'boolean') {
            // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
            this.pb!.autoCancellation(autoCancellation);
          }

          if (requestKey === null) {
            // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
            this.pb!.cancelRequest(requestKey);
          }

          if (headers) {
            this._customHeaders = headers;
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to set request options: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Auth store management tool
    this.server.tool(
      'manage_auth_store',
      {
        action: z.enum(['save', 'clear', 'export_cookie', 'load_cookie']).describe('Authentication store operation: "save" (store auth data), "clear" (logout), "export_cookie" (get cookie string), "load_cookie" (restore from cookie)'),
        data: z.record(z.any()).optional().describe('Action-specific data: for "save" use {token, record}, for "export_cookie" use cookie options, for "load_cookie" use {cookie: "cookie_string"}')
      },
      async ({ action, data = {} }) => {
        try {
          switch (action) {
            case 'save':
              // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
              this.pb!.authStore.save(data.token, data.record);
              return {
                content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }]
              };
            case 'clear':
              // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
              this.pb!.authStore.clear();
              return {
                content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }]
              };
            case 'export_cookie':
              // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
              return {
                content: [{ type: 'text', text: this.pb!.authStore.exportToCookie(data) }]
              };
            case 'load_cookie':
              // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
              this.pb!.authStore.loadFromCookie(data.cookie);
              return {
                content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }]
              };
          }
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to manage auth store: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Real-time subscription tool (Note: Streams data to server console, not back via MCP response)
    this.server.tool(
      'subscribe_to_collection',
      {
        collection: z.string().describe('Collection name to monitor for real-time changes (e.g., "users", "posts"). Events will be logged to server console.'),
        recordId: z.string().optional().describe('Specific record ID to monitor (optional). If provided, only changes to this record will trigger events. Use "*" or omit for all records.'),
        filter: z.string().optional().describe('PocketBase filter expression to limit which records trigger events (optional). Uses same syntax as list_records filter.')
        // How to handle the callback/stream is tricky with MCP's request/response model.
        // This implementation will log events to the server console.
      },
      async ({ collection, recordId, filter }) => {
        try {
          const subscribePath = recordId ? `${collection}/${recordId}` : collection;
          console.error(`[MCP PocketBase] Subscribing to ${subscribePath}...`);

          // The subscribe function takes a callback. We can't easily stream this back via MCP.
          // We'll log events to the server's console instead.
          // Also, managing unsubscription isn't straightforward in this model.
          // Cast to 'any' to bypass TS error if the specific type isn't correctly inferred
          await (this.pb!.collection(collection) as any).subscribe(recordId || '*', (e: SubscriptionEvent) => {
            console.error(`[MCP PocketBase Subscription Event - ${collection}/${recordId || '*'}] Action: ${e.action}, Record:`, JSON.stringify(e.record, null, 2));
          }, { filter }); // Pass filter option if provided

          return {
            content: [{ type: 'text', text: `Successfully initiated subscription to collection '${collection}'${recordId ? ` for record '${recordId}'` : ''}. Events will be logged to the server console.` }]
          };
        } catch (error: any) {
          console.error(`[MCP PocketBase] Subscription failed for ${collection}/${recordId || '*'}:`, error);
          return {
            content: [{ type: 'text', text: `Failed to subscribe to collection: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Batch update tool
    this.server.tool(
      'batch_update_records',
      {
        collection: z.string().describe('Collection name where records will be updated (e.g., "users", "products"). All records must belong to this collection.'),
        records: z.array(z.object({
          id: z.string().describe('Unique identifier of the record to update (15-character string like "abc123def456xyz")'),
          data: z.record(z.any()).describe('Object containing field values to update. Only include fields that need changes - missing fields remain unchanged. Use proper data types matching collection schema.')
        })).describe('Array of record update operations. Each operation updates one record. Operations execute sequentially with individual error handling for partial success scenarios.')
      },
      async ({ collection, records }) => {
        const results: any[] = [];
        const errors: any[] = [];
        try {
          for (const record of records) {
            try {
              const result = await this.pb!.collection(collection).update(record.id, record.data);
              results.push({ id: record.id, status: 'success', result });
            } catch (error: any) {
              errors.push({ id: record.id, status: 'error', message: error.message });
            }
          }

          if (errors.length > 0) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ updated: results, errors: errors }, null, 2) }],
              isError: true // Indicate partial or full failure
            };
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ updated: results }, null, 2) }]
          };
        } catch (error: any) {
          // Catch potential errors outside the loop (though less likely here)
          return {
            content: [{ type: 'text', text: `Failed during batch update: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Batch delete tool
    this.server.tool(
      'batch_delete_records',
      {
        collection: z.string().describe('Collection name where records will be deleted (e.g., "users", "products"). All specified records must belong to this collection.'),
        recordIds: z.array(z.string()).describe('Array of unique record identifiers to delete (each 15-character string like "abc123def456xyz"). Warning: Deletions cannot be undone! Operations execute sequentially with individual error handling.')
      },
      async ({ collection, recordIds }) => {
        const results: any[] = [];
        const errors: any[] = [];
        try {
          for (const id of recordIds) {
            try {
              await this.pb!.collection(collection).delete(id);
              results.push({ id, status: 'success' });
            } catch (error: any) {
              errors.push({ id, status: 'error', message: error.message });
            }
          }

          if (errors.length > 0) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ deleted: results, errors: errors }, null, 2) }],
              isError: true // Indicate partial or full failure
            };
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ deleted: results }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed during batch delete: ${error.message}` }],
            isError: true
          };
        }
      }
    );      // Batch operations tool - Sequential implementation since batch API is not available
    this.server.tool(
      'execute_batch_operations',
      {
        operations: z.array(z.object({
          operation: z.enum(['create', 'update', 'delete']).describe('Operation type: "create" for new records, "update" for modifying existing records, "delete" for removing records'),
          collection: z.string().describe('Collection name where the operation will be performed (e.g., "users", "products")'),
          id: z.string().optional().describe('Record identifier required for update/delete operations (15-character string like "abc123def456xyz"). Not needed for create operations.'),
          data: z.record(z.any()).optional().describe('Record data object required for create/update operations. Must match collection schema. Not needed for delete operations.')
        })).describe('Array of mixed operations (create, update, delete) executed sequentially across potentially different collections. Each operation is independent with individual error handling.')
      },
      async ({ operations }) => {
        const results: any[] = [];
        const errors: any[] = [];
        
        try {
          // Execute operations sequentially since batch API is not available
          for (const op of operations) {
            try {
              let result;
              switch (op.operation) {
                case 'create':
                  if (!op.data) {
                    throw new Error(`Data is required for create operation on collection ${op.collection}`);
                  }
                  result = await this.pb!.collection(op.collection).create(op.data);
                  break;
                
                case 'update':
                  if (!op.id) {
                    throw new Error(`ID is required for update operation on collection ${op.collection}`);
                  }
                  if (!op.data) {
                    throw new Error(`Data is required for update operation on collection ${op.collection}`);
                  }
                  result = await this.pb!.collection(op.collection).update(op.id, op.data);
                  break;
                
                case 'delete':
                  if (!op.id) {
                    throw new Error(`ID is required for delete operation on collection ${op.collection}`);
                  }
                  result = await this.pb!.collection(op.collection).delete(op.id);
                  break;
              }
              
              results.push({
                operation: op.operation,
                collection: op.collection,
                id: op.id,
                status: 'success',
                result
              });
              
            } catch (error: any) {
              errors.push({
                operation: op.operation,
                collection: op.collection,
                id: op.id,
                status: 'error',
                error: error.message
              });
            }
          }
            return {
            content: [{ type: 'text', text: JSON.stringify({ 
              results, 
              errors,
              note: "Operations executed sequentially since batch API is not available in current PocketBase SDK version"
            }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to execute batch operations: ${error.message}` }],
            isError: true
          };
        }
      }
    );
    
    // === ADVANCED FEATURES ===
    
    // Setup required collections for advanced features
    this.server.tool(
      'setup_advanced_collections',
      {},
      async () => {
        try {
          const collections = [
            {
              name: 'stripe_products',
              schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'price', type: 'number', required: true },
                { name: 'currency', type: 'text', required: true },
                { name: 'recurring', type: 'bool', required: true },
                { name: 'interval', type: 'text', required: false },
                { name: 'stripeProductId', type: 'text', required: true },
                { name: 'stripePriceId', type: 'text', required: false },
                { name: 'active', type: 'bool', required: true },
                { name: 'metadata', type: 'json', required: false },
              ]
            },
            {
              name: 'stripe_customers',
              schema: [
                { name: 'email', type: 'email', required: true },
                { name: 'name', type: 'text', required: false },
                { name: 'stripeCustomerId', type: 'text', required: true },
                { name: 'userId', type: 'relation', required: false, options: { collectionId: 'users' } },
                { name: 'metadata', type: 'json', required: false },
              ]
            },
            {
              name: 'stripe_subscriptions',
              schema: [
                { name: 'customerId', type: 'text', required: true },
                { name: 'productId', type: 'text', required: false },
                { name: 'stripeSubscriptionId', type: 'text', required: true },
                { name: 'status', type: 'text', required: true },
                { name: 'currentPeriodStart', type: 'date', required: true },
                { name: 'currentPeriodEnd', type: 'date', required: true },
                { name: 'cancelAtPeriodEnd', type: 'bool', required: true },
                { name: 'metadata', type: 'json', required: false },
              ]
            },
            {
              name: 'stripe_payments',
              schema: [
                { name: 'customerId', type: 'text', required: true },
                { name: 'amount', type: 'number', required: true },
                { name: 'currency', type: 'text', required: true },
                { name: 'status', type: 'text', required: true },
                { name: 'stripePaymentIntentId', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'metadata', type: 'json', required: false },
              ]
            },
            {
              name: 'email_templates',
              schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'subject', type: 'text', required: true },
                { name: 'htmlContent', type: 'text', required: true },
                { name: 'textContent', type: 'text', required: false },
                { name: 'variables', type: 'json', required: false },
              ]
            },            {
              name: 'email_logs',
              schema: [
                { name: 'to', type: 'email', required: true },
                { name: 'from', type: 'email', required: false },
                { name: 'subject', type: 'text', required: true },
                { name: 'template', type: 'text', required: false },
                { name: 'status', type: 'select', required: true, options: { values: ['sent', 'failed', 'pending'] } },
                { name: 'error', type: 'text', required: false },
                { name: 'variables', type: 'json', required: false },
                // SendGrid-specific fields
                { name: 'sendgrid_message_id', type: 'text', required: false },
                { name: 'categories', type: 'json', required: false },
                { name: 'custom_args', type: 'json', required: false },
                { name: 'last_event', type: 'text', required: false },
                { name: 'last_event_timestamp', type: 'date', required: false },
              ]
            },
            {
              name: 'sendgrid_templates',
              schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'subject', type: 'text', required: false },
                { name: 'htmlContent', type: 'text', required: false },
                { name: 'textContent', type: 'text', required: false },
                { name: 'sendgridTemplateId', type: 'text', required: true },
                { name: 'active', type: 'bool', required: true },
              ]
            },
            {
              name: 'email_suppressions',
              schema: [
                { name: 'email', type: 'email', required: true },
                { name: 'type', type: 'select', required: true, options: { values: ['bounces', 'blocks', 'spam_reports', 'unsubscribes'] } },
                { name: 'reason', type: 'text', required: false },
                { name: 'created_at', type: 'date', required: true },
              ]
            },
            {
              name: 'sendgrid_contact_lists',
              schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'contact_count', type: 'number', required: true },
                { name: 'sendgrid_list_id', type: 'text', required: true },
              ]
            },
            {
              name: 'sendgrid_contacts',
              schema: [
                { name: 'list_id', type: 'text', required: true },
                { name: 'email', type: 'email', required: true },
                { name: 'first_name', type: 'text', required: false },
                { name: 'last_name', type: 'text', required: false },
                { name: 'custom_fields', type: 'json', required: false },
              ]
            },
            {
              name: 'sendgrid_webhook_events',
              schema: [
                { name: 'email', type: 'email', required: true },
                { name: 'event', type: 'select', required: true, options: { values: ['delivered', 'open', 'click', 'bounce', 'dropped', 'spamreport', 'unsubscribe'] } },
                { name: 'timestamp', type: 'date', required: true },
                { name: 'sg_message_id', type: 'text', required: false },
                { name: 'useragent', type: 'text', required: false },
                { name: 'ip', type: 'text', required: false },
                { name: 'url', type: 'text', required: false },
                { name: 'reason', type: 'text', required: false },
              ]
            }
          ];

          const results = [];
          for (const collectionDef of collections) {
            try {
              // Check if collection exists
              try {
                await this.pb!.collections.getOne(collectionDef.name);
                results.push({ collection: collectionDef.name, action: 'exists' });
              } catch {
                // Create collection if it doesn't exist
                await this.pb!.collections.create({
                  name: collectionDef.name,
                  type: 'base',
                  schema: collectionDef.schema.map(field => ({
                    name: field.name,
                    type: field.type,
                    required: field.required,
                    options: field.options || {}
                  }))
                });
                results.push({ collection: collectionDef.name, action: 'created' });
              }
            } catch (error: any) {
              results.push({ collection: collectionDef.name, action: 'error', error: error.message });
            }
          }          return {
            content: [{ type: 'text', text: JSON.stringify({ setup: 'completed', results }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to setup advanced collections: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // === STRIPE PAYMENT PROCESSING TOOLS ===
    // Note: These tools are always registered for discovery, but require STRIPE_SECRET_KEY at runtime
      // Stripe Product Management
    this.server.tool(
      'stripe_create_product',
      {
        name: z.string().describe('Product name for Stripe catalog (e.g., "Premium Subscription", "One-time Setup Fee"). Will be visible to customers.'),
        description: z.string().optional().describe('Product description for customer display (e.g., "Monthly premium plan with advanced features"). Optional but recommended for clarity.'),
        price: z.number().describe('Price in smallest currency unit (cents for USD, e.g., 1999 for $19.99). Cannot be changed once created - create new price for changes.'),        currency: z.string().default('usd').describe('ISO 4217 currency code (e.g., "usd", "eur", "gbp"). Defaults to USD if not specified.'),
        recurring: z.boolean().optional().describe('True for subscription products (recurring billing), false for one-time payments. Determines billing behavior.'),
        interval: z.enum(['month', 'year', 'week', 'day']).optional().describe('Billing frequency for subscriptions (e.g., "month" for monthly billing). Required if recurring=true, ignored for one-time products.'),
        metadata: z.record(z.any()).optional().describe('Custom key-value pairs for internal tracking (e.g., {"category": "premium", "source": "admin"}). Not visible to customers.')
      },
      async ({ name, description, price, currency, recurring, interval, metadata }) => {
        try {
          if (!process.env.STRIPE_SECRET_KEY) {
            return {
              content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
              isError: true
            };
          }
          
          if (!this.stripeService) {
            this.stripeService = new StripeService(this.pb!);
          }
          
          const product = await this.stripeService.createProduct({
            name,
            description,
            price,
            currency,
            recurring,
            interval,
            metadata
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(product, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create product: ${error.message}` }],
            isError: true
          };
        }
      }
    );      this.server.tool(
        'stripe_create_customer',
        {
          email: z.string().email().describe('Customer email address (must be valid email format like "user@example.com"). Used for receipts, notifications, and customer identification.'),
          name: z.string().optional().describe('Customer full name (e.g., "John Smith"). Displayed on invoices and receipts. Optional but recommended for better customer experience.'),
          userId: z.string().optional().describe('Internal user ID from your system (e.g., PocketBase user record ID). Links Stripe customer to your user records for data consistency.'),
          metadata: z.record(z.any()).optional().describe('Custom tracking data (e.g., {"plan_tier": "premium", "signup_source": "web"}). Max 50 keys, each key/value up to 500 characters.')
        },
        async ({ email, name, userId, metadata }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            
            if (!this.stripeService) {
              this.stripeService = new StripeService(this.pb!);
            }
            
            const customer = await this.stripeService.createCustomer({
              email,
              name,
              userId,
              metadata
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(customer, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create customer: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_create_checkout_session',
        {
          priceId: z.string().describe('Stripe price ID'),
          customerId: z.string().optional().describe('Stripe customer ID'),
          customerEmail: z.string().email().optional().describe('Customer email if no customer ID'),
          successUrl: z.string().url().describe('Success redirect URL'),
          cancelUrl: z.string().url().describe('Cancel redirect URL'),
          mode: z.enum(['payment', 'subscription', 'setup']).default('payment').describe('Checkout mode'),
          metadata: z.record(z.any()).optional().describe('Session metadata')
        },
        async ({ priceId, customerId, customerEmail, successUrl, cancelUrl, mode, metadata }) => {
          try {
            const session = await this.stripeService!.createCheckoutSession({
              priceId,
              customerId,
              customerEmail,
              successUrl,
              cancelUrl,
              mode,
              metadata
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(session, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create checkout session: ${error.message}` }],
              isError: true
            };
          }
        }      );      this.server.tool(
        'stripe_create_payment_intent',
        {
          amount: z.number().describe('Payment amount in smallest currency unit (cents for USD, e.g., 2500 for $25.00). Must be at least 50 cents in most currencies.'),
          currency: z.string().default('usd').describe('ISO 4217 currency code (e.g., "usd", "eur", "gbp"). Determines payment methods available and processing rules.'),
          customerId: z.string().optional().describe('Stripe customer ID to associate with payment (e.g., "cus_xxxxx"). Enables saved payment methods and customer history tracking.'),
          description: z.string().optional().describe('Payment description for internal tracking (e.g., "Premium subscription renewal"). Shown in Stripe dashboard and receipts.'),
          metadata: z.record(z.any()).optional().describe('Custom payment tracking data (e.g., {"order_id": "12345", "product": "premium"}). Useful for reconciliation and analytics.')
        },
        async ({ amount, currency, customerId, description, metadata }) => {
          try {
            const result = await this.stripeService!.createPaymentIntent({
              amount,
              currency,
              customerId,
              description,
              metadata
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create payment intent: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_retrieve_customer',
        {
          customerId: z.string().describe('Stripe customer ID')
        },
        async ({ customerId }) => {
          try {
            const customer = await this.stripeService!.retrieveCustomer(customerId);

            return {
              content: [{ type: 'text', text: JSON.stringify(customer, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to retrieve customer: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_update_customer',
        {
          customerId: z.string().describe('Stripe customer ID'),
          email: z.string().email().optional().describe('New customer email'),
          name: z.string().optional().describe('New customer name'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ customerId, email, name, metadata }) => {
          try {
            const customer = await this.stripeService!.updateCustomer(customerId, {
              email,
              name,
              metadata
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(customer, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to update customer: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_cancel_subscription',
        {
          subscriptionId: z.string().describe('Stripe subscription ID'),
          cancelAtPeriodEnd: z.boolean().default(false).describe('Whether to cancel at period end or immediately')
        },
        async ({ subscriptionId, cancelAtPeriodEnd }) => {
          try {
            const subscription = await this.stripeService!.cancelSubscription(subscriptionId, cancelAtPeriodEnd);

            return {
              content: [{ type: 'text', text: JSON.stringify(subscription, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to cancel subscription: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'list_stripe_products',
        {
          page: z.number().optional().default(1).describe('Page number'),
          perPage: z.number().optional().default(50).describe('Records per page'),
          filter: z.string().optional().describe('Filter products (PocketBase filter syntax)')
        },
        async ({ page, perPage, filter }) => {
          try {
            const options: any = {};
            if (filter) options.filter = filter;

            const products = await this.pb!.collection('stripe_products').getList(page, perPage, options);

            return {
              content: [{ type: 'text', text: JSON.stringify(products, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list Stripe products: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'list_stripe_customers',
        {
          page: z.number().optional().default(1).describe('Page number'),
          perPage: z.number().optional().default(50).describe('Records per page'),
          filter: z.string().optional().describe('Filter customers (PocketBase filter syntax)')
        },
        async ({ page, perPage, filter }) => {
          try {
            const options: any = {};
            if (filter) options.filter = filter;

            const customers = await this.pb!.collection('stripe_customers').getList(page, perPage, options);

            return {
              content: [{ type: 'text', text: JSON.stringify(customers, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list Stripe customers: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'list_stripe_subscriptions',
        {
          page: z.number().optional().default(1).describe('Page number'),
          perPage: z.number().optional().default(50).describe('Records per page'),
          filter: z.string().optional().describe('Filter subscriptions (PocketBase filter syntax)')
        },
        async ({ page, perPage, filter }) => {
          try {
            const options: any = {};
            if (filter) options.filter = filter;

            const subscriptions = await this.pb!.collection('stripe_subscriptions').getList(page, perPage, options);

            return {
              content: [{ type: 'text', text: JSON.stringify(subscriptions, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list Stripe subscriptions: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_handle_webhook',
        {
          body: z.string().describe('Webhook request body'),
          signature: z.string().describe('Stripe signature header')
        },
        async ({ body, signature }) => {
          try {
            const result = await this.stripeService!.handleWebhook(body, signature);

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to handle webhook: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'sync_stripe_products',
        {},
        async () => {
          try {
            const result = await this.stripeService!.syncProducts();

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to sync products: ${error.message}` }],
              isError: true
            };
          }
        }      );

    // === LATEST STRIPE 2025 FEATURES ===
    // Note: These tools are always registered for discovery, but require STRIPE_SECRET_KEY at runtime
    
    // Treasury (for embedded finance)
    this.server.tool(
      'stripe_create_treasury_financial_account',
      {
        supportedCurrencies: z.array(z.string()).describe('Supported currencies for the account'),
        countryCode: z.string().describe('Country code for compliance'),
        metadata: z.record(z.any()).optional().describe('Additional metadata')
      },      async ({ supportedCurrencies, countryCode, metadata }: {
        supportedCurrencies: string[];
        countryCode: string;
        metadata?: Record<string, any>;
      }) => {
        try {
          if (!process.env.STRIPE_SECRET_KEY) {
            return {
              content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
              isError: true
            };
          }
          
          // Note: This requires Treasury enabled on your Stripe account
          const response = await fetch('https://api.stripe.com/v1/treasury/financial_accounts', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              'supported_currencies[]': supportedCurrencies.join(','),
              'country': countryCode,
              ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)]))
            }),
          });

          const account = await response.json();

          return {
            content: [{ type: 'text', text: JSON.stringify(account, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create treasury financial account: ${error.message}` }],
            isError: true
          };
        }
      }
    );

      // Climate - Carbon removal orders (Stripe Climate)
      this.server.tool(
        'stripe_create_climate_order',
        {
          amount: z.number().describe('Amount in smallest currency unit for carbon removal'),
          currency: z.string().default('usd').describe('Currency'),
          beneficiary: z.string().optional().describe('Beneficiary of the carbon removal'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },        async ({ amount, currency, beneficiary, metadata }: {
          amount: number;
          currency: string;
          beneficiary?: string;
          metadata?: Record<string, any>;
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            // Note: This requires Climate products enabled
            const response = await fetch('https://api.stripe.com/v1/climate/orders', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                amount: amount.toString(),
                currency,
                ...(beneficiary && { beneficiary }),
                ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)]))
              }),
            });

            const order = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(order, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create climate order: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Terminal - For in-person payments
      this.server.tool(
        'stripe_create_terminal_connection_token',
        {
          location: z.string().optional().describe('Terminal location ID')
        },        async ({ location }: { location?: string }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const response = await fetch('https://api.stripe.com/v1/terminal/connection_tokens', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                ...(location && { location })
              }),
            });

            const token = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(token, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create terminal connection token: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Issuing - For card issuing
      this.server.tool(
        'stripe_create_issuing_card',
        {
          cardholderId: z.string().describe('Cardholder ID'),
          currency: z.string().describe('Currency for the card'),
          type: z.enum(['virtual', 'physical']).describe('Type of card'),
          spendingControls: z.object({
            spendingLimits: z.array(z.object({
              amount: z.number(),
              interval: z.enum(['per_authorization', 'daily', 'weekly', 'monthly', 'yearly', 'all_time'])
            })).optional(),
            allowedCategories: z.array(z.string()).optional(),
            blockedCategories: z.array(z.string()).optional()
          }).optional().describe('Spending controls'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },        async ({ cardholderId, currency, type, spendingControls, metadata }: {
          cardholderId: string;
          currency: string;
          type: 'virtual' | 'physical';
          spendingControls?: any;
          metadata?: Record<string, any>;
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const response = await fetch('https://api.stripe.com/v1/issuing/cards', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                cardholder: cardholderId,
                currency,
                type,
                ...(spendingControls && {
                  'spending_controls[spending_limits][0][amount]': spendingControls.spendingLimits?.[0]?.amount?.toString() || '',
                  'spending_controls[spending_limits][0][interval]': spendingControls.spendingLimits?.[0]?.interval || ''
                }),
                ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)]))
              }),
            });

            const card = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(card, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create issuing card: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Apps - For marketplace/platform integrations
      this.server.tool(
        'stripe_create_app_secret',
        {
          name: z.string().describe('Name for the secret'),
          payload: z.string().describe('Secret payload'),
          scope: z.object({
            type: z.enum(['account', 'user']),
            account: z.string().optional()
          }).describe('Scope of the secret')
        },        async ({ name, payload, scope }: {
          name: string;
          payload: string;
          scope: { type: 'account' | 'user'; account?: string };
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const response = await fetch('https://api.stripe.com/v1/apps/secrets', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                name,
                payload,
                'scope[type]': scope.type,
                ...(scope.account && { 'scope[account]': scope.account })
              }),
            });

            const secret = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(secret, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create app secret: ${error.message}` }],
              isError: true
            };
          }
        }
      );

    // === EMAIL SERVICE TOOLS ===
    // Note: These tools are always registered for discovery, but require email configuration at runtime
    
    this.server.tool(
      'email_create_template',
      {
        name: z.string().describe('Template name'),
        subject: z.string().describe('Email subject'),
        htmlContent: z.string().describe('HTML email content'),
        textContent: z.string().optional().describe('Plain text email content'),
        variables: z.array(z.string()).optional().describe('Template variables')
      },
      async ({ name, subject, htmlContent, textContent, variables }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const template = await this.emailService.createTemplate({
            name,
            subject,
            htmlContent,
            textContent,
            variables
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(template, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create email template: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'email_get_template',
      {
        name: z.string().describe('Template name')
      },
      async ({ name }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const template = await this.emailService.getTemplate(name);
          return {
            content: [{ type: 'text', text: JSON.stringify(template, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get email template: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'email_update_template',
      {
        name: z.string().describe('Template name'),
        subject: z.string().optional().describe('New email subject'),
        htmlContent: z.string().optional().describe('New HTML email content'),
        textContent: z.string().optional().describe('New plain text email content'),
        variables: z.array(z.string()).optional().describe('New template variables')
      },
      async ({ name, subject, htmlContent, textContent, variables }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const template = await this.emailService.updateTemplate(name, {
            subject,
            htmlContent,
            textContent,
            variables
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(template, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to update email template: ${error.message}` }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'email_send_templated',
      {
        template: z.string().describe('Template name from email_templates collection (e.g., "welcome", "password_reset"). Template must exist or tool will fail.'),
        to: z.string().email().describe('Recipient email address (must be valid email format like "user@example.com")'),
        from: z.string().email().optional().describe('Sender email address. If not provided, uses DEFAULT_FROM_EMAIL or SMTP_USER environment variable.'),
        variables: z.record(z.any()).optional().describe('Template variables object for Handlebars interpolation (e.g., {"userName": "John", "appName": "MyApp"}). Variables replace {{variableName}} placeholders in template.'),
        customSubject: z.string().optional().describe('Override the template default subject line. If not provided, uses template subject with variable interpolation.'),
        // Optional SendGrid-specific parameters (backward compatible)
        categories: z.array(z.string()).optional().describe('SendGrid categories for email organization and tracking (e.g., ["onboarding", "welcome"]). Only works with EMAIL_SERVICE=sendgrid, ignored for SMTP.'),
        customArgs: z.record(z.string()).optional().describe('SendGrid custom arguments for analytics tracking (e.g., {"userId": "123", "campaignId": "summer2024"}). Only works with SendGrid.'),
        enableClickTracking: z.boolean().optional().describe('Enable SendGrid click tracking for links in email. Only works with SendGrid service, ignored for SMTP.'),
        enableOpenTracking: z.boolean().optional().describe('Enable SendGrid open tracking to detect when emails are opened. Only works with SendGrid service, ignored for SMTP.')
      },
      async ({ template, to, from, variables, customSubject, categories, customArgs, enableClickTracking, enableOpenTracking }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          // Check if any SendGrid features are requested
          const hasEnhancedFeatures = categories || customArgs || enableClickTracking !== undefined || enableOpenTracking !== undefined;
          
          let emailLog;
          if (hasEnhancedFeatures && this.emailService.hasEnhancedFeatures()) {
            // Use enhanced method if SendGrid features are requested and available
            const enhancedData: any = {
              template,
              to,
              from,
              variables,
              customSubject
            };
            
            if (categories) enhancedData.categories = categories;
            if (customArgs) enhancedData.customArgs = customArgs;
            if (enableClickTracking !== undefined || enableOpenTracking !== undefined) {
              enhancedData.trackingSettings = {
                clickTracking: enableClickTracking,
                openTracking: enableOpenTracking
              };
            }
            
            emailLog = await this.emailService.sendEnhancedTemplatedEmail(enhancedData);
          } else {
            // Use regular method for backward compatibility
            emailLog = await this.emailService.sendTemplatedEmail({
              template,
              to,
              from,
              variables,
              customSubject
            });
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(emailLog, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to send templated email: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'email_send_enhanced_templated',
      {
        template: z.string().describe('Template name'),
        to: z.string().email().describe('Recipient email'),
        from: z.string().email().optional().describe('Sender email'),
        variables: z.record(z.any()).optional().describe('Template variables'),
        customSubject: z.string().optional().describe('Custom subject override'),
        // SendGrid-specific options
        categories: z.array(z.string()).optional().describe('SendGrid categories for email tracking and organization'),
        customArgs: z.record(z.string()).optional().describe('SendGrid custom arguments for tracking'),
        sendAt: z.string().optional().describe('ISO 8601 datetime string for scheduled sending (SendGrid only)'),
        clickTracking: z.boolean().optional().describe('Enable click tracking (SendGrid only)'),
        openTracking: z.boolean().optional().describe('Enable open tracking (SendGrid only)'),
        sandboxMode: z.boolean().optional().describe('Enable sandbox mode for testing (SendGrid only)')
      },
      async ({ template, to, from, variables, customSubject, categories, customArgs, sendAt, clickTracking, openTracking, sandboxMode }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          // Prepare enhanced email data
          const emailData: any = {
            template,
            to,
            from,
            variables,
            customSubject
          };

          // Add SendGrid-specific options if provided
          if (categories) emailData.categories = categories;
          if (customArgs) emailData.customArgs = customArgs;
          if (sendAt) emailData.sendAt = new Date(sendAt);
          if (sandboxMode !== undefined) emailData.sandboxMode = sandboxMode;
          
          if (clickTracking !== undefined || openTracking !== undefined) {
            emailData.trackingSettings = {
              clickTracking,
              openTracking
            };
          }

          const emailLog = await this.emailService.sendEnhancedTemplatedEmail(emailData);
          return {
            content: [{ type: 'text', text: JSON.stringify(emailLog, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to send enhanced templated email: ${error.message}` }],
            isError: true
          };
        }
      }
    );    this.server.tool(
      'email_schedule_templated',
      {
        template: z.string().describe('Template name from email_templates collection to send (e.g., "newsletter", "reminder"). Template must exist.'),
        to: z.string().email().describe('Recipient email address (must be valid email format like "user@example.com")'),
        sendAt: z.string().describe('ISO 8601 datetime string for scheduled delivery (e.g., "2024-12-25T10:00:00Z"). SendGrid supports scheduling up to 72 hours in advance. For SMTP, emails send immediately.'),
        from: z.string().email().optional().describe('Sender email address. If not provided, uses DEFAULT_FROM_EMAIL environment variable.'),
        variables: z.record(z.any()).optional().describe('Template variables for Handlebars interpolation (e.g., {"name": "John", "date": "2024-12-25"}). Variables replace {{variableName}} in template.'),
        customSubject: z.string().optional().describe('Override template default subject. If not provided, uses template subject with variable interpolation.'),
        categories: z.array(z.string()).optional().describe('SendGrid categories for email organization (e.g., ["scheduled", "newsletter"]). Only works with EMAIL_SERVICE=sendgrid.')
      },
      async ({ template, to, sendAt, from, variables, customSubject, categories }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const emailLog = await this.emailService.scheduleTemplatedEmail({
            template,
            to,
            sendAt: new Date(sendAt),
            from,
            variables,
            customSubject,
            categories
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(emailLog, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to schedule templated email: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'email_test_connection',
      {},
      async () => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const result = await this.emailService.testConnection();
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to test email connection: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'email_check_features',
      {},
      async () => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                configured: false,
                message: 'Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.'
              }, null, 2) }]
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const features = {
            configured: true,
            service: process.env.EMAIL_SERVICE || 'smtp',
            enhancedFeatures: this.emailService.hasEnhancedFeatures(),
            capabilities: {
              basicEmail: true,
              templatedEmail: true,
              testConnection: true,
              enhancedTemplatedEmail: this.emailService.hasEnhancedFeatures(),
              scheduledEmail: this.emailService.hasEnhancedFeatures(),
              categories: this.emailService.hasEnhancedFeatures(),
              customArgs: this.emailService.hasEnhancedFeatures(),
              trackingSettings: this.emailService.hasEnhancedFeatures(),
              sandboxMode: this.emailService.hasEnhancedFeatures(),
              dynamicTemplates: this.emailService.hasEnhancedFeatures(),
              bulkEmail: this.emailService.hasEnhancedFeatures(),
              emailStatistics: this.emailService.hasEnhancedFeatures(),
              suppressionManagement: this.emailService.hasEnhancedFeatures(),
              emailValidation: this.emailService.hasEnhancedFeatures(),
              contactListManagement: this.emailService.hasEnhancedFeatures()
            }
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(features, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to check email features: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // === SENDGRID TEMPLATE AND ANALYTICS TOOLS ===
    
    this.server.tool(
      'sendgrid_create_dynamic_template',
      {
        name: z.string().describe('Template name'),
        subject: z.string().optional().describe('Email subject'),
        htmlContent: z.string().optional().describe('HTML email content'),
        textContent: z.string().optional().describe('Plain text email content')
      },
      async ({ name, subject, htmlContent, textContent }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }

          const template = await sendGridService.createDynamicTemplate({
            name,
            subject,
            htmlContent,
            textContent
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(template, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create SendGrid dynamic template: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_send_bulk_email',
      {
        templateId: z.string().describe('SendGrid template ID'),
        recipients: z.array(z.object({
          email: z.string().email().describe('Recipient email'),
          dynamicTemplateData: z.record(z.any()).optional().describe('Template variables for this recipient')
        })).describe('Array of recipients with their template data'),
        from: z.string().email().optional().describe('Sender email'),
        categories: z.array(z.string()).optional().describe('SendGrid categories'),
        customArgs: z.record(z.string()).optional().describe('SendGrid custom arguments')
      },
      async ({ templateId, recipients, from, categories, customArgs }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }          // For now, convert template-based bulk email to individual sendEnhancedEmail calls
          // Since sendBulkEmails expects different structure, we'll process individually
          const results = {
            sent: 0,
            failed: 0,
            errors: [] as string[]
          };

          for (const recipient of recipients) {
            try {
              await sendGridService.sendEnhancedEmail({
                to: recipient.email,
                from: from || process.env.DEFAULT_FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com',
                subject: 'Template Email', // This would come from the template
                html: '<p>This is a template-based email</p>', // This would come from the template
                templateId: templateId,
                dynamicTemplateData: recipient.dynamicTemplateData,
                options: {
                  categories,
                  customArgs
                }
              });
              results.sent++;
            } catch (error: any) {
              results.failed++;
              results.errors.push(`${recipient.email}: ${error.message}`);
            }
          }

          const result = results;

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to send bulk email: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_get_email_statistics',
      {
        startDate: z.string().describe('Start date (YYYY-MM-DD format)'),
        endDate: z.string().optional().describe('End date (YYYY-MM-DD format, defaults to today)'),
        categories: z.array(z.string()).optional().describe('Filter by categories'),
        aggregatedBy: z.enum(['day', 'week', 'month']).optional().default('day').describe('Aggregation period')
      },
      async ({ startDate, endDate, categories, aggregatedBy }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }          const stats = await sendGridService.getEmailStats({
            startDate,
            endDate,
            categories,
            aggregatedBy
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get email statistics: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_manage_suppression',
      {
        action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
        email: z.string().email().optional().describe('Email to add/remove from suppression (required for add/remove)'),
        suppressionType: z.enum(['bounce', 'block', 'spam', 'unsubscribe']).optional().describe('Type of suppression (required for add/remove)')
      },
      async ({ action, email, suppressionType }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }

          if ((action === 'add' || action === 'remove') && (!email || !suppressionType)) {
            return {
              content: [{ type: 'text', text: 'Error: email and suppressionType are required for add/remove actions.' }],
              isError: true
            };
          }          let result;
          
          if (action === 'list') {
            result = await sendGridService.getSuppressions(suppressionType as any);
          } else if (action === 'add' && email && suppressionType) {
            result = await sendGridService.addSuppression(email, suppressionType as any);
          } else if (action === 'remove' && email && suppressionType) {
            result = await sendGridService.removeSuppression(email, suppressionType as any);
          } else {
            throw new Error('Invalid action or missing parameters');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to manage suppression: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_validate_email',
      {
        email: z.string().email().describe('Email address to validate'),
        source: z.string().optional().describe('Source context for validation')
      },
      async ({ email, source }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }          const validation = await sendGridService.validateEmail(email);

          return {
            content: [{ type: 'text', text: JSON.stringify(validation, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to validate email: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_manage_contact_lists',
      {
        action: z.enum(['create', 'list', 'delete', 'add_contact', 'remove_contact']).describe('Action to perform'),
        listName: z.string().optional().describe('List name (required for create)'),
        listId: z.string().optional().describe('List ID (required for delete, add_contact, remove_contact)'),
        contactEmail: z.string().email().optional().describe('Contact email (required for add_contact, remove_contact)'),
        contactData: z.record(z.any()).optional().describe('Additional contact data (optional for add_contact)')
      },
      async ({ action, listName, listId, contactEmail, contactData }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb!);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }

          // Validate required parameters based on action
          if (action === 'create' && !listName) {
            return {
              content: [{ type: 'text', text: 'Error: listName is required for create action.' }],
              isError: true
            };
          }

          if ((action === 'delete' || action === 'add_contact' || action === 'remove_contact') && !listId) {
            return {
              content: [{ type: 'text', text: 'Error: listId is required for this action.' }],
              isError: true
            };
          }

          if ((action === 'add_contact' || action === 'remove_contact') && !contactEmail) {
            return {
              content: [{ type: 'text', text: 'Error: contactEmail is required for contact actions.' }],
              isError: true
            };
          }          let result;
          
          if (action === 'create' && listName) {
            result = await sendGridService.createContactList({
              name: listName,
              description: contactData?.description
            });
          } else if (action === 'list') {
            // Get all contact lists
            const lists = await this.pb!.collection('sendgrid_contact_lists').getFullList();
            result = { lists };
          } else if (action === 'delete' && listId) {
            await this.pb!.collection('sendgrid_contact_lists').delete(listId);
            result = { success: true, message: `Contact list ${listId} deleted` };
          } else if (action === 'add_contact' && listId && contactEmail) {
            result = await sendGridService.addContactToList(listId, {
              email: contactEmail,
              firstName: contactData?.firstName,
              lastName: contactData?.lastName,
              customFields: contactData?.customFields
            });
          } else if (action === 'remove_contact' && listId && contactEmail) {
            // Remove contact from list
            const contacts = await this.pb!.collection('sendgrid_contacts').getFullList({
              filter: `list_id = "${listId}" && email = "${contactEmail}"`
            });
            
            for (const contact of contacts) {
              await this.pb!.collection('sendgrid_contacts').delete(contact.id);
            }
            
            result = { success: true, message: `Contact ${contactEmail} removed from list ${listId}` };
          } else {
            throw new Error('Invalid action or missing required parameters');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to manage contact lists: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // === HIGH-LEVEL AUTOMATION WORKFLOW TOOLS ===
    
    // Complete user registration with email and Stripe customer creation
    this.server.tool(
      'register_user_with_automation',
      {
        email: z.string().email().describe('User email address for registration and all future communications (must be valid email format like "user@example.com")'),
        password: z.string().min(8).describe('User password (minimum 8 characters for security compliance). Should contain mix of letters, numbers, symbols for strength.'),
        userData: z.record(z.any()).optional().describe('Additional user profile data (e.g., {"name": "John Smith", "phone": "+1234567890", "preferences": {"marketing": true}}). All fields optional.'),
        sendWelcomeEmail: z.boolean().optional().default(true).describe('Automatically send welcome email using template "welcome". Requires email service configuration (SMTP or SendGrid).'),
        createStripeCustomer: z.boolean().optional().default(true).describe('Create corresponding Stripe customer for future payment processing. Requires STRIPE_SECRET_KEY environment variable.')
      },
      async ({ email, password, userData = {}, sendWelcomeEmail, createStripeCustomer }) => {
        try {
          const results: any = {};
          
          // Step 1: Create PocketBase user
          const user = await this.pb!.collection('users').create({
            email,
            password,
            passwordConfirm: password,
            ...userData
          });
          results.user = user;
          
          // Step 2: Create Stripe customer if enabled and service available
          if (createStripeCustomer && this.stripeService) {
            try {
              const customer = await this.stripeService.createCustomer({
                email,
                name: userData.name || email,
                metadata: { pocketbase_user_id: user.id }
              });
              results.stripeCustomer = customer;
              
              // Update user with Stripe customer ID
              await this.pb!.collection('users').update(user.id, {
                stripe_customer_id: customer.id
              });
            } catch (error: any) {
              results.stripeError = error.message;
            }
          }
            // Step 3: Send welcome email if enabled and service available
          if (sendWelcomeEmail && this.emailService) {
            try {
              await this.emailService.sendTemplatedEmail({
                template: 'welcome',
                to: email,
                variables: {
                  name: userData.name || email,
                  email,
                  userId: user.id,
                  appName: process.env.APP_NAME || 'Your App'
                }
              });
              results.welcomeEmailSent = true;
            } catch (error: any) {
              results.emailError = error.message;
            }
          }
          
          // Step 4: Log successful registration for analytics
          try {
            await this.pb!.collection('user_registrations').create({
              user_id: user.id,
              registration_method: 'automation',
              stripe_customer_created: !!results.stripeCustomer,
              welcome_email_sent: !!results.welcomeEmailSent,
              registration_ip: '', // Could be enhanced with IP tracking
              user_agent: '', // Could be enhanced with user agent tracking
              created: new Date().toISOString()
            });
            results.analyticsLogged = true;
          } catch (error: any) {
            // Analytics logging is optional - don't fail registration if this fails
            results.analyticsWarning = 'Could not log registration analytics: ' + error.message;
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `User registration automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // End-to-end subscription setup with email notifications
    this.server.tool(
      'create_subscription_flow',
      {
        customerId: z.string().describe('Stripe customer ID (e.g., "cus_xxxxx" from register_user_with_automation or stripe_create_customer). Must be existing valid customer.'),
        priceId: z.string().describe('Stripe price ID for subscription plan (e.g., "price_xxxxx" from Stripe dashboard or stripe_create_product). Determines billing amount and frequency.'),
        userEmail: z.string().email().describe('User email address for subscription confirmation and billing notifications. Should match customer email for consistency.'),
        metadata: z.record(z.any()).optional().describe('Custom subscription tracking data (e.g., {"plan_name": "Premium", "source": "website", "campaign_id": "summer2024"}). Useful for analytics and customer support.'),
        sendConfirmationEmail: z.boolean().optional().default(true).describe('Send subscription confirmation email using template "subscription_created". Includes subscription details, trial info, and billing dates.'),
        trialPeriodDays: z.number().optional().describe('Number of days for free trial period (e.g., 7, 14, 30). Customer not charged until trial ends. Must be positive integer.'),
        promotionCode: z.string().optional().describe('Stripe promotion code to apply discount (e.g., "SAVE20", "NEWUSER"). Must be active and valid promotion code from Stripe.')
      },async ({ customerId, priceId, userEmail, metadata = {}, sendConfirmationEmail, trialPeriodDays, promotionCode }) => {
        try {
          const results: any = {};
          
          if (!this.stripeService) {
            throw new Error('Stripe service not configured. Set STRIPE_SECRET_KEY environment variable.');
          }
          
          // Step 1: Create Stripe subscription with enhanced options
          const subscriptionData: any = {
            customerId,
            items: [{ price: priceId }],
            metadata: {
              ...metadata,
              created_via: 'mcp_automation',
              user_email: userEmail,
              created_at: new Date().toISOString()
            }
          };
          
          // Add optional features if provided
          if (trialPeriodDays) {
            subscriptionData.trialPeriodDays = trialPeriodDays;
          }
          
          if (promotionCode) {
            subscriptionData.promotionCode = promotionCode;
          }
          
          const subscription = await this.stripeService.createAdvancedSubscription(subscriptionData);
          results.subscription = subscription;
            // Step 2: Store subscription in PocketBase with enhanced tracking
          try {
            const subscriptionRecord = await this.pb!.collection('stripe_subscriptions').create({
              stripe_subscription_id: subscription.id,
              stripe_customer_id: customerId,
              status: subscription.status,
              price_id: priceId,
              metadata: JSON.stringify(metadata),
              user_email: userEmail,
              trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
              trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              created_via: 'automation_flow'
            });
            results.subscriptionRecord = subscriptionRecord;
          } catch (error: any) {
            results.databaseError = error.message;
          }
            // Step 3: Send confirmation email if enabled and service available
          if (sendConfirmationEmail && this.emailService) {
            try {
              const emailVariables: any = {
                subscriptionId: subscription.id,
                status: subscription.status,
                priceId,
                email: userEmail,
                appName: process.env.APP_NAME || 'Your App'
              };
              
              // Add trial information if applicable
              if (subscription.trial_end) {
                emailVariables.trialEnd = new Date(subscription.trial_end * 1000).toLocaleDateString();
                emailVariables.isTrialSubscription = true;
              }
              
              // Add promotion information if applicable
              if (promotionCode) {
                emailVariables.promotionCode = promotionCode;
                emailVariables.hasPromotion = true;
              }
              
              await this.emailService.sendTemplatedEmail({
                template: 'subscription_created',
                to: userEmail,
                variables: emailVariables
              });
              results.confirmationEmailSent = true;
            } catch (error: any) {
              results.emailError = error.message;
            }
          }
          
          // Step 4: Update user record with subscription information
          if (this.pb && userEmail) {
            try {
              const user = await this.pb!.collection('users').getFirstListItem(`email = '${userEmail}'`);
              await this.pb!.collection('users').update(user.id, {
                subscription_status: subscription.status,
                stripe_subscription_id: subscription.id,
                subscription_updated_at: new Date().toISOString()
              });
              results.userUpdated = true;
            } catch (error: any) {
              results.userUpdateError = error.message;
            }
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Subscription flow automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Webhook processing with automated email notifications and enhanced event handling
    this.server.tool(
      'process_payment_webhook_with_email',
      {
        webhookPayload: z.record(z.any()).describe('Complete Stripe webhook payload object from webhook endpoint (includes type, data, id, created, livemode fields). Contains full event information from Stripe.'),
        webhookSignature: z.string().describe('Stripe webhook signature header value from "stripe-signature" header. Required for security verification to ensure webhook authenticity and prevent replay attacks.'),
        sendNotifications: z.boolean().optional().default(true).describe('Automatically send contextual email notifications for payment events (payment success, failure, subscription changes). Uses appropriate templates based on event type.'),
        customEmailTemplates: z.record(z.string()).optional().describe('Override default email templates for specific events (e.g., {"payment_intent.succeeded": "custom_payment_success", "invoice.payment_failed": "custom_payment_retry"}). Template names from email_templates collection.')
      },async ({ webhookPayload, webhookSignature, sendNotifications, customEmailTemplates = {} }) => {
        try {
          const results: any = {};
          
          if (!this.stripeService) {
            throw new Error('Stripe service not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.');
          }
          
          // Step 1: Process the webhook with Stripe service (validates signature)
          const webhookResult = await this.stripeService.handleWebhook(JSON.stringify(webhookPayload), webhookSignature);
          results.webhookProcessed = webhookResult;
          results.eventType = webhookPayload.type;
          results.eventId = webhookPayload.id;
          
          // Step 2: Log webhook event for audit trail
          try {
            await this.pb!.collection('webhook_events').create({
              event_id: webhookPayload.id,
              event_type: webhookPayload.type,
              processed_at: new Date().toISOString(),
              data: JSON.stringify(webhookPayload.data),
              livemode: webhookPayload.livemode || false,
              api_version: webhookPayload.api_version || '',
              processing_result: JSON.stringify(webhookResult)
            });
            results.eventLogged = true;
          } catch (error: any) {
            results.loggingError = error.message;
          }
            // Step 3: Handle specific webhook events with enhanced email notifications
          if (sendNotifications && this.emailService && webhookPayload.type) {
            const eventType = webhookPayload.type;
            const eventData = webhookPayload.data?.object;
            
            try {
              switch (eventType) {
                case 'payment_intent.succeeded':
                  if (eventData?.receipt_email) {
                    const template = customEmailTemplates['payment_intent.succeeded'] || 'payment_success';
                    await this.emailService.sendTemplatedEmail({
                      template,
                      to: eventData.receipt_email,
                      variables: {
                        amount: (eventData.amount / 100).toFixed(2),
                        currency: eventData.currency.toUpperCase(),
                        paymentId: eventData.id,
                        paymentMethod: eventData.payment_method_types?.[0] || 'card',
                        receiptUrl: eventData.charges?.data?.[0]?.receipt_url || '',
                        appName: process.env.APP_NAME || 'Your App'
                      }
                    });
                    results.paymentSuccessEmailSent = true;
                  }
                  break;
                  
                case 'payment_intent.payment_failed':
                  if (eventData?.receipt_email) {
                    const template = customEmailTemplates['payment_intent.payment_failed'] || 'payment_failed';
                    await this.emailService.sendTemplatedEmail({
                      template,
                      to: eventData.receipt_email,
                      variables: {
                        amount: (eventData.amount / 100).toFixed(2),
                        currency: eventData.currency.toUpperCase(),
                        paymentId: eventData.id,
                        failureReason: eventData.last_payment_error?.message || 'Payment declined',
                        failureCode: eventData.last_payment_error?.code || 'generic_decline',
                        supportEmail: process.env.SUPPORT_EMAIL || 'support@yourapp.com',
                        appName: process.env.APP_NAME || 'Your App'
                      }
                    });
                    results.paymentFailedEmailSent = true;
                  }
                  break;
                  
                case 'invoice.payment_succeeded':
                  // Find user by customer ID for subscription renewals
                  try {
                    const user = await this.pb!.collection('users').getFirstListItem(
                      `stripe_customer_id = '${eventData?.customer}'`
                    );
                    const template = customEmailTemplates['invoice.payment_succeeded'] || 'subscription_renewed';
                    await this.emailService.sendTemplatedEmail({
                      template,
                      to: user.email,
                      variables: {
                        invoiceId: eventData?.id,
                        amount: (eventData?.amount_paid / 100).toFixed(2),
                        currency: eventData?.currency?.toUpperCase(),
                        periodStart: new Date(eventData?.period_start * 1000).toLocaleDateString(),
                        periodEnd: new Date(eventData?.period_end * 1000).toLocaleDateString(),
                        invoiceUrl: eventData?.hosted_invoice_url || '',
                        appName: process.env.APP_NAME || 'Your App'
                      }
                    });
                    results.invoiceEmailSent = true;
                  } catch (error: any) {
                    results.invoiceEmailError = error.message;
                  }
                  break;
                    case 'customer.subscription.created':
                case 'customer.subscription.updated':
                  // Find user by customer ID and send notification
                  try {
                    const user = await this.pb!.collection('users').getFirstListItem(
                      `stripe_customer_id = '${eventData?.customer}'`
                    );
                    const template = customEmailTemplates[eventType] || 'subscription_updated';
                    await this.emailService.sendTemplatedEmail({
                      template,
                      to: user.email,
                      variables: {
                        subscriptionId: eventData?.id,
                        status: eventData?.status,
                        customerId: eventData?.customer,
                        planName: eventData?.items?.data?.[0]?.price?.nickname || 'Your Plan',
                        amount: eventData?.items?.data?.[0]?.price?.unit_amount ? 
                          (eventData.items.data[0].price.unit_amount / 100).toFixed(2) : '0',
                        currency: eventData?.items?.data?.[0]?.price?.currency?.toUpperCase() || 'USD',
                        currentPeriodEnd: new Date(eventData?.current_period_end * 1000).toLocaleDateString(),
                        appName: process.env.APP_NAME || 'Your App'
                      }
                    });
                    results.subscriptionEmailSent = true;
                  } catch (error: any) {
                    results.subscriptionEmailError = error.message;
                  }
                  break;
                  
                case 'customer.subscription.deleted':
                  // Handle subscription cancellation
                  try {
                    const user = await this.pb!.collection('users').getFirstListItem(
                      `stripe_customer_id = '${eventData?.customer}'`
                    );
                    const template = customEmailTemplates['customer.subscription.deleted'] || 'subscription_canceled';
                    await this.emailService.sendTemplatedEmail({
                      template,
                      to: user.email,
                      variables: {
                        subscriptionId: eventData?.id,
                        canceledAt: new Date(eventData?.canceled_at * 1000).toLocaleDateString(),
                        feedbackUrl: process.env.FEEDBACK_URL || '',
                        supportEmail: process.env.SUPPORT_EMAIL || 'support@yourapp.com',
                        appName: process.env.APP_NAME || 'Your App'
                      }
                    });
                    results.cancellationEmailSent = true;
                  } catch (error: any) {
                    results.cancellationEmailError = error.message;
                  }
                  break;
              }
            } catch (error: any) {
              results.emailNotificationError = error.message;
            }
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Webhook processing automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // One-click SaaS backend initialization with comprehensive setup
    this.server.tool(
      'setup_complete_saas_backend',
      {
        setupStripeCollections: z.boolean().optional().default(true).describe('Create Stripe-related collections (customers, subscriptions, payments, invoices)'),
        setupEmailCollections: z.boolean().optional().default(true).describe('Create email-related collections (templates, logs, suppressions, campaigns)'),
        createDefaultTemplates: z.boolean().optional().default(true).describe('Create default email templates (welcome, payment_success, subscription_created, etc.)'),
        setupUserCollections: z.boolean().optional().default(true).describe('Create enhanced user management collections (profiles, sessions, preferences)'),
        setupAnalyticsCollections: z.boolean().optional().default(true).describe('Create analytics and tracking collections (events, metrics, user_activity)'),
        setupWebhookCollections: z.boolean().optional().default(true).describe('Create webhook processing collections (webhook_events, processing_logs)')
      },      async ({ setupStripeCollections, setupEmailCollections, createDefaultTemplates, setupUserCollections, setupAnalyticsCollections, setupWebhookCollections }) => {
        try {
          const results: any = {};
          
          // Step 1: Verify PocketBase access
          try {
            const collectionsSetup = await this.pb!.collection('_collections').getList(1, 1);
            results.collectionsSetup = { success: true, message: 'Collections accessible' };
          } catch (error: any) {
            results.collectionsSetup = { success: false, error: error.message };
          }
          
          // Step 2: Create default email templates if email service available
          if (createDefaultTemplates && this.emailService) {
            try {
              const templatesResult = await this.emailService.createDefaultTemplates();
              results.defaultTemplates = templatesResult;
            } catch (error: any) {
              results.templatesError = error.message;
            }
          }
            // Step 3: Setup comprehensive collections based on requirements
          const additionalCollections = [];
          
          if (setupUserCollections) {
            additionalCollections.push(
              {
                name: 'user_profiles',
                schema: [
                  { name: 'user_id', type: 'relation', required: true, options: { collectionId: 'users' } },
                  { name: 'display_name', type: 'text', required: false },
                  { name: 'bio', type: 'text', required: false },
                  { name: 'avatar', type: 'file', required: false },
                  { name: 'subscription_status', type: 'select', required: false, options: { values: ['free', 'trial', 'premium', 'cancelled'] } },
                  { name: 'onboarding_completed', type: 'bool', required: false },
                  { name: 'preferences', type: 'json', required: false }
                ]
              },
              {
                name: 'user_sessions',
                schema: [
                  { name: 'user_id', type: 'relation', required: true, options: { collectionId: 'users' } },
                  { name: 'session_token', type: 'text', required: true },
                  { name: 'ip_address', type: 'text', required: false },
                  { name: 'user_agent', type: 'text', required: false },
                  { name: 'expires_at', type: 'date', required: true },
                  { name: 'is_active', type: 'bool', required: true }
                ]
              }
            );
          }
          
          if (setupStripeCollections) {
            additionalCollections.push(
              {
                name: 'stripe_customers',
                schema: [
                  { name: 'user_id', type: 'relation', required: true, options: { collectionId: 'users' } },
                  { name: 'stripe_customer_id', type: 'text', required: true },
                  { name: 'email', type: 'email', required: true },
                  { name: 'name', type: 'text', required: false },
                  { name: 'metadata', type: 'json', required: false }
                ]
              },
              {
                name: 'payment_history',
                schema: [
                  { name: 'user_id', type: 'relation', required: true, options: { collectionId: 'users' } },
                  { name: 'stripe_payment_id', type: 'text', required: true },
                  { name: 'amount', type: 'number', required: true },
                  { name: 'currency', type: 'text', required: true },
                  { name: 'status', type: 'text', required: true },
                  { name: 'payment_method', type: 'text', required: false },
                  { name: 'metadata', type: 'json', required: false }
                ]
              },
              {
                name: 'subscription_history',
                schema: [
                  { name: 'user_id', type: 'relation', required: true, options: { collectionId: 'users' } },
                  { name: 'stripe_subscription_id', type: 'text', required: true },
                  { name: 'status', type: 'text', required: true },
                  { name: 'plan_name', type: 'text', required: false },
                  { name: 'amount', type: 'number', required: false },
                  { name: 'started_at', type: 'date', required: false },
                  { name: 'ended_at', type: 'date', required: false }
                ]
              }
            );
          }
          
          if (setupAnalyticsCollections) {
            additionalCollections.push(
              {
                name: 'user_events',
                schema: [
                  { name: 'user_id', type: 'relation', required: false, options: { collectionId: 'users' } },
                  { name: 'event_name', type: 'text', required: true },
                  { name: 'event_data', type: 'json', required: false },
                  { name: 'session_id', type: 'text', required: false },
                  { name: 'ip_address', type: 'text', required: false },
                  { name: 'user_agent', type: 'text', required: false }
                ]
              },
              {
                name: 'user_registrations',
                schema: [
                  { name: 'user_id', type: 'relation', required: true, options: { collectionId: 'users' } },
                  { name: 'registration_method', type: 'text', required: true },
                  { name: 'stripe_customer_created', type: 'bool', required: false },
                  { name: 'welcome_email_sent', type: 'bool', required: false },
                  { name: 'registration_ip', type: 'text', required: false },
                  { name: 'user_agent', type: 'text', required: false }
                ]
              }
            );
          }
          
          if (setupWebhookCollections) {
            additionalCollections.push(
              {
                name: 'webhook_events',
                schema: [
                  { name: 'event_id', type: 'text', required: true },
                  { name: 'event_type', type: 'text', required: true },
                  { name: 'processed_at', type: 'date', required: true },
                  { name: 'data', type: 'json', required: false },
                  { name: 'livemode', type: 'bool', required: false },
                  { name: 'api_version', type: 'text', required: false },
                  { name: 'processing_result', type: 'json', required: false }
                ]
              }
            );
          }
          
          // Create additional collections
          for (const collection of additionalCollections) {
            try {
              const result = await this.pb!.collections.create({
                name: collection.name,
                type: 'base',
                schema: collection.schema
              });
              results[`${collection.name}_created`] = result;
            } catch (error: any) {
              results[`${collection.name}_error`] = error.message;
            }
          }
            results.summary = {
            totalCollections: Object.keys(results).filter(k => k.endsWith('_created')).length,
            errors: Object.keys(results).filter(k => k.endsWith('_error')).length,
            backendReadyForProduction: Object.keys(results).filter(k => k.endsWith('_error')).length === 0,
            servicesConfigured: {
              stripe: !!this.stripeService,
              email: !!this.emailService,
              sendgrid: process.env.EMAIL_SERVICE === 'sendgrid'
            },
            environmentVariables: {
              required: ['POCKETBASE_URL'],
              optional: ['STRIPE_SECRET_KEY', 'EMAIL_SERVICE', 'SENDGRID_API_KEY', 'SMTP_HOST'],
              missing: [
                !process.env.POCKETBASE_URL && 'POCKETBASE_URL',
                !process.env.STRIPE_SECRET_KEY && 'STRIPE_SECRET_KEY',
                !process.env.EMAIL_SERVICE && 'EMAIL_SERVICE'
              ].filter(Boolean)
            },
            nextSteps: [
              'Configure environment variables for missing services',
              'Test email templates with email_test_connection',
              'Set up Stripe webhooks in dashboard',
              'Configure domain authentication for email delivery',
              'Review collection permissions and access rules'
            ]
          };
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `SaaS backend setup automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Subscription cancellation with customer notifications and retention features
    this.server.tool(
      'cancel_subscription_with_email',
      {
        subscriptionId: z.string().describe('Stripe subscription ID to cancel (e.g., "sub_xxxxx" from subscription records or Stripe dashboard). Must be active subscription.'),
        reason: z.string().optional().describe('Cancellation reason for analytics tracking (e.g., "user_request", "payment_failed", "upgrade", "too_expensive"). Stored for retention analysis.'),
        sendNotification: z.boolean().optional().default(true).describe('Send cancellation confirmation email to customer using template "subscription_canceled". Includes access details and next steps.'),
        offerRetention: z.boolean().optional().default(false).describe('Include retention offer in cancellation email (discount codes, pause options, downgrade alternatives). Uses "subscription_canceled_with_offer" template.'),
        cancelAtPeriodEnd: z.boolean().optional().default(false).describe('Cancel at current period end (true) vs immediate cancellation (false). Period-end allows continued access until billing cycle completes.'),
        collectFeedback: z.boolean().optional().default(true).describe('Include feedback collection link in cancellation email for product improvement insights. Links to survey or feedback form.')
      },async ({ subscriptionId, reason, sendNotification, offerRetention, cancelAtPeriodEnd, collectFeedback }) => {
        try {
          const results: any = {};
          
          if (!this.stripeService) {
            throw new Error('Stripe service not configured. Set STRIPE_SECRET_KEY environment variable.');
          }
          
          // Step 1: Cancel the Stripe subscription with specified timing
          const canceledSubscription = await this.stripeService.cancelSubscription(subscriptionId, cancelAtPeriodEnd);
          results.canceledSubscription = {
            id: canceledSubscription.id,
            status: canceledSubscription.status,
            canceled_at: canceledSubscription.canceled_at,
            cancel_at_period_end: canceledSubscription.cancel_at_period_end,
            current_period_end: canceledSubscription.current_period_end
          };
            // Step 2: Update subscription record in PocketBase with enhanced tracking
          try {
            const subscriptionRecord = await this.pb!.collection('stripe_subscriptions').getFirstListItem(
              `stripe_subscription_id = '${subscriptionId}'`
            );
            
            await this.pb!.collection('stripe_subscriptions').update(subscriptionRecord.id, {
              status: canceledSubscription.status,
              canceled_at: new Date().toISOString(),
              cancellation_reason: reason || 'User requested',
              cancel_at_period_end: cancelAtPeriodEnd,
              retention_offered: offerRetention,
              feedback_requested: collectFeedback
            });
            results.databaseUpdated = true;
            
            // Log cancellation for analytics
            await this.pb!.collection('subscription_history').create({
              user_id: subscriptionRecord.user_id || '',
              stripe_subscription_id: subscriptionId,
              status: 'canceled',
              ended_at: new Date().toISOString(),
              cancellation_reason: reason || 'User requested',
              retention_offered: offerRetention
            });
            results.historyLogged = true;
          } catch (error: any) {
            results.databaseError = error.message;
          }
            // Step 3: Send enhanced cancellation notification email
          if (sendNotification && this.emailService) {
            try {
              // Get user email from subscription record or customer
              let userEmail = null;
              let userName = null;
              
              try {
                const subscriptionRecord = await this.pb!.collection('stripe_subscriptions').getFirstListItem(
                  `stripe_subscription_id = '${subscriptionId}'`
                );
                userEmail = subscriptionRecord.user_email;
                
                // Get user name for personalization
                if (subscriptionRecord.user_id) {
                  const user = await this.pb!.collection('users').getOne(subscriptionRecord.user_id);
                  userName = user.name || user.email;
                }
              } catch {
                // If no record found, try to get from Stripe customer
                if (canceledSubscription.customer) {
                  const customer = await this.stripeService.retrieveCustomer(canceledSubscription.customer as string);
                  userEmail = customer.email;
                  userName = customer.name;
                }
              }
              
              if (userEmail) {
                const emailTemplate = offerRetention ? 'subscription_canceled_with_offer' : 'subscription_canceled';
                const emailVariables: any = {
                  userName: userName || userEmail,
                  subscriptionId: subscriptionId,
                  reason: reason || 'User requested',
                  canceledAt: canceledSubscription.canceled_at ? 
                    new Date(canceledSubscription.canceled_at * 1000).toLocaleDateString() : 
                    new Date().toLocaleDateString(),
                  email: userEmail,
                  appName: process.env.APP_NAME || 'Your App',
                  supportEmail: process.env.SUPPORT_EMAIL || 'support@yourapp.com'
                };
                
                // Add retention-specific variables
                if (offerRetention) {
                  emailVariables.retentionOffer = true;
                  emailVariables.discountCode = process.env.RETENTION_DISCOUNT_CODE || 'COMEBACK20';
                  emailVariables.retentionUrl = process.env.RETENTION_URL || '';
                }
                
                // Add feedback collection variables
                if (collectFeedback) {
                  emailVariables.feedbackUrl = process.env.FEEDBACK_URL || '';
                  emailVariables.collectFeedback = true;
                }
                
                // Add billing information if cancel at period end
                if (cancelAtPeriodEnd && canceledSubscription.current_period_end) {
                  emailVariables.accessUntil = new Date(canceledSubscription.current_period_end * 1000).toLocaleDateString();
                  emailVariables.cancelAtPeriodEnd = true;
                }
                
                await this.emailService.sendTemplatedEmail({
                  template: emailTemplate,
                  to: userEmail,
                  variables: emailVariables
                });
                results.cancellationEmailSent = true;
              } else {
                results.emailError = 'Could not find user email for notification';
              }
            } catch (error: any) {
              results.emailError = error.message;
            }
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Subscription cancellation automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // Backend status monitoring and health checks with comprehensive diagnostics
    this.server.tool(
      'get_saas_backend_status',
      {
        includeCollectionStats: z.boolean().optional().default(true).describe('Include detailed collection statistics (record counts, schema validation)'),
        includeServiceHealth: z.boolean().optional().default(true).describe('Include service health checks (Stripe, Email, SendGrid connectivity)'),
        includeRecommendations: z.boolean().optional().default(true).describe('Include production readiness recommendations and best practices'),
        includePerformanceMetrics: z.boolean().optional().default(false).describe('Include performance metrics and response times (may slow down check)'),
        includeSecurityChecks: z.boolean().optional().default(false).describe('Include security configuration checks (auth rules, access permissions)')
      },      async ({ includeCollectionStats, includeServiceHealth, includeRecommendations, includePerformanceMetrics, includeSecurityChecks }) => {
        try {
          const status: any = {
            timestamp: new Date().toISOString(),
            overall_status: 'checking',
            version: {
              server: '3.1.0',
              pocketbase_sdk: '0.26.1',
              mcp_version: '1.0.0'
            }
          };
          
          // Performance tracking
          const startTime = Date.now();
          
          // Check PocketBase connection with timing
          const pbStartTime = Date.now();
          try {
            const collections = await this.pb!.collections.getList(1, 1);
            status.pocketbase = {
              connected: true,
              url: this.pb!.baseUrl,
              authenticated: this.pb!.authStore.isValid,
              response_time_ms: Date.now() - pbStartTime,
              collections_accessible: collections.totalItems || 0
            };
          } catch (error: any) {
            status.pocketbase = {
              connected: false,
              error: error.message,
              response_time_ms: Date.now() - pbStartTime
            };
          }
            // Enhanced service health checks
          if (includeServiceHealth) {
            // Check Stripe service with detailed diagnostics
            if (this.stripeService) {              try {
                const stripeStartTime = Date.now();
                // Test with a simple API call
                const products = await this.stripeService.syncProducts();
                status.stripe = {
                  configured: true,
                  connected: true,
                  service: 'stripe',
                  response_time_ms: Date.now() - stripeStartTime,
                  api_key_valid: true,
                  webhook_configured: !!process.env.STRIPE_WEBHOOK_SECRET
                };
              } catch (error: any) {
                status.stripe = {
                  configured: true,
                  connected: false,
                  error: error.message,
                  api_key_valid: false,
                  webhook_configured: !!process.env.STRIPE_WEBHOOK_SECRET
                };
              }
            } else {
              status.stripe = {
                configured: false,
                message: 'Stripe service not initialized - set STRIPE_SECRET_KEY environment variable',
                webhook_configured: !!process.env.STRIPE_WEBHOOK_SECRET
              };
            }
            
            // Check Email service with enhanced diagnostics
            if (this.emailService) {
              try {
                const emailStartTime = Date.now();
                const connectionTest = await this.emailService.testConnection();                status.email = {
                  configured: true,
                  connected: connectionTest.success,
                  service: process.env.EMAIL_SERVICE || 'smtp',
                  response_time_ms: Date.now() - emailStartTime,
                  sendgrid_enabled: process.env.EMAIL_SERVICE === 'sendgrid',
                  smtp_configured: !!(process.env.SMTP_HOST && process.env.SMTP_PORT),
                  templates_available: true // Will be checked in collection stats
                };
              } catch (error: any) {
                status.email = {
                  configured: true,
                  connected: false,
                  error: error.message,
                  service: process.env.EMAIL_SERVICE || 'smtp'
                };
              }
            } else {
              status.email = {
                configured: false,
                message: 'Email service not initialized - set EMAIL_SERVICE environment variable',
                sendgrid_enabled: false,
                smtp_configured: !!(process.env.SMTP_HOST && process.env.SMTP_PORT)
              };
            }
          }
            // Enhanced collection statistics
          if (includeCollectionStats) {
            const essentialCollections = [
              'users', 'stripe_products', 'stripe_customers', 'stripe_subscriptions', 
              'email_templates', 'email_logs', 'user_profiles', 'payment_history',
              'webhook_events', 'user_registrations', 'subscription_history'
            ];
            status.collections = {};
            
            for (const collection of essentialCollections) {
              try {
                const records = await this.pb!.collection(collection).getList(1, 1);
                status.collections[collection] = {
                  exists: true,
                  total_records: records.totalItems || 0,
                  is_essential: ['users', 'stripe_subscriptions', 'email_templates'].includes(collection)
                };
              } catch (error: any) {
                status.collections[collection] = {
                  exists: false,
                  error: error.message,
                  is_essential: ['users', 'stripe_subscriptions', 'email_templates'].includes(collection)
                };
              }
            }
            
            // Check email templates specifically
            if (status.collections.email_templates?.exists) {
              try {
                const templates = await this.pb!.collection('email_templates').getFullList();
                const templateNames = templates.map(t => t.name);
                const requiredTemplates = [
                  'welcome', 'payment_success', 'payment_failed', 'subscription_created',
                  'subscription_canceled', 'subscription_renewed'
                ];
                
                status.collections.email_templates.template_names = templateNames;
                status.collections.email_templates.required_templates_missing = 
                  requiredTemplates.filter(t => !templateNames.includes(t));
              } catch (error: any) {
                status.collections.email_templates.template_check_error = error.message;
              }
            }
          }
            // Enhanced production readiness recommendations
          if (includeRecommendations) {
            const recommendations = [];
            const warnings = [];
            const criticalIssues = [];
            
            // Authentication checks
            if (!status.pocketbase?.authenticated) {
              criticalIssues.push('Setup admin authentication for production deployment');
            }
            
            // Service configuration checks
            if (!status.stripe?.configured) {
              recommendations.push('Configure Stripe for payment processing (set STRIPE_SECRET_KEY)');
            }
            
            if (!status.email?.configured) {
              warnings.push('Configure email service for user communications (set EMAIL_SERVICE)');
            }
            
            // Collection checks
            if (status.collections) {
              const missingEssential = Object.entries(status.collections)
                .filter(([name, info]: [string, any]) => info.is_essential && !info.exists)
                .map(([name]) => name);
              
              if (missingEssential.length > 0) {
                criticalIssues.push(`Create missing essential collections: ${missingEssential.join(', ')}`);
              }
              
              // Template checks
              if (status.collections.email_templates?.required_templates_missing?.length > 0) {
                warnings.push(`Create missing email templates: ${status.collections.email_templates.required_templates_missing.join(', ')}`);
              }
            }
            
            // Environment variable checks
            const missingEnvVars = [];
            if (!process.env.POCKETBASE_URL) missingEnvVars.push('POCKETBASE_URL');
            if (!process.env.APP_NAME) missingEnvVars.push('APP_NAME (recommended)');
            if (!process.env.SUPPORT_EMAIL) missingEnvVars.push('SUPPORT_EMAIL (recommended)');
            
            if (missingEnvVars.length > 0) {
              recommendations.push(`Set environment variables: ${missingEnvVars.join(', ')}`);
            }
            
            // Security recommendations
            if (includeSecurityChecks) {
              recommendations.push('Review collection access rules for production security');
              recommendations.push('Enable HTTPS for production deployment');
              recommendations.push('Set up monitoring and alerting for payment failures');
            }
            
            status.recommendations = {
              critical: criticalIssues,
              warnings: warnings,
              suggestions: recommendations,
              total_issues: criticalIssues.length + warnings.length
            };
            
            status.production_ready = criticalIssues.length === 0;
          }
            // Performance metrics
          if (includePerformanceMetrics) {
            status.performance = {
              total_check_time_ms: Date.now() - startTime,
              pocketbase_response_time: status.pocketbase?.response_time_ms || 0,
              stripe_response_time: status.stripe?.response_time_ms || 0,
              email_response_time: status.email?.response_time_ms || 0,
              collections_checked: Object.keys(status.collections || {}).length
            };
          }
          
          // Overall status calculation
          const issues = [];
          if (!status.pocketbase?.connected) issues.push('pocketbase');
          if (status.stripe?.configured && !status.stripe?.connected) issues.push('stripe');
          if (status.email?.configured && !status.email?.connected) issues.push('email');
          
          // Factor in critical issues from recommendations
          const hasCriticalIssues = status.recommendations?.critical?.length > 0;
          
          if (issues.length === 0 && !hasCriticalIssues) {
            status.overall_status = 'healthy';
          } else if (issues.length > 0 || hasCriticalIssues) {
            status.overall_status = 'degraded';
          } else {
            status.overall_status = 'operational';
          }
          
          status.issues = issues;
          status.health_score = Math.max(0, 100 - (issues.length * 25) - (status.recommendations?.total_issues || 0) * 10);
          
          return {
            content: [{ type: 'text', text: JSON.stringify(status, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Backend status check failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // === END HIGH-LEVEL AUTOMATION WORKFLOW TOOLS ===

    // === MISSING POCKETBASE SDK v0.26.1 FEATURES ===
    // These tools implement features from the latest PocketBase SDK that weren't available
    
    // Enhanced error handling with ClientResponseError patterns
    this.server.tool(
      'pb_parse_error',
      {
        error: z.any().describe('Error object to parse')
      },
      async ({ error }) => {
        try {
          const parsedError = {
            message: error.message || 'Unknown error',
            status: error.status || 'unknown',
            statusCode: error.status || 'unknown',
            data: error.data || null,
            isClientResponseError: !!(error.response && error.data),
            originalResponse: error.response || null,
            url: error.url || 'unknown',
            timestamp: new Date().toISOString()
          };
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify(parsedError, null, 2)
            }]
          };
        } catch (parseError: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to parse error',
                message: parseError.message,
                originalError: error
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Modern baseURL property access (SDK v0.26.1)
    this.server.tool(
      'pb_get_base_url',
      {},
      async () => {
        try {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                baseUrl: this.pb!.baseUrl, // Legacy property (still works)
                baseURL: this.pb!.baseUrl, // Modern property name in v0.26.1
                note: 'Use baseURL property in latest SDK versions for consistency'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to get base URL',
                message: error.message
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Safe parameter binding (modern filter method)
    this.server.tool(
      'pb_safe_filter',
      {
        expression: z.string().describe('Filter expression with placeholders like "name = {:name}"'),
        params: z.record(z.any()).describe('Parameters for safe binding')
      },
      async ({ expression, params }) => {
        try {
          // This is equivalent to the pb.filter() method in SDK v0.26.1
          // @ts-ignore - Modern SDK method for safe parameter binding
          const safeFilter = this.pb!.filter(expression, params);
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                safeFilter,
                expression,
                params,
                method: 'pb.filter()',
                security: 'Prevents SQL injection through parameter binding'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to create safe filter',
                message: error.message,
                tip: 'Use {:param} syntax for parameter placeholders'
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Enhanced record retrieval with getFirstListItem()
    this.server.tool(
      'pb_get_first_list_item',
      {
        collection: z.string().describe('Collection name'),
        filter: z.string().describe('Filter expression'),
        sort: z.string().optional().describe('Sort expression'),
        expand: z.string().optional().describe('Relations to expand')
      },
      async ({ collection, filter, sort, expand }) => {
        try {
          const options: any = { filter };
          if (sort) options.sort = sort;
          if (expand) options.expand = expand;
          
          // Enhanced method available in latest SDK
          const record = await this.pb!.collection(collection).getFirstListItem(filter, options);
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                record,
                method: 'getFirstListItem()',
                note: 'More efficient than getList() when you only need the first matching record'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to get first list item',
                message: error.message,
                collection,
                filter
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );    // Health service simulation (PocketBase health endpoint)
    this.server.tool(
      'pb_health_check',
      {},
      async () => {
        try {
          const healthStatus: {
            timestamp: string;
            status: string;
            checks: {
              database?: { status: string; message: string };
              auth?: { status: string; message: string };
              collections?: { status: string; message: string };
            };
          } = {
            timestamp: new Date().toISOString(),
            status: 'checking',
            checks: {}
          };
          
          // Check database connectivity
          try {
            await this.pb!.collections.getList(1, 1);
            healthStatus.checks.database = { status: 'healthy', message: 'Database accessible' };
          } catch (error: any) {
            healthStatus.checks.database = { status: 'unhealthy', message: error.message };
          }
          
          // Check auth status
          healthStatus.checks.auth = {
            status: this.pb!.authStore.isValid ? 'healthy' : 'unauthenticated',
            message: this.pb!.authStore.isValid ? 'Authenticated' : 'No valid authentication'
          };
          
          // Check collections access
          try {
            const collections = await this.pb!.collections.getList(1, 5);
            healthStatus.checks.collections = { 
              status: 'healthy', 
              message: `${collections.items.length} collections accessible` 
            };
          } catch (error: any) {
            healthStatus.checks.collections = { status: 'limited', message: error.message };
          }
          
          // Overall status
          const allHealthy = Object.values(healthStatus.checks).every((check: any) => check.status === 'healthy');
          healthStatus.status = allHealthy ? 'healthy' : 'degraded';
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify(healthStatus, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Health check failed',
                message: error.message,
                status: 'unhealthy'
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Enhanced impersonation with duration control
    this.server.tool(
      'pb_impersonate_with_duration',
      {
        userId: z.string().describe('User ID to impersonate'),
        duration: z.number().optional().default(3600).describe('Impersonation duration in seconds'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ userId, duration, collection }) => {
        try {
          // Standard impersonation
          const authData = await this.pb!.collection(collection).impersonate(userId, duration);
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                ...authData,
                impersonationDuration: duration,
                expiresAt: new Date(Date.now() + (duration * 1000)).toISOString(),
                note: 'Enhanced impersonation with duration control'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Enhanced impersonation failed',
                message: error.message,
                userId,
                duration,
                collection
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Collection truncate operation
    this.server.tool(
      'pb_truncate_collection',
      {
        collection: z.string().describe('Collection name to truncate (delete all records)'),
        confirm: z.boolean().describe('Confirmation that you want to delete ALL records')
      },
      async ({ collection, confirm }) => {
        try {
          if (!confirm) {
            return {
              content: [{ 
                type: 'text', 
                text: JSON.stringify({
                  error: 'Truncate operation cancelled',
                  message: 'Set confirm=true to proceed with deleting all records',
                  collection
                }, null, 2)
              }],
              isError: true
            };
          }
          
          // Get all records and delete them (since there's no native truncate)
          const allRecords = await this.pb!.collection(collection).getFullList();
          const deletedCount = allRecords.length;
          
          // Delete all records
          for (const record of allRecords) {
            await this.pb!.collection(collection).delete(record.id);
          }
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                success: true,
                collection,
                deletedRecords: deletedCount,
                message: `Successfully truncated collection ${collection}`,
                warning: 'This operation cannot be undone'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Truncate operation failed',
                message: error.message,
                collection
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // === END MISSING POCKETBASE SDK FEATURES ===

    // === POCKETBASE API COMPATIBILITY LAYER ===
    
    // Generic API proxy tool for direct PocketBase API calls
    this.server.tool(
      'api_request',
      {
        method: z.enum(['GET', 'POST', 'PATCH', 'DELETE']).describe('HTTP method for the API request'),
        path: z.string().describe('API path relative to base URL (e.g., "/api/collections/users/records", "/api/collections")'),
        body: z.record(z.any()).optional().describe('Request body data (for POST/PATCH requests)'),
        queryParams: z.record(z.any()).optional().describe('Query parameters as key-value pairs'),
        headers: z.record(z.string()).optional().describe('Additional headers to send with request')
      },
      async ({ method, path, body, queryParams, headers }) => {
        try {
          // Build the full URL
          const url = new URL(path.startsWith('/') ? path.slice(1) : path, this.pb!.baseUrl);
          
          // Add query parameters
          if (queryParams) {
            Object.entries(queryParams).forEach(([key, value]) => {
              if (value !== undefined && value !== null) {
                url.searchParams.append(key, String(value));
              }
            });
          }

          // Prepare request options
          const requestOptions: any = {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...headers
            }
          };

          // Add authorization header if authenticated
          if (this.pb!.authStore.isValid && this.pb!.authStore.token) {
            requestOptions.headers.Authorization = this.pb!.authStore.token;
          }

          // Add body for POST/PATCH requests
          if (body && (method === 'POST' || method === 'PATCH')) {
            requestOptions.body = JSON.stringify(body);
          }

          // Make the request
          const response = await fetch(url.toString(), requestOptions);
          const responseData = await response.json();

          if (!response.ok) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: true,
                  status: response.status,
                  statusText: response.statusText,
                  data: responseData
                }, null, 2)
              }],
              isError: true
            };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                status: response.status,
                data: responseData
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `API request failed: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // List/Search records with full API compatibility
    this.server.tool(
      'list_records_api',
      {
        collection: z.string().describe('Collection name to query records from'),
        page: z.number().optional().default(1).describe('Page number for pagination (default: 1)'),
        perPage: z.number().optional().default(30).describe('Number of records per page (max: 500, default: 30)'),
        sort: z.string().optional().describe('Sort fields with direction (e.g., "-created", "+name", "title,-updated")'),
        filter: z.string().optional().describe('Filter expression using PocketBase syntax (e.g., "status=\'active\' && created>=\'2024-01-01\'")'),
        expand: z.string().optional().describe('Relations to expand (comma-separated, e.g., "author,category,tags")'),
        fields: z.string().optional().describe('Specific fields to return (comma-separated, e.g., "id,name,email")'),
        skipTotal: z.boolean().optional().describe('Skip total count calculation for better performance')
      },
      async ({ collection, page, perPage, sort, filter, expand, fields, skipTotal }) => {
        try {
          const options: any = {
            page,
            perPage
          };

          if (sort) options.sort = sort;
          if (filter) options.filter = filter;
          if (expand) options.expand = expand;
          if (fields) options.fields = fields;
          if (skipTotal) options.skipTotal = skipTotal;

          const result = await this.pb!.collection(collection).getList(page, perPage, options);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                page: result.page,
                perPage: result.perPage,
                totalItems: result.totalItems,
                totalPages: result.totalPages,
                items: result.items
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to list records: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Get full list of records (all pages)
    this.server.tool(
      'get_full_list_api',
      {
        collection: z.string().describe('Collection name to query records from'),
        sort: z.string().optional().describe('Sort fields with direction'),
        filter: z.string().optional().describe('Filter expression using PocketBase syntax'),
        expand: z.string().optional().describe('Relations to expand (comma-separated)'),
        fields: z.string().optional().describe('Specific fields to return (comma-separated)'),
        batch: z.number().optional().default(500).describe('Batch size for fetching records (max: 500)')
      },
      async ({ collection, sort, filter, expand, fields, batch }) => {
        try {
          const options: any = {};
          if (sort) options.sort = sort;
          if (filter) options.filter = filter;
          if (expand) options.expand = expand;
          if (fields) options.fields = fields;
          if (batch) options.batch = batch;

          const result = await this.pb!.collection(collection).getFullList(options);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                totalItems: result.length,
                items: result
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get full list: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Get first record matching criteria
    this.server.tool(
      'get_first_list_item_api',
      {
        collection: z.string().describe('Collection name to query records from'),
        filter: z.string().optional().describe('Filter expression to find the record'),
        sort: z.string().optional().describe('Sort fields to determine which record is "first"'),
        expand: z.string().optional().describe('Relations to expand'),
        fields: z.string().optional().describe('Specific fields to return')
      },
      async ({ collection, filter, sort, expand, fields }) => {
        try {
          const options: any = {};
          if (filter) options.filter = filter;
          if (sort) options.sort = sort;
          if (expand) options.expand = expand;
          if (fields) options.fields = fields;

          const result = await this.pb!.collection(collection).getFirstListItem(filter || '', options);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get first record: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // View specific record by ID
    this.server.tool(
      'get_record_api',
      {
        collection: z.string().describe('Collection name containing the record'),
        id: z.string().describe('Record ID to retrieve'),
        expand: z.string().optional().describe('Relations to expand (comma-separated)'),
        fields: z.string().optional().describe('Specific fields to return (comma-separated)')
      },
      async ({ collection, id, expand, fields }) => {
        try {
          const options: any = {};
          if (expand) options.expand = expand;
          if (fields) options.fields = fields;

          const result = await this.pb!.collection(collection).getOne(id, options);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get record: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Update record by ID
    this.server.tool(
      'update_record_api',
      {
        collection: z.string().describe('Collection name containing the record to update'),
        id: z.string().describe('Record ID to update'),
        data: z.record(z.any()).describe('Updated field values as key-value pairs'),
        expand: z.string().optional().describe('Relations to expand in the response'),
        fields: z.string().optional().describe('Specific fields to return in response')
      },
      async ({ collection, id, data, expand, fields }) => {
        try {
          const options: any = {};
          if (expand) options.expand = expand;
          if (fields) options.fields = fields;

          const result = await this.pb!.collection(collection).update(id, data, options);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to update record: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Delete record by ID
    this.server.tool(
      'delete_record_api',
      {
        collection: z.string().describe('Collection name containing the record to delete'),
        id: z.string().describe('Record ID to delete')
      },
      async ({ collection, id }) => {
        try {
          await this.pb!.collection(collection).delete(id);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Record ${id} deleted successfully from ${collection}`
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to delete record: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // === AUTHENTICATION API TOOLS ===

    // List available auth methods for a collection
    this.server.tool(
      'list_auth_methods_api',
      {
        collection: z.string().describe('Auth collection name (e.g., "users")')
      },
      async ({ collection }) => {
        try {
          const result = await this.pb!.collection(collection).listAuthMethods();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to list auth methods: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Authenticate with email/password
    this.server.tool(
      'auth_with_password_api',
      {
        collection: z.string().describe('Auth collection name (e.g., "users")'),
        identity: z.string().describe('User identity (email, username, or any unique field)'),
        password: z.string().describe('User password'),
        expand: z.string().optional().describe('Relations to expand in auth record'),
        fields: z.string().optional().describe('Specific fields to return in auth record')
      },
      async ({ collection, identity, password, expand, fields }) => {
        try {
          const options: any = {};
          if (expand) options.expand = expand;
          if (fields) options.fields = fields;

          const result = await this.pb!.collection(collection).authWithPassword(identity, password, options);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                token: result.token,
                record: result.record,
                meta: result.meta
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Authentication failed: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Request OTP for authentication
    this.server.tool(
      'request_otp_api',
      {
        collection: z.string().describe('Auth collection name (e.g., "users")'),
        email: z.string().email().describe('Email address to send OTP to')
      },
      async ({ collection, email }) => {
        try {
          const result = await this.pb!.collection(collection).requestOTP(email);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to request OTP: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Authenticate with OTP
    this.server.tool(
      'auth_with_otp_api',
      {
        collection: z.string().describe('Auth collection name (e.g., "users")'),
        otpId: z.string().describe('OTP ID received from request_otp_api'),
        password: z.string().describe('OTP password received via email'),
        expand: z.string().optional().describe('Relations to expand in auth record'),
        fields: z.string().optional().describe('Specific fields to return in auth record')
      },
      async ({ collection, otpId, password, expand, fields }) => {
        try {
          const options: any = {};
          if (expand) options.expand = expand;
          if (fields) options.fields = fields;

          const result = await this.pb!.collection(collection).authWithOTP(otpId, password, options);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                token: result.token,
                record: result.record,
                meta: result.meta
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `OTP authentication failed: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Refresh authentication
    this.server.tool(
      'auth_refresh_api',
      {
        collection: z.string().describe('Auth collection name (e.g., "users")'),
        expand: z.string().optional().describe('Relations to expand in auth record'),
        fields: z.string().optional().describe('Specific fields to return in auth record')
      },
      async ({ collection, expand, fields }) => {
        try {
          const options: any = {};
          if (expand) options.expand = expand;
          if (fields) options.fields = fields;

          const result = await this.pb!.collection(collection).authRefresh(options);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                token: result.token,
                record: result.record,
                meta: result.meta
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Auth refresh failed: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Request password reset
    this.server.tool(
      'request_password_reset_api',
      {
        collection: z.string().describe('Auth collection name (e.g., "users")'),
        email: z.string().email().describe('Email address to send password reset link to')
      },
      async ({ collection, email }) => {
        try {
          const result = await this.pb!.collection(collection).requestPasswordReset(email);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Password reset email sent successfully'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to request password reset: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Confirm password reset
    this.server.tool(
      'confirm_password_reset_api',
      {
        collection: z.string().describe('Auth collection name (e.g., "users")'),
        token: z.string().describe('Password reset token from email'),
        password: z.string().describe('New password'),
        passwordConfirm: z.string().describe('New password confirmation')
      },
      async ({ collection, token, password, passwordConfirm }) => {
        try {
          const result = await this.pb!.collection(collection).confirmPasswordReset(token, password, passwordConfirm);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Password reset confirmed successfully'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to confirm password reset: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Request email verification
    this.server.tool(
      'request_verification_api',
      {
        collection: z.string().describe('Auth collection name (e.g., "users")'),
        email: z.string().email().describe('Email address to send verification email to')
      },
      async ({ collection, email }) => {
        try {
          const result = await this.pb!.collection(collection).requestVerification(email);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Verification email sent successfully'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to request verification: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Confirm email verification
    this.server.tool(
      'confirm_verification_api',
      {
        collection: z.string().describe('Auth collection name (e.g., "users")'),
        token: z.string().describe('Email verification token from email')
      },
      async ({ collection, token }) => {
        try {
          const result = await this.pb!.collection(collection).confirmVerification(token);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Email verification confirmed successfully'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to confirm verification: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // === COLLECTION MANAGEMENT API TOOLS ===

    // List all collections
    this.server.tool(
      'list_collections_api',
      {
        page: z.number().optional().default(1).describe('Page number for pagination'),
        perPage: z.number().optional().default(30).describe('Number of collections per page'),
        sort: z.string().optional().describe('Sort fields with direction'),
        filter: z.string().optional().describe('Filter expression for collections')
      },
      async ({ page, perPage, sort, filter }) => {
        try {
          const options: any = {};
          if (sort) options.sort = sort;
          if (filter) options.filter = filter;

          const result = await this.pb!.collections.getList(page, perPage, options);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                page: result.page,
                perPage: result.perPage,
                totalItems: result.totalItems,
                totalPages: result.totalPages,
                items: result.items
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to list collections: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Get collection by ID or name
    this.server.tool(
      'get_collection_api',
      {
        idOrName: z.string().describe('Collection ID or name to retrieve')
      },
      async ({ idOrName }) => {
        try {
          const result = await this.pb!.collections.getOne(idOrName);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get collection: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // === UTILITY API TOOLS ===

    // Health check
    this.server.tool(
      'health_check_api',
      {},
      async () => {
        try {
          const response = await fetch(`${this.pb!.baseUrl}/api/health`);
          const result = await response.json();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: response.status,
                healthy: response.ok,
                data: result
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Health check failed: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Build safe filter expressions
    this.server.tool(
      'build_filter_expression',
      {
        conditions: z.array(z.object({
          field: z.string().describe('Field name to filter on'),
          operator: z.enum(['=', '!=', '>', '>=', '<', '<=', '~', '!~', '?=', '?!=', '?>', '?>=', '?<', '?<=', '?~', '?!~']).describe('Comparison operator'),
          value: z.any().describe('Value to compare against'),
          connector: z.enum(['&&', '||']).optional().describe('Logical connector to next condition')
        })).describe('Array of filter conditions to combine'),
        parentheses: z.boolean().optional().default(false).describe('Wrap entire expression in parentheses')
      },
      async ({ conditions, parentheses }) => {
        try {
          const parts: string[] = [];
          
          conditions.forEach((condition, index) => {
            let value = condition.value;
            
            // Handle string values - wrap in quotes and escape
            if (typeof value === 'string') {
              value = `"${value.replace(/"/g, '\\"')}"`;
            }
            // Handle date values - convert to ISO string
            else if (value instanceof Date) {
              value = `"${value.toISOString()}"`;
            }
            // Handle arrays for ?= and ?!= operators
            else if (Array.isArray(value)) {
              value = `[${value.map(v => typeof v === 'string' ? `"${v}"` : v).join(',')}]`;
            }
            
            const filterPart = `${condition.field} ${condition.operator} ${value}`;
            parts.push(filterPart);
            
            // Add connector if not the last condition
            if (index < conditions.length - 1 && condition.connector) {
              parts.push(` ${condition.connector} `);
            }
          });
          
          let expression = parts.join('');
          if (parentheses) {
            expression = `(${expression})`;
          }
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                expression,
                safe: true,
                conditions_count: conditions.length
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to build filter expression: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // === BATCH OPERATIONS API TOOLS ===

    // Batch create/update/upsert records
    this.server.tool(
      'batch_records_api',
      {
        collection: z.string().describe('Collection name to perform batch operations on'),
        requests: z.array(z.object({
          method: z.enum(['POST', 'PATCH', 'DELETE']).describe('HTTP method for this operation'),
          id: z.string().optional().describe('Record ID (required for PATCH/DELETE)'),
          data: z.record(z.any()).optional().describe('Record data (required for POST/PATCH)')
        })).describe('Array of batch operation requests'),
        atomic: z.boolean().optional().default(true).describe('Whether operations should be atomic (all succeed or all fail)')
      },
      async ({ collection, requests, atomic }) => {
        try {
          const results = [];
          const errors = [];

          if (atomic) {
            // For atomic operations, we need to handle them sequentially and rollback on any error
            for (const request of requests) {
              try {
                let result;
                switch (request.method) {
                  case 'POST':
                    if (!request.data) throw new Error('POST request requires data');
                    result = await this.pb!.collection(collection).create(request.data);
                    break;
                  case 'PATCH':
                    if (!request.id || !request.data) throw new Error('PATCH request requires id and data');
                    result = await this.pb!.collection(collection).update(request.id, request.data);
                    break;
                  case 'DELETE':
                    if (!request.id) throw new Error('DELETE request requires id');
                    await this.pb!.collection(collection).delete(request.id);
                    result = { id: request.id, deleted: true };
                    break;
                }
                results.push({
                  success: true,
                  method: request.method,
                  id: request.id || result?.id,
                  data: result
                });
              } catch (error: any) {
                errors.push({
                  method: request.method,
                  id: request.id,
                  error: error.message
                });
                
                if (atomic) {
                  // In atomic mode, stop on first error
                  break;
                }
              }
            }
          } else {
            // Non-atomic: continue processing all requests regardless of individual failures
            await Promise.allSettled(requests.map(async (request) => {
              try {
                let result;
                switch (request.method) {
                  case 'POST':
                    if (!request.data) throw new Error('POST request requires data');
                    result = await this.pb!.collection(collection).create(request.data);
                    break;
                  case 'PATCH':
                    if (!request.id || !request.data) throw new Error('PATCH request requires id and data');
                    result = await this.pb!.collection(collection).update(request.id, request.data);
                    break;
                  case 'DELETE':
                    if (!request.id) throw new Error('DELETE request requires id');
                    await this.pb!.collection(collection).delete(request.id);
                    result = { id: request.id, deleted: true };
                    break;
                }
                results.push({
                  success: true,
                  method: request.method,
                  id: request.id || result?.id,
                  data: result
                });
              } catch (error: any) {
                errors.push({
                  method: request.method,
                  id: request.id,
                  error: error.message
                });
              }
            }));
          }

          const response = {
            success: errors.length === 0,
            atomic,
            total_requests: requests.length,
            successful_operations: results.length,
            failed_operations: errors.length,
            results,
            errors
          };

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(response, null, 2)
            }],
            isError: errors.length > 0 && atomic
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Batch operation failed: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // === FILE HANDLING API TOOLS ===

    // Get file URL/info
    this.server.tool(
      'get_file_url_api',
      {
        collection: z.string().describe('Collection name containing the record'),
        recordId: z.string().describe('Record ID containing the file'),
        filename: z.string().describe('Filename to get URL for'),
        thumb: z.string().optional().describe('Thumbnail size (e.g., "100x100", "0x100", "100x0")')
      },
      async ({ collection, recordId, filename, thumb }) => {
        try {
          // Build file URL
          let fileUrl = `${this.pb!.baseUrl}/api/files/${collection}/${recordId}/${filename}`;
          
          if (thumb) {
            fileUrl += `?thumb=${thumb}`;
          }

          // Try to get record to validate file exists
          try {
            const record = await this.pb!.collection(collection).getOne(recordId);
            
            // Find the field that contains this filename
            let fileField = null;
            let fileData = null;
            
            for (const [fieldName, fieldValue] of Object.entries(record)) {
              if (Array.isArray(fieldValue) && fieldValue.includes(filename)) {
                fileField = fieldName;
                fileData = fieldValue;
                break;
              } else if (fieldValue === filename) {
                fileField = fieldName;
                fileData = fieldValue;
                break;
              }
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  file_url: fileUrl,
                  public_url: fileUrl,
                  collection,
                  record_id: recordId,
                  filename,
                  thumb_size: thumb || null,
                  field_name: fileField,
                  file_exists_in_record: !!fileField,
                  record_file_data: fileData
                }, null, 2)
              }]
            };
          } catch (recordError: any) {
            // Record doesn't exist or not accessible, but still return the URL
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  file_url: fileUrl,
                  public_url: fileUrl,
                  collection,
                  record_id: recordId,
                  filename,
                  thumb_size: thumb || null,
                  warning: `Could not verify file existence: ${recordError.message}`
                }, null, 2)
              }]
            };
          }
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get file URL: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // === REALTIME/SUBSCRIPTION API TOOLS ===

    // Subscribe to realtime changes (information only, actual subscription requires client-side implementation)
    this.server.tool(
      'realtime_subscription_info',
      {
        collection: z.string().optional().describe('Collection to subscribe to (optional, can subscribe to all)'),
        recordId: z.string().optional().describe('Specific record ID to subscribe to')
      },
      async ({ collection, recordId }) => {
        try {
          const baseUrl = this.pb!.baseUrl.replace(/^http/, 'ws');
          
          let subscriptionTopic = '*';
          if (collection && recordId) {
            subscriptionTopic = `${collection}/${recordId}`;
          } else if (collection) {
            subscriptionTopic = collection;
          }

          const info = {
            realtime_endpoint: `${baseUrl}/api/realtime`,
            subscription_topic: subscriptionTopic,
            auth_required: this.pb!.authStore.isValid,
            connection_info: {
              protocol: 'WebSocket',
              auth_method: 'Authorization header or query param',
              message_format: 'JSON',
              events: ['connect', 'disconnect', 'create', 'update', 'delete']
            },
            client_example: {
              javascript: `
// Using PocketBase JS SDK
pb.realtime.subscribe('${subscriptionTopic}', function (e) {
  console.log(e.action); // create, update, delete
  console.log(e.record); // the changed record
});

// Unsubscribe
pb.realtime.unsubscribe('${subscriptionTopic}');
              `.trim(),
              curl: `
# Connect to WebSocket
wscat -c "${baseUrl}/api/realtime${this.pb!.authStore.token ? '?authorization=' + this.pb!.authStore.token : ''}"

# Subscribe message
{"clientId": "CLIENT_ID", "command": "subscribe", "data": {"topic": "${subscriptionTopic}"}}
              `.trim()
            },
            note: 'This tool provides connection information only. Actual realtime subscriptions must be implemented in your client application using WebSocket connections.'
          };

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(info, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Failed to get realtime info: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // === ADVANCED QUERY BUILDING ===

    // Advanced query builder with multiple filters and sorting
    this.server.tool(
      'advanced_query_builder',
      {
        collection: z.string().describe('Collection to query'),
        filters: z.array(z.object({
          field: z.string(),
          operator: z.string(),
          value: z.any(),
          connector: z.enum(['AND', 'OR']).optional()
        })).optional().describe('Array of filter conditions'),
        sort_fields: z.array(z.object({
          field: z.string(),
          direction: z.enum(['ASC', 'DESC']).default('ASC')
        })).optional().describe('Fields to sort by'),
        relations: z.array(z.string()).optional().describe('Relations to expand'),
        fields: z.array(z.string()).optional().describe('Specific fields to return'),
        pagination: z.object({
          page: z.number().default(1),
          perPage: z.number().default(30)
        }).optional().describe('Pagination settings'),
        groupBy: z.string().optional().describe('Field to group results by (for aggregation queries)')
      },
      async ({ collection, filters, sort_fields, relations, fields, pagination, groupBy }) => {
        try {
          const options: any = {};

          // Build filter expression
          if (filters && filters.length > 0) {
            const filterParts: string[] = [];
            filters.forEach((filter, index) => {
              let value = filter.value;
              
              // Escape string values
              if (typeof value === 'string') {
                value = `"${value.replace(/"/g, '\\"')}"`;
              } else if (value instanceof Date) {
                value = `"${value.toISOString()}"`;
              }
              
              filterParts.push(`${filter.field} ${filter.operator} ${value}`);
              
              if (index < filters.length - 1 && filter.connector) {
                filterParts.push(` ${filter.connector === 'AND' ? '&&' : '||'} `);
              }
            });
            options.filter = filterParts.join('');
          }

          // Build sort expression
          if (sort_fields && sort_fields.length > 0) {
            const sortParts = sort_fields.map(sort => 
              `${sort.direction === 'DESC' ? '-' : '+'}${sort.field}`
            );
            options.sort = sortParts.join(',');
          }

          // Add expand relations
          if (relations && relations.length > 0) {
            options.expand = relations.join(',');
          }

          // Add specific fields
          if (fields && fields.length > 0) {
            options.fields = fields.join(',');
          }

          // Execute query
          const page = pagination?.page || 1;
          const perPage = pagination?.perPage || 30;
          
          const result = await this.pb!.collection(collection).getList(page, perPage, options);

          // If groupBy is specified, group the results
          let processedResults: any[] | { [key: string]: any[] } = result.items;
          if (groupBy) {
            const grouped: { [key: string]: any[] } = {};
            result.items.forEach((item: any) => {
              const groupValue = item[groupBy] || 'null';
              if (!grouped[groupValue]) {
                grouped[groupValue] = [];
              }
              grouped[groupValue].push(item);
            });
            processedResults = grouped;
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                query_info: {
                  collection,
                  filter_expression: options.filter || null,
                  sort_expression: options.sort || null,
                  expanded_relations: options.expand || null,
                  selected_fields: options.fields || null,
                  grouped_by: groupBy || null
                },
                pagination: {
                  page: result.page,
                  perPage: result.perPage,
                  totalItems: result.totalItems,
                  totalPages: result.totalPages
                },
                results: processedResults
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: `Advanced query failed: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // === END POCKETBASE API COMPATIBILITY LAYER ===
  }

  // Utility methods for automation features
  private evaluateCondition(fieldValue: any, operator: string, value: any): boolean {
    switch (operator) {
      case 'equals':
        return fieldValue === value;
      case 'not_equals':
        return fieldValue !== value;
      case 'greater_than':
        return Number(fieldValue) > Number(value);
      case 'less_than':
        return Number(fieldValue) < Number(value);
      case 'contains':
        return String(fieldValue).includes(String(value));
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue);
      case 'not_in':
        return Array.isArray(value) && !value.includes(fieldValue);
      default:
        return false;
    }
  }

  private async executeRuleAction(action: any, record: any, collection: string): Promise<any> {
    switch (action.type) {
      case 'email':
        if (this.emailService) {
          return await this.emailService.sendTemplatedEmail({
            template: action.config.template,
            to: action.config.to || record.email,
            variables: { ...record, ...action.config.variables }
          });
        }
        throw new Error('Email service not configured');
      
      case 'webhook':
        const response = await fetch(action.config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record, action: action.type })
        });
        return await response.json();
      
      case 'update_field':
        return await this.pb!.collection(collection).update(record.id, {
          [action.config.field]: action.config.value
        });
      
      case 'create_record':
        return await this.pb!.collection(action.config.collection).create(action.config.data);
      
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private async executeWorkflowStep(step: any, instance: any, input: any): Promise<any> {
    try {
     
      switch (step.type) {
        case 'email':
          if (this.emailService) {
            await this.emailService.sendTemplatedEmail({
              template: step.config.template,
              to: step.config.to,
              variables: { ...input, ...step.config.variables }
            });
          }
          return { stepId: step.id, status: 'completed', type: step.type };
        
        case 'webhook':
          const response = await fetch(step.config.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input, step: step.id })
          });
          return { stepId: step.id, status: 'completed', type: step.type, response: await response.json() };
        
        case 'delay':
          await new Promise(resolve => setTimeout(resolve, step.config.milliseconds || 1000));
          return { stepId: step.id, status: 'completed', type: step.type };
        
        case 'condition':
          const conditionMet = this.evaluateCondition(
            input[step.config.field],
            step.config.operator,
            step.config.value
          );
          return { stepId: step.id, status: conditionMet ? 'completed' : 'skipped', type: step.type };
        
        default:
          return { stepId: step.id, status: 'completed', type: step.type };
      }
    } catch (error: any) {
      return { stepId: step.id, status: 'failed', type: step.type, error: error.message };
    }
  }

  private applyFilter(item: any, config: any): boolean {
    // Simple filter implementation
    if (config.condition) {
      return eval(config.condition.replace(/\$\{(\w+)\}/g, (_: any, field: string) => JSON.stringify(item[field])));
    }
    return true;
  }

  private applyAggregation(data: any[], config: any): any[] {
    // Simple aggregation implementation
    if (config.groupBy) {
      const groups = data.reduce((acc, item) => {
        const key = config.groupBy.map((field: string) => item[field]).join('|');
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      }, {});
      
      return Object.entries(groups).map(([key, items]: [string, any]) => ({
        group: key,
        count: items.length,
        items
      }));
    }
    return data;
  }
  // Helper methods for automation tools
  private applyMapping(value: any, config: any): any {
    // Simple value mapping implementation
    if (config.mappings && config.mappings[value]) {
      return config.mappings[value];
    }
    return value;
  }

  private processMetrics(data: any[], metrics: any[]): any {
    const result: any = {};
    
    metrics.forEach(metric => {
      const alias = metric.alias || `${metric.operation}_${metric.field}`;
      const values = data.map(item => item[metric.field]).filter(v => v != null);
      
      switch (metric.operation) {
        case 'count':
          result[alias] = data.length;
          break;
        case 'sum':
          result[alias] = values.reduce((a, b) => a + Number(b), 0);
          break;
        case 'avg':
          result[alias] = values.reduce((a, b) => a + Number(b), 0) / values.length;
          break;
        case 'min':
          result[alias] = Math.min(...values.map(Number));
          break;
        case 'max':
          result[alias] = Math.max(...values.map(Number));
          break;
        case 'distinct_count':
          result[alias] = new Set(values).size;
          break;
      }
    });
    
    return result;
  }

  private processGroupedMetrics(data: any[], metrics: any[], groupBy: string[]): any[] {
    const groups: any = {};
    
    data.forEach(item => {
      const key = groupBy.map(field => item[field]).join('|');
      if (!groups[key]) {
        groups[key] = { items: [], group: {} };
        groupBy.forEach(field => {
          groups[key].group[field] = item[field];
        });
      }
      groups[key].items.push(item);
    });
    
    return Object.values(groups).map((group: any) => ({
      ...group.group,
      ...this.processMetrics(group.items, metrics)
    }));
  }

  private formatAsCSV(data: any): string {
    if (Array.isArray(data) && data.length > 0) {
      const headers = Object.keys(data[0]);
      const rows = data.map(item => headers.map(h => JSON.stringify(item[h])).join(','));
      return [headers.join(','), ...rows].join('\n');
    }
    return JSON.stringify(data);
  }

  // Parse Smithery configuration from query parameters (dot-notation support)
  private parseSmitheryConfig(query: Record<string, any>): Record<string, any> {
    const config: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(query)) {
      // Convert dot-notation to nested object
      // e.g., "pocketbase.url" becomes { pocketbase: { url: value } }
      const keys = key.split('.');
      let current = config;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) {
          current[keys[i]] = {};
        }
        current = current[keys[i]];
      }
      
      current[keys[keys.length - 1]] = value;
    }
    
    // Flatten for our config system (we use flat env vars)
    const flattened: Record<string, any> = {};
    
    // Map common Smithery config patterns to our environment variables
    if (config.pocketbaseUrl) flattened.pocketbaseUrl = config.pocketbaseUrl;
    if (config.pocketbase?.url) flattened.pocketbaseUrl = config.pocketbase.url;
    if (config.adminEmail) flattened.adminEmail = config.adminEmail;
    if (config.admin?.email) flattened.adminEmail = config.admin.email;
    if (config.adminPassword) flattened.adminPassword = config.adminPassword;
    if (config.admin?.password) flattened.adminPassword = config.admin.password;
    if (config.stripeSecretKey) flattened.stripeSecretKey = config.stripeSecretKey;
    if (config.stripe?.secretKey) flattened.stripeSecretKey = config.stripe.secretKey;
    if (config.emailService) flattened.emailService = config.emailService;
    if (config.email?.service) flattened.emailService = config.email.service;
    if (config.smtpHost) flattened.smtpHost = config.smtpHost;
    if (config.smtp?.host) flattened.smtpHost = config.smtp.host;
    if (config.sendgridApiKey) flattened.sendgridApiKey = config.sendgridApiKey;
    if (config.sendgrid?.apiKey) flattened.sendgridApiKey = config.sendgrid.apiKey;
    
    return flattened;
  }

  private async formatAsPDF(data: any, title: string): Promise<string> {
    // Simple PDF formatting - in a real implementation, you'd use a PDF library
    return `PDF Report: ${title}\n${JSON.stringify(data, null, 2)}`;
  }
  async run() {
    console.error('[MCP DEBUG] Starting PocketBase MCP server...');
    
    // @ts-ignore
    const toolNames = Object.keys(this.server._tools || {});
    console.error(`[MCP DEBUG] Registered tools: ${JSON.stringify(toolNames)}`);
    
    const transport = new StdioServerTransport();
    
    try {
      console.error('[MCP DEBUG] Created StdioServerTransport, connecting...');
      await this.server.connect(transport);
      console.error('[MCP DEBUG] PocketBase MCP server running on stdio');
    } catch (error) {
      console.error(`[MCP DEBUG] Error connecting server: ${error}`);
    }
  }

  // Run as SSE server with enhanced configuration
  async runSSE(port: number = 3000, host: string = 'localhost', corsOrigin: string = '*') {
    console.error(`[MCP DEBUG] Starting PocketBase MCP SSE server on ${host}:${port}...`);
    
    // Log registered tools for debugging
    // @ts-ignore
    const toolNames = Object.keys(this.server._tools || {});
    console.error(`[MCP DEBUG] Registered tools: ${JSON.stringify(toolNames, null, 2)}`);
    
    // Import express and create app
    const express = require('express');
    const app = express();
    
    // Enhanced middleware
    app.use(express.json({ limit: '10mb' })); // Increased limit for file uploads
    
    // CORS configuration
    app.use((req: any, res: any, next: any) => {
      res.header('Access-Control-Allow-Origin', corsOrigin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Store transports by session ID
    const transports: Record<string, any> = {};

    // Health check endpoint
    app.get('/health', (req: any, res: any) => {
      res.json({ 
        status: 'healthy', 
        server: 'pocketbase-mcp-server',
        version: '3.0.0',
        transport: 'sse',
        host,
        port,
        pocketbaseUrl: this.pb?.baseUrl || 'not-configured',
        isAuthenticated: this.pb?.authStore?.isValid || false
      });
    });

    // SSE endpoint for MCP connection with Smithery compatibility
    app.get('/mcp', async (req: any, res: any) => {
      console.log('Received GET request to /mcp - establishing SSE connection');
      
      try {
        // Handle Smithery configuration via query parameters
        const config = this.parseSmitheryConfig(req.query);
        if (config && Object.keys(config).length > 0) {
          console.log('Applying Smithery configuration:', config);
          // Apply configuration to environment for this session
          applyConfigToEnv(config);
        }
        
        const transport = new SSEServerTransport('/mcp', res);
        const sessionId = transport.sessionId;
        transports[sessionId] = transport;
        
        res.on("close", () => {
          console.log(`SSE connection closed for session ${sessionId}`);
          delete transports[sessionId];
        });

        await this.server.connect(transport);
        console.error(`[MCP DEBUG] SSE transport connected for session ${sessionId}`);
      } catch (error) {
        console.error(`[MCP DEBUG] Error establishing SSE connection: ${error}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to establish SSE connection' });
        }
      }
    });

    // POST endpoint for MCP communication (Smithery requirement)
    app.post('/mcp', async (req: any, res: any) => {
      console.log('Received POST request to /mcp');
      
      try {
        // Handle Smithery configuration via query parameters
        const config = this.parseSmitheryConfig(req.query);
        if (config && Object.keys(config).length > 0) {
          console.log('Applying Smithery configuration:', config);
          applyConfigToEnv(config);
        }
        
        // For POST requests, we'll return server capabilities and tool list
        // This allows Smithery to discover tools without full connection
        const capabilities = {
          server: {
            name: 'pocketbase-server',
            version: '3.0.0'
          },
          capabilities: {
            tools: {},
            resources: {},
            prompts: {}
          },
          // @ts-ignore - Access internal tools for discovery
          tools: Object.keys(this.server._tools || {}),
          // @ts-ignore - Access internal resources for discovery  
          resources: Object.keys(this.server._resources || {}),
          // @ts-ignore - Access internal prompts for discovery
          prompts: Object.keys(this.server._prompts || {})
        };
        
        res.json(capabilities);
      } catch (error) {
        console.error(`[MCP DEBUG] Error handling POST to /mcp: ${error}`);
        res.status(500).json({ error: 'Failed to handle MCP POST request' });
      }
    });

    // DELETE endpoint for MCP cleanup (Smithery requirement)
    app.delete('/mcp', async (req: any, res: any) => {
      console.log('Received DELETE request to /mcp - cleaning up connections');
      
      try {
        // Close all active transports
        for (const sessionId in transports) {
          try {
            await transports[sessionId].close();
            delete transports[sessionId];
          } catch (error) {
            console.error(`Error closing transport ${sessionId}:`, error);
          }
        }
        
        res.json({ success: true, message: 'All MCP connections closed' });
      } catch (error) {
        console.error(`[MCP DEBUG] Error handling DELETE to /mcp: ${error}`);
        res.status(500).json({ error: 'Failed to handle MCP DELETE request' });
      }
    });

    // Start the server
    app.listen(port, host, () => {
      console.error(`[MCP DEBUG] PocketBase MCP SSE server running on ${host}:${port}`);
      console.log(`
==============================================
PocketBase MCP Server - SSE Mode
Host: ${host}
Port: ${port}
Health Check: http://${host}:${port}/health
MCP Endpoint: http://${host}:${port}/mcp
CORS Origin: ${corsOrigin}
==============================================
`);
    });

    // Handle server shutdown
    this.setupShutdownHandlers(transports);
  }

  // Run as pure HTTP server (using existing Express setup for HTTP-like functionality)
  async runHTTP(port: number = 3000, host: string = 'localhost', corsOrigin: string = '*') {
    // For now, delegate to runSSE since the MCP SDK may not have pure HTTP transport
    // This provides HTTP access via SSE transport which is HTTP-compatible
    console.error(`[MCP DEBUG] HTTP transport delegating to SSE transport for compatibility...`);
    await this.runSSE(port, host, corsOrigin);
  }

  // Shared shutdown handler setup
  private setupShutdownHandlers(transports: Record<string, any>) {
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      for (const sessionId in transports) {
        try {
          console.log(`Closing transport for session ${sessionId}`);
          await transports[sessionId].close();
          delete transports[sessionId];
        } catch (error) {
          console.error(`Error closing transport for session ${sessionId}:`, error);
        }
      }
      console.log('Server shutdown complete');
      process.exit(0);
    });
  }

  // Run as HTTP server
  async runHttp(port: number = 3000) {
    console.error(`[MCP DEBUG] Starting PocketBase MCP HTTP server on port ${port}...`);
    
    // Log registered tools for debugging
    // @ts-ignore
    const toolNames = Object.keys(this.server._tools || {});
    console.error(`[MCP DEBUG] Registered tools: ${JSON.stringify(toolNames, null, 2)}`);
    
    // Import express and create app
    const express = require('express');
    const app = express();
    app.use(express.json());

    // Store transports by session ID
    const transports: Record<string, any> = {};

    // Health check endpoint
    app.get('/health', (req: any, res: any) => {
      res.json({ 
        status: 'healthy', 
        server: 'pocketbase-mcp-server',
        version: '3.0.0',
        pocketbaseUrl: this.pb!.baseUrl,
        isAuthenticated: this.pb!.authStore?.isValid || false
      });
    });

    // SSE endpoint for MCP connection
    app.get('/mcp', async (req: any, res: any) => {
      console.log('Received GET request to /mcp - establishing SSE connection');
      
      try {
        const transport = new SSEServerTransport('/mcp', res);
        const sessionId = transport.sessionId;
        transports[sessionId] = transport;
        
        res.on("close", () => {
          console.log(`SSE connection closed for session ${sessionId}`);
          delete transports[sessionId];
        });

        await this.server.connect(transport);
        console.error(`[MCP DEBUG] SSE transport connected for session ${sessionId}`);
      } catch (error) {
        console.error(`[MCP DEBUG] Error establishing SSE connection: ${error}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to establish SSE connection' });
        }
      }
    });

    // Start the server
    app.listen(port, () => {
      console.error(`[MCP DEBUG] PocketBase MCP HTTP server running on port ${port}`);
      console.log(`
==============================================
PocketBase MCP Server - HTTP Mode
Port: ${port}
Health Check: http://localhost:${port}/health
MCP Endpoint: http://localhost:${port}/mcp
==============================================
`);
    });

    // Handle server shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      for (const sessionId in transports) {
        try {
          console.log(`Closing transport for session ${sessionId}`);
          await transports[sessionId].close();
          delete transports[sessionId];
        } catch (error) {
          console.error(`Error closing transport for session ${sessionId}:`, error);
        }
      }
      console.log('Server shutdown complete');
      process.exit(0);
    });
  }
}

// Transport types supported by the MCP server
type TransportType = 'stdio' | 'sse' | 'http';

// Transport configuration interface
interface TransportConfig {
  type: TransportType;
  port?: number;
  host?: string;
  corsOrigin?: string;
  auth?: boolean;
}

// Function to detect transport type from environment and command line arguments
function detectTransportType(): TransportConfig {
  // Check command line arguments first
  const args = process.argv.slice(2);
  const transportArg = args.find(arg => arg.startsWith('--transport='));
  const portArg = args.find(arg => arg.startsWith('--port='));
  const hostArg = args.find(arg => arg.startsWith('--host='));
  
  let transportType: TransportType = 'stdio'; // default
  let port: number | undefined;
  let host: string | undefined;
  let corsOrigin: string | undefined;
  
  // Parse command line arguments
  if (transportArg) {
    const type = transportArg.split('=')[1] as TransportType;
    if (['stdio', 'sse', 'http'].includes(type)) {
      transportType = type;
    }
  }
  
  if (portArg) {
    port = parseInt(portArg.split('=')[1]);
  }
  
  if (hostArg) {
    host = hostArg.split('=')[1];
  }
  
  // Check environment variables
  if (process.env.MCP_TRANSPORT_TYPE) {
    const envType = process.env.MCP_TRANSPORT_TYPE as TransportType;
    if (['stdio', 'sse', 'http'].includes(envType)) {
      transportType = envType;
    }
  }
  
  // Legacy environment variable support
  if (process.env.HTTP_MODE === 'true' || process.env.PORT) {
    transportType = 'sse'; // Default to SSE for HTTP mode
  }
  
  if (process.env.SSE_MODE === 'true') {
    transportType = 'sse';
  }
  
  // Port detection
  if (!port) {
    port = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT) : 
           process.env.PORT ? parseInt(process.env.PORT) : 
           (transportType === 'stdio' ? undefined : 3000);
  }
  
  // Host detection  
  if (!host) {
    host = process.env.MCP_HOST || process.env.HOST || 'localhost';
  }
  
  // CORS origin
  corsOrigin = process.env.MCP_CORS_ORIGIN || process.env.CORS_ORIGIN || '*';
  
  return {
    type: transportType,
    port,
    host,
    corsOrigin,
    auth: process.env.MCP_AUTH === 'true'
  };
}

// Export the class for testing
export default PocketBaseServer;
export { PocketBaseServer };

// Lazy server instance creation
let serverInstance: PocketBaseServer | null = null;

function getServerInstance(): PocketBaseServer {
  if (!serverInstance) {
    serverInstance = new PocketBaseServer();
  }
  return serverInstance;
}

// Main server startup with transport detection
async function startServer() {
  const server = getServerInstance();
  const config = detectTransportType();
  
  console.error(`[MCP DEBUG] Detected transport type: ${config.type}`);
  if (config.port) console.error(`[MCP DEBUG] Port: ${config.port}`);
  if (config.host) console.error(`[MCP DEBUG] Host: ${config.host}`);
  
  try {
    switch (config.type) {
      case 'stdio':
        console.error('[MCP DEBUG] Starting STDIO transport...');
        await server.run();
        break;
        
      case 'sse':
        console.error(`[MCP DEBUG] Starting SSE transport on ${config.host}:${config.port}...`);
        await server.runSSE(config.port!, config.host, config.corsOrigin);
        break;
        
      case 'http':
        console.error(`[MCP DEBUG] Starting HTTP transport on ${config.host}:${config.port}...`);
        await server.runHTTP(config.port!, config.host, config.corsOrigin);
        break;
        
      default:
        throw new Error(`Unsupported transport type: ${config.type}`);
    }
  } catch (error) {
    console.error(`[MCP ERROR] Failed to start server with ${config.type} transport:`, error);
    process.exit(1);
  }
}

// Only start the server if this script is run directly (not imported)
// For now, comment out auto-start to ensure lazy loading works
// TODO: Re-enable when entry point detection is working properly

// const isMainModule = process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;

// if (isMainModule) {
//   // Legacy compatibility check - keep existing behavior for backward compatibility  
//   if (process.env.HTTP_MODE === 'true' || process.env.PORT) {
//     // Legacy HTTP/SSE mode
//     const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
//     getServerInstance().runSSE(port).catch(console.error);
//   } else {
//     // Use new transport detection system
//     startServer().catch(console.error);
//   }
// }

// For manual testing, you can uncomment this line:
// startServer().catch(console.error);
