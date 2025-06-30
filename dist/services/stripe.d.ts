import PocketBase from 'pocketbase';
import { StripeProduct, StripeCustomer } from '../types/stripe.js';
export declare class StripeService {
    private stripe;
    private pb;
    constructor(pb: PocketBase);
    createProduct(data: {
        name: string;
        description?: string;
        price: number;
        currency?: string;
        recurring?: boolean;
        interval?: 'month' | 'year' | 'week' | 'day';
        metadata?: Record<string, any>;
    }): Promise<StripeProduct>;
    createCustomer(data: {
        email: string;
        name?: string;
        userId?: string;
        metadata?: Record<string, any>;
    }): Promise<StripeCustomer>;
    createPaymentIntent(data: {
        amount: number;
        currency?: string;
        customerId?: string;
        description?: string;
        metadata?: Record<string, any>;
    }): Promise<{
        clientSecret: string;
        paymentIntentId: string;
    }>;
    retrieveCustomer(customerId: string): Promise<any>;
    updateCustomer(customerId: string, data: {
        email?: string;
        name?: string;
        metadata?: Record<string, any>;
    }): Promise<any>;
    cancelSubscription(subscriptionId: string, cancelAtPeriodEnd?: boolean): Promise<any>;
    createCheckoutSession(data: {
        priceId: string;
        customerId?: string;
        customerEmail?: string;
        successUrl: string;
        cancelUrl: string;
        mode?: 'payment' | 'subscription' | 'setup';
        metadata?: Record<string, any>;
    }): Promise<{
        url: string;
        sessionId: string;
    }>;
    handleWebhook(body: string, signature: string): Promise<any>;
    private handleCheckoutCompleted;
    private handlePaymentSucceeded;
    private handleSubscriptionUpdated;
    private handleSubscriptionDeleted;
    syncProducts(): Promise<any>;
    createPaymentMethod(data: {
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
    }): Promise<any>;
    attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<any>;
    detachPaymentMethod(paymentMethodId: string): Promise<any>;
    listPaymentMethods(customerId: string, type?: string): Promise<any>;
    createSetupIntent(data: {
        customerId?: string;
        paymentMethodTypes?: string[];
        usage?: 'on_session' | 'off_session';
        description?: string;
        metadata?: Record<string, any>;
    }): Promise<any>;
    confirmSetupIntent(setupIntentId: string, data: {
        paymentMethod?: string;
        returnUrl?: string;
    }): Promise<any>;
    createPaymentLink(data: {
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
    }): Promise<any>;
    retrievePaymentLink(paymentLinkId: string): Promise<any>;
    updatePaymentLink(paymentLinkId: string, data: {
        active?: boolean;
        metadata?: Record<string, any>;
    }): Promise<any>;
    listPaymentLinks(params?: {
        active?: boolean;
        limit?: number;
    }): Promise<any>;
    createFinancialConnectionsSession(data: {
        accountHolderType: 'individual' | 'business';
        permissions: string[];
        filtersCountryCode?: string;
        returnUrl?: string;
        prefetch?: string[];
    }): Promise<any>;
    retrieveFinancialConnectionsAccount(accountId: string): Promise<any>;
    listFinancialConnectionsAccounts(sessionId?: string): Promise<any>;
    createEnhancedPaymentIntent(data: {
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
    }): Promise<any>;
    confirmPaymentIntent(paymentIntentId: string, data: {
        paymentMethod?: string;
        returnUrl?: string;
        receiptEmail?: string;
    }): Promise<any>;
    capturePaymentIntent(paymentIntentId: string, amountToCapture?: number): Promise<any>;
    createAdvancedSubscription(data: {
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
    }): Promise<any>;
    createRefund(data: {
        paymentIntentId?: string;
        chargeId?: string;
        amount?: number;
        reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
        refundApplicationFee?: boolean;
        reverseTransfer?: boolean;
        metadata?: Record<string, any>;
    }): Promise<any>;
    createCoupon(data: {
        id?: string;
        duration: 'forever' | 'once' | 'repeating';
        amountOff?: number;
        percentOff?: number;
        currency?: string;
        durationInMonths?: number;
        maxRedemptions?: number;
        redeemBy?: number;
        metadata?: Record<string, any>;
    }): Promise<any>;
    createPromotionCode(data: {
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
    }): Promise<any>;
    getPaymentAnalytics(params?: {
        startDate?: string;
        endDate?: string;
        customerId?: string;
    }): Promise<any>;
}
