# Security Policy

## Supported Versions

We support security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 3.x.x   | ✅ Active support  |
| 2.x.x   | ⚠️ Critical fixes only |
| < 2.0   | ❌ No longer supported |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please follow these steps:

### 🚨 For Critical Security Issues

**DO NOT** create a public GitHub issue for security vulnerabilities.

Instead, please:
1. **Email us privately** at [your-security-email@domain.com] with details
2. Include "SECURITY" in the subject line
3. Provide a detailed description of the vulnerability
4. Include steps to reproduce (if applicable)
5. Suggest a fix (if you have one)

### 📋 What to Include

Please include the following information:
- **Description** of the vulnerability
- **Impact** assessment (who is affected, how severe)
- **Steps to reproduce** the vulnerability
- **Proof of concept** code (if applicable)
- **Suggested fix** or mitigation
- **Your contact information** for follow-up

### ⏱️ Response Timeline

We will acknowledge your report within **48 hours** and provide a detailed response within **7 days** indicating:
- Confirmation of the vulnerability
- Our planned timeline for a fix
- Any immediate workarounds or mitigations

### 🛡️ Security Considerations for Contributors

When contributing to this project, please consider:

#### API Keys and Secrets
- Never commit API keys, tokens, or secrets
- Use environment variables for sensitive configuration
- Review `.env.example` for required variables
- Ensure `.env` files are in `.gitignore`

#### Input Validation
- All user inputs must be validated with Zod schemas
- Sanitize data before database operations
- Validate webhook signatures (especially Stripe)
- Use parameterized queries for database operations

#### Authentication & Authorization
- Properly validate PocketBase authentication tokens
- Implement proper error handling without exposing sensitive info
- Use secure defaults for all configuration options
- Follow principle of least privilege

#### Third-Party Services
- Verify SSL/TLS for all external API calls
- Implement proper timeout and retry logic
- Handle rate limiting appropriately
- Store credentials securely

#### Common Vulnerabilities to Avoid
- **SQL Injection**: Use PocketBase's built-in query builders
- **XSS**: Sanitize any user-generated content
- **CSRF**: Validate webhook signatures and tokens
- **Information Disclosure**: Don't log sensitive data
- **Insecure Dependencies**: Keep dependencies updated

### 🔒 Security Best Practices for Users

#### Environment Configuration
```env
# Use strong, unique values
POCKETBASE_ADMIN_PASSWORD=use-a-strong-password
STRIPE_SECRET_KEY=sk_test_... # Use test keys for development
STRIPE_WEBHOOK_SECRET=whsec_... # Required for webhook security

# Restrict access
POCKETBASE_URL=http://localhost:8090 # Don't expose publicly without auth
```

#### PocketBase Security
- Use strong admin passwords
- Enable HTTPS in production
- Configure proper CORS settings
- Regularly backup your database
- Keep PocketBase updated

#### Stripe Security
- Use environment-specific API keys
- Validate all webhook signatures
- Never expose secret keys in client-side code
- Monitor for suspicious activity
- Use Stripe's test mode for development

#### Email Security
- Use app-specific passwords for SMTP
- Configure SPF, DKIM, and DMARC records
- Validate email addresses before sending
- Implement rate limiting for email sending
- Monitor for bounce rates and spam reports

### 🚨 Known Security Considerations

#### MCP Protocol
- MCP servers have access to sensitive operations
- Ensure proper authentication between client and server
- Validate all tool parameters thoroughly
- Limit access to production environments

#### Service Integrations
- **Stripe**: Webhook endpoints should validate signatures
- **Email**: SMTP credentials should be stored securely
- **PocketBase**: Admin tokens should be protected
- **External APIs**: Rate limiting and timeout handling

### 📊 Security Monitoring

We recommend monitoring for:
- Failed authentication attempts
- Unusual API usage patterns
- Webhook signature validation failures
- Database access anomalies
- Email sending volume spikes

### 🔄 Security Updates

- Security patches will be released as soon as possible
- Critical vulnerabilities will be disclosed after fixes are available
- Users will be notified via GitHub releases and security advisories
- Changelogs will clearly mark security-related changes

### 🏆 Security Recognition

We appreciate security researchers who help improve our project:
- Responsible disclosure will be acknowledged in release notes
- Severe vulnerabilities may be eligible for recognition
- We welcome collaboration on security improvements

### 📞 Contact Information

- **Security Email**: [your-security-email@domain.com]
- **General Issues**: GitHub Issues (for non-security bugs)
- **Discussions**: GitHub Discussions

### 🔗 Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Stripe Security Best Practices](https://stripe.com/docs/security)
- [PocketBase Security](https://pocketbase.io/docs/going-to-production/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

---

**Thank you for helping keep Advanced PocketBase MCP Server secure!** 🔒
