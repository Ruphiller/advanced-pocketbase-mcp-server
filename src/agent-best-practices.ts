/**
 * PocketBase MCP Server - Best Practices Implementation
 * 
 * This implementation follows Cloudflare's official MCP best practices:
 * - Uses the official Cloudflare Agents SDK
 * - Proper tool registration patterns from @cloudflare/mcp-server-cloudflare
 * - Individual Zod schemas for better LLM understanding
 * - Proper error handling and state management
 * - Follows the exact patterns from Context7 documentation
 */

import { Agent } from "agents";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import PocketBase from 'pocketbase';
import { StripeService } from './services/stripe.js';
import { EmailService } from './services/email.js';

// Environment interface following Cloudflare patterns
interface Env {
  POCKETBASE_URL?: string;
  POCKETBASE_ADMIN_EMAIL?: string;
  POCKETBASE_ADMIN_PASSWORD?: string;
  STRIPE_SECRET_KEY?: string;
  SENDGRID_API_KEY?: string;
  EMAIL_SERVICE?: string;
  SMTP_HOST?: string;
}

// Agent state interface following best practices
interface State {
  pocketbaseInitialized: boolean;
  isAuthenticated: boolean;
  discoveryMode: boolean;
  customHeaders: Record<string, string>;
  realtimeSubscriptions: string[];
  lastActivityTime: number;
}

// Individual Zod schemas following Cloudflare MCP server patterns
// This approach provides better LLM understanding and schema reusability

/** Collection name schema */
export const CollectionNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
  .describe('The name of the PocketBase collection (alphanumeric, underscore, must start with letter)');

/** Record ID schema */
export const RecordIdSchema = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[a-zA-Z0-9]+$/)
  .describe('The unique identifier for a PocketBase record');

/** Record data schema */
export const RecordDataSchema = z
  .record(z.unknown())
  .describe('JSON object containing the record data fields');

/** Query filter schema */
export const QueryFilterSchema = z
  .string()
  .optional()
  .describe('PocketBase filter query string (e.g., "status = true && created >= @now")');

/** Sort criteria schema */
export const SortCriteriaSchema = z
  .string()
  .optional()
  .describe('Sort criteria (e.g., "-created,+name" for descending created, ascending name)');

/** Page number schema */
export const PageNumberSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Page number for pagination (starting from 1)');

/** Records per page schema */
export const PerPageSchema = z
  .number()
  .int()
  .min(1)
  .max(500)
  .optional()
  .describe('Number of records per page (1-500)');

/** Email address schema */
export const EmailAddressSchema = z
  .string()
  .email()
  .describe('Valid email address');

/** Email template schema */
export const EmailTemplateSchema = z
  .string()
  .min(1)
  .describe('Name of the email template to use');

/** Stripe amount schema */
export const StripeAmountSchema = z
  .number()
  .int()
  .positive()
  .describe('Amount in cents (e.g., 2000 for $20.00)');

/** Currency code schema */
export const CurrencyCodeSchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/)
  .describe('Three-letter currency code (e.g., USD, EUR, GBP)');

/**
 * PocketBase MCP Agent following Cloudflare best practices
 * 
 * Key improvements:
 * - Individual Zod schemas for better LLM understanding
 * - Proper error handling patterns from official Cloudflare MCP servers
 * - Standard tool registration structure
 * - Efficient state management with Agent class
 */
export class PocketBaseMCPAgentBestPractices extends Agent<Env, State> {
  server = new McpServer({
    name: "pocketbase-server",
    version: "0.1.0",
  });

  // Initial state following Agent patterns
  initialState: State = {
    pocketbaseInitialized: false,
    isAuthenticated: false,
    discoveryMode: false,
    customHeaders: {},
    realtimeSubscriptions: [],
    lastActivityTime: Date.now()
  };

  // Private instances
  private pb?: PocketBase;
  private stripeService?: StripeService;
  private emailService?: EmailService;

  /**
   * Initialize the agent - called automatically by the Agents framework
   */
  async init(): Promise<void> {
    await this.initializePocketBase();
    await this.initializeServices();
    this.registerTools();
    this.registerResources();
    this.registerPrompts();
  }

  /**
   * Initialize PocketBase connection
   */
  private async initializePocketBase(): Promise<void> {
    try {
      const pocketbaseUrl = this.env.POCKETBASE_URL;
      
      if (!pocketbaseUrl) {
        this.setState({
          ...this.state,
          discoveryMode: true
        });
        return;
      }

      // Custom headers from state
      const options: any = {};
      if (Object.keys(this.state.customHeaders).length > 0) {
        // Apply custom headers if any are set
        options.headers = { ...options.headers, ...this.state.customHeaders };
      }

      this.pb = new PocketBase(pocketbaseUrl, options);

      // Authenticate if credentials are provided
      const adminEmail = this.env.POCKETBASE_ADMIN_EMAIL;
      const adminPassword = this.env.POCKETBASE_ADMIN_PASSWORD;
      
      if (adminEmail && adminPassword) {
        try {
          await this.pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
          this.setState({
            ...this.state,
            pocketbaseInitialized: true,
            isAuthenticated: true
          });
        } catch (authError: any) {
          console.warn('Admin authentication failed:', authError.message);
          this.setState({
            ...this.state,
            pocketbaseInitialized: true,
            isAuthenticated: false
          });
        }
      } else {
        this.setState({
          ...this.state,
          pocketbaseInitialized: true,
          isAuthenticated: false
        });
      }
    } catch (error: any) {
      console.error('PocketBase initialization failed:', error.message);
      this.setState({
        ...this.state,
        discoveryMode: true
      });
    }
  }

  /**
   * Initialize additional services
   */
  private async initializeServices(): Promise<void> {
    if (!this.pb) return;

    // Initialize Stripe service
    if (this.env.STRIPE_SECRET_KEY) {
      try {
        this.stripeService = new StripeService(this.pb);
      } catch (error) {
        console.warn('Stripe service initialization failed:', error);
      }
    }

    // Initialize Email service
    if (this.env.EMAIL_SERVICE || this.env.SMTP_HOST) {
      try {
        this.emailService = new EmailService(this.pb);
      } catch (error) {
        console.warn('Email service initialization failed:', error);
      }
    }
  }

  /**
   * Register all MCP tools following Cloudflare patterns
   */
  private registerTools(): void {
    // PocketBase CRUD operations
    this.registerPocketBaseTools();
    
    // Stripe tools
    if (this.stripeService) {
      this.registerStripeTools();
    }

    // Email tools
    if (this.emailService) {
      this.registerEmailTools();
    }

    // Utility tools
    this.registerUtilityTools();
  }

  /**
   * Register PocketBase CRUD tools
   */
  private registerPocketBaseTools(): void {
    // List collections
    this.server.tool(
      'pocketbase_list_collections',
      'List all available PocketBase collections with their schemas and metadata',
      {},
      async () => {
        try {
          if (!this.pb) {
            return this.createErrorResponse('PocketBase not initialized');
          }

          const collections = await this.pb.collections.getFullList(200);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                collections: collections.map(col => ({
                  id: col.id,
                  name: col.name,
                  type: col.type,
                  schema: col.schema,
                  listRule: col.listRule,
                  viewRule: col.viewRule,
                  createRule: col.createRule,
                  updateRule: col.updateRule,
                  deleteRule: col.deleteRule
                }))
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Create record
    this.server.tool(
      'pocketbase_create_record',
      'Create a new record in a PocketBase collection with specified data',
      {
        collection: CollectionNameSchema,
        data: RecordDataSchema
      },
      async ({ collection, data }) => {
        try {
          if (!this.pb) {
            return this.createErrorResponse('PocketBase not initialized');
          }

          const record = await this.pb.collection(collection).create(data);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                record: {
                  id: record.id,
                  ...record
                }
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Get record
    this.server.tool(
      'pocketbase_get_record',
      'Retrieve a specific record by ID from a PocketBase collection',
      {
        collection: CollectionNameSchema,
        id: RecordIdSchema
      },
      async ({ collection, id }) => {
        try {
          if (!this.pb) {
            return this.createErrorResponse('PocketBase not initialized');
          }

          const record = await this.pb.collection(collection).getOne(id);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                record
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // List records with advanced filtering
    this.server.tool(
      'pocketbase_list_records',
      'List records from a PocketBase collection with optional filtering, sorting, and pagination',
      {
        collection: CollectionNameSchema,
        filter: QueryFilterSchema,
        sort: SortCriteriaSchema,
        page: PageNumberSchema,
        perPage: PerPageSchema
      },
      async ({ collection, filter, sort, page, perPage }) => {
        try {
          if (!this.pb) {
            return this.createErrorResponse('PocketBase not initialized');
          }

          const options: any = {};
          if (filter) options.filter = filter;
          if (sort) options.sort = sort;
          if (page) options.page = page;
          if (perPage) options.perPage = perPage;

          const records = await this.pb.collection(collection).getList(
            page || 1,
            perPage || 30,
            options
          );
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                page: records.page,
                perPage: records.perPage,
                totalItems: records.totalItems,
                totalPages: records.totalPages,
                items: records.items
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Update record
    this.server.tool(
      'pocketbase_update_record',
      'Update an existing record in a PocketBase collection with new data',
      {
        collection: CollectionNameSchema,
        id: RecordIdSchema,
        data: RecordDataSchema
      },
      async ({ collection, id, data }) => {
        try {
          if (!this.pb) {
            return this.createErrorResponse('PocketBase not initialized');
          }

          const record = await this.pb.collection(collection).update(id, data);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                record
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Delete record
    this.server.tool(
      'pocketbase_delete_record',
      'Delete a specific record by ID from a PocketBase collection',
      {
        collection: CollectionNameSchema,
        id: RecordIdSchema
      },
      async ({ collection, id }) => {
        try {
          if (!this.pb) {
            return this.createErrorResponse('PocketBase not initialized');
          }

          await this.pb.collection(collection).delete(id);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Record ${id} deleted successfully from ${collection}`
              })
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * Register Stripe payment tools
   */
  private registerStripeTools(): void {
    if (!this.stripeService) return;

    // Create Payment Intent
    this.server.tool(
      'stripe_create_payment',
      'Create a new Stripe payment intent for processing payments',
      {
        amount: StripeAmountSchema,
        currency: CurrencyCodeSchema,
        description: z.string().optional().describe('Optional description for the payment')
      },
      async ({ amount, currency, description }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const paymentIntent = await this.stripeService.createPaymentIntent({
            amount,
            currency,
            description
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                paymentIntent: {
                  paymentIntentId: paymentIntent.paymentIntentId,
                  clientSecret: paymentIntent.clientSecret
                }
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Create Product
    this.server.tool(
      'stripe_create_product',
      'Create a new product in Stripe for selling',
      {
        name: z.string().describe('Product name'),
        description: z.string().optional().describe('Product description'),
        price: StripeAmountSchema.describe('Price in cents'),
        currency: CurrencyCodeSchema.optional().describe('Currency code'),
        interval: z.enum(['month', 'year', 'week', 'day']).optional().describe('Billing interval for subscriptions')
      },
      async ({ name, description, price, currency, interval }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const product = await this.stripeService.createProduct({
            name,
            description,
            price,
            currency,
            interval
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                product
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Create Customer
    this.server.tool(
      'stripe_create_customer',
      'Create a new customer in Stripe',
      {
        email: EmailAddressSchema,
        name: z.string().optional().describe('Customer name'),
        metadata: z.record(z.string()).optional().describe('Custom metadata')
      },
      async ({ email, name, metadata }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const customer = await this.stripeService.createCustomer({
            email,
            name,
            metadata
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                customer
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Retrieve Customer
    this.server.tool(
      'stripe_get_customer',
      'Retrieve a customer from Stripe by ID',
      {
        customerId: z.string().describe('Stripe customer ID')
      },
      async ({ customerId }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const customer = await this.stripeService.retrieveCustomer(customerId);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                customer
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Update Customer
    this.server.tool(
      'stripe_update_customer',
      'Update an existing customer in Stripe',
      {
        customerId: z.string().describe('Stripe customer ID'),
        email: EmailAddressSchema.optional(),
        name: z.string().optional().describe('Customer name'),
        metadata: z.record(z.string()).optional().describe('Custom metadata')
      },
      async ({ customerId, email, name, metadata }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const customer = await this.stripeService.updateCustomer(customerId, {
            email,
            name,
            metadata
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                customer
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Cancel Subscription
    this.server.tool(
      'stripe_cancel_subscription',
      'Cancel a Stripe subscription',
      {
        subscriptionId: z.string().describe('Stripe subscription ID'),
        cancelAtPeriodEnd: z.boolean().optional().describe('Whether to cancel at period end or immediately')
      },
      async ({ subscriptionId, cancelAtPeriodEnd }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const subscription = await this.stripeService.cancelSubscription(subscriptionId, cancelAtPeriodEnd);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                subscription
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Create Checkout Session
    this.server.tool(
      'stripe_create_checkout_session',
      'Create a Stripe Checkout session for payment',
      {
        priceId: z.string().describe('Stripe price ID'),
        successUrl: z.string().url().describe('Success redirect URL'),
        cancelUrl: z.string().url().describe('Cancel redirect URL'),
        customerId: z.string().optional().describe('Stripe customer ID'),
        mode: z.enum(['payment', 'subscription', 'setup']).optional().describe('Checkout mode')
      },
      async ({ priceId, successUrl, cancelUrl, customerId, mode }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const session = await this.stripeService.createCheckoutSession({
            priceId,
            successUrl,
            cancelUrl,
            customerId,
            mode
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                session: {
                  id: session.sessionId,
                  url: session.url
                }
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Create Payment Method
    this.server.tool(
      'stripe_create_payment_method',
      'Create a new payment method in Stripe',
      {
        type: z.enum(['card', 'us_bank_account', 'sepa_debit']).describe('Payment method type')
      },
      async ({ type }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const paymentMethod = await this.stripeService.createPaymentMethod({
            type
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                paymentMethod
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // List Payment Methods
    this.server.tool(
      'stripe_list_payment_methods',
      'List payment methods for a customer',
      {
        customerId: z.string().describe('Stripe customer ID'),
        type: z.string().optional().describe('Payment method type filter')
      },
      async ({ customerId, type }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const paymentMethods = await this.stripeService.listPaymentMethods(customerId, type);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                paymentMethods
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Create Setup Intent
    this.server.tool(
      'stripe_create_setup_intent',
      'Create a Setup Intent for saving payment methods',
      {
        customerId: z.string().describe('Stripe customer ID'),
        paymentMethodTypes: z.array(z.string()).optional().describe('Allowed payment method types')
      },
      async ({ customerId, paymentMethodTypes }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const setupIntent = await this.stripeService.createSetupIntent({
            customerId,
            paymentMethodTypes
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                setupIntent
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Create Payment Link
    this.server.tool(
      'stripe_create_payment_link',
      'Create a payment link for products',
      {
        priceId: z.string().describe('Stripe price ID'),
        quantity: z.number().optional().describe('Quantity of the product'),
        metadata: z.record(z.string()).optional().describe('Custom metadata')
      },
      async ({ priceId, quantity, metadata }) => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const paymentLink = await this.stripeService.createPaymentLink({
            lineItems: [{
              price: priceId,
              quantity: quantity || 1
            }],
            metadata
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                paymentLink
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Sync Products
    this.server.tool(
      'stripe_sync_products',
      'Sync Stripe products with PocketBase database',
      {},
      async () => {
        try {
          if (!this.stripeService) {
            return this.createErrorResponse('Stripe service not available');
          }

          const result = await this.stripeService.syncProducts();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                syncResult: result
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * Register email tools
   */
  private registerEmailTools(): void {
    if (!this.emailService) return;

    // Send Templated Email
    this.server.tool(
      'email_send_templated',
      'Send a templated email using the configured email service',
      {
        template: EmailTemplateSchema,
        to: EmailAddressSchema,
        from: EmailAddressSchema.optional(),
        subject: z.string().optional().describe('Custom email subject (overrides template subject)'),
        variables: z.record(z.unknown()).optional().describe('Template variables for personalization')
      },
      async ({ template, to, from, subject, variables }) => {
        try {
          if (!this.emailService) {
            return this.createErrorResponse('Email service not available');
          }

          const result = await this.emailService.sendTemplatedEmail({
            template,
            to,
            from,
            customSubject: subject,
            variables
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                emailLog: {
                  id: result.id,
                  to: result.to,
                  subject: result.subject,
                  status: result.status,
                  sentAt: result.created
                }
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Send Custom Email
    this.server.tool(
      'email_send_custom',
      'Send a custom email with specified content',
      {
        to: EmailAddressSchema,
        from: EmailAddressSchema.optional(),
        subject: z.string().describe('Email subject'),
        htmlBody: z.string().optional().describe('HTML email body'),
        textBody: z.string().optional().describe('Plain text email body')
      },
      async ({ to, from, subject, htmlBody, textBody }) => {
        try {
          if (!this.emailService) {
            return this.createErrorResponse('Email service not available');
          }

          const result = await this.emailService.sendCustomEmail({
            to,
            from,
            subject,
            html: htmlBody || '',
            text: textBody
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                emailLog: {
                  id: result.id,
                  to: result.to,
                  subject: result.subject,
                  status: result.status,
                  sentAt: result.created
                }
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Create Email Template
    this.server.tool(
      'email_create_template',
      'Create a new email template in the database',
      {
        name: z.string().describe('Template name/identifier'),
        subject: z.string().describe('Email subject'),
        htmlBody: z.string().describe('HTML template body'),
        textBody: z.string().optional().describe('Plain text template body'),
        variables: z.array(z.string()).optional().describe('List of template variables')
      },
      async ({ name, subject, htmlBody, textBody, variables }) => {
        try {
          if (!this.emailService) {
            return this.createErrorResponse('Email service not available');
          }

          const template = await this.emailService.createTemplate({
            name,
            subject,
            htmlContent: htmlBody,
            textContent: textBody,
            variables
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                template
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Get Email Template
    this.server.tool(
      'email_get_template',
      'Retrieve an email template by name',
      {
        name: EmailTemplateSchema
      },
      async ({ name }) => {
        try {
          if (!this.emailService) {
            return this.createErrorResponse('Email service not available');
          }

          const template = await this.emailService.getTemplate(name);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                template
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Update Email Template
    this.server.tool(
      'email_update_template',
      'Update an existing email template',
      {
        name: EmailTemplateSchema,
        subject: z.string().optional().describe('Email subject'),
        htmlBody: z.string().optional().describe('HTML template body'),
        textBody: z.string().optional().describe('Plain text template body'),
        variables: z.array(z.string()).optional().describe('List of template variables')
      },
      async ({ name, subject, htmlBody, textBody, variables }) => {
        try {
          if (!this.emailService) {
            return this.createErrorResponse('Email service not available');
          }

          const template = await this.emailService.updateTemplate(name, {
            subject,
            htmlContent: htmlBody,
            textContent: textBody,
            variables
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                template
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Test Email Connection
    this.server.tool(
      'email_test_connection',
      'Test the email service connection and configuration',
      {},
      async () => {
        try {
          if (!this.emailService) {
            return this.createErrorResponse('Email service not available');
          }

          const result = await this.emailService.testConnection();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                connectionTest: result
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Send Enhanced Templated Email
    this.server.tool(
      'email_send_enhanced_templated',
      'Send a templated email with enhanced features (tracking, scheduling, etc.)',
      {
        template: EmailTemplateSchema,
        to: EmailAddressSchema,
        from: EmailAddressSchema.optional(),
        subject: z.string().optional().describe('Custom email subject'),
        variables: z.record(z.unknown()).optional().describe('Template variables'),
        trackOpens: z.boolean().optional().describe('Enable open tracking'),
        trackClicks: z.boolean().optional().describe('Enable click tracking'),
        tags: z.array(z.string()).optional().describe('Email tags for categorization')
      },
      async ({ template, to, from, subject, variables, trackOpens, trackClicks, tags }) => {
        try {
          if (!this.emailService) {
            return this.createErrorResponse('Email service not available');
          }

          const result = await this.emailService.sendEnhancedTemplatedEmail({
            template,
            to,
            from,
            customSubject: subject,
            variables,
            trackingSettings: trackOpens || trackClicks ? {
              openTracking: trackOpens,
              clickTracking: trackClicks
            } : undefined,
            categories: tags
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                emailLog: {
                  id: result.id,
                  to: result.to,
                  subject: result.subject,
                  status: result.status,
                  sentAt: result.created
                }
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Schedule Templated Email
    this.server.tool(
      'email_schedule_templated',
      'Schedule a templated email to be sent at a specific time',
      {
        template: EmailTemplateSchema,
        to: EmailAddressSchema,
        from: EmailAddressSchema.optional(),
        subject: z.string().optional().describe('Custom email subject'),
        variables: z.record(z.unknown()).optional().describe('Template variables'),
        scheduledFor: z.string().describe('ISO 8601 datetime string for when to send'),
        timezone: z.string().optional().describe('Timezone for scheduling (e.g., "America/New_York")')
      },
      async ({ template, to, from, subject, variables, scheduledFor, timezone }) => {
        try {
          if (!this.emailService) {
            return this.createErrorResponse('Email service not available');
          }

          const result = await this.emailService.scheduleTemplatedEmail({
            template,
            to,
            from,
            customSubject: subject,
            variables,
            sendAt: new Date(scheduledFor),
            categories: timezone ? [timezone] : undefined
          });
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                scheduledEmail: {
                  id: result.id,
                  to: result.to,
                  subject: result.subject,
                  status: result.status,
                  createdAt: result.created
                }
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );

    // Create Default Templates
    this.server.tool(
      'email_create_default_templates',
      'Create a set of default email templates for common use cases',
      {},
      async () => {
        try {
          if (!this.emailService) {
            return this.createErrorResponse('Email service not available');
          }

          const result = await this.emailService.createDefaultTemplates();
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                createdTemplates: result
              }, null, 2)
            }]
          };
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * Register utility tools
   */
  private registerUtilityTools(): void {
    this.server.tool(
      'pocketbase_get_status',
      'Get the current status and configuration of the PocketBase MCP server',
      {},
      async () => {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              status: {
                state: this.state,
                capabilities: {
                  pocketbaseUrl: Boolean(this.env.POCKETBASE_URL),
                  hasAdminAuth: Boolean(this.env.POCKETBASE_ADMIN_EMAIL),
                  hasStripe: Boolean(this.env.STRIPE_SECRET_KEY),
                  hasEmail: Boolean(this.env.EMAIL_SERVICE || this.env.SMTP_HOST)
                },
                timestamp: new Date().toISOString()
              }
            }, null, 2)
          }]
        };
      }
    );
  }

  /**
   * Register MCP resources
   */
  private registerResources(): void {
    // Resources would be registered here with proper callback functions
    // Example: this.server.resource('name', 'uri', async (uri) => { ... });
  }

  /**
   * Register MCP prompts
   */
  private registerPrompts(): void {
    // Prompts would be registered here with proper callback functions
    // Example: this.server.prompt('name', 'description', async (extra) => { ... });
  }

  /**
   * Create standardized error response following Cloudflare patterns
   */
  private createErrorResponse(error: unknown): { content: Array<{ type: 'text'; text: string }> } {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: errorMessage,
          timestamp: new Date().toISOString()
        })
      }]
    };
  }

  /**
   * Handle state updates (called by Agents framework)
   */
  onStateUpdate(state: State | undefined, source: any): void {
    console.log('State updated:', { state, source });
  }
}

export default PocketBaseMCPAgentBestPractices;
