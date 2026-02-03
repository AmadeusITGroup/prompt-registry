/**
 * Tests for EngagementStorage
 * File-based persistence for engagement data (telemetry, ratings, feedback)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EngagementStorage } from '../../src/storage/EngagementStorage';
import {
    TelemetryEvent,
    Rating,
    Feedback,
    RatingScore,
} from '../../src/types/engagement';

suite('EngagementStorage', () => {
    let storage: EngagementStorage;
    let tempDir: string;

    // ===== Test Utilities =====
    const createTelemetryEvent = (
        id: string,
        eventType: TelemetryEvent['eventType'] = 'bundle_install',
        resourceId: string = 'test-bundle'
    ): TelemetryEvent => ({
        id,
        timestamp: new Date().toISOString(),
        eventType,
        resourceType: 'bundle',
        resourceId,
    });

    const createRating = (
        id: string,
        resourceId: string,
        score: RatingScore = 4
    ): Rating => ({
        id,
        timestamp: new Date().toISOString(),
        resourceType: 'bundle',
        resourceId,
        score,
    });

    const createFeedback = (
        id: string,
        resourceId: string,
        comment: string = 'Great bundle!'
    ): Feedback => ({
        id,
        timestamp: new Date().toISOString(),
        resourceType: 'bundle',
        resourceId,
        comment,
    });

    setup(async () => {
        // Create temp directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-storage-test-'));
        storage = new EngagementStorage(tempDir);
        await storage.initialize();
    });

    teardown(async () => {
        // Clean up temp directory
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('constructor', () => {
        test('should throw error for empty storage path', () => {
            assert.throws(
                () => new EngagementStorage(''),
                /Storage path cannot be empty/
            );
        });

        test('should throw error for whitespace-only storage path', () => {
            assert.throws(
                () => new EngagementStorage('   '),
                /Storage path cannot be empty/
            );
        });
    });

    suite('initialize()', () => {
        test('should create engagement directory', async () => {
            const newTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-init-test-'));
            const newStorage = new EngagementStorage(newTempDir);
            await newStorage.initialize();

            const engagementDir = path.join(newTempDir, 'engagement');
            assert.ok(fs.existsSync(engagementDir), 'Engagement directory should exist');

            // Cleanup
            fs.rmSync(newTempDir, { recursive: true, force: true });
        });
    });

    suite('getPaths()', () => {
        test('should return correct storage paths', () => {
            const paths = storage.getPaths();

            assert.ok(paths.root.includes('engagement'));
            assert.ok(paths.telemetry.endsWith('telemetry.json'));
            assert.ok(paths.ratings.endsWith('ratings.json'));
            assert.ok(paths.feedback.endsWith('feedback.json'));
        });
    });

    // ========================================================================
    // Telemetry Tests
    // ========================================================================

    suite('Telemetry Operations', () => {
        suite('saveTelemetryEvent()', () => {
            test('should save a telemetry event', async () => {
                const event = createTelemetryEvent('event-1');
                await storage.saveTelemetryEvent(event);

                const events = await storage.getTelemetryEvents();
                assert.strictEqual(events.length, 1);
                assert.strictEqual(events[0].id, 'event-1');
            });

            test('should save multiple telemetry events', async () => {
                await storage.saveTelemetryEvent(createTelemetryEvent('event-1'));
                await storage.saveTelemetryEvent(createTelemetryEvent('event-2'));
                await storage.saveTelemetryEvent(createTelemetryEvent('event-3'));

                const events = await storage.getTelemetryEvents();
                assert.strictEqual(events.length, 3);
            });
        });

        suite('getTelemetryEvents()', () => {
            test('should return empty array when no events exist', async () => {
                const events = await storage.getTelemetryEvents();
                assert.deepStrictEqual(events, []);
            });

            test('should filter by event type', async () => {
                await storage.saveTelemetryEvent(createTelemetryEvent('e1', 'bundle_install'));
                await storage.saveTelemetryEvent(createTelemetryEvent('e2', 'bundle_uninstall'));
                await storage.saveTelemetryEvent(createTelemetryEvent('e3', 'bundle_install'));

                const events = await storage.getTelemetryEvents({
                    eventTypes: ['bundle_install'],
                });
                assert.strictEqual(events.length, 2);
            });

            test('should filter by resource type', async () => {
                const bundleEvent = createTelemetryEvent('e1');
                bundleEvent.resourceType = 'bundle';

                const profileEvent = createTelemetryEvent('e2');
                profileEvent.resourceType = 'profile';

                await storage.saveTelemetryEvent(bundleEvent);
                await storage.saveTelemetryEvent(profileEvent);

                const events = await storage.getTelemetryEvents({
                    resourceTypes: ['bundle'],
                });
                assert.strictEqual(events.length, 1);
                assert.strictEqual(events[0].id, 'e1');
            });

            test('should filter by resource ID', async () => {
                await storage.saveTelemetryEvent(createTelemetryEvent('e1', 'bundle_install', 'bundle-a'));
                await storage.saveTelemetryEvent(createTelemetryEvent('e2', 'bundle_install', 'bundle-b'));

                const events = await storage.getTelemetryEvents({
                    resourceId: 'bundle-a',
                });
                assert.strictEqual(events.length, 1);
                assert.strictEqual(events[0].resourceId, 'bundle-a');
            });

            test('should filter by date range', async () => {
                const oldEvent = createTelemetryEvent('e1');
                oldEvent.timestamp = '2024-01-01T00:00:00.000Z';

                const newEvent = createTelemetryEvent('e2');
                newEvent.timestamp = '2024-06-15T00:00:00.000Z';

                await storage.saveTelemetryEvent(oldEvent);
                await storage.saveTelemetryEvent(newEvent);

                const events = await storage.getTelemetryEvents({
                    startDate: '2024-06-01T00:00:00.000Z',
                    endDate: '2024-12-31T23:59:59.999Z',
                });
                assert.strictEqual(events.length, 1);
                assert.strictEqual(events[0].id, 'e2');
            });

            test('should limit results', async () => {
                for (let i = 0; i < 10; i++) {
                    await storage.saveTelemetryEvent(createTelemetryEvent(`e${i}`));
                }

                const events = await storage.getTelemetryEvents({ limit: 5 });
                assert.strictEqual(events.length, 5);
            });
        });

        suite('clearTelemetry()', () => {
            test('should clear all telemetry when no filter provided', async () => {
                await storage.saveTelemetryEvent(createTelemetryEvent('e1'));
                await storage.saveTelemetryEvent(createTelemetryEvent('e2'));

                await storage.clearTelemetry();

                const events = await storage.getTelemetryEvents();
                assert.strictEqual(events.length, 0);
            });

            test('should clear telemetry matching filter', async () => {
                await storage.saveTelemetryEvent(createTelemetryEvent('e1', 'bundle_install'));
                await storage.saveTelemetryEvent(createTelemetryEvent('e2', 'bundle_uninstall'));

                await storage.clearTelemetry({ eventTypes: ['bundle_install'] });

                const events = await storage.getTelemetryEvents();
                assert.strictEqual(events.length, 1);
                assert.strictEqual(events[0].eventType, 'bundle_uninstall');
            });
        });
    });

    // ========================================================================
    // Rating Tests
    // ========================================================================

    suite('Rating Operations', () => {
        suite('saveRating()', () => {
            test('should save a rating', async () => {
                const rating = createRating('r1', 'bundle-1', 5);
                await storage.saveRating(rating);

                const retrieved = await storage.getRating('bundle', 'bundle-1');
                assert.ok(retrieved);
                assert.strictEqual(retrieved.score, 5);
            });

            test('should update existing rating for same resource', async () => {
                await storage.saveRating(createRating('r1', 'bundle-1', 3));
                await storage.saveRating(createRating('r2', 'bundle-1', 5));

                const ratings = await storage.getAllRatings();
                assert.strictEqual(ratings.length, 1);
                assert.strictEqual(ratings[0].score, 5);
            });
        });

        suite('getRating()', () => {
            test('should return undefined for non-existent rating', async () => {
                const rating = await storage.getRating('bundle', 'non-existent');
                assert.strictEqual(rating, undefined);
            });

            test('should return correct rating for resource', async () => {
                await storage.saveRating(createRating('r1', 'bundle-1', 4));
                await storage.saveRating(createRating('r2', 'bundle-2', 5));

                const rating = await storage.getRating('bundle', 'bundle-1');
                assert.ok(rating);
                assert.strictEqual(rating.score, 4);
            });
        });

        suite('getAllRatings()', () => {
            test('should return empty array when no ratings exist', async () => {
                const ratings = await storage.getAllRatings();
                assert.deepStrictEqual(ratings, []);
            });

            test('should return all ratings', async () => {
                await storage.saveRating(createRating('r1', 'bundle-1', 4));
                await storage.saveRating(createRating('r2', 'bundle-2', 5));

                const ratings = await storage.getAllRatings();
                assert.strictEqual(ratings.length, 2);
            });
        });

        suite('deleteRating()', () => {
            test('should delete existing rating', async () => {
                await storage.saveRating(createRating('r1', 'bundle-1', 4));
                await storage.deleteRating('bundle', 'bundle-1');

                const rating = await storage.getRating('bundle', 'bundle-1');
                assert.strictEqual(rating, undefined);
            });

            test('should not throw when deleting non-existent rating', async () => {
                await storage.deleteRating('bundle', 'non-existent');
                // Should not throw
            });
        });
    });

    // ========================================================================
    // Feedback Tests
    // ========================================================================

    suite('Feedback Operations', () => {
        suite('saveFeedback()', () => {
            test('should save feedback', async () => {
                const feedback = createFeedback('f1', 'bundle-1', 'Great!');
                await storage.saveFeedback(feedback);

                const retrieved = await storage.getFeedback('bundle', 'bundle-1');
                assert.strictEqual(retrieved.length, 1);
                assert.strictEqual(retrieved[0].comment, 'Great!');
            });

            test('should allow multiple feedback entries for same resource', async () => {
                await storage.saveFeedback(createFeedback('f1', 'bundle-1', 'First'));
                await storage.saveFeedback(createFeedback('f2', 'bundle-1', 'Second'));

                const feedback = await storage.getFeedback('bundle', 'bundle-1');
                assert.strictEqual(feedback.length, 2);
            });
        });

        suite('getFeedback()', () => {
            test('should return empty array for resource with no feedback', async () => {
                const feedback = await storage.getFeedback('bundle', 'non-existent');
                assert.deepStrictEqual(feedback, []);
            });

            test('should return feedback sorted by timestamp descending', async () => {
                const f1 = createFeedback('f1', 'bundle-1', 'First');
                f1.timestamp = '2024-01-01T00:00:00.000Z';

                const f2 = createFeedback('f2', 'bundle-1', 'Second');
                f2.timestamp = '2024-06-01T00:00:00.000Z';

                await storage.saveFeedback(f1);
                await storage.saveFeedback(f2);

                const feedback = await storage.getFeedback('bundle', 'bundle-1');
                assert.strictEqual(feedback[0].comment, 'Second'); // Most recent first
            });

            test('should limit results', async () => {
                for (let i = 0; i < 10; i++) {
                    await storage.saveFeedback(createFeedback(`f${i}`, 'bundle-1', `Comment ${i}`));
                }

                const feedback = await storage.getFeedback('bundle', 'bundle-1', 3);
                assert.strictEqual(feedback.length, 3);
            });
        });

        suite('getAllFeedback()', () => {
            test('should return all feedback', async () => {
                await storage.saveFeedback(createFeedback('f1', 'bundle-1'));
                await storage.saveFeedback(createFeedback('f2', 'bundle-2'));

                const feedback = await storage.getAllFeedback();
                assert.strictEqual(feedback.length, 2);
            });
        });

        suite('deleteFeedback()', () => {
            test('should delete feedback by ID', async () => {
                await storage.saveFeedback(createFeedback('f1', 'bundle-1'));
                await storage.saveFeedback(createFeedback('f2', 'bundle-1'));

                await storage.deleteFeedback('f1');

                const feedback = await storage.getAllFeedback();
                assert.strictEqual(feedback.length, 1);
                assert.strictEqual(feedback[0].id, 'f2');
            });
        });
    });

    // ========================================================================
    // Cache and Clear Tests
    // ========================================================================

    suite('Cache Management', () => {
        test('clearCache should not affect persisted data', async () => {
            await storage.saveTelemetryEvent(createTelemetryEvent('e1'));
            await storage.saveRating(createRating('r1', 'bundle-1', 5));

            storage.clearCache();

            // Data should still be retrievable from disk
            const events = await storage.getTelemetryEvents();
            const rating = await storage.getRating('bundle', 'bundle-1');

            assert.strictEqual(events.length, 1);
            assert.ok(rating);
        });

        test('clearAll should remove all data', async () => {
            await storage.saveTelemetryEvent(createTelemetryEvent('e1'));
            await storage.saveRating(createRating('r1', 'bundle-1', 5));
            await storage.saveFeedback(createFeedback('f1', 'bundle-1'));

            await storage.clearAll();

            const events = await storage.getTelemetryEvents();
            const ratings = await storage.getAllRatings();
            const feedback = await storage.getAllFeedback();

            assert.strictEqual(events.length, 0);
            assert.strictEqual(ratings.length, 0);
            assert.strictEqual(feedback.length, 0);
        });
    });
});
