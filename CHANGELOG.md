# PocketBase MCP Server - Changelog

## Version 3.0.0 - SDK Compatibility Update (June 11, 2025)

### ✅ **COMPLETED UPDATES**

#### **Type Definitions Overhaul**
- **Completely rewrote** `src/types/pocketbase.d.ts` to match actual PocketBase JavaScript SDK v0.26.1
- **Removed incompatible features** that don't exist in current SDK version:
  - `createBatch()`, `collections.import()`, `collections.getScaffolds()`
  - Non-existent `files`, `health` service methods
  - `listExternalAuths()`, `unlinkExternalAuth()` realtime methods that were incorrectly implemented
- **Added correct interfaces** for all available SDK features:
  - `CollectionService`, `RecordService`, `FileService`, `HealthService`, `RealtimeService`
  - `AuthStore`, `AuthData`, `AuthMethodsList`
  - Proper method signatures matching actual SDK

#### **Authentication Method Fixes**
- **Fixed `authenticate_with_otp`** to use correct `requestOTP()` method for initiating OTP flow
- **Updated `authenticate_with_oauth2`** to use `authWithOAuth2Code()` with proper parameter structure
- **Corrected method casing** from `authWithOtp` to `authWithOTP` to match SDK
- **Fixed AuthStore references** from deprecated `model` property to correct `record` property

#### **Tool Registration Compatibility**
- **Removed batch operation tools** that relied on non-existent `createBatch()` API
- **Replaced with sequential execution** for better compatibility with current SDK
- **Updated all tool implementations** to use actual available SDK methods
- **Fixed ExtendedPocketBase interface** issues by using standard PocketBase type directly

#### **SDK Feature Alignment**
- **Updated all method calls** to match actual PocketBase v0.26.1 API rather than hypothetical future features
- **Ensured compatibility** with real SDK capabilities rather than assumed functionality
- **Maintained all working features** while removing incompatible ones

### **What Works Now**
✅ **Core CRUD Operations** - Create, read, update, delete records  
✅ **Collection Management** - List, create, update collections  
✅ **Authentication** - Password, OAuth2, OTP authentication  
✅ **Real-time Subscriptions** - Subscribe to collection changes  
✅ **File Operations** - Upload, download, URL generation  
✅ **Advanced Features** - Stripe integration, email services  
✅ **Type Safety** - Full TypeScript support with correct types  

### **What Was Removed**
❌ **Batch Operations API** - Not available in current SDK  
❌ **Collection Import/Export** - Not available in current SDK  
❌ **Collection Scaffolds** - Not available in current SDK  
❌ **Advanced Auth Management** - Some methods not available  

### **SDK Versions**
- **MCP TypeScript SDK**: v1.12.1 ✅  
- **PocketBase JavaScript SDK**: v0.26.1 ✅  
- **TypeScript**: Latest ✅  

### **Breaking Changes**
- Removed tools that used non-existent SDK methods
- Changed batch operations to sequential execution
- Updated authentication method signatures
- Fixed type definitions to match actual SDK

### **Migration Notes**
If you were using:
- `execute_batch_operations` → Now executes sequentially instead of as a batch
- `get_collection_scaffolds` → Removed (not available in SDK)
- `import_collections` → Removed (not available in SDK)
- Any auth store `.model` references → Now uses `.record`

### **Future Considerations**
- Monitor PocketBase SDK updates for new batch operation APIs
- Watch for collection import/export features in future releases
- Consider community contributions for advanced features
- Maintain compatibility with stable SDK releases

---

**Status**: ✅ **COMPLETED** - PocketBase MCP Server now fully compatible with actual SDK v0.26.1  
**Next Steps**: Regular testing and monitoring for SDK updates
