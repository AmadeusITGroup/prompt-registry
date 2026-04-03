/**
 * Fixture: Second implementation of IScopeService where getStatus() is never called.
 * Models: RepositoryScopeService.getStatus() in real codebase.
 */

import {
  IScopeService,
  ScopeStatus,
} from './scope-service';

export class RepositoryScopeService implements IScopeService {
  public async getStatus(): Promise<ScopeStatus> {
    return { baseDirectory: '/workspace/.github', dirExists: false };
  }

  public async syncBundle(bundleId: string): Promise<void> {
    // live
  }
}
