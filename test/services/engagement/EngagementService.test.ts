/**
 * Tests for EngagementService
 * Unified facade for telemetry, ratings, and feedback
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { EngagementService } from '../../../src/services/engagement/EngagementService';
import {
    TelemetryEventType,
    EngagementResourceType,
    RatingScore,
} from '../../../src/types/engagement';

suite('EngagementService', () => {
    let sandbox: sinon.SinonSandbox;
    let service: EngagementService;
    let tempDir: string;
    let mockContext: vscode.ExtensionContext;

    // ===== Test Utilities =====
    const createMockContext = (storagePath: string): vscode.ExtensionContext => ({
        globalStorageUri: vscode.Uri.file(storagePath),
        subscriptions: [],
        workspaceState: {
            get: sandbox.stub(),
            update: sandbox.stub(),
            keys: () => [],
        } as any,
        globalState: {
            get: sandbox.stub(),
            update: sandbox.stub(),
            keys: () => [],
            setKeysForSync: sandbox.stub(),
        } as any,
        extensionUri: vscode.Uri.file('/mock/extension'),
        extensionPath: '/mock/extension',
        asAbsolutePath: (p: string) => path.join('/mock/extension', p),
        storagePath: storagePath,
        globalStoragePath: storagePath,
        logPath: path.join(storagePath, 'logs'),
        extensionMode: 3 as any, // ExtensionMode.Test
        extension: {} as any,
        environmentVariableCollection: {} as any,
        secrets: {} as any,
        storageUri: vscode.Uri.file(storagePath),
        logUri: vscode.Uri.file(path.join(storagePath, 'logs')),
        languageModelAccessInformation: {} as any,
    });

    setup(async () => {
        sandbox = sinon.createSandbox();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-service-test-'));
        mockContext = createMockContext(tempDir);

        // Reset singleton
        EngagementService.resetInstance();

        service = EngagementService.getInstance(mockContext);
        await service.initialize();
    });

    teardown(async () => {
        sandbox.restore();
        EngagementService.resetInstance();

        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Singleton Pattern', () => {
        test('should return same instance on subsequent calls', () => {
            const instance1 = EngagementService.getInstance();
            const instance2 = EngagementService.getInstance();
            assert.strictEqual(instance1, instance2);
        });

        test('should throw error if context not provided on first call', () => {
            EngagementService.resetInstance();
            assert.throws(
                () => EngagementService.getInstance(),
                /ExtensionContext required/
            );
        });
    });

    suite('Initialization', () => {
        test('should initialize with file backend', async () => {
            assert.strictEqual(service.initialized, true);
        });

        test('should create engagement storage directory', async () => {
            const engagementDir = path.join(tempDir, 'engagement');
            assert.ok(fs.existsSync(engagementDir));
        });
    });

    suite('Privacy Settings', () => {
        test('should have telemetry disabled by default', () => {
            const settings = service.getPrivacySettings();
            assert.strictEqual(settings.telemetryEnabled, false);
        });

        test('should update privacy settings', () => {
            service.setPrivacySettings({ telemetryEnabled: true });
            const settings = service.getPrivacySettings();
            assert.strictEqual(settings.telemetryEnabled, true);
        });

        test('should preserve other settings when updating', () => {
            service.setPrivacySettings({ telemetryEnabled: true });
            service.setPrivacySettings({ shareRatingsPublicly: true });

            const settings = service.getPrivacySettings();
            assert.strictEqual(settings.telemetryEnabled, true);
            assert.strictEqual(settings.shareRatingsPublicly, true);
        });
    });

    suite('Telemetry Operations', () => {
        test('should not record telemetry when disabled', async () => {
            // Telemetry is disabled by default
            await service.recordTelemetry('bundle_install', 'bundle', 'test-bundle');

            const events = await service.getTelemetry();
            assert.strictEqual(events.length, 0);
        });

        test('should record telemetry when enabled', async () => {
            service.setPrivacySettings({ telemetryEnabled: true });

            await service.recordTelemetry('bundle_install', 'bundle', 'test-bundle', {
                version: '1.0.0',
            });

            const events = await service.getTelemetry();
            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].eventType, 'bundle_install');
            assert.strictEqual(events[0].resourceId, 'test-bundle');
        });

        test('should fire event when telemetry recorded', async () => {
            service.setPrivacySettings({ telemetryEnabled: true });

            let firedEvent: any = null;
            service.onTelemetryRecorded(event => {
                firedEvent = event;
            });

            await service.recordTelemetry('bundle_install', 'bundle', 'test-bundle');

            assert.ok(firedEvent);
            assert.strictEqual(firedEvent.eventType, 'bundle_install');
        });

        test('should filter telemetry by event type', async () => {
            service.setPrivacySettings({ telemetryEnabled: true });

            await service.recordTelemetry('bundle_install', 'bundle', 'b1');
            await service.recordTelemetry('bundle_uninstall', 'bundle', 'b2');

            const events = await service.getTelemetry({ eventTypes: ['bundle_install'] });
            assert.strictEqual(events.length, 1);
        });

        test('should clear telemetry', async () => {
            service.setPrivacySettings({ telemetryEnabled: true });

            await service.recordTelemetry('bundle_install', 'bundle', 'test-bundle');
            await service.clearTelemetry();

            const events = await service.getTelemetry();
            assert.strictEqual(events.length, 0);
        });
    });

    suite('Rating Operations', () => {
        test('should submit a rating', async () => {
            const rating = await service.submitRating('bundle', 'test-bundle', 5);

            assert.ok(rating.id);
            assert.strictEqual(rating.score, 5);
            assert.strictEqual(rating.resourceId, 'test-bundle');
        });

        test('should fire event when rating submitted', async () => {
            let firedRating: any = null;
            service.onRatingSubmitted(rating => {
                firedRating = rating;
            });

            await service.submitRating('bundle', 'test-bundle', 4);

            assert.ok(firedRating);
            assert.strictEqual(firedRating.score, 4);
        });

        test('should retrieve submitted rating', async () => {
            await service.submitRating('bundle', 'test-bundle', 5, { version: '1.0.0' });

            const rating = await service.getRating('bundle', 'test-bundle');

            assert.ok(rating);
            assert.strictEqual(rating.score, 5);
            assert.strictEqual(rating.version, '1.0.0');
        });

        test('should return undefined for non-existent rating', async () => {
            const rating = await service.getRating('bundle', 'non-existent');
            assert.strictEqual(rating, undefined);
        });

        test('should get aggregated ratings', async () => {
            await service.submitRating('bundle', 'test-bundle', 4);

            const stats = await service.getAggregatedRatings('bundle', 'test-bundle');

            assert.ok(stats);
            assert.strictEqual(stats.averageRating, 4);
            assert.strictEqual(stats.ratingCount, 1);
        });

        test('should delete rating', async () => {
            await service.submitRating('bundle', 'test-bundle', 5);
            await service.deleteRating('bundle', 'test-bundle');

            const rating = await service.getRating('bundle', 'test-bundle');
            assert.strictEqual(rating, undefined);
        });
    });

    suite('Feedback Operations', () => {
        test('should submit feedback', async () => {
            const feedback = await service.submitFeedback(
                'bundle',
                'test-bundle',
                'Great bundle!'
            );

            assert.ok(feedback.id);
            assert.strictEqual(feedback.comment, 'Great bundle!');
            assert.strictEqual(feedback.resourceId, 'test-bundle');
        });

        test('should submit feedback with rating', async () => {
            const feedback = await service.submitFeedback(
                'bundle',
                'test-bundle',
                'Excellent!',
                { rating: 5 }
            );

            assert.strictEqual(feedback.rating, 5);
        });

        test('should fire event when feedback submitted', async () => {
            let firedFeedback: any = null;
            service.onFeedbackSubmitted(feedback => {
                firedFeedback = feedback;
            });

            await service.submitFeedback('bundle', 'test-bundle', 'Nice!');

            assert.ok(firedFeedback);
            assert.strictEqual(firedFeedback.comment, 'Nice!');
        });

        test('should retrieve feedback for resource', async () => {
            await service.submitFeedback('bundle', 'test-bundle', 'First');
            await service.submitFeedback('bundle', 'test-bundle', 'Second');

            const feedback = await service.getFeedback('bundle', 'test-bundle');

            assert.strictEqual(feedback.length, 2);
        });

        test('should limit feedback results', async () => {
            for (let i = 0; i < 10; i++) {
                await service.submitFeedback('bundle', 'test-bundle', `Comment ${i}`);
            }

            const feedback = await service.getFeedback('bundle', 'test-bundle', 3);
            assert.strictEqual(feedback.length, 3);
        });

        test('should delete feedback', async () => {
            const feedback = await service.submitFeedback('bundle', 'test-bundle', 'Test');
            await service.deleteFeedback(feedback.id);

            const retrieved = await service.getFeedback('bundle', 'test-bundle');
            assert.strictEqual(retrieved.length, 0);
        });
    });

    suite('Resource Engagement', () => {
        test('should return combined engagement data', async () => {
            service.setPrivacySettings({ telemetryEnabled: true });

            await service.submitRating('bundle', 'test-bundle', 4);
            await service.submitFeedback('bundle', 'test-bundle', 'Great!');
            await service.recordTelemetry('bundle_install', 'bundle', 'test-bundle');

            const engagement = await service.getResourceEngagement('bundle', 'test-bundle');

            assert.strictEqual(engagement.resourceId, 'test-bundle');
            assert.ok(engagement.ratings);
            assert.ok(engagement.recentFeedback);
            assert.ok(engagement.telemetry);
        });

        test('should handle resource with no engagement', async () => {
            const engagement = await service.getResourceEngagement('bundle', 'empty-bundle');

            assert.strictEqual(engagement.resourceId, 'empty-bundle');
            assert.strictEqual(engagement.ratings, undefined);
        });
    });

    suite('Hub Backend Management', () => {
        test('should register hub backend', async () => {
            await service.registerHubBackend('test-hub', {
                enabled: true,
                backend: { type: 'file', storagePath: tempDir },
            });

            // Should be able to use hub-specific backend
            await service.submitRating('bundle', 'hub-bundle', 5, { hubId: 'test-hub' });
            const rating = await service.getRating('bundle', 'hub-bundle', 'test-hub');

            assert.ok(rating);
            assert.strictEqual(rating.score, 5);
        });

        test('should skip registration when engagement disabled', async () => {
            await service.registerHubBackend('disabled-hub', {
                enabled: false,
                backend: { type: 'file', storagePath: tempDir },
            });

            // Should fall back to default backend
            await service.submitRating('bundle', 'test-bundle', 5, { hubId: 'disabled-hub' });
            const rating = await service.getRating('bundle', 'test-bundle');

            assert.ok(rating);
        });

        test('should unregister hub backend', async () => {
            await service.registerHubBackend('test-hub', {
                enabled: true,
                backend: { type: 'file', storagePath: tempDir },
            });

            service.unregisterHubBackend('test-hub');

            // Should fall back to default backend after unregister
            await service.submitRating('bundle', 'test-bundle', 5, { hubId: 'test-hub' });
            const rating = await service.getRating('bundle', 'test-bundle');

            assert.ok(rating);
        });
    });
});
