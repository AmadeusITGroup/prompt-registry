/**
 * Environment detection utilities
 */

/**
 * Detect whether the current process is running inside a test runner.
 *
 * Schedulers and other timer-based services use this to skip creating
 * long-lived Node.js timers that would keep the process alive and cause
 * test hangs.
 *
 * @param allowTimersEnvVar - Optional env-var name that, when set to
 *   `'true'`, overrides the detection and allows timers even in tests
 *   (useful for property / integration tests that need real scheduling).
 */
export function isTestEnvironment(allowTimersEnvVar?: string): boolean {
  const isTest =
    process.env.NODE_ENV === 'test'
    || process.argv.some((arg) => arg.includes('mocha'))
    || process.argv.some((arg) => arg.includes('test'));

  if (allowTimersEnvVar && process.env[allowTimersEnvVar] === 'true') {
    return false;
  }

  return isTest;
}
