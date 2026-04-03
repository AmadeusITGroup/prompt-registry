/**
 * Fixture: Consumer that calls syncBundle() but never getStatus().
 * This makes getStatus() dead on both interfaces and implementations.
 */

import {
  RepositoryScopeService,
} from './repository-scope-service';
import {
  IScopeService,
} from './scope-service';
import {
  UserScopeService,
} from './user-scope-service';

export class Orchestrator {
  private readonly userScope: IScopeService;
  private readonly repoScope: IScopeService;

  constructor() {
    this.userScope = new UserScopeService();
    this.repoScope = new RepositoryScopeService();
  }

  public async installBundle(bundleId: string): Promise<void> {
    await this.userScope.syncBundle(bundleId, '/tmp/bundle');
    await this.repoScope.syncBundle(bundleId, '/tmp/bundle');
    // Note: getStatus() is never called anywhere
  }
}
