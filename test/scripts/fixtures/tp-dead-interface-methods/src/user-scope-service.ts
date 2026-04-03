/**
 * Fixture: Class implementing an interface where getStatus() is never called.
 * Models: UserScopeService.getStatus() in real codebase.
 */

import {
  IScopeService,
  ScopeStatus,
} from './scope-service';

export class UserScopeService implements IScopeService {
  public async getStatus(): Promise<ScopeStatus> {
    return {
      baseDirectory: '/home/user/.copilot',
      dirExists: true,
      syncedFiles: 3,
      files: ['a.md', 'b.md', 'c.md']
    };
  }

  public async syncBundle(bundleId: string, bundlePath: string): Promise<void> {
    // live — called from consumer
  }
}
