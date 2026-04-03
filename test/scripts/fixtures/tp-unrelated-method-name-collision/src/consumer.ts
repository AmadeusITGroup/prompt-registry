/**
 * Fixture: Consumer that calls getStatus() on RuntimeManager (unrelated type)
 * and syncBundle() on IScopeService. The getStatus() call must NOT exonerate
 * ScopeService/UserScopeService/RepositoryScopeService.getStatus().
 */

import {
  RepositoryScopeService,
} from './repository-scope-service';
import {
  RuntimeManager,
} from './runtime-manager';
import {
  IScopeService,
} from './scope-service';
import {
  UserScopeService,
} from './user-scope-service';

export class Orchestrator {
  private readonly userScope: IScopeService;
  private readonly repoScope: IScopeService;
  private readonly runtime: RuntimeManager;

  constructor() {
    this.userScope = new UserScopeService();
    this.repoScope = new RepositoryScopeService();
    this.runtime = new RuntimeManager();
  }

  public async installBundle(bundleId: string): Promise<void> {
    // Calls syncBundle on scope services (live)
    await this.userScope.syncBundle(bundleId);
    await this.repoScope.syncBundle(bundleId);
  }

  public async checkRuntime(): Promise<void> {
    // Calls getStatus() on RuntimeManager — unrelated to IScopeService.getStatus()
    const status = await this.runtime.getStatus();
    console.log(status.running);
  }

  // Note: IScopeService.getStatus() / UserScopeService.getStatus() /
  // RepositoryScopeService.getStatus() are NEVER called
}
