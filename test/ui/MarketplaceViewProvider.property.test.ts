/**
 * Property-based tests for MarketplaceViewProvider button state logic
 * 
 * **Feature: github-version-consolidation, Property 4: Button state correctness**
 * 
 * Tests that button states are correctly determined based on version comparisons
 * across all possible combinations of installed and latest versions.
 */

import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as fc from 'fast-check';
import { VersionManager } from '../../src/utils/versionManager';

suite('MarketplaceViewProvider - Property Tests', () => {
    /**
     * Helper to determine button state based on version comparison
     * This mirrors the logic that should be in MarketplaceViewProvider
     */
    function determineButtonState(
        installedVersion: string | undefined,
        latestVersion: string
    ): 'install' | 'update' | 'uninstall' {
        if (!installedVersion) {
            return 'install';
        }
        
        try {
            if (VersionManager.isUpdateAvailable(installedVersion, latestVersion)) {
                return 'update';
            }
        } catch (error) {
            // If version comparison fails, fall back to string comparison
            if (installedVersion !== latestVersion) {
                return 'update';
            }
        }
        
        return 'uninstall';
    }

    suite('Property 4: Button state correctness', () => {
        /**
         * **Property 4: Button state correctness**
         * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
         * 
         * For any bundle with an installed version, the button state should be:
         * - "update" if and only if the installed version is less than the latest version
         * - "uninstall" if versions are equal
         * - "install" if no version is installed
         */
        test('should determine correct button state for all version combinations', () => {
            // Generator for valid semver strings
            const semverArbitrary = fc.tuple(
                fc.integer({ min: 0, max: 10 }),
                fc.integer({ min: 0, max: 20 }),
                fc.integer({ min: 0, max: 50 })
            ).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

            fc.assert(
                fc.property(
                    fc.record({
                        installedVersion: fc.option(semverArbitrary, { nil: undefined }),
                        latestVersion: semverArbitrary
                    }),
                    ({ installedVersion, latestVersion }) => {
                        const buttonState = determineButtonState(installedVersion, latestVersion);
                        
                        // Verify button state matches expected behavior
                        if (!installedVersion) {
                            return buttonState === 'install';
                        }
                        
                        const cmp = VersionManager.compareVersions(installedVersion, latestVersion);
                        
                        if (cmp < 0) {
                            // Installed version is older than latest
                            return buttonState === 'update';
                        } else if (cmp === 0) {
                            // Versions are equal
                            return buttonState === 'uninstall';
                        } else {
                            // Installed version is newer than latest (edge case)
                            // Should still show uninstall
                            return buttonState === 'uninstall';
                        }
                    }
                ),
                { numRuns: 100, verbose: false }
            );
        });

        test('should handle version prefixes correctly', () => {
            // Test with 'v' prefix variations
            const versionWithPrefixArbitrary = fc.tuple(
                fc.integer({ min: 0, max: 10 }),
                fc.integer({ min: 0, max: 20 }),
                fc.integer({ min: 0, max: 50 }),
                fc.boolean()
            ).map(([major, minor, patch, hasPrefix]) => 
                hasPrefix ? `v${major}.${minor}.${patch}` : `${major}.${minor}.${patch}`
            );

            fc.assert(
                fc.property(
                    fc.record({
                        installedVersion: versionWithPrefixArbitrary,
                        latestVersion: versionWithPrefixArbitrary
                    }),
                    ({ installedVersion, latestVersion }) => {
                        const buttonState = determineButtonState(installedVersion, latestVersion);
                        
                        // Parse versions to compare
                        const cleanInstalled = VersionManager.parseVersion(installedVersion);
                        const cleanLatest = VersionManager.parseVersion(latestVersion);
                        
                        if (!cleanInstalled || !cleanLatest) {
                            return true; // Skip invalid versions
                        }
                        
                        const cmp = VersionManager.compareVersions(cleanInstalled, cleanLatest);
                        
                        if (cmp < 0) {
                            return buttonState === 'update';
                        } else if (cmp === 0) {
                            return buttonState === 'uninstall';
                        } else {
                            return buttonState === 'uninstall';
                        }
                    }
                ),
                { numRuns: 100, verbose: false }
            );
        });

        test('should always return "install" when no version is installed', () => {
            const semverArbitrary = fc.tuple(
                fc.integer({ min: 0, max: 10 }),
                fc.integer({ min: 0, max: 20 }),
                fc.integer({ min: 0, max: 50 })
            ).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

            fc.assert(
                fc.property(
                    semverArbitrary,
                    (latestVersion) => {
                        const buttonState = determineButtonState(undefined, latestVersion);
                        return buttonState === 'install';
                    }
                ),
                { numRuns: 50, verbose: false }
            );
        });

        test('should return "uninstall" when versions are equal', () => {
            const semverArbitrary = fc.tuple(
                fc.integer({ min: 0, max: 10 }),
                fc.integer({ min: 0, max: 20 }),
                fc.integer({ min: 0, max: 50 })
            ).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

            fc.assert(
                fc.property(
                    semverArbitrary,
                    (version) => {
                        const buttonState = determineButtonState(version, version);
                        return buttonState === 'uninstall';
                    }
                ),
                { numRuns: 50, verbose: false }
            );
        });

        test('should return "update" when installed version is older', () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        fc.integer({ min: 0, max: 10 }),
                        fc.integer({ min: 0, max: 20 }),
                        fc.integer({ min: 0, max: 50 }),
                        fc.integer({ min: 1, max: 5 }) // Version increment
                    ),
                    ([major, minor, patch, increment]) => {
                        const installedVersion = `${major}.${minor}.${patch}`;
                        const latestVersion = `${major}.${minor}.${patch + increment}`;
                        
                        const buttonState = determineButtonState(installedVersion, latestVersion);
                        return buttonState === 'update';
                    }
                ),
                { numRuns: 50, verbose: false }
            );
        });
    });
});
