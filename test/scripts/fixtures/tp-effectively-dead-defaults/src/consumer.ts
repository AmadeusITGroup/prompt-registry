/**
 * Fixture: Consumer that calls syncSkill/unsyncSkill but always relies on
 * default parameters, so the Claude code path is never activated.
 */

import {
  UserScopeService,
} from './user-scope-service';

export class RegistryManager {
  private readonly userScope = new UserScopeService();

  public async installSkill(skillName: string): Promise<void> {
    // Never passes syncToClaude=true → getClaudeSkillsDirectory is effectively dead
    await this.userScope.syncSkill(skillName, '/tmp/skill');
  }

  public async uninstallSkill(skillName: string): Promise<void> {
    // Never passes removeFromClaude=true → getClaudeSkillsDirectory is effectively dead
    await this.userScope.unsyncSkill(skillName);
  }

  public getCopilotDir(): string {
    // Live call
    return this.userScope.getCopilotSkillsDirectory('user');
  }
}
