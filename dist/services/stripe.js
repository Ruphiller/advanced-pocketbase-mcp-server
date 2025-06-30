import Stripe from 'stripe';
export class StripeService {
    stripe;
    pb;
    constructor(pb) {
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
    async createProduct(data) {
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
            return productRecord;
        }
        catch (error) {
            throw new Error(`Failed to create product: ${error.message}`);
        }
    }
    // Customer Management
    async createCustomer(data) {
        try { // Check if customer already exists
            const existingCustomer = await this.pb.collection('stripe_customers')
                .getFirstListItem(`email="${data.email}"`)
                .catch(() => null);
            if (existingCustomer) {
                return existingCustomer;
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
            return customerRecord;
        }
        catch (error) {
            throw new Error(`Failed to create customer: ${error.message}`);
        }
    }
    // Create Payment Intent directly (for custom payment flows)
    async createPaymentIntent(data) {
        try {
            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: data.amount,
                currency: data.currency || 'usd',
                customer: data.customerId,
                description: data.description,
                metadata: data.metadata || {},
            });
            return {
                clientSecret: paymentIntent.client_secret,
                paymentIntentId: paymentIntent.id,
            };
        }
        catch (error) {
            throw new Error(`Failed to create payment intent: ${error.message}`);
        }
    }
    // Retrieve customer information
    async retrieveCustomer(customerId) {
        try {
            const stripeCustomer = await this.stripe.customers.retrieve(customerId);
            return stripeCustomer;
        }
        catch (error) {
            throw new Error(`Failed to retrieve customer: ${error.message}`);
        }
    }
    // Update customer information
    async updateCustomer(customerId, data) {
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
            }
            catch (error) {
                // Customer might not exist in PocketBase, that's ok
                console.warn('Could not update customer in PocketBase:', error);
            }
            return stripeCustomer;
        }
        catch (error) {
            throw new Error(`Failed to update customer: ${error.message}`);
        }
    }
    // Cancel subscription
    async cancelSubscription(subscriptionId, cancelAtPeriodEnd = false) {
        try {
            let stripeSubscription;
            if (cancelAtPeriodEnd) {
                stripeSubscription = await this.stripe.subscriptions.update(subscriptionId, {
                    cancel_at_period_end: true,
                });
            }
            else {
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
            }
            catch (error) {
                console.warn('Could not update subscription in PocketBase:', error);
            }
            return stripeSubscription;
        }
        catch (error) {
            throw new Error(`Failed to cancel subscription: ${error.message}`);
        }
    }
    // Checkout Session
    async createCheckoutSession(data) {
        try {
            const sessionData = {
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
            }
            else if (data.customerEmail) {
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
        }
        catch (error) {
            throw new Error(`Failed to create checkout session: ${error.message}`);
        }
    }
    // Webhook Handler
    async handleWebhook(body, signature) {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!webhookSecret) {
            throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
        }
        try {
            const event = this.stripe.webhooks.constructEvent(body, signature, webhookSecret);
            switch (event.type) {
                case 'checkout.session.completed':
                    return await this.handleCheckoutCompleted(event.data.object);
                case 'invoice.payment_succeeded':
                    return await this.handlePaymentSucceeded(event.data.object);
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    return await this.handleSubscriptionUpdated(event.data.object);
                case 'customer.subscription.deleted':
                    return await this.handleSubscriptionDeleted(event.data.object);
                default:
                    console.log(`Unhandled event type: ${event.type}`);
                    return { received: true };
            }
        }
        catch (error) {
            throw new Error(`Webhook error: ${error.message}`);
        }
    }
    async handleCheckoutCompleted(session) {
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
                const subscription = await this.stripe.subscriptions.retrieve(session.subscription);
                await this.handleSubscriptionUpdated(subscription);
            }
            return { processed: true };
        }
        catch (error) {
            console.error('Error handling checkout completed:', error);
            throw error;
        }
    }
    async handlePaymentSucceeded(invoice) {
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
        }
        catch (error) {
            console.error('Error handling payment succeeded:', error);
            throw error;
        }
    }
    async handleSubscriptionUpdated(subscription) {
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
            }
            catch {
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
        }
        catch (error) {
            console.error('Error handling subscription updated:', error);
            throw error;
        }
    }
    async handleSubscriptionDeleted(subscription) {
        try {
            const subscriptionRecord = await this.pb.collection('stripe_subscriptions')
                .getFirstListItem(`stripeSubscriptionId="${subscription.id}"`);
            await this.pb.collection('stripe_subscriptions').update(subscriptionRecord.id, {
                status: 'canceled',
            });
            return { processed: true };
        }
        catch (error) {
            console.error('Error handling subscription deleted:', error);
            throw error;
        }
    }
    // Sync products from Stripe to PocketBase
    async syncProducts() {
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
                        }
                        catch {
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
                        }
                        else {
                            await this.pb.collection('stripe_products').create(productData);
                            results.push({ action: 'created', productId: product.id, priceId: price.id });
                        }
                    }
                    catch (error) {
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
        }
        catch (error) {
            throw new Error(`Failed to sync products: ${error.message}`);
        }
    }
    // === NEW MODERN STRIPE FEATURES ===
    // Payment Methods Management
    async createPaymentMethod(data) {
        try {
            const paymentMethod = await this.stripe.paymentMethods.create({
                type: data.type,
                card: data.card,
                billing_details: data.billing_details,
                metadata: data.metadata || {},
            });
            return paymentMethod;
        }
        catch (error) {
            throw new Error(`Failed to create payment method: ${error.message}`);
        }
    }
    async attachPaymentMethod(paymentMethodId, customerId) {
        try {
            const paymentMethod = await this.stripe.paymentMethods.attach(paymentMethodId, {
                customer: customerId,
            });
            return paymentMethod;
        }
        catch (error) {
            throw new Error(`Failed to attach payment method: ${error.message}`);
        }
    }
    async detachPaymentMethod(paymentMethodId) {
        try {
            const paymentMethod = await this.stripe.paymentMethods.detach(paymentMethodId);
            return paymentMethod;
        }
        catch (error) {
            throw new Error(`Failed to detach payment method: ${error.message}`);
        }
    }
    async listPaymentMethods(customerId, type) {
        try {
            const paymentMethods = await this.stripe.paymentMethods.list({
                customer: customerId,
                type: type || 'card',
            });
            return paymentMethods;
        }
        catch (error) {
            throw new Error(`Failed to list payment methods: ${error.message}`);
        }
    }
    // Setup Intents for saving payment methods
    async createSetupIntent(data) {
        try {
            const setupIntent = await this.stripe.setupIntents.create({
                customer: data.customerId,
                payment_method_types: data.paymentMethodTypes || ['card'],
                usage: data.usage || 'off_session',
                description: data.description,
                metadata: data.metadata || {},
            });
            return setupIntent;
        }
        catch (error) {
            throw new Error(`Failed to create setup intent: ${error.message}`);
        }
    }
    async confirmSetupIntent(setupIntentId, data) {
        try {
            const setupIntent = await this.stripe.setupIntents.confirm(setupIntentId, {
                payment_method: data.paymentMethod,
                return_url: data.returnUrl,
            });
            return setupIntent;
        }
        catch (error) {
            throw new Error(`Failed to confirm setup intent: ${error.message}`);
        }
    }
    // Payment Links - Modern shareable payment links
    async createPaymentLink(data) {
        try {
            const paymentLink = await this.stripe.paymentLinks.create({
                line_items: data.lineItems,
                metadata: data.metadata || {},
                allow_promotion_codes: data.allowPromotionCodes,
                automatic_tax: data.automaticTax ? { enabled: true } : undefined,
                custom_text: data.customText,
                customer_creation: data.customerCreation || 'if_required',
                invoice_creation: data.invoiceCreation,
                phone_number_collection: data.phoneNumberCollection,
                shipping_address_collection: data.shippingAddressCollection,
                submit_type: data.submitType,
                subscription_data: data.subscriptionData,
            });
            return paymentLink;
        }
        catch (error) {
            throw new Error(`Failed to create payment link: ${error.message}`);
        }
    }
    async retrievePaymentLink(paymentLinkId) {
        try {
            const paymentLink = await this.stripe.paymentLinks.retrieve(paymentLinkId);
            return paymentLink;
        }
        catch (error) {
            throw new Error(`Failed to retrieve payment link: ${error.message}`);
        }
    }
    async updatePaymentLink(paymentLinkId, data) {
        try {
            const paymentLink = await this.stripe.paymentLinks.update(paymentLinkId, {
                active: data.active,
                metadata: data.metadata,
            });
            return paymentLink;
        }
        catch (error) {
            throw new Error(`Failed to update payment link: ${error.message}`);
        }
    }
    async listPaymentLinks(params = {}) {
        try {
            const paymentLinks = await this.stripe.paymentLinks.list({
                active: params.active,
                limit: params.limit || 10,
            });
            return paymentLinks;
        }
        catch (error) {
            throw new Error(`Failed to list payment links: ${error.message}`);
        }
    }
    // Financial Connections for bank account verification
    async createFinancialConnectionsSession(data) {
        try {
            const session = await this.stripe.financialConnections.sessions.create({
                account_holder: {
                    type: data.accountHolderType,
                },
                permissions: data.permissions,
                filters: data.filtersCountryCode ? {
                    countries: [data.filtersCountryCode],
                } : undefined,
                return_url: data.returnUrl,
                prefetch: data.prefetch,
            });
            return session;
        }
        catch (error) {
            throw new Error(`Failed to create financial connections session: ${error.message}`);
        }
    }
    async retrieveFinancialConnectionsAccount(accountId) {
        try {
            const account = await this.stripe.financialConnections.accounts.retrieve(accountId);
            return account;
        }
        catch (error) {
            throw new Error(`Failed to retrieve financial connections account: ${error.message}`);
        }
    }
    async listFinancialConnectionsAccounts(sessionId) {
        try {
            const accounts = await this.stripe.financialConnections.accounts.list({
                session: sessionId,
            });
            return accounts;
        }
        catch (error) {
            throw new Error(`Failed to list financial connections accounts: ${error.message}`);
        }
    }
    // Enhanced Payment Intents with latest features
    async createEnhancedPaymentIntent(data) {
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
        }
        catch (error) {
            throw new Error(`Failed to create enhanced payment intent: ${error.message}`);
        }
    }
    async confirmPaymentIntent(paymentIntentId, data) {
        try {
            const paymentIntent = await this.stripe.paymentIntents.confirm(paymentIntentId, {
                payment_method: data.paymentMethod,
                return_url: data.returnUrl,
                receipt_email: data.receiptEmail,
            });
            return paymentIntent;
        }
        catch (error) {
            throw new Error(`Failed to confirm payment intent: ${error.message}`);
        }
    }
    async capturePaymentIntent(paymentIntentId, amountToCapture) {
        try {
            const paymentIntent = await this.stripe.paymentIntents.capture(paymentIntentId, {
                amount_to_capture: amountToCapture,
            });
            return paymentIntent;
        }
        catch (error) {
            throw new Error(`Failed to capture payment intent: ${error.message}`);
        }
    }
    // Subscription management with latest features
    async createAdvancedSubscription(data) {
        try {
            const subscription = await this.stripe.subscriptions.create({
                customer: data.customerId,
                items: data.items,
                payment_behavior: data.paymentBehavior,
                payment_settings: data.paymentSettings,
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
        }
        catch (error) {
            throw new Error(`Failed to create advanced subscription: ${error.message}`);
        }
    }
    // Refunds with enhanced features
    async createRefund(data) {
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
        }
        catch (error) {
            throw new Error(`Failed to create refund: ${error.message}`);
        }
    }
    // Coupons and Promotion Codes
    async createCoupon(data) {
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
        }
        catch (error) {
            throw new Error(`Failed to create coupon: ${error.message}`);
        }
    }
    async createPromotionCode(data) {
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
        }
        catch (error) {
            throw new Error(`Failed to create promotion code: ${error.message}`);
        }
    }
    // Advanced Analytics and Reporting
    async getPaymentAnalytics(params = {}) {
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
                currencies: {},
                paymentMethods: {},
            };
            for (const charge of charges.data) {
                analytics.totalAmount += charge.amount;
                if (charge.status === 'succeeded') {
                    analytics.successfulPayments++;
                }
                else if (charge.status === 'failed') {
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
        }
        catch (error) {
            throw new Error(`Failed to get payment analytics: ${error.message}`);
        }
    }
}
