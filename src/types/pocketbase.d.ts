// Type definitions for PocketBase JavaScript SDK v0.26.1
declare module 'pocketbase' {
  export interface CollectionModel {
    id: string;
    name: string;
    schema?: SchemaField[];
    type: string;
    system: boolean;
    listRule?: string | null;
    viewRule?: string | null;
    createRule?: string | null;
    updateRule?: string | null;
    deleteRule?: string | null;
    created: string;
    updated: string;
    [key: string]: any;
  }

  export interface SchemaField {
    name: string;
    type: string;
    required: boolean;
    options?: Record<string, any>;
    system?: boolean;
  }

  export interface CollectionResponse<T = Record<string, any>> {
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
    items: T[];
  }

  export interface AuthData {
    token: string;
    record: Record<string, any>;
    meta?: Record<string, any>;
  }

  export interface AuthMethodsList {
    mfa: {
      enabled: boolean;
      duration: number;
    };
    otp: {
      enabled: boolean;
      duration: number;
    };
    password: {
      enabled: boolean;
      identityFields: Array<string>;
    };
    oauth2: {
      enabled: boolean;
      providers: Array<{
        name: string;
        displayName: string;
        state: string;
        authURL: string;
        codeVerifier: string;
        codeChallenge: string;
        codeChallengeMethod: string;
      }>;
    };
  }

  export interface CollectionService {
    create(data: Partial<CollectionModel>): Promise<CollectionModel>;
    getOne(idOrName: string, options?: any): Promise<CollectionModel>;
    getList(page?: number, perPage?: number, options?: any): Promise<CollectionResponse<CollectionModel>>;
    getFullList(options?: any): Promise<CollectionModel[]>;
    getFirstListItem(filter: string, options?: any): Promise<CollectionModel>;
    update(idOrName: string, data: Partial<CollectionModel>): Promise<CollectionModel>;
    delete(idOrName: string): Promise<boolean>;
    truncate(idOrName: string, options?: any): Promise<boolean>;
  }

  export interface RecordService {
    create(data: Record<string, any>, options?: any): Promise<Record<string, any>>;
    getList(page?: number, perPage?: number, options?: any): Promise<CollectionResponse>;
    getFullList(options?: any): Promise<Record<string, any>[]>;
    getOne(id: string, options?: any): Promise<Record<string, any>>;
    getFirstListItem(filter: string, options?: any): Promise<Record<string, any>>;
    update(id: string, data: Record<string, any>, options?: any): Promise<Record<string, any>>;
    delete(id: string, options?: any): Promise<boolean>;
    
    // Auth methods
    listAuthMethods(options?: any): Promise<AuthMethodsList>;
    authWithPassword(usernameOrEmail: string, password: string, options?: any): Promise<AuthData>;
    authWithOTP(otpId: string, password: string, options?: any): Promise<AuthData>;
    authWithOAuth2Code(
      provider: string,
      code: string,
      codeVerifier: string,
      redirectUrl: string,
      createData?: Record<string, any>,
      options?: any
    ): Promise<AuthData>;
    authRefresh(options?: any): Promise<AuthData>;
    requestOTP(email: string, options?: any): Promise<{ otpId: string }>;
    requestVerification(email: string, options?: any): Promise<boolean>;
    confirmVerification(token: string, options?: any): Promise<boolean>;
    requestPasswordReset(email: string, options?: any): Promise<boolean>;
    confirmPasswordReset(
      token: string,
      password: string,
      passwordConfirm: string,
      options?: any
    ): Promise<boolean>;
    requestEmailChange(newEmail: string, options?: any): Promise<boolean>;
    confirmEmailChange(
      token: string,
      password: string,
      options?: any
    ): Promise<AuthData>;
    listExternalAuths(recordId: string, options?: any): Promise<any[]>;
    unlinkExternalAuth(recordId: string, provider: string, options?: any): Promise<boolean>;
    impersonate(recordId: string, duration?: number, options?: any): Promise<any>;

    // Realtime methods
    subscribe(topic: string, callback: (data: any) => void, options?: any): Promise<() => void>;
    unsubscribe(topic?: string): Promise<void>;
  }

  export interface FileService {
    getURL(record: Record<string, any>, filename: string, options?: any): string;
    getToken(options?: any): Promise<{ token: string }>;
  }

  export interface HealthService {
    check(options?: any): Promise<{ status: string; version: string }>;
  }

  export interface RealtimeService {
    subscribe(topic: string, callback: (data: any) => void, options?: any): Promise<() => void>;
    unsubscribe(topic?: string): Promise<void>;
    unsubscribeByPrefix(topicPrefix: string): Promise<void>;
    unsubscribeByTopicAndListener(topic: string, callback: (data: any) => void): Promise<void>;
    isConnected: boolean;
    onDisconnect?: (activeSubscriptions: any) => void;
  }

  export interface AuthStore {
    token: string;
    record: Record<string, any> | null;
    isValid: boolean;
    isSuperuser: boolean;
    clear(): void;
    save(token: string, record: Record<string, any>): void;
    onChange(callback: (token: string, record: Record<string, any>) => void, fireImmediately?: boolean): () => void;
    loadFromCookie(cookieHeader: string, key?: string): void;
    exportToCookie(options?: any, key?: string): string;
  }

  export default class PocketBase {
    constructor(baseUrl?: string, authStore?: any);
    
    baseUrl: string;
    authStore: AuthStore;
    
    collections: CollectionService;
    files: FileService;
    health: HealthService;
    realtime: RealtimeService;
    
    collection(name: string): RecordService;
    
    filter(expr: string, params: Record<string, any>): string;
    
    autoCancellation(enable: boolean): PocketBase;
    cancelAllRequests(): PocketBase;
    cancelRequest(requestKey: string): PocketBase;
    
    send(path: string, options?: any): Promise<any>;
    buildURL(path: string): string;
    
    beforeSend?: (url: string, options: any) => { url: string; options: any };
    afterSend?: (response: Response, data: any) => any;
  }
}
