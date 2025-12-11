/**
 * Repository adapter interface for different source types
 */

import { Bundle, SourceMetadata, ValidationResult, RegistrySource } from '../types/registry';

/**
 * Base interface for repository adapters
 * Each source type (GitHub, GitLab, HTTP, Local) implements this interface
 */
export interface IRepositoryAdapter {
    /**
     * The type of repository this adapter handles
     */
    readonly type: string;

    /**
     * The source configuration
     */
    readonly source: RegistrySource;

    /**
     * Fetch list of available bundles from the source
     * @returns Promise with array of bundles
     */
    fetchBundles(): Promise<Bundle[]>;

    /**
     * Download a specific bundle
     * @param bundle Bundle to download
     * @returns Promise with buffer containing bundle data
     */
    downloadBundle(bundle: Bundle): Promise<Buffer>;

    /**
     * Fetch metadata about the source
     * @returns Promise with source metadata
     */
    fetchMetadata(): Promise<SourceMetadata>;

    /**
     * Validate that the repository is accessible
     * @returns Promise with validation result
     */
    validate(): Promise<ValidationResult>;

    /**
     * Check if source requires authentication
     * @returns True if authentication is required
     */
    requiresAuthentication(): boolean;

    /**
     * Get the raw manifest URL for a bundle
     * @param bundleId Bundle identifier
     * @param version Optional version (defaults to latest)
     * @returns Manifest URL
     */
    getManifestUrl(bundleId: string, version?: string): string;

    /**
     * Get the download URL for a bundle
     * @param bundleId Bundle identifier
     * @param version Optional version (defaults to latest)
     * @returns Download URL
     */
    getDownloadUrl(bundleId: string, version?: string): string;

    /**
     * Force re-authentication for the source
     * Useful when token expires or user wants to switch accounts
     */
    forceAuthentication?(): Promise<void>;
}

/**
 * Base abstract class with common adapter functionality
 */
export abstract class RepositoryAdapter implements IRepositoryAdapter {
    abstract readonly type: string;
    
    constructor(public readonly source: RegistrySource) {}

    abstract fetchBundles(): Promise<Bundle[]>;
    abstract downloadBundle(bundle: Bundle): Promise<Buffer>;
    abstract fetchMetadata(): Promise<SourceMetadata>;
    abstract validate(): Promise<ValidationResult>;
    abstract getManifestUrl(bundleId: string, version?: string): string;
    abstract getDownloadUrl(bundleId: string, version?: string): string;

    /**
     * Force re-authentication
     * Default implementation does nothing
     */
    async forceAuthentication(): Promise<void> {
        // Default implementation does nothing
        return Promise.resolve();
    }

    /**
     * Check if source requires authentication
     */
    requiresAuthentication(): boolean {
        return this.source.private === true;
    }

    /**
     * Get authentication token from source config
     * @returns Token or undefined
     */
    protected getAuthToken(): string | undefined {
        return this.source.token;
    }

    /**
     * Create common HTTP headers for requests
     * @returns Headers object
     */
    protected getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'User-Agent': 'Prompt-Registry-VSCode-Extension/1.0',
            'Accept': 'application/json',
        };

        const token = this.getAuthToken();
        if (token && this.requiresAuthentication()) {
            headers['Authorization'] = `token ${token}`;
        }

        return headers;
    }

    /**
     * Handle HTTP errors
     * @param response HTTP response
     * @param context Error context
     */
    protected async handleHttpError(response: any, context: string): Promise<never> {
        const statusText = response.statusText || 'Unknown';
        const body = await response.text?.().catch(() => '') || '';
        
        throw new Error(
            `${context}: HTTP ${response.status} ${statusText}. ${body ? 'Details: ' + body : ''}`
        );
    }

    /**
     * Validate URL format
     * @param url URL to validate
     * @returns True if valid
     */
    protected isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Adapter constructor type
 */
type AdapterConstructor = new (source: RegistrySource) => IRepositoryAdapter;

/**
 * Factory for creating repository adapters
 */
export class RepositoryAdapterFactory {
    private static adapters = new Map<string, AdapterConstructor>();

    /**
     * Register an adapter type
     * @param type Source type
     * @param adapterClass Adapter class constructor
     */
    static register(type: string, adapterClass: AdapterConstructor): void {
        this.adapters.set(type, adapterClass);
    }

    /**
     * Create adapter for a source
     * @param source Registry source
     * @returns Repository adapter instance
     */
    static create(source: RegistrySource): IRepositoryAdapter {
        const AdapterClass = this.adapters.get(source.type);
        
        if (!AdapterClass) {
            throw new Error(`No adapter registered for source type: ${source.type}`);
        }

        return new AdapterClass(source);
    }

    /**
     * Check if adapter is available for type
     * @param type Source type
     * @returns True if adapter exists
     */
    static hasAdapter(type: string): boolean {
        return this.adapters.has(type);
    }

    /**
     * Get all registered adapter types
     * @returns Array of adapter types
     */
    static getRegisteredTypes(): string[] {
        return Array.from(this.adapters.keys());
    }
}
