# PocketBase Super Admin Authentication Tool

## Overview

The `pocketbase_super_admin_auth` tool enables runtime authentication as a PocketBase super admin, unlocking admin-level operations that are typically restricted in production environments.

## Purpose

This tool addresses the common scenario where:
- Basic data operations (CRUD on records) work fine
- Admin operations (schema changes, collection management) are restricted
- You need to perform admin tasks programmatically rather than through the PocketBase admin UI

## Usage

### Basic Usage with Environment Credentials

If your environment variables `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` are configured:

```javascript
{
  "tool": "pocketbase_super_admin_auth",
  "arguments": {}
}
```

### Runtime Credentials

To authenticate with specific credentials (overriding environment variables):

```javascript
{
  "tool": "pocketbase_super_admin_auth",
  "arguments": {
    "email": "admin@example.com",
    "password": "your-super-admin-password"
  }
}
```

## What This Tool Does

1. **Authentication Test**: Attempts to authenticate using the `_superusers` collection
2. **Session Update**: Updates the internal PocketBase instance with the admin session
3. **Capability Testing**: Tests what operations are available before and after authentication
4. **Comprehensive Reporting**: Provides detailed feedback on the authentication process

## Response Format

```javascript
{
  "timestamp": "2025-01-01T12:00:00.000Z",
  "success": true,
  "operation": "super_admin_auth",
  "message": "Successfully authenticated as super admin",
  "details": {
    "credentialsSource": "provided_parameters|environment_variables",
    "authenticationAttempted": true,
    "sessionUpdated": true,
    "previousAuth": {
      "wasAuthenticated": false,
      "lastAuthTime": null,
      "authAge": null
    }
  },
  "capabilities": {
    "beforeAuth": [
      "List Collections (3 found)"
    ],
    "afterAuth": [
      "List Collections (8 found)",
      "Create Collections: SUCCESS",
      "Delete Collections: SUCCESS",
      "Manage Admin Users (2 found)"
    ]
  },
  "hint": "Admin authentication successful! You can now perform admin-level operations..."
}
```

## After Successful Authentication

Once authenticated, subsequent operations in the same session will have admin privileges:

- **Collection Management**: Create, update, delete collections
- **Schema Changes**: Modify collection schemas, add/remove fields
- **User Management**: Manage admin users and authentication settings
- **System Settings**: Access to PocketBase system configuration

## Error Scenarios

### Missing Credentials
```javascript
{
  "success": false,
  "message": "Admin credentials not available",
  "hint": "Provide email and password parameters, or set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD environment variables"
}
```

### Authentication Failed
```javascript
{
  "success": false,
  "message": "Super admin authentication failed",
  "hint": "Invalid admin credentials (Network connectivity issue)"
}
```

### Production Restrictions
```javascript
{
  "success": false,
  "message": "Super admin authentication failed",
  "hint": "Admin authentication is disabled or restricted (This may be a security restriction in production environments)"
}
```

## Security Considerations

1. **Credential Safety**: Avoid hardcoding credentials. Use environment variables when possible.
2. **Session Persistence**: The admin session persists within the Durable Object until it expires or is reset.
3. **Production Environments**: Some PocketBase deployments may disable admin API access for security.
4. **Audit Trail**: All authentication attempts are logged for security monitoring.

## Integration with Other Tools

After successful super admin authentication, these tools become available:

- Collection creation and management
- Schema modifications  
- User and authentication management
- System configuration changes

## Troubleshooting

### Common Issues

1. **403 Forbidden**: Admin authentication may be disabled in production
2. **404 Not Found**: The `_superusers` collection may not be accessible
3. **400 Bad Request**: Invalid credentials provided
4. **Network Errors**: Connectivity issues with PocketBase server

### Diagnostic Steps

1. Use `debug_pocketbase_auth` to test basic connectivity
2. Use `check_pocketbase_write_permissions` to test current permissions
3. Use `analyze_pocketbase_capabilities` to understand the security model
4. Then use `pocketbase_super_admin_auth` to elevate permissions

## Best Practices

1. **Test Environment First**: Verify admin credentials work in a development environment
2. **Handle Failures Gracefully**: Check the response and provide user-friendly error messages
3. **Document Restrictions**: Note any production limitations in your application documentation
4. **Use Environment Variables**: Store credentials securely using environment variables
5. **Session Management**: Re-authenticate if operations start failing due to session expiry

## Example Workflow

```javascript
// Step 1: Check current capabilities
const capabilities = await callTool("analyze_pocketbase_capabilities", {});

// Step 2: If admin operations are restricted, authenticate as super admin
if (capabilities.capabilities.adminOperations.restricted.length > 0) {
  const authResult = await callTool("pocketbase_super_admin_auth", {
    "email": "admin@example.com",
    "password": "secure-password"
  });
  
  if (authResult.success) {
    console.log("Admin access granted:", authResult.capabilities.afterAuth);
    
    // Step 3: Now perform admin operations
    const newCollection = await callTool("pocketbase_create_collection", {
      "name": "my_new_collection",
      "schema": {...}
    });
  } else {
    console.error("Admin authentication failed:", authResult.hint);
  }
}
```

This tool bridges the gap between restricted production environments and the need for programmatic admin operations, providing a secure and auditable way to perform administrative tasks when necessary.
