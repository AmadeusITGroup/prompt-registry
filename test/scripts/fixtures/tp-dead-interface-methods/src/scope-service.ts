/**
 * Fixture: Interface with a method that has zero callers across production code.
 * Models: IScopeService.getStatus() / ScopeStatus in real codebase.
 */

export interface ScopeStatus {
  baseDirectory: string;
  dirExists: boolean;
  syncedFiles: number;
  files: string[];
}

export interface IScopeService {
  /** Dead interface method — never called on any type */
  getStatus(): Promise<ScopeStatus>;

  /** Live interface method — called from consumer */
  syncBundle(bundleId: string, bundlePath: string): Promise<void>;
}
