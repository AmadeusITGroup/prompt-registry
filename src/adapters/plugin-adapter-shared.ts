/**
 * Shared types and pure helpers for the awesome-copilot plugin adapters.
 *
 * Both `AwesomeCopilotPluginAdapter` (remote/GitHub) and
 * `LocalAwesomeCopilotPluginAdapter` (local filesystem) consume the same
 * `plugin.json` format and produce the same deployment-manifest.yml shape.
 *
 * Everything in this module is **pure / I/O-free** — no HTTP, no filesystem —
 * so it can be unit-tested in isolation and shared between adapters without
 * coupling them to a specific file source.
 */

import {
  Bundle,
} from '../types/registry';

/** `plugin.json` on-disk schema (superset of both our format and upstream github/awesome-copilot). */
export interface PluginManifest {
  id?: string;
  name: string;
  description: string;
  path?: string;
  tags?: string[];
  keywords?: string[];
  version?: string;
  itemCount?: number;
  /** Our format: explicit items with kind/path. */
  items?: PluginItem[];
  /** Upstream format: agent path refs. */
  agents?: string[];
  /** Upstream format: skill path refs. */
  skills?: string[];
  featured?: boolean;
  display?: {
    ordering?: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention -- external JSON field
    show_badge?: boolean;
  };
  external?: boolean;
  repository?: string;
  homepage?: string;
  author?: { name: string; url?: string };
  license?: string;
  source?: { source: string; repo: string; path: string };
}

export interface PluginItem {
  kind: 'agent' | 'skill' | 'prompt' | 'instruction' | 'chat-mode';
  path: string;
}

/**
 * A single deployable unit after resolving upstream directory-style paths to
 * concrete files. Produced by adapter-specific I/O code and consumed by the
 * shared deployment-manifest / archive logic.
 */
export interface ResolvedPluginFile {
  /** Content kind (skill, agent, prompt, ...). */
  kind: PluginItem['kind'];
  /** Logical id used as the prompt id in the deployment manifest. */
  id: string;
  /** Entry file path relative to the plugin root (used for `file:` in the manifest). */
  entryFile: string;
  /** Files to include in the archive. */
  files: { sourcePath: string; archivePath: string }[];
}

/** Registry-facing content types. */
export type ContentType = 'prompt' | 'instructions' | 'chatmode' | 'agent' | 'skill';

/**
 * Map upstream `kind` string to the registry `type` field.
 * @param kind
 */
export function mapKindToType(kind: string): ContentType {
  switch (kind) {
    case 'instruction': {
      return 'instructions';
    }
    case 'chat-mode': {
      return 'chatmode';
    }
    case 'agent': {
      return 'agent';
    }
    case 'skill': {
      return 'skill';
    }
    default: {
      return 'prompt';
    }
  }
}

/**
 * Count items by kind for the marketplace breakdown view.
 * @param items
 */
export function calculateBreakdown(items: PluginItem[]): Record<string, number> {
  const breakdown = { prompts: 0, instructions: 0, chatmodes: 0, agents: 0, skills: 0 };
  for (const item of items) {
    switch (item.kind) {
      case 'prompt': {
        breakdown.prompts++;
        break;
      }
      case 'instruction': {
        breakdown.instructions++;
        break;
      }
      case 'chat-mode': {
        breakdown.chatmodes++;
        break;
      }
      case 'agent': {
        breakdown.agents++;
        break;
      }
      case 'skill': {
        breakdown.skills++;
        break;
      }
    }
  }
  return breakdown;
}

/**
 * Derive `PluginItem[]` from a manifest, supporting both our format
 * (explicit `items` array) and the upstream awesome-copilot format
 * (separate `agents`/`skills` path arrays).
 * @param manifest
 */
export function derivePluginItems(manifest: PluginManifest): PluginItem[] {
  if (manifest.items && manifest.items.length > 0) {
    return manifest.items;
  }
  const items: PluginItem[] = [];
  for (const p of manifest.agents || []) {
    items.push({ kind: 'agent', path: p });
  }
  for (const p of manifest.skills || []) {
    items.push({ kind: 'skill', path: p });
  }
  return items;
}

/**
 * Infer broad environment buckets (cloud/web/data/...) from free-form tags.
 * @param tags
 */
export function inferEnvironments(tags: string[]): string[] {
  const envMap: Record<string, string> = {
    azure: 'cloud', aws: 'cloud', gcp: 'cloud',
    frontend: 'web', backend: 'server',
    database: 'data', devops: 'infrastructure',
    testing: 'testing'
  };
  const environments = new Set<string>();
  for (const tag of tags) {
    const env = envMap[tag.toLowerCase()];
    if (env) {
      environments.add(env);
    }
  }
  return environments.size > 0 ? Array.from(environments) : ['general'];
}

/**
 * Strip `./` prefix from a relative path.
 * @param p
 */
export function stripLeadingDotSlash(p: string): string {
  return p.startsWith('./') ? p.slice(2) : p;
}

/**
 * Normalize a filesystem path to POSIX separators for archive consistency.
 * @param p
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Strip `.md` and `.agent.md` suffixes from a filename.
 * @param filename
 */
export function stripMdExtension(filename: string): string {
  return filename.replace(/\.agent\.md$/i, '').replace(/\.md$/i, '');
}

/**
 * Derive a short human-readable id for a simple single-file item.
 * @param filename
 */
export function deriveSimpleItemId(filename: string): string {
  return filename
    .replace(/\.(prompt|instructions|chatmode|agent)\.md$/, '')
    .replace(/\.md$/, '');
}

/**
 * Convert kebab-case (with spaces) to Title Case.
 * @param str
 */
export function titleCase(str: string): string {
  return str
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Minimal YAML serializer used for `deployment-manifest.yml`.
 *
 * The extension only emits a small, well-known shape (`{ id, name, version, ...,
 * prompts: [{ id, name, ... }] }`), so we avoid pulling in a full YAML library.
 * @param obj
 * @param indent
 */
export function toYaml(obj: any, indent = 0): string {
  const pad = '  '.repeat(indent);
  let result = '';
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        result += `${pad}${key}: []\n`;
      } else if (typeof value[0] === 'object') {
        result += `${pad}${key}:\n`;
        for (const item of value) {
          const lines = toYaml(item, indent + 2).split('\n').filter((l) => l.trim());
          if (lines.length > 0) {
            result += `${pad}  - ${lines[0].trim()}\n`;
            for (let i = 1; i < lines.length; i++) {
              result += `${pad}    ${lines[i].trim()}\n`;
            }
          }
        }
      } else {
        result += `${pad}${key}: [${value.map((v) => `"${v}"`).join(', ')}]\n`;
      }
    } else if (typeof value === 'object' && value !== null) {
      result += `${pad}${key}:\n${toYaml(value, indent + 1)}`;
    } else {
      result += `${pad}${key}: ${JSON.stringify(value)}\n`;
    }
  }
  return result;
}

/** Shape of one entry in a deployment manifest's `prompts` array. */
interface ManifestPrompt {
  id: string;
  name: string;
  description: string;
  file: string;
  type: ContentType;
  tags?: string[];
}

function pickDescriptionPrefix(kind: ResolvedPluginFile['kind']): string {
  if (kind === 'skill') {
    return 'Skill from';
  }
  if (kind === 'agent') {
    return 'Agent from';
  }
  return 'From';
}

/**
 * Build the deployment manifest object for the given bundle + resolved files.
 * Pure function — output is shaped to be consumed by {@link toYaml}.
 * @param bundle
 * @param resolved
 */
export function createDeploymentManifest(
  bundle: Bundle,
  resolved: ResolvedPluginFile[]
): Record<string, unknown> {
  const prompts: ManifestPrompt[] = resolved.map((res) => {
    const displayName = titleCase(res.id.replace(/-/g, ' '));
    const descriptionPrefix = pickDescriptionPrefix(res.kind);
    return {
      id: res.id,
      name: displayName,
      description: `${descriptionPrefix} ${bundle.name}`,
      file: res.entryFile,
      type: mapKindToType(res.kind),
      tags: bundle.tags
    };
  });

  return {
    id: bundle.id,
    name: bundle.name,
    version: bundle.version,
    description: bundle.description,
    author: bundle.author,
    repository: bundle.repository,
    license: bundle.license,
    tags: bundle.tags,
    prompts
  };
}
