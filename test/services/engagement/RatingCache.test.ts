/**
 * Tests for RatingCache
 * In-memory cache for synchronous rating access in UI components
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { RatingCache, CachedRating } from '../../../src/services/engagement/RatingCache';
import { RatingService, RatingsData } from '../../../src/services/engagement/RatingService';

suite('RatingCache', () => {
    let sandbox: sinon.SinonSandbox;
    let cache: RatingCache;

    const createMockRating = (sourceId: string, bundleId: string, starRating: number = 4.0, voteCount: number = 50): CachedRating => ({
        sourceId,
        bundleId,
        starRating,
        wilsonScore: 0.75,
        voteCount,
        confidence: 'high',
        cachedAt: Date.now()
    });

    setup(() => {
        sandbox = sinon.createSandbox();
        RatingCache.resetInstance();
        cache = RatingCache.getInstance();
    });

    teardown(() => {
        sandbox.restore();
        RatingCache.resetInstance();
    });

    suite('Singleton Pattern', () => {
        test('should return same instance', () => {
            const instance1 = RatingCache.getInstance();
            const instance2 = RatingCache.getInstance();
            assert.strictEqual(instance1, instance2);
        });

        test('should create new instance after reset', () => {
            const instance1 = RatingCache.getInstance();
            RatingCache.resetInstance();
            const instance2 = RatingCache.getInstance();
            assert.notStrictEqual(instance1, instance2);
        });
    });

    suite('getRating()', () => {
        test('should return undefined for uncached bundle', () => {
            const rating = cache.getRating('test-source', 'unknown-bundle');
            assert.strictEqual(rating, undefined);
        });

        test('should return cached rating', () => {
            const mockRating = createMockRating('test-source', 'test-bundle');
            cache.setRating(mockRating);

            const rating = cache.getRating('test-source', 'test-bundle');
            assert.deepStrictEqual(rating, mockRating);
        });
    });

    suite('getRatingDisplay()', () => {
        test('should return undefined for uncached bundle', () => {
            const display = cache.getRatingDisplay('test-source', 'unknown-bundle');
            assert.strictEqual(display, undefined);
        });

        test('should return undefined for bundle with zero votes', () => {
            const mockRating = createMockRating('test-source', 'test-bundle', 0, 0);
            cache.setRating(mockRating);

            const display = cache.getRatingDisplay('test-source', 'test-bundle');
            assert.strictEqual(display, undefined);
        });

        test('should return formatted display for cached rating', () => {
            const mockRating = createMockRating('test-source', 'test-bundle', 4.2, 50);
            cache.setRating(mockRating);

            const display = cache.getRatingDisplay('test-source', 'test-bundle');
            assert.ok(display);
            assert.ok(display.text.includes('★'));
            assert.ok(display.text.includes('4.2'));
            assert.ok(display.tooltip.includes('Rating'));
            assert.ok(display.tooltip.includes('Votes'));
        });
    });

    suite('hasRating()', () => {
        test('should return false for uncached bundle', () => {
            assert.strictEqual(cache.hasRating('test-source', 'unknown-bundle'), false);
        });

        test('should return true for cached bundle', () => {
            cache.setRating(createMockRating('test-source', 'test-bundle'));
            assert.strictEqual(cache.hasRating('test-source', 'test-bundle'), true);
        });
    });

    suite('setRating()', () => {
        test('should add rating to cache', () => {
            const rating = createMockRating('test-source', 'new-bundle');
            cache.setRating(rating);

            assert.strictEqual(cache.size, 1);
            assert.deepStrictEqual(cache.getRating('test-source', 'new-bundle'), rating);
        });

        test('should update existing rating', () => {
            cache.setRating(createMockRating('test-source', 'test-bundle', 3.0));
            cache.setRating(createMockRating('test-source', 'test-bundle', 4.5));

            const rating = cache.getRating('test-source', 'test-bundle');
            assert.strictEqual(rating?.starRating, 4.5);
        });
    });

    suite('clear()', () => {
        test('should remove all cached ratings', () => {
            cache.setRating(createMockRating('test-source', 'bundle-1'));
            cache.setRating(createMockRating('test-source', 'bundle-2'));
            assert.strictEqual(cache.size, 2);

            cache.clear();
            assert.strictEqual(cache.size, 0);
        });
    });

    suite('clearHub()', () => {
        test('should remove ratings matching hub prefix', () => {
            cache.setRating(createMockRating('hub1', 'bundle-1'));
            cache.setRating(createMockRating('hub1', 'bundle-2'));
            cache.setRating(createMockRating('hub2', 'bundle-1'));

            cache.clearHub('hub1');

            assert.strictEqual(cache.size, 1);
            assert.strictEqual(cache.hasRating('hub2', 'bundle-1'), true);
        });
    });

    suite('getCachedBundleIds()', () => {
        test('should return empty array when cache is empty', () => {
            const ids = cache.getCachedBundleIds();
            assert.deepStrictEqual(ids, []);
        });

        test('should return all cached composite keys', () => {
            cache.setRating(createMockRating('test-source', 'bundle-a'));
            cache.setRating(createMockRating('test-source', 'bundle-b'));

            const ids = cache.getCachedBundleIds();
            assert.strictEqual(ids.length, 2);
            assert.ok(ids.includes('test-source:bundle-a'));
            assert.ok(ids.includes('test-source:bundle-b'));
        });
    });

    suite('refreshFromHub()', () => {
        test('should populate cache from RatingService', async () => {
            const mockRatingsData: RatingsData = {
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                bundles: {
                    'bundle-1': {
                        sourceId: 'test-source',
                        bundleId: 'bundle-1',
                        upvotes: 80,
                        downvotes: 10,
                        wilsonScore: 0.82,
                        starRating: 4.3,
                        totalVotes: 90,
                        lastUpdated: new Date().toISOString()
                    },
                    'bundle-2': {
                        sourceId: 'test-source',
                        bundleId: 'bundle-2',
                        upvotes: 20,
                        downvotes: 5,
                        wilsonScore: 0.65,
                        starRating: 3.6,
                        totalVotes: 25,
                        lastUpdated: new Date().toISOString()
                    }
                }
            };

            const ratingService = RatingService.getInstance();
            sandbox.stub(ratingService, 'fetchRatings').resolves(mockRatingsData);

            await cache.refreshFromHub('test-hub', 'https://example.com/ratings.json');

            assert.strictEqual(cache.size, 2);
            
            const rating1 = cache.getRating('test-source', 'bundle-1');
            assert.ok(rating1);
            assert.strictEqual(rating1.starRating, 4.3);
            assert.strictEqual(rating1.voteCount, 90);
            
            const rating2 = cache.getRating('test-source', 'bundle-2');
            assert.ok(rating2);
            assert.strictEqual(rating2.starRating, 3.6);
        });

        test('should handle empty ratings data', async () => {
            const ratingService = RatingService.getInstance();
            sandbox.stub(ratingService, 'fetchRatings').resolves(undefined);

            await cache.refreshFromHub('test-hub', 'https://example.com/ratings.json');

            assert.strictEqual(cache.size, 0);
        });

        test('should handle fetch errors gracefully', async () => {
            const ratingService = RatingService.getInstance();
            sandbox.stub(ratingService, 'fetchRatings').rejects(new Error('Network error'));

            // Should not throw
            await cache.refreshFromHub('test-hub', 'https://example.com/ratings.json');

            assert.strictEqual(cache.size, 0);
        });

        test('should fire onCacheUpdated event after refresh', async () => {
            const mockRatingsData: RatingsData = {
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                bundles: {
                    'bundle-1': {
                        sourceId: 'test-source',
                        bundleId: 'bundle-1',
                        upvotes: 50,
                        downvotes: 5,
                        wilsonScore: 0.85,
                        starRating: 4.4,
                        totalVotes: 55,
                        lastUpdated: new Date().toISOString()
                    }
                }
            };

            const ratingService = RatingService.getInstance();
            sandbox.stub(ratingService, 'fetchRatings').resolves(mockRatingsData);

            let eventFired = false;
            cache.onCacheUpdated(() => { eventFired = true; });

            await cache.refreshFromHub('test-hub', 'https://example.com/ratings.json');

            assert.strictEqual(eventFired, true);
        });
    });

    suite('Confidence Level Calculation', () => {
        test('should assign low confidence for < 5 votes', async () => {
            const mockRatingsData: RatingsData = {
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                bundles: {
                    'bundle-1': {
                        sourceId: 'test-source',
                        bundleId: 'bundle-1',
                        upvotes: 3,
                        downvotes: 0,
                        wilsonScore: 0.5,
                        starRating: 3.0,
                        totalVotes: 3,
                        lastUpdated: new Date().toISOString()
                    }
                }
            };

            const ratingService = RatingService.getInstance();
            sandbox.stub(ratingService, 'fetchRatings').resolves(mockRatingsData);

            await cache.refreshFromHub('test-hub', 'https://example.com/ratings.json');

            const rating = cache.getRating('test-source', 'bundle-1');
            assert.strictEqual(rating?.confidence, 'low');
        });

        test('should assign medium confidence for 5-19 votes', async () => {
            const mockRatingsData: RatingsData = {
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                bundles: {
                    'bundle-1': {
                        sourceId: 'test-source',
                        bundleId: 'bundle-1',
                        upvotes: 10,
                        downvotes: 2,
                        wilsonScore: 0.7,
                        starRating: 3.8,
                        totalVotes: 12,
                        lastUpdated: new Date().toISOString()
                    }
                }
            };

            const ratingService = RatingService.getInstance();
            sandbox.stub(ratingService, 'fetchRatings').resolves(mockRatingsData);

            await cache.refreshFromHub('test-hub', 'https://example.com/ratings.json');

            const rating = cache.getRating('test-source', 'bundle-1');
            assert.strictEqual(rating?.confidence, 'medium');
        });

        test('should assign high confidence for 20-99 votes', async () => {
            const mockRatingsData: RatingsData = {
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                bundles: {
                    'bundle-1': {
                        sourceId: 'test-source',
                        bundleId: 'bundle-1',
                        upvotes: 40,
                        downvotes: 10,
                        wilsonScore: 0.75,
                        starRating: 4.0,
                        totalVotes: 50,
                        lastUpdated: new Date().toISOString()
                    }
                }
            };

            const ratingService = RatingService.getInstance();
            sandbox.stub(ratingService, 'fetchRatings').resolves(mockRatingsData);

            await cache.refreshFromHub('test-hub', 'https://example.com/ratings.json');

            const rating = cache.getRating('test-source', 'bundle-1');
            assert.strictEqual(rating?.confidence, 'high');
        });

        test('should assign very_high confidence for 100+ votes', async () => {
            const mockRatingsData: RatingsData = {
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                bundles: {
                    'bundle-1': {
                        sourceId: 'test-source',
                        bundleId: 'bundle-1',
                        upvotes: 150,
                        downvotes: 20,
                        wilsonScore: 0.85,
                        starRating: 4.4,
                        totalVotes: 170,
                        lastUpdated: new Date().toISOString()
                    }
                }
            };

            const ratingService = RatingService.getInstance();
            sandbox.stub(ratingService, 'fetchRatings').resolves(mockRatingsData);

            await cache.refreshFromHub('test-hub', 'https://example.com/ratings.json');

            const rating = cache.getRating('test-source', 'bundle-1');
            assert.strictEqual(rating?.confidence, 'very_high');
        });
    });
});
