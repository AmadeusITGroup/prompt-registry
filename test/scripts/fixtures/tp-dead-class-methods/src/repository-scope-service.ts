/**
 * Fixture: Class with a dead method.
 * Models: RepositoryScopeService.addLocalLockfileToGitExclude()
 */

export class RepositoryScopeService {
  /** Dead — never called from any production code */
  public async addLocalLockfileToGitExclude(): Promise<void> {
    // implementation
  }

  /**
   * Live — called by consumer
   * @param bundleId
   * @param bundlePath
   */
  public async syncBundle(bundleId: string, bundlePath: string): Promise<void> {
    // implementation
  }
}
