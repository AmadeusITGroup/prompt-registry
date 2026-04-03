/**
 * Fixture: Completely unrelated class that also has a getStatus() method.
 * Models: ApmRuntimeManager.getStatus() in real codebase — different class,
 * same method name, which previously caused false negatives via the untyped fallback.
 */

export class RuntimeManager {
  public async getStatus(): Promise<{ running: boolean }> {
    return { running: true };
  }
}
