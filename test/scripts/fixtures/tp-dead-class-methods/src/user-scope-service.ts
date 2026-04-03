/**
 * Fixture: Class with a mix of live and dead public methods.
 * Models: UserScopeService.syncAllBundles(), cleanAll(), getSkillsStatus()
 */

export class UserScopeService {
  /** Dead — never called from any production code */
  public async syncAllBundles(): Promise<void> {
    const bundles = ['a', 'b', 'c'];
    for (const b of bundles) {
      await this.syncBundle(b, `/tmp/${b}`);
    }
  }

  /** Dead — never called from any production code */
  public async cleanAll(): Promise<void> {
    const bundles = ['a', 'b', 'c'];
    for (const b of bundles) {
      await this.unsyncBundle(b);
    }
  }

  /** Dead — never called from any production code */
  public async getSkillsStatus(): Promise<{ skills: string[] }> {
    return { skills: [] };
  }

  /**
   * Live — called by consumer
   * @param bundleId
   * @param bundlePath
   */
  public async syncBundle(bundleId: string, bundlePath: string): Promise<void> {
    // implementation
  }

  /**
   * Live — called internally and by consumer
   * @param bundleId
   */
  public async unsyncBundle(bundleId: string): Promise<void> {
    // implementation
  }
}
