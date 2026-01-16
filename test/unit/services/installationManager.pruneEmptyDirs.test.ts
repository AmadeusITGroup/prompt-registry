import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InstallationManager } from '../../../src/services/installationManager';
import { InstallationScope } from '../../../src/types/platform';

/**
 * Mock Logger for testing - captures logs for verification
 */
class MockLogger {
    info(_message: string): void { /* no-op */ }
    warn(_message: string): void { /* no-op */ }
    debug(_message: string, _error?: Error): void { /* no-op */ }
    error(_message: string, _error?: Error): void { /* no-op */ }
}

/**
 * Mock PlatformDetector for testing
 */
class MockPlatformDetector {
    constructor(private testInstallPath: string) {}

    async detectPlatform() {
        return { platform: 'vscode' };
    }

    getInstallationPath(_platform: string, scope: InstallationScope): string {
        return path.join(this.testInstallPath, `.olaf-${scope}`);
    }
}

suite('InstallationManager.pruneEmptyDirs Test Suite', () => {
    let tempDir: string;
    let installationManager: InstallationManager;
    let originalLogger: unknown;
    let originalPlatformDetector: unknown;

    setup(async () => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olaf-test-'));
        
        // Get singleton and save original state for restoration
        installationManager = InstallationManager.getInstance();
        originalLogger = (installationManager as any).logger;
        originalPlatformDetector = (installationManager as any).platformDetector;
        
        // Inject test mocks
        (installationManager as any).logger = new MockLogger();
        (installationManager as any).platformDetector = new MockPlatformDetector(tempDir);
    });

    teardown(async () => {
        // Restore original state to prevent test pollution
        (installationManager as any).logger = originalLogger;
        (installationManager as any).platformDetector = originalPlatformDetector;
        
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            await fs.promises.rm(tempDir, { recursive: true });
        }
    });

    suite('pruneEmptyDirs - Directory Structure Cleanup', () => {
        test('should remove empty directories after file removal', async () => {
            // Arrange - create test structure
            const installPath = path.join(tempDir, '.olaf-user');
            const extractionPath = path.join(tempDir, 'extracted');
            
            // Create directory structure
            const nestedDir = path.join(extractionPath, 'prompt-registry-core', 'deep', 'nested');
            await fs.promises.mkdir(nestedDir, { recursive: true });
            await fs.promises.mkdir(installPath, { recursive: true });
            
            // Create metadata file
            const metadata = {
                installedFiles: ['prompt-registry-core/deep/nested/file.txt', 'prompt-registry-core/another.txt'],
                extractionPath: extractionPath,
                scope: 'user',
                version: '1.0.0',
                platform: 'vscode'
            };
            await fs.promises.writeFile(
                path.join(installPath, '.olaf-metadata.json'),
                JSON.stringify(metadata, null, 2)
            );

            // Act - call pruneEmptyDirs (files should already be removed)
            await installationManager.pruneEmptyDirs(InstallationScope.USER);

            // Assert - verify observable behavior: empty directories should be removed
            assert.strictEqual(fs.existsSync(nestedDir), false, 'Nested directory should be removed');
            assert.strictEqual(fs.existsSync(path.join(extractionPath, 'prompt-registry-core', 'deep')), false, 'Deep directory should be removed');
            assert.strictEqual(fs.existsSync(path.join(extractionPath, 'prompt-registry-core')), false, 'prompt-registry-core directory should be removed');
            assert.strictEqual(fs.existsSync(extractionPath), false, 'Extraction path should be removed if empty');
        });

        test('should not remove directories that contain other files', async () => {
            // Arrange - create test structure with some files remaining
            const installPath = path.join(tempDir, '.olaf-user');
            const extractionPath = path.join(tempDir, 'extracted');
            
            // Create directory structure
            const nestedDir = path.join(extractionPath, 'prompt-registry-core', 'deep');
            await fs.promises.mkdir(nestedDir, { recursive: true });
            await fs.promises.mkdir(installPath, { recursive: true });
            
            // Create a file that should remain
            const remainingFile = path.join(extractionPath, 'prompt-registry-core', 'remaining.txt');
            await fs.promises.writeFile(remainingFile, 'This file should remain');
            
            // Create metadata file
            const metadata = {
                installedFiles: ['prompt-registry-core/deep/file.txt'],
                extractionPath: extractionPath,
                scope: 'user',
                version: '1.0.0',
                platform: 'vscode'
            };
            await fs.promises.writeFile(
                path.join(installPath, '.olaf-metadata.json'),
                JSON.stringify(metadata, null, 2)
            );

            // Act
            await installationManager.pruneEmptyDirs(InstallationScope.USER);

            // Assert - verify observable behavior: directories with files should remain
            assert.strictEqual(fs.existsSync(nestedDir), false, 'Empty nested directory should be removed');
            assert.strictEqual(fs.existsSync(path.join(extractionPath, 'prompt-registry-core')), true, 'Directory with remaining file should remain');
            assert.strictEqual(fs.existsSync(extractionPath), true, 'Extraction path should remain');
            assert.strictEqual(fs.existsSync(remainingFile), true, 'Remaining file should not be touched');
        });

        test('should handle metadata directory removal when separate from extraction', async () => {
            // Arrange - metadata directory separate from extraction
            const installPath = path.join(tempDir, '.olaf-user');
            const extractionPath = path.join(tempDir, 'extracted');
            
            await fs.promises.mkdir(extractionPath, { recursive: true });
            await fs.promises.mkdir(installPath, { recursive: true });
            
            // Create metadata file
            const metadata = {
                installedFiles: [],
                extractionPath: extractionPath,
                scope: 'user',
                version: '1.0.0',
                platform: 'vscode'
            };
            await fs.promises.writeFile(
                path.join(installPath, '.olaf-metadata.json'),
                JSON.stringify(metadata, null, 2)
            );

            // Act
            await installationManager.pruneEmptyDirs(InstallationScope.USER);

            // Assert - verify observable behavior: both empty directories should be removed
            assert.strictEqual(fs.existsSync(extractionPath), false, 'Extraction path should be removed');
            assert.strictEqual(fs.existsSync(installPath), false, 'Installation/metadata path should be removed');
        });

        test('should gracefully handle non-existent installation', async () => {
            // Arrange - no installation exists (tempDir is empty)
            
            // Act & Assert - should not throw
            await assert.doesNotReject(
                async () => installationManager.pruneEmptyDirs(InstallationScope.USER),
                'Should not throw when no installation exists'
            );
        });

        test('should handle corrupted metadata gracefully', async () => {
            // Arrange - create installation with corrupted metadata
            const installPath = path.join(tempDir, '.olaf-user');
            await fs.promises.mkdir(installPath, { recursive: true });
            
            // Create corrupted metadata file
            await fs.promises.writeFile(
                path.join(installPath, '.olaf-metadata.json'),
                'invalid json content'
            );

            // Act & Assert - should not throw
            await assert.doesNotReject(
                async () => installationManager.pruneEmptyDirs(InstallationScope.USER),
                'Should not throw when metadata is corrupted'
            );
        });
    });
});
