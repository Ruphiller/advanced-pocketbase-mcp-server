import Stripe from 'stripe';
import PocketBase from 'pocketbase';
import { StripeProduct, StripeCustomer, StripeSubscription, StripePayment } from '../types/stripe.js';

export class StripeService {
  private stripe: Stripe;
  private pb: PocketBase;

  constructor(pb: PocketBase) {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
      this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });
    this.pb = pb;
  }

  // Product Management
  async createProduct(data: {
    name: string;
    description?: string;
    price: number;
    currency?: string;
    recurring?: boolean;
    interval?: 'month' | 'year' | 'week' | 'day';
    metadata?: Record<string, any>;
  }): Promise<StripeProduct> {
    try {
      // Create product in Stripe
      const stripeProduct = await this.stripe.products.create({
        name: data.name,
        description: data.description,
        metadata: data.metadata || {},
      });

      // Create price in Stripe
      const stripePrice = await this.stripe.prices.create({
        unit_amount: data.price,
        currency: data.currency || 'usd',
        product: stripeProduct.id,
        recurring: data.recurring ? {
          interval: data.interval || 'month',
        } : undefined,
      });

      // Save to PocketBase
      const productRecord = await this.pb.collection('stripe_products').create({
        name: data.name,
        description: data.description,
        price: data.price,
        currency: data.currency || 'usd',
        recurring: data.recurring || false,
        interval: data.interval,
        stripeProductId: stripeProduct.id,
        stripePriceId: stripePrice.id,
        active: true,
        metadata: data.metadata || {},
      });

      return productRecord as unknown as StripeProduct;
    } catch (error: any) {
      throw new Error(`Failed to create product: ${error.message}`);
    }
  }

  // Customer Management
  async createCustomer(data: {
    email: string;
    name?: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<StripeCustomer> {
    try {      // Check if customer already exists
      const existingCustomer = await this.pb.collection('stripe_customers')
        .getFirstListItem(`email="${data.email}"`)
        .catch(() => null);

      if (existingCustomer) {
        return existingCustomer as StripeCustomer;
      }

      // Create customer in Stripe
      const stripeCustomer = await this.stripe.customers.create({
        email: data.email,
        name: data.name,
        metadata: {
          userId: data.userId || '',
          ...data.metadata,
        },
      });

      // Save to PocketBase
      const customerRecord = await this.pb.collection('stripe_customers').create({
        email: data.email,
        name: data.name,
        stripeCustomerId: stripeCustomer.id,
        userId: data.userId,
        metadata: data.metadata || {},
      });

      return customerRecord as unknown as StripeCustomer;
    } catch (error: any) {
      throw new Error(`Failed to create customer: ${error.message}`);
    }
  }

  // Create Payment Intent directly (for custom payment flows)
  async createPaymentIntent(data: {
    amount: number;
    currency?: string;
    customerId?: string;
    description?: string;
    metadata?: Record<string, any>;
  }): Promise<{ clientSecret: string; paymentIntentId: string }> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: data.amount,
        currency: data.currency || 'usd',
        customer: data.customerId,
        description: data.description,
        metadata: data.metadata || {},
      });

      return {
        clientSecret: paymentIntent.client_secret!,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error: any) {
      throw new Error(`Failed to create payment intent: ${error.message}`);
    }
  }

  // Retrieve customer information
  async retrieveCustomer(customerId: string): Promise<any> {
    try {
      const stripeCustomer = await this.stripe.customers.retrieve(customerId);
      return stripeCustomer;
    } catch (error: any) {
      throw new Error(`Failed to retrieve customer: ${error.message}`);
    }
  }

  // Update customer information
  async updateCustomer(customerId: string, data: {
    email?: string;
    name?: string;
    metadata?: Record<string, any>;
  }): Promise<any> {
    try {
      const stripeCustomer = await this.stripe.customers.update(customerId, {
        email: data.email,
        name: data.name,
        metadata: data.metadata,
      });

      // Also update in PocketBase if exists
      try {
        const pbCustomer = await this.pb.collection('stripe_customers')
          .getFirstListItem(`stripeCustomerId="${customerId}"`);
        
        await this.pb.collection('stripe_customers').update(pbCustomer.id, {
          email: data.email || pbCustomer.email,
          name: data.name || pbCustomer.name,
          metadata: { ...pbCustomer.metadata, ...data.metadata },
        });
      } catch (error) {
        // Customer might not exist in PocketBase, that's ok
        console.warn('Could not update customer in PocketBase:', error);
      }

      return stripeCustomer;
    } catch (error: any) {
      throw new Error(`Failed to update customer: ${error.message}`);
    }
  }

  // Cancel subscription
  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd: boolean = false): Promise<any> {
    try {
      let stripeSubscription;
      
      if (cancelAtPeriodEnd) {
        stripeSubscription = await this.stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
      } else {
        stripeSubscription = await this.stripe.subscriptions.cancel(subscriptionId);
      }

      // Update in PocketBase
      try {
        const pbSubscription = await this.pb.collection('stripe_subscriptions')
          .getFirstListItem(`stripeSubscriptionId="${subscriptionId}"`);
        
        await this.pb.collection('stripe_subscriptions').update(pbSubscription.id, {
          status: stripeSubscription.status,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        });
      } catch (error) {
        console.warn('Could not update subscription in PocketBase:', error);
      }

      return stripeSubscription;
    } catch (error: any) {
      throw new Error(`Failed to cancel subscription: ${error.message}`);
    }
  }

  // Checkout Session
  async createCheckoutSession(data: {
    priceId: string;
    customerId?: string;
    customerEmail?: string;
    successUrl: string;
    cancelUrl: string;
    mode?: 'payment' | 'subscription' | 'setup';
    metadata?: Record<string, any>;
  }): Promise<{ url: string; sessionId: string }> {
    try {
      const sessionData: Stripe.Checkout.SessionCreateParams = {
        line_items: [{
          price: data.priceId,
          quantity: 1,
        }],
        mode: data.mode || 'payment',
        success_url: data.successUrl,
        cancel_url: data.cancelUrl,
        metadata: data.metadata || {},
      };

      if (data.customerId) {
        sessionData.customer = data.customerId;
      } else if (data.customerEmail) {
        sessionData.customer_email = data.customerEmail;
      }

      const session = await this.stripe.checkout.sessions.create(sessionData);

      if (!session.url) {
        throw new Error('Failed to create checkout session URL');
      }

      return {
        url: session.url,
        sessionId: session.id,
      };
    } catch (error: any) {
      throw new Error(`Failed to create checkout session: ${error.message}`);
    }
  }

  // Webhook Handler
  async handleWebhook(body: string, signature: string): Promise<any> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
    }

    try {
      const event = this.stripe.webhooks.constructEvent(body, signature, webhookSecret);

      switch (event.type) {
        case 'checkout.session.completed':
          return await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        
        case 'invoice.payment_succeeded':
          return await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
          case 'customer.subscription.created':
        case 'customer.subscription.updated':
          return await this.handleSubscriptionUpdated(event.data.object as any);
        
        case 'customer.subscription.deleted':
          return await this.handleSubscriptionDeleted(event.data.object as any);
        
        default:
          console.log(`Unhandled event type: ${event.type}`);
          return { received: true };
      }
    } catch (error: any) {
      throw new Error(`Webhook error: ${error.message}`);
    }
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<any> {
    try {
      // Create payment record
      if (session.amount_total && session.customer) {
        await this.pb.collection('stripe_payments').create({
          customerId: session.customer,
          amount: session.amount_total,
          currency: session.currency,
          status: 'succeeded',
          stripePaymentIntentId: session.payment_intent || session.id,
          description: `Payment for session ${session.id}`,
          metadata: session.metadata || {},
        });
      }

      // Handle subscription if present
      if (session.subscription) {
        const subscription = await this.stripe.subscriptions.retrieve(session.subscription as string);
        await this.handleSubscriptionUpdated(subscription);
      }

      return { processed: true };
    } catch (error: any) {
      console.error('Error handling checkout completed:', error);
      throw error;
    }
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<any> {
    try {
      if (invoice.customer && invoice.amount_paid) {
        await this.pb.collection('stripe_payments').create({
          customerId: invoice.customer,
          amount: invoice.amount_paid,
          currency: invoice.currency,
          status: 'succeeded',
          stripePaymentIntentId: invoice.payment_intent || invoice.id,
          description: `Invoice payment ${invoice.number}`,
          metadata: invoice.metadata || {},
        });
      }
      return { processed: true };
    } catch (error: any) {
      console.error('Error handling payment succeeded:', error);
      throw error;
    }
  }

  private async handleSubscriptionUpdated(subscription: any): Promise<any> {
    try {
      // Find existing subscription or create new one
      let subscriptionRecord;
      try {
        subscriptionRecord = await this.pb.collection('stripe_subscriptions')
          .getFirstListItem(`stripeSubscriptionId="${subscription.id}"`);
        
        // Update existing
        await this.pb.collection('stripe_subscriptions').update(subscriptionRecord.id, {
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });
      } catch {
        // Create new subscription
        await this.pb.collection('stripe_subscriptions').create({
          customerId: subscription.customer,
          stripeSubscriptionId: subscription.id,
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          metadata: subscription.metadata || {},
        });
      }

      return { processed: true };
    } catch (error: any) {
      console.error('Error handling subscription updated:', error);
      throw error;
    }
  }
  private async handleSubscriptionDeleted(subscription: any): Promise<any> {
    try {
      const subscriptionRecord = await this.pb.collection('stripe_subscriptions')
        .getFirstListItem(`stripeSubscriptionId="${subscription.id}"`);
      
      await this.pb.collection('stripe_subscriptions').update(subscriptionRecord.id, {
        status: 'canceled',
      });

      return { processed: true };
    } catch (error: any) {
      console.error('Error handling subscription deleted:', error);
      throw error;
    }
  }

  // Sync products from Stripe to PocketBase
  async syncProducts(): Promise<any> {
    try {
      const stripeProducts = await this.stripe.products.list({ active: true });
      const results = [];

      for (const product of stripeProducts.data) {
        // Get prices for this product
        const prices = await this.stripe.prices.list({ product: product.id, active: true });
        
        for (const price of prices.data) {
          try {
            // Check if product exists in PocketBase
            let existingProduct;
            try {
              existingProduct = await this.pb.collection('stripe_products')
                .getFirstListItem(`stripeProductId="${product.id}" && stripePriceId="${price.id}"`);
            } catch {
              existingProduct = null;
            }

            const productData = {
              name: product.name,
              description: product.description,
              price: price.unit_amount || 0,
              currency: price.currency,
              recurring: !!price.recurring,
              interval: price.recurring?.interval,
              stripeProductId: product.id,
              stripePriceId: price.id,
              active: product.active && price.active,
              metadata: { ...product.metadata, ...price.metadata },
            };

            if (existingProduct) {
              await this.pb.collection('stripe_products').update(existingProduct.id, productData);
              results.push({ action: 'updated', productId: product.id, priceId: price.id });
            } else {
              await this.pb.collection('stripe_products').create(productData);
              results.push({ action: 'created', productId: product.id, priceId: price.id });
            }
          } catch (error: any) {
            results.push({ 
              action: 'error', 
              productId: product.id, 
              priceId: price.id, 
              error: error.message 
            });
          }
        }
      }

      return { synced: results.length, results };
    } catch (error: any) {
      throw new Error(`Failed to sync products: ${error.message}`);
    }
  }

  // === NEW MODERN STRIPE FEATURES ===

  // Payment Methods Management
  async createPaymentMethod(data: {
    type: string;
    card?: {
      number: string;
      exp_month: number;
      exp_year: number;
      cvc: string;
    };
    billing_details?: {
      name?: string;
      email?: string;
      address?: {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postal_code?: string;
        country?: string;
      };
    };
    metadata?: Record<string, any>;
  }): Promise<any> {
    try {
      const paymentMethod = await this.stripe.paymentMethods.create({
        type: data.type as any,
        card: data.card,
        billing_details: data.billing_details,
        metadata: data.metadata || {},
      });

      return paymentMethod;
    } catch (error: any) {
      throw new Error(`Failed to create payment method: ${error.message}`);
    }
  }

  async attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<any> {
    try {
      const paymentMethod = await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      return paymentMethod;
    } catch (error: any) {
      throw new Error(`Failed to attach payment method: ${error.message}`);
    }
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<any> {
    try {
      const paymentMethod = await this.stripe.paymentMethods.detach(paymentMethodId);
      return paymentMethod;
    } catch (error: any) {
      throw new Error(`Failed to detach payment method: ${error.message}`);
    }
  }

  async listPaymentMethods(customerId: string, type?: string): Promise<any> {
    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: type as any || 'card',
      });

      return paymentMethods;
    } catch (error: any) {
      throw new Error(`Failed to list payment methods: ${error.message}`);
    }
  }

  // Setup Intents for saving payment methods
  async createSetupIntent(data: {
    customerId?: string;
    paymentMethodTypes?: string[];
    usage?: 'on_session' | 'off_session';
    description?: string;
    metadata?: Record<string, any>;
  }): Promise<any> {
    try {
      const setupIntent = await this.stripe.setupIntents.create({
        customer: data.customerId,
        payment_method_types: data.paymentMethodTypes || ['card'],
        usage: data.usage || 'off_session',
        description: data.description,
        metadata: data.metadata || {},
      });

      return setupIntent;
    } catch (error: any) {
      throw new Error(`Failed to create setup intent: ${error.message}`);
    }
  }

  async confirmSetupIntent(setupIntentId: string, data: {
    paymentMethod?: string;
    returnUrl?: string;
  }): Promise<any> {
    try {
      const setupIntent = await this.stripe.setupIntents.confirm(setupIntentId, {
        payment_method: data.paymentMethod,
        return_url: data.returnUrl,
      });

      return setupIntent;
    } catch (error: any) {
      throw new Error(`Failed to confirm setup intent: ${error.message}`);
    }
  }

  // Payment Links - Modern shareable payment links
  async createPaymentLink(data: {
    lineItems: Array<{
      price: string;
      quantity: number;
    }>;
    metadata?: Record<string, any>;
    allowPromotionCodes?: boolean;
    automaticTax?: boolean;
    customText?: {
      shipping_address?: {
        message: string;
      };
      submit?: {
        message: string;
      };
    };
    customerCreation?: 'always' | 'if_required';
    invoiceCreation?: {
      enabled: boolean;
      invoice_data?: {
        description?: string;
        metadata?: Record<string, any>;
      };
    };
    phoneNumberCollection?: {
      enabled: boolean;
    };
    shippingAddressCollection?: {
      allowed_countries: string[];
    };
    submitType?: 'auto' | 'book' | 'donate' | 'pay';
    subscriptionData?: {
      description?: string;
      metadata?: Record<string, any>;
    };
  }): Promise<any> {
    try {      const paymentLink = await this.stripe.paymentLinks.create({
        line_items: data.lineItems,
        metadata: data.metadata || {},
        allow_promotion_codes: data.allowPromotionCodes,
        automatic_tax: data.automaticTax ? { enabled: true } : undefined,
        custom_text: data.customText,
        customer_creation: data.customerCreation || 'if_required',
        invoice_creation: data.invoiceCreation,
        phone_number_collection: data.phoneNumberCollection,
        shipping_address_collection: data.shippingAddressCollection as any,
        submit_type: data.submitType,
        subscription_data: data.subscriptionData,
      });

      return paymentLink;
    } catch (error: any) {
      throw new Error(`Failed to create payment link: ${error.message}`);
    }
  }

  async retrievePaymentLink(paymentLinkId: string): Promise<any> {
    try {
      const paymentLink = await this.stripe.paymentLinks.retrieve(paymentLinkId);
      return paymentLink;
    } catch (error: any) {
      throw new Error(`Failed to retrieve payment link: ${error.message}`);
    }
  }

  async updatePaymentLink(paymentLinkId: string, data: {
    active?: boolean;
    metadata?: Record<string, any>;
  }): Promise<any> {
    try {
      const paymentLink = await this.stripe.paymentLinks.update(paymentLinkId, {
        active: data.active,
        metadata: data.metadata,
      });

      return paymentLink;
    } catch (error: any) {
      throw new Error(`Failed to update payment link: ${error.message}`);
    }
  }

  async listPaymentLinks(params: {
    active?: boolean;
    limit?: number;
  } = {}): Promise<any> {
    try {
      const paymentLinks = await this.stripe.paymentLinks.list({
        active: params.active,
        limit: params.limit || 10,
      });

      return paymentLinks;
    } catch (error: any) {
      throw new Error(`Failed to list payment links: ${error.message}`);
    }
  }

  // Financial Connections for bank account verification
  async createFinancialConnectionsSession(data: {
    accountHolderType: 'individual' | 'business';
    permissions: string[];
    filtersCountryCode?: string;
    returnUrl?: string;
    prefetch?: string[];
  }): Promise<any> {
    try {      const session = await this.stripe.financialConnections.sessions.create({
        account_holder: {
          type: data.accountHolderType as any,
        },
        permissions: data.permissions as any,
        filters: data.filtersCountryCode ? {
          countries: [data.filtersCountryCode],
        } : undefined,
        return_url: data.returnUrl,
        prefetch: data.prefetch as any,
      });

      return session;
    } catch (error: any) {
      throw new Error(`Failed to create financial connections session: ${error.message}`);
    }
  }

  async retrieveFinancialConnectionsAccount(accountId: string): Promise<any> {
    try {
      const account = await this.stripe.financialConnections.accounts.retrieve(accountId);
      return account;
    } catch (error: any) {
      throw new Error(`Failed to retrieve financial connections account: ${error.message}`);
    }
  }

  async listFinancialConnectionsAccounts(sessionId?: string): Promise<any> {
    try {
      const accounts = await this.stripe.financialConnections.accounts.list({
        session: sessionId,
      });

      return accounts;
    } catch (error: any) {
      throw new Error(`Failed to list financial connections accounts: ${error.message}`);
    }
  }

  // Enhanced Payment Intents with latest features
  async createEnhancedPaymentIntent(data: {
    amount: number;
    currency?: string;
    customerId?: string;
    paymentMethodTypes?: string[];
    description?: string;
    receiptEmail?: string;
    setupFutureUsage?: 'on_session' | 'off_session';
    captureMethod?: 'automatic' | 'manual';
    confirmationMethod?: 'automatic' | 'manual';
    returnUrl?: string;
    metadata?: Record<string, any>;
    applicationFeeAmount?: number;
    transferData?: {
      destination: string;
      amount?: number;
    };
    statementDescriptor?: string;
    statementDescriptorSuffix?: string;
  }): Promise<any> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: data.amount,
        currency: data.currency || 'usd',
        customer: data.customerId,
        payment_method_types: data.paymentMethodTypes || ['card'],
        description: data.description,
        receipt_email: data.receiptEmail,
        setup_future_usage: data.setupFutureUsage,
        capture_method: data.captureMethod || 'automatic',
        confirmation_method: data.confirmationMethod || 'automatic',
        return_url: data.returnUrl,
        metadata: data.metadata || {},
        application_fee_amount: data.applicationFeeAmount,
        transfer_data: data.transferData,
        statement_descriptor: data.statementDescriptor,
        statement_descriptor_suffix: data.statementDescriptorSuffix,
      });

      return paymentIntent;
    } catch (error: any) {
      throw new Error(`Failed to create enhanced payment intent: ${error.message}`);
    }
  }

  async confirmPaymentIntent(paymentIntentId: string, data: {
    paymentMethod?: string;
    returnUrl?: string;
    receiptEmail?: string;
  }): Promise<any> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: data.paymentMethod,
        return_url: data.returnUrl,
        receipt_email: data.receiptEmail,
      });

      return paymentIntent;
    } catch (error: any) {
      throw new Error(`Failed to confirm payment intent: ${error.message}`);
    }
  }

  async capturePaymentIntent(paymentIntentId: string, amountToCapture?: number): Promise<any> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.capture(paymentIntentId, {
        amount_to_capture: amountToCapture,
      });

      return paymentIntent;
    } catch (error: any) {
      throw new Error(`Failed to capture payment intent: ${error.message}`);
    }
  }

  // Subscription management with latest features
  async createAdvancedSubscription(data: {
    customerId: string;
    items: Array<{
      price: string;
      quantity?: number;
    }>;
    paymentBehavior?: 'default_incomplete' | 'pending_if_incomplete' | 'error_if_incomplete';
    paymentSettings?: {
      payment_method_types?: string[];
      save_default_payment_method?: 'on_subscription' | 'off_session';
    };
    prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
    collectionMethod?: 'charge_automatically' | 'send_invoice';
    daysUntilDue?: number;
    defaultPaymentMethod?: string;
    description?: string;
    metadata?: Record<string, any>;
    promotionCode?: string;
    trialPeriodDays?: number;
    trialEnd?: number;
    billingCycleAnchor?: number;
  }): Promise<any> {
    try {      const subscription = await this.stripe.subscriptions.create({
        customer: data.customerId,
        items: data.items,
        payment_behavior: data.paymentBehavior,
        payment_settings: data.paymentSettings as any,
        proration_behavior: data.prorationBehavior,
        collection_method: data.collectionMethod || 'charge_automatically',
        days_until_due: data.daysUntilDue,
        default_payment_method: data.defaultPaymentMethod,
        description: data.description,
        metadata: data.metadata || {},
        promotion_code: data.promotionCode,
        trial_period_days: data.trialPeriodDays,
        trial_end: data.trialEnd,
        billing_cycle_anchor: data.billingCycleAnchor,
      });

      // Save to PocketBase
      await this.pb.collection('stripe_subscriptions').create({
        customerId: data.customerId,
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        metadata: subscription.metadata || {},
      });

      return subscription;
    } catch (error: any) {
      throw new Error(`Failed to create advanced subscription: ${error.message}`);
    }
  }

  // Refunds with enhanced features
  async createRefund(data: {
    paymentIntentId?: string;
    chargeId?: string;
    amount?: number;
    reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
    refundApplicationFee?: boolean;
    reverseTransfer?: boolean;
    metadata?: Record<string, any>;
  }): Promise<any> {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: data.paymentIntentId,
        charge: data.chargeId,
        amount: data.amount,
        reason: data.reason,
        refund_application_fee: data.refundApplicationFee,
        reverse_transfer: data.reverseTransfer,
        metadata: data.metadata || {},
      });

      return refund;
    } catch (error: any) {
      throw new Error(`Failed to create refund: ${error.message}`);
    }
  }

  // Coupons and Promotion Codes
  async createCoupon(data: {
    id?: string;
    duration: 'forever' | 'once' | 'repeating';
    amountOff?: number;
    percentOff?: number;
    currency?: string;
    durationInMonths?: number;
    maxRedemptions?: number;
    redeemBy?: number;
    metadata?: Record<string, any>;
  }): Promise<any> {
    try {
      const coupon = await this.stripe.coupons.create({
        id: data.id,
        duration: data.duration,
        amount_off: data.amountOff,
        percent_off: data.percentOff,
        currency: data.currency,
        duration_in_months: data.durationInMonths,
        max_redemptions: data.maxRedemptions,
        redeem_by: data.redeemBy,
        metadata: data.metadata || {},
      });

      return coupon;
    } catch (error: any) {
      throw new Error(`Failed to create coupon: ${error.message}`);
    }
  }

  async createPromotionCode(data: {
    couponId: string;
    code?: string;
    customerId?: string;
    expiresAt?: number;
    maxRedemptions?: number;
    restrictions?: {
      first_time_transaction?: boolean;
      minimum_amount?: number;
      minimum_amount_currency?: string;
    };
    metadata?: Record<string, any>;
  }): Promise<any> {
    try {
      const promotionCode = await this.stripe.promotionCodes.create({
        coupon: data.couponId,
        code: data.code,
        customer: data.customerId,
        expires_at: data.expiresAt,
        max_redemptions: data.maxRedemptions,
        restrictions: data.restrictions,
        metadata: data.metadata || {},
      });

      return promotionCode;
    } catch (error: any) {
      throw new Error(`Failed to create promotion code: ${error.message}`);
    }
  }

  // Advanced Analytics and Reporting
  async getPaymentAnalytics(params: {
    startDate?: string;
    endDate?: string;
    customerId?: string;
  } = {}): Promise<any> {
    try {
      const charges = await this.stripe.charges.list({
        created: {
          gte: params.startDate ? Math.floor(new Date(params.startDate).getTime() / 1000) : undefined,
          lte: params.endDate ? Math.floor(new Date(params.endDate).getTime() / 1000) : undefined,
        },
        customer: params.customerId,
        limit: 100,
      });

      const analytics = {
        totalAmount: 0,
        totalCount: charges.data.length,
        successfulPayments: 0,
        failedPayments: 0,
        refundedAmount: 0,
        currencies: {} as Record<string, number>,
        paymentMethods: {} as Record<string, number>,
      };

      for (const charge of charges.data) {
        analytics.totalAmount += charge.amount;
        
        if (charge.status === 'succeeded') {
          analytics.successfulPayments++;
        } else if (charge.status === 'failed') {
          analytics.failedPayments++;
        }

        if (charge.refunded) {
          analytics.refundedAmount += charge.amount_refunded;
        }

        // Track currencies
        analytics.currencies[charge.currency] = (analytics.currencies[charge.currency] || 0) + charge.amount;

        // Track payment methods
        const paymentMethod = charge.payment_method_details?.type || 'unknown';
        analytics.paymentMethods[paymentMethod] = (analytics.paymentMethods[paymentMethod] || 0) + 1;
      }

      return analytics;
    } catch (error: any) {
      throw new Error(`Failed to get payment analytics: ${error.message}`);
    }
  }
}

// Register tools function
export function registerTools(server: any, pb: any): void {
  server.tool('create_stripe_customer', 'Create a Stripe customer', { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } } }, async (args: any) => {
    const stripeService = new StripeService(pb);
    const customer = await stripeService.createCustomer({ email: args.email, name: args.name });
    return { success: true, customer };
  });
}
