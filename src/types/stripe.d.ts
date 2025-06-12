// Type definitions for Stripe integration
export interface StripeProduct {
  id: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  recurring?: boolean;
  interval?: 'month' | 'year' | 'week' | 'day';
  stripeProductId: string;
  stripePriceId?: string;
  active: boolean;
  metadata?: Record<string, any>;
  created: string;
  updated: string;
}

export interface StripeCustomer {
  id: string;
  email: string;
  name?: string;
  stripeCustomerId: string;
  userId?: string;
  metadata?: Record<string, any>;
  created: string;
  updated: string;
}

export interface StripeSubscription {
  id: string;
  customerId: string;
  productId: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  metadata?: Record<string, any>;
  created: string;
  updated: string;
}

export interface StripePayment {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  status: string;
  stripePaymentIntentId: string;
  description?: string;
  metadata?: Record<string, any>;
  created: string;
  updated: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  variables?: string[];
  created: string;
  updated: string;
}

export interface EmailLog {
  id: string;
  to: string;
  from?: string;
  subject: string;
  template?: string;
  status: 'sent' | 'failed' | 'pending';
  error?: string;
  variables?: Record<string, any>;
  // SendGrid-specific fields
  sendgrid_message_id?: string;
  categories?: string[];
  custom_args?: Record<string, string>;
  created: string;
  updated: string;
}
