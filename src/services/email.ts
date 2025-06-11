import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';
import PocketBase from 'pocketbase';
import { EmailTemplate, EmailLog } from '../types/stripe.js';

export class EmailService {
  private transporter!: nodemailer.Transporter;
  private pb: PocketBase;

  constructor(pb: PocketBase) {
    this.pb = pb;
    this.setupTransporter();
  }

  private setupTransporter() {
    const emailService = process.env.EMAIL_SERVICE;
    
    if (emailService === 'sendgrid') {
      // SendGrid configuration
      const apiKey = process.env.SENDGRID_API_KEY;
      if (!apiKey) {
        throw new Error('SENDGRID_API_KEY environment variable is required');
      }
        this.transporter = nodemailer.createTransport({
        service: 'SendGrid',
        auth: {
          user: 'apikey',
          pass: apiKey,
        },
      });
    } else {
      // SMTP configuration
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = parseInt(process.env.SMTP_PORT || '587');
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;

      if (!smtpHost || !smtpUser || !smtpPass) {
        throw new Error('SMTP configuration environment variables are required');
      }      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    }
  }

  // Create email template
  async createTemplate(data: {
    name: string;
    subject: string;
    htmlContent: string;
    textContent?: string;
    variables?: string[];
  }): Promise<EmailTemplate> {
    try {
      const template = await this.pb.collection('email_templates').create({
        name: data.name,
        subject: data.subject,
        htmlContent: data.htmlContent,
        textContent: data.textContent || '',
        variables: data.variables || [],
      });

      return template as EmailTemplate;
    } catch (error: any) {
      throw new Error(`Failed to create email template: ${error.message}`);
    }
  }

  // Get email template
  async getTemplate(name: string): Promise<EmailTemplate> {
    try {
      const template = await this.pb.collection('email_templates')
        .getFirstListItem(`name="${name}"`);
      
      return template as EmailTemplate;
    } catch (error: any) {
      throw new Error(`Template not found: ${name}`);
    }
  }

  // Update email template
  async updateTemplate(name: string, data: {
    subject?: string;
    htmlContent?: string;
    textContent?: string;
    variables?: string[];
  }): Promise<EmailTemplate> {
    try {
      // First get the existing template to get its ID
      const existingTemplate = await this.getTemplate(name);
      
      // Update the template
      const updatedTemplate = await this.pb.collection('email_templates').update(existingTemplate.id, {
        subject: data.subject || existingTemplate.subject,
        htmlContent: data.htmlContent || existingTemplate.htmlContent,
        textContent: data.textContent !== undefined ? data.textContent : existingTemplate.textContent,
        variables: data.variables !== undefined ? data.variables : existingTemplate.variables,
      });

      return updatedTemplate as EmailTemplate;
    } catch (error: any) {
      throw new Error(`Failed to update email template: ${error.message}`);
    }
  }

  // Send templated email
  async sendTemplatedEmail(data: {
    template: string;
    to: string;
    from?: string;
    variables?: Record<string, any>;
    customSubject?: string;
  }): Promise<EmailLog> {
    try {
      // Get template
      const template = await this.getTemplate(data.template);
      
      // Compile templates
      const subjectTemplate = Handlebars.compile(data.customSubject || template.subject);
      const htmlTemplate = Handlebars.compile(template.htmlContent);
      const textTemplate = template.textContent ? Handlebars.compile(template.textContent) : null;

      // Apply variables
      const variables = data.variables || {};
      const subject = subjectTemplate(variables);
      const html = htmlTemplate(variables);
      const text = textTemplate ? textTemplate(variables) : undefined;

      // Send email
      const info = await this.transporter.sendMail({
        from: data.from || process.env.SMTP_USER || process.env.DEFAULT_FROM_EMAIL,
        to: data.to,
        subject,
        html,
        text,
      });      // Log email
      const emailLog = await this.pb.collection('email_logs').create({
        to: data.to,
        from: data.from || process.env.SMTP_USER || process.env.DEFAULT_FROM_EMAIL,
        subject,
        template: data.template,
        status: 'sent',
        variables: variables,
      });

      return emailLog as EmailLog;
    } catch (error: any) {
      // Log failed email
      const emailLog = await this.pb.collection('email_logs').create({
        to: data.to,
        from: data.from || process.env.SMTP_USER || process.env.DEFAULT_FROM_EMAIL,
        subject: data.customSubject || 'Email send failed',
        template: data.template,
        status: 'failed',
        error: error.message,
        variables: data.variables || {},
      });

      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  // Send custom email
  async sendCustomEmail(data: {
    to: string;
    from?: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<EmailLog> {
    try {
      // Send email
      const info = await this.transporter.sendMail({
        from: data.from || process.env.SMTP_USER || process.env.DEFAULT_FROM_EMAIL,
        to: data.to,
        subject: data.subject,
        html: data.html,
        text: data.text,
      });      // Log email
      const emailLog = await this.pb.collection('email_logs').create({
        to: data.to,
        from: data.from || process.env.SMTP_USER || process.env.DEFAULT_FROM_EMAIL,
        subject: data.subject,
        status: 'sent',
      });

      return emailLog as EmailLog;
    } catch (error: any) {
      // Log failed email
      const emailLog = await this.pb.collection('email_logs').create({
        to: data.to,
        from: data.from || process.env.SMTP_USER || process.env.DEFAULT_FROM_EMAIL,
        subject: data.subject,
        status: 'failed',
        error: error.message,
      });

      throw new Error(`Failed to send custom email: ${error.message}`);
    }
  }

  // Test email connection
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Verify the transporter connection
      const isConnected = await this.transporter.verify();
      
      if (isConnected) {
        return {
          success: true,
          message: 'Email connection successful'
        };
      } else {
        return {
          success: false,
          message: 'Email connection failed verification'
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Email connection test failed: ${error.message}`
      };
    }
  }

  // Pre-built email templates
  async createDefaultTemplates(): Promise<any> {
    const templates = [
      {
        name: 'welcome',
        subject: 'Welcome to {{appName}}!',
        htmlContent: `
          <h1>Welcome {{userName}}!</h1>
          <p>Thank you for joining {{appName}}. We're excited to have you on board!</p>
          <p>If you have any questions, feel free to reach out to our support team.</p>
          <p>Best regards,<br>The {{appName}} Team</p>
        `,
        textContent: `
Welcome {{userName}}!

Thank you for joining {{appName}}. We're excited to have you on board!

If you have any questions, feel free to reach out to our support team.

Best regards,
The {{appName}} Team
        `,
        variables: ['userName', 'appName'],
      },
      {
        name: 'payment_success',
        subject: 'Payment Successful - {{planName}}',
        htmlContent: `
          <h1>Payment Successful!</h1>
          <p>Hi {{userName}},</p>
          <p>Your payment for <strong>{{planName}}</strong> has been processed successfully.</p>
          <p><strong>Amount:</strong> {{amount}} {{currency}}</p>
          <p><strong>Date:</strong> {{date}}</p>
          <p>Thank you for your business!</p>
          <p>Best regards,<br>The {{appName}} Team</p>
        `,
        textContent: `
Payment Successful!

Hi {{userName}},

Your payment for {{planName}} has been processed successfully.

Amount: {{amount}} {{currency}}
Date: {{date}}

Thank you for your business!

Best regards,
The {{appName}} Team
        `,
        variables: ['userName', 'planName', 'amount', 'currency', 'date', 'appName'],
      },
      {
        name: 'subscription_expired',
        subject: 'Your {{planName}} subscription has expired',
        htmlContent: `
          <h1>Subscription Expired</h1>
          <p>Hi {{userName}},</p>
          <p>Your <strong>{{planName}}</strong> subscription has expired on {{expirationDate}}.</p>
          <p>To continue enjoying our services, please renew your subscription:</p>
          <p><a href="{{renewalUrl}}" style="background-color: #007cba; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Renew Subscription</a></p>
          <p>If you have any questions, please contact our support team.</p>
          <p>Best regards,<br>The {{appName}} Team</p>
        `,
        textContent: `
Subscription Expired

Hi {{userName}},

Your {{planName}} subscription has expired on {{expirationDate}}.

To continue enjoying our services, please renew your subscription:
{{renewalUrl}}

If you have any questions, please contact our support team.

Best regards,
The {{appName}} Team
        `,
        variables: ['userName', 'planName', 'expirationDate', 'renewalUrl', 'appName'],
      },
    ];

    const results = [];
    for (const template of templates) {
      try {
        // Check if template already exists
        try {
          await this.getTemplate(template.name);
          results.push({ template: template.name, action: 'exists' });
        } catch {
          // Create template if it doesn't exist
          await this.createTemplate(template);
          results.push({ template: template.name, action: 'created' });
        }
      } catch (error: any) {
        results.push({ template: template.name, action: 'error', error: error.message });
      }
    }

    return results;
  }
}
