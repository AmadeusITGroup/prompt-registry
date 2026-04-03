/**
 * Fixture: Module with a method that is syntactically reachable but effectively
 * dead because the guarding parameter always defaults to false.
 *
 * Models: UserScopeService.getClaudeSkillsDirectory() — only called inside
 * `if (syncToClaude)` / `if (removeFromClaude)` blocks, but all callers
 * pass the default `false` for those flags.
 *
 * This is a known limitation of call-graph analysis; data-flow analysis
 * would be required to detect this pattern.
 */

export class UserScopeService {
  /**
   * Effectively dead — only reachable when syncToClaude=true, but nobody passes true
   * @param scope
   */
  public getClaudeSkillsDirectory(scope: 'user' | 'workspace' = 'user'): string {
    if (scope === 'workspace') {
      return '/workspace/.claude/skills';
    }
    return '/home/user/.claude/skills';
  }

  /**
   * Live — called from consumer
   * @param scope
   */
  public getCopilotSkillsDirectory(scope: 'user' | 'workspace' = 'user'): string {
    if (scope === 'workspace') {
      return '/workspace/.copilot/skills';
    }
    return '/home/user/.copilot/skills';
  }

  public async syncSkill(
    skillName: string,
    sourceDir: string,
    scope: 'user' | 'workspace' = 'user',
    syncToClaude = false
  ): Promise<void> {
    const copilotDir = this.getCopilotSkillsDirectory(scope);
    // always runs
    void copilotDir;

    if (syncToClaude) {
      // This branch is never taken because no caller passes syncToClaude=true
      const claudeDir = this.getClaudeSkillsDirectory(scope);
      void claudeDir;
    }
  }

  public async unsyncSkill(
    skillName: string,
    scope: 'user' | 'workspace' = 'user',
    removeFromClaude = false
  ): Promise<void> {
    if (removeFromClaude) {
      // This branch is never taken because no caller passes removeFromClaude=true
      const claudeDir = this.getClaudeSkillsDirectory(scope);
      void claudeDir;
    }
  }
}
