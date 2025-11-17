/**
 * OLAF Competencies Adapter (native-source, UI via bundle-like items)
 */

import * as https from 'https';
import * as vscode from 'vscode';
import { RepositoryAdapter } from './RepositoryAdapter';
import { Bundle, RegistrySource, SourceMetadata, ValidationResult } from '../types/registry';
import { Logger } from '../utils/logger';

interface OlafConfig {
  branch?: string;
  basePath?: string; // default: olaf-core/competencies
  collectionFilter?: string; // e.g. developer, project-manager
}

interface GitTreeResponse {
  sha: string;
  tree: Array<{ path: string; mode: string; type: 'blob' | 'tree'; sha: string; url: string }>;
  truncated?: boolean;
}

interface OlafManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  author?: string;
  index_metadata?: {
    include_in_index: boolean;
    always_required?: boolean;
    persona_tags?: string[];
    description_short?: string;
  };
  created?: string;
  updated?: string;
  category?: string;
  classification?: {
    type: string;
    reason?: string;
  };
  target_users?: {
    primary: string;
    secondary?: string[];
    description?: string;
  };
  maintenance?: {
    team?: string;
    primary_maintainer?: string;
    created_by?: string;
  };
  status?: string;
  technical_requirements?: Record<string, unknown>;
  competencies?: string[];
  integrations?: Record<string, string[]>;
  cross_cutting_intents?: string[];
  entry_points?: Array<{
    name: string;
    command: string;
    file: string;
    protocol: string;
    use_case?: string;
  }>;
}

export class OlafCompetenciesAdapter extends RepositoryAdapter {
  readonly type = 'olaf-competencies';
  private logger: Logger;
  private config: Required<OlafConfig>;
  private cache: { timestamp: number; bundles: Bundle[] } | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(source: RegistrySource) {
    super(source);
    this.logger = Logger.getInstance();
    const cfg = (source as any).config || {};
    this.config = {
      branch: cfg.branch || 'main',
      basePath: cfg.basePath || 'olaf-core/competencies',
      collectionFilter: cfg.collectionFilter || ''
    };
    this.logger.info(`OlafCompetenciesAdapter initialized for: ${source.url}`);
  }

  /**
   * Always include Authorization header when a token is present, even if source wasn't marked private
   */
  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Prompt-Registry-VSCode-Extension/1.0',
      'Accept': 'application/json',
    };
    const token = (this as any).getAuthToken?.() as string | undefined;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (this.source.private) {
      // fallback to base behavior if marked private but no token set
      headers['Authorization'] = headers['Authorization'] || '';
    }
    return headers;
  }

  async fetchBundles(): Promise<Bundle[]> {
    // Cache
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      return this.cache.bundles;
    }

    try {
      const { owner, repo } = this.parseGitHubUrl(this.source.url);
      const tree = await this.fetchGitTree(owner, repo, this.config.branch);
      const competencyDirs = new Set<string>();
      const base = this.config.basePath.replace(/^\/+|\/+$/g, '');

      // Find competency-manifest.json files
      for (const node of tree.tree) {
        if (node.type === 'blob' && node.path.startsWith(base) && node.path.endsWith('competency-manifest.json')) {
          const dir = node.path.substring(0, node.path.lastIndexOf('/'));
          competencyDirs.add(dir);
        }
      }

      // Optional filter by top-level domain under basePath
      const filter = this.config.collectionFilter?.trim();
      const filteredDirs = Array.from(competencyDirs).filter((p) => {
        if (!filter) {
          return true;
        }
        const rel = p.substring(base.length + 1).split('/')[0];
        return rel === filter;
      });

      // Fetch and parse manifests; map to lightweight Bundle for UI
      const bundles: Bundle[] = [];
      for (const dir of filteredDirs) {
        try {
          const manifestUrl = this.rawGitHubUrl(owner, repo, this.config.branch, `${dir}/competency-manifest.json`);
          const manifest = await this.fetchJson<OlafManifest>(manifestUrl);
          if (!manifest?.id || !manifest?.name || !manifest?.version) {
            this.logger.warn(`Skipping invalid competency at ${dir}`);
            continue;
          }
          bundles.push({
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description || 'OLAF competency',
            author: manifest.author || 'Unknown',
            sourceId: this.source.id,
            environments: ['any'],
            tags: manifest.tags || [],
            downloads: 0,
            rating: 0,
            lastUpdated: new Date().toISOString(),
            size: 'n/a',
            dependencies: [],
            homepage: this.source.url,
            repository: this.source.url,
            license: 'Unknown',
            manifestUrl,
            // Not used for native flow in milestones 1-4, but required by type
            downloadUrl: manifestUrl
          });
        } catch (err) {
          this.logger.warn(`Failed parsing manifest for ${dir}:`, err as Error);
        }
      }

      this.cache = { timestamp: Date.now(), bundles };
      return bundles;
    } catch (error) {
      this.logger.error('Failed to fetch OLAF competencies', error as Error);
      // For milestone 2, return a minimal placeholder so UI shows tiles
      return [
        {
          id: `${this.source.id}-placeholder`,
          name: 'OLAF Competencies (placeholder)',
          version: '0.0.0',
          description: 'Configure repo/branch/basePath to load real competencies',
          author: 'System',
          sourceId: this.source.id,
          environments: ['any'],
          tags: ['olaf'],
          lastUpdated: new Date().toISOString(),
          size: 'n/a',
          dependencies: [],
          license: 'Unknown',
          manifestUrl: this.source.url,
          downloadUrl: this.source.url,
        }
      ];
    }
  }

  async downloadBundle(): Promise<Buffer> {
    // Not used for milestones 1-4. Return empty buffer to avoid accidental installs.
    return Buffer.from('');
  }

  async fetchMetadata(): Promise<SourceMetadata> {
    return {
      name: this.source.name,
      description: 'OLAF competencies native source',
      bundleCount: (await this.fetchBundles()).length,
      lastUpdated: new Date().toISOString(),
      version: '1.0.0'
    };
  }

  async validate(): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.isValidUrl(this.source.url)) {
      errors.push('Invalid repository URL');
    }

    try {
      const { owner, repo } = this.parseGitHubUrl(this.source.url);
      await this.fetchGitTree(owner, repo, this.config.branch);
    } catch (e: any) {
      warnings.push(`Could not access repo/branch yet: ${e?.message || e}`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  getManifestUrl(bundleId: string): string {
    // Not applicable; return source URL for now
    return this.source.url;
  }

  getDownloadUrl(bundleId: string): string {
    // Not applicable in native flow
    return this.source.url;
  }

  // ===== Helpers =====
  private parseGitHubUrl(url: string): { owner: string; repo: string } {
    // Support https://github.com/owner/repo(.git)?
    try {
      const u = new URL(url);
      const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
      if (u.hostname !== 'github.com' || parts.length < 2) {
        throw new Error('Only github.com URLs are supported at the moment');
      }
      return { owner: parts[0], repo: parts[1] };
    } catch (e) {
      throw new Error('Invalid GitHub URL');
    }
  }

  private async fetchGitTree(owner: string, repo: string, branch: string): Promise<GitTreeResponse> {
    const headers: Record<string, string> = {
      ...this.getHeaders(),
      'Accept': 'application/vnd.github+json'
    };
    // First attempt: tree by branch ref (supports URL-encoded slashes)
    const byRefUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    try {
      return await this.fetchJson<GitTreeResponse>(byRefUrl, headers);
    } catch (e: any) {
      // Fallback: resolve ref to SHA and retry
      const sha = await this.fetchRefSha(owner, repo, branch);
      const byShaUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
      return await this.fetchJson<GitTreeResponse>(byShaUrl, headers);
    }
  }

  private async fetchRefSha(owner: string, repo: string, branch: string): Promise<string> {
    const headers: Record<string, string> = {
      ...this.getHeaders(),
      'Accept': 'application/vnd.github+json'
    };
    const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
    const ref = await this.fetchJson<{ object: { sha: string } }>(refUrl, headers);
    if (!ref?.object?.sha) {
      throw new Error(`Failed to resolve ref for branch '${branch}'`);
    }
    return ref.object.sha;
  }

  private rawGitHubUrl(owner: string, repo: string, branch: string, path: string): string {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path}`;
  }

  private async fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const h = headers || this.getHeaders();
    return await new Promise<T>((resolve, reject) => {
      const req = https.request(url, { method: 'GET', headers: h }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const status = res.statusCode || 0;
          const body = Buffer.concat(chunks).toString('utf8');
          if (status >= 200 && status < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Invalid JSON from ${url}`));
            }
          } else {
            reject(new Error(`HTTP ${status} for ${url}`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}
