#!/usr/bin/env node
/**
 * Hub Configuration Validation Script
 * 
 * Standalone script to validate hub configuration files.
 * Can be run locally or in CI/CD pipelines.
 * 
 * Usage:
 *   node scripts/validate-hub.js <path-to-hub-config.yml>
 *   node scripts/validate-hub.js <path-to-hub-config.yml> --check-urls
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const https = require('https');
const http = require('http');
const Ajv = require('ajv');

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    bold: '\x1b[1m'
};

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
${colors.bold}Hub Configuration Validation Script${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node scripts/validate-hub.js <path-to-hub-config.yml> [options]

${colors.cyan}Options:${colors.reset}
  --check-urls     Check URL accessibility (Level 3 validation)
  --help, -h       Show this help message

${colors.cyan}Examples:${colors.reset}
  node scripts/validate-hub.js hub-config.yml
  node scripts/validate-hub.js hub-config.yml --check-urls
`);
        process.exit(0);
    }

    const filePath = args.find(arg => !arg.startsWith('--'));
    const checkUrls = args.includes('--check-urls');

    if (!filePath) {
        console.error(`${colors.red}Error: No file path provided${colors.reset}`);
        process.exit(1);
    }

    return { filePath, checkUrls };
}

/**
 * Load and parse hub configuration file
 */
function loadHubConfig(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`${colors.red}Error: File not found: ${filePath}${colors.reset}`);
        process.exit(1);
    }

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const config = yaml.load(content);
        
        if (!config || typeof config !== 'object') {
            console.error(`${colors.red}Error: Empty or invalid YAML file${colors.reset}`);
            process.exit(1);
        }

        return config;
    } catch (error) {
        if (error.name === 'YAMLException') {
            console.error(`${colors.red}Error: Failed to parse YAML: ${error.message}${colors.reset}`);
        } else {
            console.error(`${colors.red}Error: Failed to load file: ${error.message}${colors.reset}`);
        }
        process.exit(1);
    }
}

/**
 * Load JSON schema
 */
function loadSchema() {
    const schemaPath = path.join(__dirname, '..', 'schemas', 'hub-config.schema.json');
    
    if (!fs.existsSync(schemaPath)) {
        console.error(`${colors.yellow}Warning: Schema file not found at ${schemaPath}${colors.reset}`);
        return null;
    }

    try {
        const schemaContent = fs.readFileSync(schemaPath, 'utf8');
        return JSON.parse(schemaContent);
    } catch (error) {
        console.error(`${colors.yellow}Warning: Failed to load schema: ${error.message}${colors.reset}`);
        return null;
    }
}

/**
 * Level 1: Schema validation
 */
function validateSchema(config) {
    const errors = [];
    const warnings = [];

    const schema = loadSchema();
    if (!schema) {
        warnings.push('Schema validation skipped (schema file not found)');
        return { errors, warnings };
    }

    try {
        const ajv = new Ajv({ allErrors: true });
        const validate = ajv.compile(schema);
        const valid = validate(config);

        if (!valid && validate.errors) {
            validate.errors.forEach(error => {
                const path = error.instancePath || error.dataPath || '';
                const message = `${path} ${error.message}`;
                errors.push(message);
            });
        }
    } catch (error) {
        warnings.push(`Schema validation error: ${error.message}`);
    }

    return { errors, warnings };
}

/**
 * Level 2: Profile-source reference validation
 */
function validateProfileSourceReferences(config) {
    const errors = [];
    const warnings = [];

    // Build set of valid source IDs
    const sourceIds = new Set();
    if (config.sources && Array.isArray(config.sources)) {
        config.sources.forEach(source => {
            if (source.id) {
                sourceIds.add(source.id);
            }
        });
    }

    // Check each profile's bundles
    if (config.profiles && Array.isArray(config.profiles)) {
        for (const profile of config.profiles) {
            if (!profile.bundles || !Array.isArray(profile.bundles)) {
                continue;
            }

            for (const bundle of profile.bundles) {
                if (!bundle.source) {
                    errors.push(`Profile "${profile.name || profile.id}": Bundle "${bundle.id}" is missing source reference`);
                    continue;
                }

                if (!sourceIds.has(bundle.source)) {
                    errors.push(`Profile "${profile.name || profile.id}": Bundle "${bundle.id}" references non-existent source "${bundle.source}"`);
                }
            }
        }
    }

    return { errors, warnings };
}

/**
 * Check URL accessibility
 */
function checkUrl(url, timeout = 10000) {
    return new Promise((resolve) => {
        try {
            const parsedUrl = new URL(url);
            
            if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                resolve({
                    url,
                    severity: 'error',
                    message: `Unsupported protocol: ${parsedUrl.protocol}`
                });
                return;
            }

            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            const options = {
                method: 'HEAD',
                timeout: timeout,
                headers: {
                    'User-Agent': 'Prompt-Registry-Validator/1.0'
                }
            };

            const req = protocol.request(url, options, (res) => {
                // Handle redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = new URL(res.headers.location, url).toString();
                    checkUrl(redirectUrl, timeout).then(resolve);
                    return;
                }

                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        url,
                        statusCode: res.statusCode,
                        severity: 'success',
                        message: 'Accessible'
                    });
                } else if (res.statusCode === 401 || res.statusCode === 403) {
                    resolve({
                        url,
                        statusCode: res.statusCode,
                        severity: 'warning',
                        message: 'Private/Access Denied - Expected for private repositories'
                    });
                } else if (res.statusCode === 404) {
                    resolve({
                        url,
                        statusCode: res.statusCode,
                        severity: 'error',
                        message: 'Not Found - URL is broken'
                    });
                } else {
                    resolve({
                        url,
                        statusCode: res.statusCode,
                        severity: 'error',
                        message: `HTTP Error ${res.statusCode}`
                    });
                }
            });

            req.on('error', (error) => {
                let message = 'Connection error';
                if (error.code === 'ENOTFOUND') {
                    message = 'DNS lookup failed - Invalid domain';
                } else if (error.code === 'ETIMEDOUT') {
                    message = 'Connection timeout - Unreachable';
                } else if (error.code === 'ECONNREFUSED') {
                    message = 'Connection refused - Server not responding';
                }
                
                resolve({
                    url,
                    severity: 'error',
                    message
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({
                    url,
                    severity: 'error',
                    message: 'Connection timeout - Unreachable'
                });
            });

            req.end();
        } catch (error) {
            resolve({
                url,
                severity: 'error',
                message: error.message.includes('Invalid URL') ? 'Invalid URL format' : error.message
            });
        }
    });
}

/**
 * Level 3: URL accessibility validation
 */
async function validateUrls(config) {
    const errors = [];
    const warnings = [];

    if (!config.sources || config.sources.length === 0) {
        return { errors, warnings };
    }

    // Extract URLs from sources
    const urlChecks = [];
    
    for (const source of config.sources) {
        if (source.url) {
            urlChecks.push({ source, url: source.url });
        } else if (source.repository) {
            // For GitHub/GitLab repositories, construct URL
            if (source.type === 'github') {
                urlChecks.push({ source, url: `https://github.com/${source.repository}` });
            } else if (source.type === 'gitlab') {
                urlChecks.push({ source, url: `https://gitlab.com/${source.repository}` });
            }
        }
    }

    if (urlChecks.length === 0) {
        return { errors, warnings };
    }

    console.log(`   Checking ${urlChecks.length} URL(s)...`);

    // Check URLs in parallel
    const results = await Promise.all(
        urlChecks.map(uc => checkUrl(uc.url))
    );

    // Process results
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const sourceInfo = urlChecks[i];
        const icon = result.severity === 'success' ? '✅' : result.severity === 'warning' ? '⚠️' : '❌';
        
        console.log(`   ${icon} ${sourceInfo.source.id} (${result.url})`);
        console.log(`      ${result.message}${result.statusCode ? ` (${result.statusCode})` : ''}`);

        if (result.severity === 'error') {
            errors.push(`Source "${sourceInfo.source.id}": ${result.message}`);
        } else if (result.severity === 'warning') {
            warnings.push(`Source "${sourceInfo.source.id}": ${result.message}`);
        }
    }

    return { errors, warnings };
}

/**
 * Main validation function
 */
async function validateHub(filePath, options = {}) {
    console.log(`${colors.bold}${colors.cyan}🔍 Hub Configuration Validation${colors.reset}\n`);
    console.log(`Validating: ${filePath}\n`);

    const config = loadHubConfig(filePath);
    const allErrors = [];
    const allWarnings = [];

    // Display hub information
    if (config.metadata) {
        console.log(`${colors.bold}📊 Hub Information:${colors.reset}`);
        console.log(`   Name: ${config.metadata.name || 'N/A'}`);
        console.log(`   Description: ${config.metadata.description || 'N/A'}`);
        console.log(`   Maintainer: ${config.metadata.maintainer || 'N/A'}`);
        console.log(`   Version: ${config.version || 'N/A'}`);
        console.log(`   Sources: ${config.sources?.length || 0}`);
        console.log(`   Profiles: ${config.profiles?.length || 0}\n`);
    }

    console.log('═'.repeat(60) + '\n');

    // Level 1: Schema validation
    console.log(`${colors.bold}📋 Level 1: Schema Validation${colors.reset}`);
    const schemaResult = validateSchema(config);
    
    if (schemaResult.errors.length > 0) {
        console.log(`   ${colors.red}❌ Schema validation failed${colors.reset}\n`);
        allErrors.push(...schemaResult.errors);
    } else {
        console.log(`   ${colors.green}✅ Schema validation passed${colors.reset}\n`);
    }
    allWarnings.push(...schemaResult.warnings);

    // Level 2: Profile-source reference validation
    console.log(`${colors.bold}🔗 Level 2: Profile-Source Reference Validation${colors.reset}`);
    const profileResult = validateProfileSourceReferences(config);
    
    if (profileResult.errors.length > 0) {
        console.log(`   ${colors.red}❌ Profile-source validation failed${colors.reset}\n`);
        allErrors.push(...profileResult.errors);
    } else {
        console.log(`   ${colors.green}✅ All profile bundles reference valid sources${colors.reset}\n`);
    }
    allWarnings.push(...profileResult.warnings);

    // Level 3: URL accessibility validation (optional)
    if (options.checkUrls) {
        console.log(`${colors.bold}🌐 Level 3: URL Accessibility Validation${colors.reset}`);
        const urlResult = await validateUrls(config);
        
        if (urlResult.errors.length > 0) {
            console.log(`\n   ${colors.red}❌ Some URLs are broken${colors.reset}\n`);
            allErrors.push(...urlResult.errors);
        } else if (urlResult.warnings.length > 0) {
            console.log(`\n   ${colors.yellow}⚠️  Some URLs are inaccessible (private repos expected)${colors.reset}\n`);
        } else {
            console.log(`\n   ${colors.green}✅ All URLs are accessible${colors.reset}\n`);
        }
        allWarnings.push(...urlResult.warnings);
    } else {
        console.log(`${colors.bold}🌐 Level 3: URL Accessibility Validation${colors.reset}`);
        console.log(`   ${colors.cyan}ℹ️  Skipped (use --check-urls to enable)${colors.reset}\n`);
    }

    // Display results
    console.log('─'.repeat(60) + '\n');

    if (allErrors.length === 0 && allWarnings.length === 0) {
        console.log(`${colors.green}${colors.bold}✅ Hub configuration is valid!${colors.reset}\n`);
        return true;
    } else {
        if (allErrors.length > 0) {
            console.log(`${colors.red}${colors.bold}❌ Validation Errors:${colors.reset}\n`);
            allErrors.forEach(err => {
                console.log(`   ${colors.red}•${colors.reset} ${err}`);
            });
            console.log('');
        }

        if (allWarnings.length > 0) {
            console.log(`${colors.yellow}${colors.bold}⚠️  Validation Warnings:${colors.reset}\n`);
            allWarnings.forEach(warn => {
                console.log(`   ${colors.yellow}•${colors.reset} ${warn}`);
            });
            console.log('');
        }

        console.log('─'.repeat(60) + '\n');
        console.log(`${colors.bold}📊 Summary:${colors.reset} ${colors.red}${allErrors.length} error(s)${colors.reset}, ${colors.yellow}${allWarnings.length} warning(s)${colors.reset}\n`);

        return allErrors.length === 0;
    }
}

/**
 * Main entry point
 */
async function main() {
    const { filePath, checkUrls } = parseArgs();
    const isValid = await validateHub(filePath, { checkUrls });
    process.exit(isValid ? 0 : 1);
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
        process.exit(1);
    });
}

module.exports = { validateHub, validateSchema, validateProfileSourceReferences, validateUrls };
