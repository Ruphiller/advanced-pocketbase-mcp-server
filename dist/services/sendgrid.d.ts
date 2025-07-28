import PocketBase from 'pocketbase';
import { EmailLog } from '../types/stripe.js';
export interface SendGridEnhancedOptions {
    categories?: string[];
    customArgs?: Record<string, string>;
    sendAt?: number;
    batchId?: string;
    asm?: {
        groupId: number;
        groupsToDisplay?: number[];
    };
    trackingSettings?: {
        clickTracking?: {
            enable: boolean;
            enableText?: boolean;
        };
        openTracking?: {
            enable: boolean;
            substitutionTag?: string;
        };
        subscriptionTracking?: {
            enable: boolean;
        };
    };
    sandboxMode?: boolean;
}
export interface SendGridDynamicTemplate {
    id: string;
    name: string;
    sendgridTemplateId: string;
    version?: string;
    subject?: string;
    active: boolean;
    created: string;
    updated: string;
}
export interface SendGridStats {
    date: string;
    delivered: number;
    opens: number;
    clicks: number;
    bounces: number;
    spam_reports: number;
    unsubscribes: number;
}
export declare class SendGridService {
    private pb;
    private isInitialized;
    constructor(pb: PocketBase);
    private initializeSendGrid;
    isReady(): boolean;
    sendEnhancedEmail(data: {
        to: string | string[];
        from?: string;
        subject: string;
        html: string;
        text?: string;
        templateId?: string;
        dynamicTemplateData?: Record<string, any>;
        options?: SendGridEnhancedOptions;
    }): Promise<EmailLog>;
    createDynamicTemplate(data: {
        name: string;
        subject?: string;
        htmlContent?: string;
        textContent?: string;
    }): Promise<SendGridDynamicTemplate>;
    testSendGridConnection(): Promise<{
        success: boolean;
        message: string;
        features?: string[];
    }>;
    sendBulkEmails(emails: Array<{
        to: string;
        subject: string;
        html: string;
        text?: string;
        dynamicTemplateData?: Record<string, any>;
    }>, options?: SendGridEnhancedOptions): Promise<{
        sent: number;
        failed: number;
        errors: string[];
    }>;
    scheduleEmail(data: {
        to: string;
        from?: string;
        subject: string;
        html: string;
        text?: string;
        sendAt: Date;
        options?: SendGridEnhancedOptions;
    }): Promise<EmailLog>;
    cancelScheduledSend(batchId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    getSuppressions(type?: 'bounces' | 'blocks' | 'spam_reports' | 'unsubscribes'): Promise<{
        suppressions: Array<{
            email: string;
            created: number;
            reason?: string;
        }>;
        count: number;
    }>;
    addSuppression(email: string, type?: 'bounces' | 'blocks' | 'spam_reports' | 'unsubscribes'): Promise<{
        success: boolean;
        message: string;
    }>;
    removeSuppression(email: string, type?: 'bounces' | 'blocks' | 'spam_reports' | 'unsubscribes'): Promise<{
        success: boolean;
        message: string;
    }>;
    validateEmail(email: string): Promise<{
        valid: boolean;
        result: {
            email: string;
            verdict: 'Valid' | 'Invalid' | 'Risky';
            score: number;
            local: string;
            host: string;
            suggestion?: string;
        };
    }>;
    getEmailStats(params: {
        startDate: string;
        endDate?: string;
        categories?: string[];
        aggregatedBy?: 'day' | 'week' | 'month';
    }): Promise<SendGridStats[]>;
    createContactList(data: {
        name: string;
        description?: string;
        contacts?: Array<{
            email: string;
            firstName?: string;
            lastName?: string;
            customFields?: Record<string, any>;
        }>;
    }): Promise<{
        id: string;
        name: string;
        contactCount: number;
        created: string;
    }>;
    addContactToList(listId: string, contact: {
        email: string;
        firstName?: string;
        lastName?: string;
        customFields?: Record<string, any>;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
    processWebhookEvent(eventData: {
        email: string;
        event: 'delivered' | 'open' | 'click' | 'bounce' | 'dropped' | 'spamreport' | 'unsubscribe';
        timestamp: number;
        sg_message_id?: string;
        useragent?: string;
        ip?: string;
        url?: string;
        reason?: string;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
    static registerTools(server: any, pb: any): void;
    sendEmail(to: string, subject: string, body: string): Promise<void>;
}
