/**
 * Resolve a runner pattern by replacing {githubOrg} with the actual org value.
 * Only the {githubOrg} placeholder is supported.
 * @param pattern
 * @param githubOrg
 */
export function resolveRunnerPattern(pattern: string, githubOrg: string): string {
  return pattern.replace(/\{githubOrg\}/g, githubOrg);
}
