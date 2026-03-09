/**
 * Discussion Setup Tool for Engagement Data Collection
 * 
 * This admin tool:
 * 1. Fetches hub configuration from a GitHub repository
 * 2. Extracts engagement repository coordinates
 * 3. Iterates through all bundles from hub sources
 * 4. Creates GitHub Discussions for each bundle to collect ratings/feedback
 * 5. Outputs a collections.yaml mapping file for compute-ratings
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import axios from 'axios';

// ============================================================================
// Types
// ============================================================================

/**
 * Hub configuration structure (simplified for this tool)
 */
interface HubConfig {
    version: string;
    metadata: {
        name: string;
        description: string;
        maintainer: string;
    };
    sources: HubSource[];
    profiles: HubProfile[];
    engagement?: HubEngagementConfig;
}

interface HubSource {
    id: string;
    name: string;
    type: string;
    url: string;
    enabled: boolean;
}

interface HubProfile {
    id: string;
    name: string;
    description?: string;
    bundles: HubProfileBundle[];
}

interface HubProfileBundle {
    id: string;
    version: string;
    source: string;
    required: boolean;
}

interface HubEngagementConfig {
    enabled: boolean;
    backend?: {
        type: string;
        repository: string;
        category?: string;
    };
    ratings?: {
        enabled: boolean;
        ratingsUrl?: string;
    };
    feedback?: {
        enabled: boolean;
        feedbackUrl?: string;
    };
}

/**
 * Bundle info extracted from hub
 */
interface BundleInfo {
    bundleId: string;
    sourceId: string;
    sourceName: string;
    sourceUrl: string;
    profiles: string[];
}

/**
 * Discussion creation result
 */
interface DiscussionResult {
    bundleId: string;
    sourceId: string;
    discussionNumber: number;
    discussionUrl: string;
    created: boolean;
    error?: string;
}

/**
 * Collections.yaml output structure
 */
interface CollectionsConfig {
    repository: string;
    category_id?: string;
    collections: CollectionMapping[];
}

interface CollectionMapping {
    id: string;
    source_id: string;
    discussion_number: number;
}

/**
 * GitHub Discussion category
 */
interface DiscussionCategory {
    id: string;
    name: string;
    slug: string;
    isAnswerable: boolean;
}

/**
 * GitHub GraphQL response types
 */
interface GraphQLDiscussion {
    number: number;
    title: string;
    url: string;
}

// ============================================================================
// GitHub API Functions
// ============================================================================

/**
 * Fetch hub configuration from GitHub repository
 */
async function fetchHubConfig(
    owner: string,
    repo: string,
    branch: string,
    token: string
): Promise<HubConfig> {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/hub-config.yml`;
    
    try {
        const response = await axios.get(url, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        return yaml.load(response.data) as HubConfig;
    } catch (error: any) {
        if (error.response?.status === 404) {
            throw new Error(`Hub config not found at ${url}`);
        }
        throw new Error(`Failed to fetch hub config: ${error.message}`);
    }
}

/**
 * Get discussion categories for a repository using GraphQL
 */
async function getDiscussionCategories(
    owner: string,
    repo: string,
    token: string
): Promise<DiscussionCategory[]> {
    const query = `
        query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
                discussionCategories(first: 25) {
                    nodes {
                        id
                        name
                        slug
                        isAnswerable
                    }
                }
            }
        }
    `;

    const response = await axios.post(
        'https://api.github.com/graphql',
        { query, variables: { owner, repo } },
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (response.data.errors) {
        throw new Error(`GraphQL error: ${JSON.stringify(response.data.errors)}`);
    }

    return response.data.data.repository.discussionCategories.nodes;
}

/**
 * Get repository ID for GraphQL mutations
 */
async function getRepositoryId(
    owner: string,
    repo: string,
    token: string
): Promise<string> {
    const query = `
        query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
                id
            }
        }
    `;

    const response = await axios.post(
        'https://api.github.com/graphql',
        { query, variables: { owner, repo } },
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (response.data.errors) {
        throw new Error(`GraphQL error: ${JSON.stringify(response.data.errors)}`);
    }

    return response.data.data.repository.id;
}

/**
 * Search for existing discussion by title
 * Note: GitHub GraphQL API doesn't support searching discussions by title,
 * so we fetch recent discussions and filter client-side
 */
async function findExistingDiscussion(
    owner: string,
    repo: string,
    title: string,
    token: string
): Promise<GraphQLDiscussion | null> {
    const query = `
        query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
                discussions(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
                    nodes {
                        number
                        title
                        url
                    }
                }
            }
        }
    `;
    
    const response = await axios.post(
        'https://api.github.com/graphql',
        { query, variables: { owner, repo } },
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (response.data.errors) {
        throw new Error(`GraphQL error: ${JSON.stringify(response.data.errors)}`);
    }

    const discussions = response.data.data.repository.discussions.nodes;
    return discussions.find((d: GraphQLDiscussion) => d.title === title) || null;
}

/**
 * Create a new GitHub Discussion
 */
async function createDiscussion(
    repositoryId: string,
    categoryId: string,
    title: string,
    body: string,
    token: string
): Promise<GraphQLDiscussion> {
    const mutation = `
        mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
            createDiscussion(input: {
                repositoryId: $repositoryId,
                categoryId: $categoryId,
                title: $title,
                body: $body
            }) {
                discussion {
                    number
                    title
                    url
                }
            }
        }
    `;

    const response = await axios.post(
        'https://api.github.com/graphql',
        {
            query: mutation,
            variables: { repositoryId, categoryId, title, body }
        },
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (response.data.errors) {
        throw new Error(`GraphQL error: ${JSON.stringify(response.data.errors)}`);
    }

    return response.data.data.createDiscussion.discussion;
}

// ============================================================================
// Bundle Extraction
// ============================================================================

/**
 * Extract all unique bundles from hub configuration
 */
function extractBundlesFromHub(hubConfig: HubConfig): BundleInfo[] {
    const bundlesMap = new Map<string, BundleInfo>();
    
    // Build source lookup
    const sourceLookup = new Map<string, HubSource>();
    for (const source of hubConfig.sources) {
        sourceLookup.set(source.id, source);
    }
    
    // Extract bundles from all profiles
    for (const profile of hubConfig.profiles) {
        for (const bundle of profile.bundles) {
            const key = `${bundle.source}:${bundle.id}`;
            
            if (bundlesMap.has(key)) {
                // Add profile to existing bundle
                const existing = bundlesMap.get(key)!;
                if (!existing.profiles.includes(profile.name)) {
                    existing.profiles.push(profile.name);
                }
            } else {
                // Create new bundle entry
                const source = sourceLookup.get(bundle.source);
                bundlesMap.set(key, {
                    bundleId: bundle.id,
                    sourceId: bundle.source,
                    sourceName: source?.name || bundle.source,
                    sourceUrl: source?.url || '',
                    profiles: [profile.name]
                });
            }
        }
    }
    
    return Array.from(bundlesMap.values());
}

// ============================================================================
// Discussion Generation
// ============================================================================

/**
 * Generate discussion title for a bundle
 */
function generateDiscussionTitle(bundle: BundleInfo): string {
    return `[Rating] ${bundle.bundleId}`;
}

/**
 * Generate discussion body for a bundle
 */
function generateDiscussionBody(bundle: BundleInfo, hubName: string): string {
    return `# Bundle Rating: ${bundle.bundleId}

## Bundle Information

| Field | Value |
|-------|-------|
| **Bundle ID** | \`${bundle.bundleId}\` |
| **Source** | ${bundle.sourceName} (\`${bundle.sourceId}\`) |
| **Source URL** | ${bundle.sourceUrl || 'N/A'} |
| **Used in Profiles** | ${bundle.profiles.join(', ')} |

## How to Rate

React to this discussion to rate this bundle:
- 👍 **Thumbs Up** - I find this bundle useful
- 👎 **Thumbs Down** - This bundle needs improvement

## Feedback

Feel free to leave comments with detailed feedback about this bundle:
- What works well?
- What could be improved?
- Any issues or bugs?

---
*This discussion was auto-generated for the **${hubName}** hub.*
*Bundle ratings are collected and aggregated to help users discover quality bundles.*
`;
}

/**
 * Setup discussions for all bundles
 */
async function setupDiscussionsForBundles(
    bundles: BundleInfo[],
    engagementOwner: string,
    engagementRepo: string,
    categoryName: string,
    hubName: string,
    token: string,
    dryRun: boolean
): Promise<DiscussionResult[]> {
    const results: DiscussionResult[] = [];
    
    // Get repository ID and category
    console.log(`\nFetching repository info for ${engagementOwner}/${engagementRepo}...`);
    
    let repositoryId: string;
    let categoryId: string;
    
    try {
        repositoryId = await getRepositoryId(engagementOwner, engagementRepo, token);
    } catch (error: any) {
        throw new Error(`Failed to get repository ID: ${error.message}. Make sure the repository exists and you have access.`);
    }
    
    const categories = await getDiscussionCategories(engagementOwner, engagementRepo, token);
    
    if (categories.length === 0) {
        throw new Error(
            `No discussion categories found in ${engagementOwner}/${engagementRepo}.\n` +
            `Please enable GitHub Discussions and create at least one category:\n` +
            `https://github.com/${engagementOwner}/${engagementRepo}/settings`
        );
    }
    
    let category = categories.find(c => 
        c.name.toLowerCase() === categoryName.toLowerCase() ||
        c.slug.toLowerCase() === categoryName.toLowerCase()
    );
    
    if (!category) {
        const availableCategories = categories.map(c => `  - ${c.name} (${c.slug})`).join('\n');
        console.log(`\n⚠️  Category "${categoryName}" not found. Available categories:\n${availableCategories}\n`);
        
        // Use the first available category as fallback
        category = categories[0];
        console.log(`Using fallback category: ${category.name} (${category.slug})`);
        console.log(`\nTo create a "${categoryName}" category:`);
        console.log(`  1. Go to https://github.com/${engagementOwner}/${engagementRepo}/discussions/categories`);
        console.log(`  2. Click "New category"`);
        console.log(`  3. Name it "${categoryName}" and choose format (Announcement or Discussion)`);
        console.log(`  4. Re-run this tool with --category "${categoryName}"\n`);
    } else {
        console.log(`Using category: ${category.name} (${category.slug})`);
    }
    
    categoryId = category.id;
    
    // Process each bundle
    console.log(`\nProcessing ${bundles.length} bundles...`);
    
    for (const bundle of bundles) {
        const title = generateDiscussionTitle(bundle);
        const body = generateDiscussionBody(bundle, hubName);
        
        try {
            // Check if discussion already exists
            const existing = await findExistingDiscussion(
                engagementOwner, engagementRepo, title, token
            );
            
            if (existing) {
                console.log(`  ✓ ${bundle.sourceId}:${bundle.bundleId} - Discussion #${existing.number} already exists`);
                results.push({
                    bundleId: bundle.bundleId,
                    sourceId: bundle.sourceId,
                    discussionNumber: existing.number,
                    discussionUrl: existing.url,
                    created: false
                });
            } else if (dryRun) {
                console.log(`  ○ ${bundle.sourceId}:${bundle.bundleId} - Would create discussion (dry-run)`);
                results.push({
                    bundleId: bundle.bundleId,
                    sourceId: bundle.sourceId,
                    discussionNumber: 0,
                    discussionUrl: '',
                    created: false
                });
            } else {
                // Create new discussion
                const discussion = await createDiscussion(
                    repositoryId, categoryId, title, body, token
                );
                console.log(`  + ${bundle.sourceId}:${bundle.bundleId} - Created discussion #${discussion.number}`);
                results.push({
                    bundleId: bundle.bundleId,
                    sourceId: bundle.sourceId,
                    discussionNumber: discussion.number,
                    discussionUrl: discussion.url,
                    created: true
                });
                
                // Rate limit: wait a bit between creations
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (error: any) {
            console.error(`  ✗ ${bundle.sourceId}:${bundle.bundleId} - Error: ${error.message}`);
            results.push({
                bundleId: bundle.bundleId,
                sourceId: bundle.sourceId,
                discussionNumber: 0,
                discussionUrl: '',
                created: false,
                error: error.message
            });
        }
    }
    
    return results;
}

/**
 * Generate collections.yaml from discussion results
 */
function generateCollectionsConfig(
    results: DiscussionResult[],
    engagementRepo: string,
    categoryId?: string
): CollectionsConfig {
    const collections: CollectionMapping[] = results
        .filter(r => r.discussionNumber > 0)
        .map(r => ({
            id: r.bundleId,
            source_id: r.sourceId,
            discussion_number: r.discussionNumber
        }));
    
    const config: CollectionsConfig = {
        repository: engagementRepo,
        collections
    };
    
    if (categoryId) {
        config.category_id = categoryId;
    }
    
    return config;
}

// ============================================================================
// CLI Interface
// ============================================================================

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): {
    hubUrl: string;
    branch: string;
    output: string;
    category: string;
    dryRun: boolean;
    help: boolean;
} {
    let hubUrl = '';
    let branch = 'main';
    let output = 'collections.yaml';
    let category = 'Ratings';
    let dryRun = false;
    let help = false;
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        
        switch (arg) {
            case '--hub':
            case '-h':
                if (nextArg) {
                    hubUrl = nextArg;
                    i++;
                }
                break;
            case '--branch':
            case '-b':
                if (nextArg) {
                    branch = nextArg;
                    i++;
                }
                break;
            case '--output':
            case '-o':
                if (nextArg) {
                    output = nextArg;
                    i++;
                }
                break;
            case '--category':
            case '-c':
                if (nextArg) {
                    category = nextArg;
                    i++;
                }
                break;
            case '--dry-run':
            case '-n':
                dryRun = true;
                break;
            case '--help':
                help = true;
                break;
            default:
                // Positional argument - treat as hub URL if not set
                if (!hubUrl && !arg.startsWith('-')) {
                    hubUrl = arg;
                }
        }
    }
    
    return { hubUrl, branch, output, category, dryRun, help };
}

/**
 * Print usage information
 */
export function printUsage(): void {
    console.log(`
Usage: setup-discussions [options] <hub-url>

Creates GitHub Discussions for all bundles in a hub configuration.
The discussions are used to collect ratings and feedback via reactions.

Arguments:
  <hub-url>              GitHub repository URL for the hub config
                         Format: https://github.com/owner/repo or owner/repo

Options:
  --hub, -h <url>        Hub repository URL (alternative to positional arg)
  --branch, -b <branch>  Git branch to fetch hub config from (default: main)
  --output, -o <file>    Output collections.yaml path (default: collections.yaml)
  --category, -c <name>  Discussion category name (default: Ratings)
  --dry-run, -n          Preview what would be created without making changes
  --help                 Show this help message

Environment Variables:
  GITHUB_TOKEN           Required. GitHub token with repo and discussions permissions

Examples:
  # Create discussions for a hub
  setup-discussions https://github.com/AmadeusITGroup/prompt-registry-config

  # Dry run to preview
  setup-discussions --dry-run AmadeusITGroup/prompt-registry-config

  # Specify branch and output
  setup-discussions -b develop -o my-collections.yaml owner/repo

Output:
  Creates a collections.yaml file mapping bundles to discussion numbers.
  This file is used by compute-ratings to fetch reaction counts.
`);
}

/**
 * Parse GitHub repository URL
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } {
    // Handle full URLs
    const urlMatch = url.match(/github\.com[/:]([^/]+)\/([^/.\s]+)/);
    if (urlMatch) {
        return { owner: urlMatch[1], repo: urlMatch[2].replace(/\.git$/, '') };
    }
    
    // Handle owner/repo format
    const shortMatch = url.match(/^([^/]+)\/([^/]+)$/);
    if (shortMatch) {
        return { owner: shortMatch[1], repo: shortMatch[2] };
    }
    
    throw new Error(`Invalid GitHub URL format: ${url}`);
}

/**
 * Main entry point
 */
export async function setupDiscussions(
    hubUrl: string,
    branch: string,
    outputPath: string,
    categoryName: string,
    dryRun: boolean,
    token: string
): Promise<void> {
    // Parse hub URL
    const { owner: hubOwner, repo: hubRepo } = parseGitHubUrl(hubUrl);
    console.log(`Hub repository: ${hubOwner}/${hubRepo} (branch: ${branch})`);
    
    // Fetch hub configuration
    console.log('Fetching hub configuration...');
    const hubConfig = await fetchHubConfig(hubOwner, hubRepo, branch, token);
    console.log(`Hub: ${hubConfig.metadata.name}`);
    console.log(`Sources: ${hubConfig.sources.length}`);
    console.log(`Profiles: ${hubConfig.profiles.length}`);
    
    // Check engagement configuration
    if (!hubConfig.engagement?.backend?.repository) {
        throw new Error(
            'Hub config does not have engagement.backend.repository configured.\n' +
            'Please add engagement configuration to hub-config.yml first.'
        );
    }
    
    const engagementRepo = hubConfig.engagement.backend.repository;
    const { owner: engagementOwner, repo: engagementRepoName } = parseGitHubUrl(engagementRepo);
    console.log(`Engagement repository: ${engagementOwner}/${engagementRepoName}`);
    
    // Extract bundles from hub
    const bundles = extractBundlesFromHub(hubConfig);
    console.log(`\nFound ${bundles.length} unique bundles across all profiles`);
    
    if (bundles.length === 0) {
        console.log('No bundles found in hub configuration.');
        return;
    }
    
    // Setup discussions
    const results = await setupDiscussionsForBundles(
        bundles,
        engagementOwner,
        engagementRepoName,
        categoryName,
        hubConfig.metadata.name,
        token,
        dryRun
    );
    
    // Generate collections.yaml
    const collectionsConfig = generateCollectionsConfig(
        results,
        `${engagementOwner}/${engagementRepoName}`
    );
    
    // Write output
    if (!dryRun) {
        const yamlContent = yaml.dump(collectionsConfig, {
            indent: 2,
            lineWidth: -1,
            noRefs: true
        });
        fs.writeFileSync(outputPath, yamlContent);
        console.log(`\nCollections config written to: ${outputPath}`);
    } else {
        console.log('\n--- Dry Run: collections.yaml would contain ---');
        console.log(yaml.dump(collectionsConfig, { indent: 2 }));
    }
    
    // Summary
    const created = results.filter(r => r.created).length;
    const existing = results.filter(r => !r.created && r.discussionNumber > 0).length;
    const errors = results.filter(r => r.error).length;
    
    console.log('\n=== Summary ===');
    console.log(`Total bundles: ${bundles.length}`);
    console.log(`Discussions created: ${created}`);
    console.log(`Already existing: ${existing}`);
    if (errors > 0) {
        console.log(`Errors: ${errors}`);
    }
    
    if (dryRun) {
        console.log('\n(Dry run - no changes were made)');
    }
}
