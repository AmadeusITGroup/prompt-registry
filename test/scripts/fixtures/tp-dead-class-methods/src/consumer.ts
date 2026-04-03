/**
 * Fixture: Consumer that uses some methods but leaves others uncalled.
 */

import {
  RepositoryScopeService,
} from './repository-scope-service';
import {
  UserScopeService,
} from './user-scope-service';

export class RegistryManager {
  private readonly userScope = new UserScopeService();
  private readonly repoScope = new RepositoryScopeService();

  public async installBundle(bundleId: string): Promise<void> {
    await this.userScope.syncBundle(bundleId, '/tmp/bundle');
    await this.repoScope.syncBundle(bundleId, '/tmp/bundle');
  }

  public async uninstallBundle(bundleId: string): Promise<void> {
    await this.userScope.unsyncBundle(bundleId);
  }

  // Note: syncAllBundles(), cleanAll(), getSkillsStatus(),
  // addLocalLockfileToGitExclude() are never called
}
