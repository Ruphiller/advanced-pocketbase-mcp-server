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

      return productRecord as StripeProduct;
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

      return customerRecord as StripeCustomer;
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
}
