import PocketBase from 'pocketbase';
import { EmailTemplate, EmailLog } from '../types/stripe.js';
import { SendGridService } from './sendgrid.js';
export declare class EmailService {
    private transporter;
    private pb;
    private sendGridService?;
    constructor(pb: PocketBase);
    private setupTransporter;
    createTemplate(data: {
        name: string;
        subject: string;
        htmlContent: string;
        textContent?: string;
        variables?: string[];
    }): Promise<EmailTemplate>;
    getTemplate(name: string): Promise<EmailTemplate>;
    updateTemplate(name: string, data: {
        subject?: string;
        htmlContent?: string;
        textContent?: string;
        variables?: string[];
    }): Promise<EmailTemplate>;
    sendTemplatedEmail(data: {
        template: string;
        to: string;
        from?: string;
        variables?: Record<string, any>;
        customSubject?: string;
    }): Promise<EmailLog>;
    sendCustomEmail(data: {
        to: string;
        from?: string;
        subject: string;
        html: string;
        text?: string;
    }): Promise<EmailLog>;
    testConnection(): Promise<{
        success: boolean;
        message: string;
    }>;
    testEnhancedConnection(): Promise<{
        success: boolean;
        message: string;
        features?: string[];
    }>;
    sendEnhancedTemplatedEmail(data: {
        template: string;
        to: string;
        from?: string;
        variables?: Record<string, any>;
        customSubject?: string;
        categories?: string[];
        customArgs?: Record<string, string>;
        sendAt?: Date;
        trackingSettings?: {
            clickTracking?: boolean;
            openTracking?: boolean;
        };
        sandboxMode?: boolean;
    }): Promise<EmailLog>;
    scheduleTemplatedEmail(data: {
        template: string;
        to: string;
        from?: string;
        variables?: Record<string, any>;
        customSubject?: string;
        sendAt: Date;
        categories?: string[];
    }): Promise<EmailLog>;
    getSendGridService(): SendGridService | undefined;
    hasEnhancedFeatures(): boolean;
    createDefaultTemplates(): Promise<any>;
}
