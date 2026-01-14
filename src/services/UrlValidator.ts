/**
 * URL Validator Service
 * Validates URL accessibility for hub sources
 */

import * as https from 'https';
import * as http from 'http';
import { Logger } from '../utils/logger';

/**
 * Result of URL accessibility check
 */
export interface UrlCheckResult {
    /** The URL that was checked */
    url: string;
    
    /** Whether the URL is accessible */
    accessible: boolean;
    
    /** HTTP status code if available */
    statusCode?: number;
    
    /** Error message if check failed */
    error?: string;
    
    /** Severity level: error for broken links, warning for private repos, success for accessible */
    severity: 'error' | 'warning' | 'success';
    
    /** Human-readable message describing the result */
    message: string;
}

/**
 * Service for validating URL accessibility
 * Distinguishes between broken links (errors) and inaccessible/private repos (warnings)
 */
export class UrlValidator {
    private logger: Logger;
    private readonly defaultTimeout: number = 10000; // 10 seconds

    constructor() {
        this.logger = Logger.getInstance();
    }

    /**
     * Check URL accessibility
     * 
     * Returns:
     * - severity: 'error' for 404, DNS failures, timeouts, malformed URLs
     * - severity: 'warning' for 401/403 (private repos)
     * - severity: 'success' for 2xx responses
     * 
     * @param url URL to check
     * @param timeout Timeout in milliseconds (default: 10000)
     * @returns URL check result with severity and message
     */
    async checkUrl(url: string, timeout: number = this.defaultTimeout): Promise<UrlCheckResult> {
        try {
            // Validate URL format first
            let parsedUrl: URL;
            try {
                parsedUrl = new URL(url);
            } catch (error) {
                return {
                    url,
                    accessible: false,
                    severity: 'error',
                    error: 'Invalid URL format',
                    message: 'Invalid URL format'
                };
            }

            // Only support HTTP/HTTPS
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                return {
                    url,
                    accessible: false,
                    severity: 'error',
                    error: 'Unsupported protocol',
                    message: `Unsupported protocol: ${parsedUrl.protocol}. Only HTTP/HTTPS supported`
                };
            }

            // Make the request
            const response = await this.makeRequest(url, timeout);

            // Success: 2xx status codes
            if (response.statusCode >= 200 && response.statusCode < 300) {
                return {
                    url,
                    accessible: true,
                    statusCode: response.statusCode,
                    severity: 'success',
                    message: 'Accessible'
                };
            }

            // Warning: 401/403 are expected for private repos
            if (response.statusCode === 401 || response.statusCode === 403) {
                return {
                    url,
                    accessible: false,
                    statusCode: response.statusCode,
                    severity: 'warning',
                    message: 'Private/Access Denied - Expected for private repositories'
                };
            }

            // Error: 404 and other HTTP errors
            if (response.statusCode === 404) {
                return {
                    url,
                    accessible: false,
                    statusCode: response.statusCode,
                    severity: 'error',
                    error: 'Not Found',
                    message: 'Not Found - URL is broken'
                };
            }

            // Error: All other HTTP error codes
            return {
                url,
                accessible: false,
                statusCode: response.statusCode,
                severity: 'error',
                error: `HTTP ${response.statusCode}`,
                message: `HTTP Error ${response.statusCode}`
            };

        } catch (error) {
            // DNS failures, timeouts, connection errors are all errors
            return {
                url,
                accessible: false,
                severity: 'error',
                error: error instanceof Error ? error.message : String(error),
                message: this.categorizeError(error)
            };
        }
    }

    /**
     * Check multiple URLs in parallel
     * @param urls Array of URLs to check
     * @param timeout Timeout for each request in milliseconds
     * @returns Array of URL check results
     */
    async checkUrls(urls: string[], timeout?: number): Promise<UrlCheckResult[]> {
        const promises = urls.map(url => this.checkUrl(url, timeout));
        return Promise.all(promises);
    }

    /**
     * Make HTTP/HTTPS request with timeout
     * @param url URL to request
     * @param timeout Timeout in milliseconds
     * @returns Response with status code
     */
    private makeRequest(url: string, timeout: number): Promise<{ statusCode: number }> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;

            const options = {
                method: 'HEAD', // Use HEAD to avoid downloading content
                timeout: timeout,
                headers: {
                    'User-Agent': 'Prompt-Registry-Validator/1.0'
                }
            };

            const req = protocol.request(url, options, (res) => {
                // Handle redirects
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    if (res.headers.location) {
                        // Follow redirect
                        const redirectUrl = new URL(res.headers.location, url).toString();
                        this.makeRequest(redirectUrl, timeout)
                            .then(resolve)
                            .catch(reject);
                        return;
                    }
                }

                resolve({ statusCode: res.statusCode || 0 });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                const timeoutError: any = new Error(`Request timeout after ${timeout}ms`);
                timeoutError.code = 'ETIMEDOUT';
                reject(timeoutError);
            });

            req.end();
        });
    }

    /**
     * Categorize error into human-readable message
     * @param error Error object
     * @returns Human-readable error message
     */
    private categorizeError(error: any): string {
        if (!error) {
            return 'Unknown error';
        }

        const code = error.code;
        const message = error.message || '';

        // DNS errors
        if (code === 'ENOTFOUND') {
            return 'DNS lookup failed - Invalid domain';
        }

        // Timeout errors
        if (code === 'ETIMEDOUT') {
            return 'Connection timeout - Unreachable';
        }

        // Connection refused
        if (code === 'ECONNREFUSED') {
            return 'Connection refused - Server not responding';
        }

        // Connection reset
        if (code === 'ECONNRESET') {
            return 'Connection reset - Server closed connection';
        }

        // Invalid URL
        if (message.includes('Invalid URL')) {
            return 'Invalid URL format';
        }

        // Certificate errors
        if (code === 'CERT_HAS_EXPIRED' || message.includes('certificate')) {
            return 'SSL certificate error';
        }

        // Generic network error
        if (code) {
            return `Network error: ${code}`;
        }

        return `Connection error: ${message}`;
    }
}
