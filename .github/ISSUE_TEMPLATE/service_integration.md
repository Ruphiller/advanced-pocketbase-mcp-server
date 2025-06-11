---
name: New Service Integration
about: Propose adding support for a new service (like Twilio, AWS, etc.)
title: '[SERVICE] Add support for [SERVICE_NAME]'
labels: enhancement, service-integration
assignees: ''

---

**Service Information**
- **Service Name**: [e.g., Twilio, AWS SES, Mailgun, etc.]
- **Service Website**: [URL]
- **API Documentation**: [URL to API docs]
- **Service Category**: [Email, SMS, Cloud Storage, Analytics, etc.]

**Why this service?**
Explain why this service would be valuable to add:

**Use Cases**
Describe specific use cases where this service would be helpful:
1. 
2. 
3. 

**API Features to Support**
List the main API features/endpoints that should be supported:
- [ ] Feature 1 (description)
- [ ] Feature 2 (description)
- [ ] Feature 3 (description)

**Integration Requirements**
- **Authentication**: [API Key, OAuth, Token, etc.]
- **Rate Limits**: [if known]
- **Webhooks**: [Does the service support webhooks?]
- **SDK Available**: [Is there an official Node.js SDK?]

**Proposed MCP Tools**
Suggest what MCP tools should be created (following the existing naming pattern):
- `servicename_action_name` - Description
- `servicename_action_name` - Description

**Configuration**
What environment variables or configuration would be needed?
```env
SERVICE_API_KEY=
SERVICE_REGION=
# etc.
```

**Similar Services**
Are there similar services already supported? How would this differ?

**Implementation Complexity**
Rate the expected complexity:
- [ ] Simple (REST API, basic auth)
- [ ] Medium (OAuth, webhooks)
- [ ] Complex (custom protocols, complex auth flows)

**Community Benefit**
How would this service benefit the broader SaaS/development community?

**Alternatives Considered**
Have you considered using existing services or workarounds?

**Additional Resources**
- Links to service documentation
- Example implementations
- Community requests for this service

**Checklist**
- [ ] I have researched the service API and capabilities
- [ ] I have identified specific use cases and benefits
- [ ] I have checked that this service isn't already supported
- [ ] I understand this would require significant development effort
- [ ] I am willing to help test the implementation if developed
