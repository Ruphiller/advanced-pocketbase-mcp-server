# PocketBase API Compatibility Layer

This document describes the comprehensive PocketBase API compatibility layer that has been added to the MCP server, providing full access to PocketBase REST API endpoints through MCP tools and resources.

## 🚀 Overview

The MCP server now includes a complete compatibility layer that mirrors the official PocketBase REST API, allowing you to:

- Make direct API calls to any PocketBase endpoint
- Access all CRUD operations with full parameter support
- Handle authentication flows (password, OTP, OAuth2)
- Manage collections and admin operations
- Work with files and batch operations
- Access real-time subscription information

## 📋 Added Tools and Resources

### 🔧 Core API Tools

#### **Generic API Proxy**
- **`api_request`** - Make direct HTTP requests to any PocketBase endpoint
  - Supports GET, POST, PATCH, DELETE methods
  - Automatic authentication header injection
  - Query parameters and request body support
  - Custom headers support

#### **Record Operations (CRUD)**
- **`list_records_api`** - GET `/api/collections/{collection}/records`
  - Full pagination support (page, perPage, skipTotal)
  - Advanced filtering with PocketBase syntax
  - Sorting with multiple fields and directions
  - Relation expansion and field selection
  
- **`get_full_list_api`** - Get all records across multiple pages
  - Automatic batching for large datasets
  - Same filtering and expansion capabilities
  
- **`get_first_list_item_api`** - Get first record matching criteria
  - Optimized for finding specific records
  
- **`get_record_api`** - GET `/api/collections/{collection}/records/{id}`
  - Single record retrieval by ID
  - Relation expansion and field selection
  
- **`update_record_api`** - PATCH `/api/collections/{collection}/records/{id}`
  - Update existing records
  - Partial updates supported
  
- **`delete_record_api`** - DELETE `/api/collections/{collection}/records/{id}`
  - Safe record deletion

#### **Authentication Operations**
- **`list_auth_methods_api`** - GET available auth methods
- **`auth_with_password_api`** - POST email/password authentication
- **`request_otp_api`** - POST request one-time password
- **`auth_with_otp_api`** - POST authenticate with OTP
- **`auth_refresh_api`** - POST refresh authentication token
- **`request_password_reset_api`** - POST password reset request
- **`confirm_password_reset_api`** - POST confirm password reset
- **`request_verification_api`** - POST email verification request
- **`confirm_verification_api`** - POST confirm email verification

#### **Collection Management**
- **`list_collections_api`** - GET `/api/collections`
- **`get_collection_api`** - GET `/api/collections/{id}`

#### **Batch Operations**
- **`batch_records_api`** - Batch create/update/delete operations
  - Atomic or non-atomic modes
  - Multiple operations in single call
  - Comprehensive error handling

#### **File Handling**
- **`get_file_url_api`** - Generate file URLs
  - Thumbnail support
  - File validation
  - Record field association

#### **Advanced Querying**
- **`build_filter_expression`** - Safe filter expression builder
  - Prevents injection attacks
  - Supports all PocketBase operators
  - Logical connectors (AND/OR)
  
- **`advanced_query_builder`** - Complex query construction
  - Multiple filter conditions
  - Multi-field sorting
  - Grouping capabilities
  - Relation expansion

#### **Utility Tools**
- **`health_check_api`** - GET `/api/health`
- **`realtime_subscription_info`** - WebSocket connection info

### 🌐 Dynamic Resources

#### **API Proxy Resource**
- **`pocketbase-api://{method}/{path...}`** - Dynamic API access
  - Access any PocketBase endpoint as a resource
  - Automatic authentication
  - Real-time responses

#### **API Documentation Resource**
- **`pocketbase-api://documentation`** - Live API documentation
  - Auto-generated from actual collections
  - Real-time endpoint discovery
  - Authentication status
  - Example URLs and parameters
  - MCP tool mappings

## 🎯 Key Features

### **Full REST API Coverage**
- **Records**: Complete CRUD operations with all query parameters
- **Authentication**: All auth methods (password, OTP, OAuth2 info)
- **Collections**: Management and schema access
- **Files**: URL generation and file handling
- **Admin**: Collection management and settings (admin auth required)
- **Utility**: Health checks and system info

### **Advanced Query Support**
- Complex filtering with PocketBase syntax
- Multi-field sorting with directions
- Relation expansion (populate related records)
- Field selection for optimized responses
- Pagination with skip total for performance
- Batch operations for bulk changes

### **Security & Authentication**
- Automatic token injection when authenticated
- Secure filter expression building
- Request validation and error handling
- Support for all PocketBase auth methods

### **Developer Experience**
- Type-safe parameters with validation
- Comprehensive error messages
- Example usage in documentation
- Real-time API discovery
- Full parameter documentation

## 📖 Usage Examples

### Basic Record Operations
```javascript
// List users with filtering and sorting
list_records_api({
  collection: "users", 
  filter: "verified = true && created >= '2024-01-01'",
  sort: "-created,+name",
  expand: "profile,roles",
  page: 1,
  perPage: 50
})

// Get specific user
get_record_api({
  collection: "users",
  id: "user123",
  expand: "profile,roles"
})

// Update user
update_record_api({
  collection: "users",
  id: "user123", 
  data: { name: "John Doe", verified: true }
})
```

### Authentication
```javascript
// Login with email/password
auth_with_password_api({
  collection: "users",
  identity: "user@example.com",
  password: "password123"
})

// Request OTP
request_otp_api({
  collection: "users",
  email: "user@example.com"
})

// Authenticate with OTP
auth_with_otp_api({
  collection: "users",
  otpId: "otp_id_from_request",
  password: "123456"
})
```

### Advanced Queries
```javascript
// Complex filtering
advanced_query_builder({
  collection: "posts",
  filters: [
    { field: "published", operator: "=", value: true, connector: "AND" },
    { field: "created", operator: ">=", value: "2024-01-01", connector: "AND" },
    { field: "category", operator: "~", value: "tech" }
  ],
  sort_fields: [
    { field: "featured", direction: "DESC" },
    { field: "created", direction: "DESC" }
  ],
  relations: ["author", "category"],
  pagination: { page: 1, perPage: 20 }
})
```

### Direct API Access
```javascript
// Make any API call
api_request({
  method: "GET",
  path: "/api/collections/posts/records",
  queryParams: {
    filter: "published = true",
    sort: "-created",
    expand: "author"
  }
})
```

### Batch Operations
```javascript
// Batch create/update multiple records
batch_records_api({
  collection: "products",
  requests: [
    { method: "POST", data: { name: "Product 1", price: 10 } },
    { method: "POST", data: { name: "Product 2", price: 20 } },
    { method: "PATCH", id: "existing_id", data: { price: 15 } }
  ],
  atomic: true
})
```

## 🔗 Resources Access

### API Documentation
Access live API documentation:
```
pocketbase-api://documentation
```

### Dynamic Endpoint Access
Access any endpoint directly:
```
pocketbase-api://GET/collections/users/records
pocketbase-api://POST/collections/users/auth-with-password
```

## 🎉 Benefits

1. **Complete API Coverage**: Access to all PocketBase REST endpoints
2. **Type Safety**: Full TypeScript validation for all parameters
3. **Developer Friendly**: Rich documentation and examples
4. **Performance Optimized**: Efficient query building and batch operations
5. **Security First**: Safe filter building and automatic authentication
6. **Real-time Discovery**: Dynamic endpoint and schema discovery
7. **Backward Compatible**: All existing MCP tools remain unchanged

This compatibility layer transforms your MCP server into a comprehensive PocketBase API gateway while maintaining all the enhanced SaaS development features and analytics capabilities.
