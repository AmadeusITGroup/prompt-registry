/**
 * Fixture: Interface with getStatus() that is never called on any IScopeService
 * or its implementations.
 * Models: IScopeService.getStatus() / ScopeStatus in real codebase.
 */

export interface ScopeStatus {
  baseDirectory: string;
  dirExists: boolean;
}

export interface IScopeService {
  /** Dead — never called via IScopeService or its implementation types */
  getStatus(): Promise<ScopeStatus>;

  /** Live — called from consumer */
  syncBundle(bundleId: string): Promise<void>;
}
