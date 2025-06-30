#!/usr/bin/env node
declare class PocketBaseServer {
    private server;
    private pb?;
    private _customHeaders;
    private _realtimeSubscriptions;
    private stripeService?;
    private emailService?;
    private initializationState;
    private discoveryMode;
    private configuration?;
    private initializationPromise;
    constructor();
    /**
     * Load configuration from environment variables or provided config
     * This is fast and synchronous for discovery purposes
     */
    private loadConfiguration;
    /**
     * Fast synchronous check for valid configuration
     * Used during discovery phase
     */
    private hasValidConfig;
    /**
     * Initialize PocketBase client and services
     * This is called lazily when tools/resources are first accessed
     */
    private initializePocketBase;
    /**
     * Initialize additional services (Stripe, Email)
     */
    private initializeServices;
    /**
     * Authenticate with PocketBase (runtime authentication)
     * This is separate from configuration checking
     */
    private authenticatePocketBase;
    /**
     * Ensure PocketBase is initialized and optionally authenticated
     * This is the main function called by tools and resources
     *
     * Refactored for fully lazy initialization:
     * - Server startup does not block on PocketBase connection.
     * - Initialization only occurs when a tool requiring it is invoked and config is present.
     * - Prevents startup timeouts during Smithery tool scanning.
     */
    private ensureInitialized;
    private doInitialization;
    /**
     * Standardized error handling for tools and resources
     * Provides consistent error categorization and user-friendly messages
     */
    private handleError;
    /**
     * Create a standardized error response for MCP tools
     */
    private createErrorResponse;
    /**
     * Create a standardized success response for MCP tools
     */
    private createSuccessResponse;
    private setupPrompts;
    private setupResources;
    private analyzeFieldTypes;
    private analyzeSecurityLevel;
    private analyzeRelationships;
    private checkBidirectional;
    private generateIndexRecommendations;
    private analyzeNamingConventions;
    private analyzeSecurityPractices;
    private generatePerformanceTips;
    private generateDataModelingSuggestions;
    private calculateHealthScore;
    private setupTools;
    private evaluateCondition;
    private executeRuleAction;
    private executeWorkflowStep;
    private applyFilter;
    private applyAggregation;
    private applyMapping;
    private processMetrics;
    private processGroupedMetrics;
    private formatAsCSV;
    private parseSmitheryConfig;
    private formatAsPDF;
    run(): Promise<void>;
    runSSE(port?: number, host?: string, corsOrigin?: string): Promise<void>;
    runHTTP(port?: number, host?: string, corsOrigin?: string): Promise<void>;
    private setupShutdownHandlers;
    runHttp(port?: number): Promise<void>;
}
export default PocketBaseServer;
export { PocketBaseServer };
