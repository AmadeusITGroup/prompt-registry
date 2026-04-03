/**
 * Fixture: Second implementor of IScopeService where getStatus() is also never called.
 * Models: RepositoryScopeService.getStatus() in real codebase.
 */

import {
  IScopeService,
  ScopeStatus,
} from './scope-service';

export class RepositoryScopeService implements IScopeService {
  public async getStatus(): Promise<ScopeStatus> {
    return {
      baseDirectory: '/workspace/.github',
      dirExists: false,
      syncedFiles: 0,
      files: []
    };
  }

  public async syncBundle(bundleId: string, bundlePath: string): Promise<void> {
    // live — called from consumer
  }
}
