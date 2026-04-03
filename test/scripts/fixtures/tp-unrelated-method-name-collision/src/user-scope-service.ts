/**
 * Fixture: Implementation of IScopeService where getStatus() is never called.
 * Models: UserScopeService.getStatus() in real codebase.
 */

import {
  IScopeService,
  ScopeStatus,
} from './scope-service';

export class UserScopeService implements IScopeService {
  public async getStatus(): Promise<ScopeStatus> {
    return { baseDirectory: '/home/.copilot', dirExists: true };
  }

  public async syncBundle(bundleId: string): Promise<void> {
    // live
  }
}
