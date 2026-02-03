/**
 * Tests for VoteService - In-Extension Rating Functionality
 * Tests the vote submission, retrieval, and toggle behavior for bundle ratings
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import nock from 'nock';
import { VoteService } from '../../../src/services/engagement/VoteService';

suite('VoteService - Rating Functionality', () => {
    let sandbox: sinon.SinonSandbox;
    let voteService: VoteService;
    let authStub: sinon.SinonStub;

    const mockSession = {
        accessToken: 'mock-github-token',
        account: { id: '123', label: 'testuser' },
        id: 'session-id',
        scopes: ['repo']
    };

    const mockUser = {
        login: 'testuser',
        id: 123
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        voteService = new VoteService('test-owner', 'test-repo');

        // Mock VS Code authentication
        authStub = sandbox.stub(vscode.authentication, 'getSession').resolves(mockSession as any);
    });

    teardown(() => {
        sandbox.restore();
        nock.cleanAll();
    });

    suite('voteOnCollection()', () => {
        test('should submit upvote successfully', async () => {
            // Mock GitHub API
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions', { content: '+1' })
                .reply(201, { id: 456, content: '+1', user: mockUser });

            const result = await voteService.voteOnCollection(123, '+1');

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.reactionId, 456);
            assert.strictEqual(result.error, undefined);
        });

        test('should submit downvote successfully', async () => {
            // Mock GitHub API
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions', { content: '-1' })
                .reply(201, { id: 789, content: '-1', user: mockUser });

            const result = await voteService.voteOnCollection(123, '-1');

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.reactionId, 789);
            assert.strictEqual(result.error, undefined);
        });

        test('should handle API error gracefully', async () => {
            // Mock GitHub API error
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions')
                .reply(403, { message: 'Forbidden' });

            const result = await voteService.voteOnCollection(123, '+1');

            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.ok(result.error.includes('Forbidden'));
        });

        test('should use custom owner and repo when provided', async () => {
            // Mock GitHub API with custom owner/repo
            nock('https://api.github.com')
                .post('/repos/custom-owner/custom-repo/discussions/123/reactions')
                .reply(201, { id: 999, content: '+1', user: mockUser });

            const result = await voteService.voteOnCollection(123, '+1', 'custom-owner', 'custom-repo');

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.reactionId, 999);
        });

        test('should handle authentication failure', async () => {
            // Stub authentication to fail
            authStub.rejects(new Error('Authentication failed'));

            const result = await voteService.voteOnCollection(123, '+1');

            assert.strictEqual(result.success, false);
            assert.ok(result.error);
        });
    });

    suite('removeVote()', () => {
        test('should remove vote successfully', async () => {
            // Mock GitHub API
            nock('https://api.github.com')
                .delete('/repos/test-owner/test-repo/reactions/456')
                .reply(204);

            const result = await voteService.removeVote(456);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.error, undefined);
        });

        test('should handle API error when removing vote', async () => {
            // Mock GitHub API error
            nock('https://api.github.com')
                .delete('/repos/test-owner/test-repo/reactions/456')
                .reply(404, { message: 'Not Found' });

            const result = await voteService.removeVote(456);

            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.ok(result.error.includes('Not Found'));
        });

        test('should use custom owner and repo when provided', async () => {
            // Mock GitHub API with custom owner/repo
            nock('https://api.github.com')
                .delete('/repos/custom-owner/custom-repo/reactions/456')
                .reply(204);

            const result = await voteService.removeVote(456, 'custom-owner', 'custom-repo');

            assert.strictEqual(result.success, true);
        });
    });

    suite('getCurrentVote()', () => {
        test('should return current upvote', async () => {
            // Mock user API
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            // Mock reactions API
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: 1, content: '+1', user: { login: 'otheruser' } },
                    { id: 2, content: '+1', user: mockUser },
                    { id: 3, content: '-1', user: { login: 'anotheruser' } }
                ]);

            const result = await voteService.getCurrentVote(123);

            assert.ok(result);
            assert.strictEqual(result.reaction, '+1');
            assert.strictEqual(result.reactionId, 2);
        });

        test('should return current downvote', async () => {
            // Mock user API
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            // Mock reactions API
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: 1, content: '+1', user: { login: 'otheruser' } },
                    { id: 2, content: '-1', user: mockUser }
                ]);

            const result = await voteService.getCurrentVote(123);

            assert.ok(result);
            assert.strictEqual(result.reaction, '-1');
            assert.strictEqual(result.reactionId, 2);
        });

        test('should return null when user has not voted', async () => {
            // Mock user API
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            // Mock reactions API with no user votes
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: 1, content: '+1', user: { login: 'otheruser' } },
                    { id: 2, content: '-1', user: { login: 'anotheruser' } }
                ]);

            const result = await voteService.getCurrentVote(123);

            assert.strictEqual(result, null);
        });

        test('should handle pagination correctly', async () => {
            // Mock user API
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            // Mock reactions API with pagination (first page full)
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(200, Array(100).fill({ id: 1, content: '+1', user: { login: 'otheruser' } }));

            // Mock second page with user's vote
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 2 })
                .reply(200, [
                    { id: 101, content: '-1', user: mockUser }
                ]);

            const result = await voteService.getCurrentVote(123);

            assert.ok(result);
            assert.strictEqual(result.reaction, '-1');
            assert.strictEqual(result.reactionId, 101);
        });

        test('should ignore non-vote reactions', async () => {
            // Mock user API
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            // Mock reactions API with various reactions
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: 1, content: 'heart', user: mockUser },
                    { id: 2, content: 'rocket', user: mockUser },
                    { id: 3, content: '+1', user: { login: 'otheruser' } }
                ]);

            const result = await voteService.getCurrentVote(123);

            assert.strictEqual(result, null);
        });

        test('should handle API errors gracefully', async () => {
            // Mock user API
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            // Mock reactions API error
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(500, { message: 'Internal Server Error' });

            const result = await voteService.getCurrentVote(123);

            assert.strictEqual(result, null);
        });
    });

    suite('toggleVote()', () => {
        test('should add vote when user has not voted', async () => {
            // Mock getCurrentVote - no existing vote
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(200, []);

            // Mock voteOnCollection
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions', { content: '+1' })
                .reply(201, { id: 456, content: '+1', user: mockUser });

            const result = await voteService.toggleVote(123, '+1');

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.action, 'added');
            assert.strictEqual(result.reactionId, 456);
        });

        test('should remove vote when clicking same button', async () => {
            // Mock getCurrentVote - existing upvote
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: 456, content: '+1', user: mockUser }
                ]);

            // Mock removeVote
            nock('https://api.github.com')
                .delete('/repos/test-owner/test-repo/reactions/456')
                .reply(204);

            const result = await voteService.toggleVote(123, '+1');

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.action, 'removed');
        });

        test('should change vote when clicking opposite button', async () => {
            // Mock getCurrentVote - existing upvote
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: 456, content: '+1', user: mockUser }
                ]);

            // Mock removeVote (remove old vote)
            nock('https://api.github.com')
                .delete('/repos/test-owner/test-repo/reactions/456')
                .reply(204);

            // Mock voteOnCollection (add new vote)
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions', { content: '-1' })
                .reply(201, { id: 789, content: '-1', user: mockUser });

            const result = await voteService.toggleVote(123, '-1');

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.action, 'changed');
            assert.strictEqual(result.reactionId, 789);
        });

        test('should handle errors during toggle', async () => {
            // Mock getCurrentVote - no existing vote
            nock('https://api.github.com')
                .get('/user')
                .reply(200, mockUser);

            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/123/reactions')
                .query({ per_page: 100, page: 1 })
                .reply(200, []);

            // Mock voteOnCollection with error
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions')
                .reply(403, { message: 'Forbidden' });

            const result = await voteService.toggleVote(123, '+1');

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.action, 'added');
            assert.ok(result.error);
        });
    });

    suite('Authentication', () => {
        test('should request GitHub session with repo scope', async () => {
            // Mock GitHub API
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions')
                .reply(201, { id: 456, content: '+1', user: mockUser });

            await voteService.voteOnCollection(123, '+1');

            // Verify authentication was called with correct scope
            assert.ok(authStub.calledOnce);
            assert.ok(authStub.calledWith('github', ['repo'], { createIfNone: true }));
        });

        test('should create session if none exists', async () => {
            // Mock GitHub API
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions')
                .reply(201, { id: 456, content: '+1', user: mockUser });

            await voteService.voteOnCollection(123, '+1');

            // Verify createIfNone option was set
            const callArgs = authStub.getCall(0).args;
            assert.strictEqual(callArgs[2].createIfNone, true);
        });
    });

    suite('Error Messages', () => {
        test('should extract error message from GitHub API response', async () => {
            // Mock GitHub API with detailed error
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions')
                .reply(422, { message: 'Validation Failed', errors: [{ message: 'Invalid reaction' }] });

            const result = await voteService.voteOnCollection(123, '+1');

            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.ok(result.error.includes('Validation Failed'));
        });

        test('should handle network errors', async () => {
            // Mock network error
            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/123/reactions')
                .replyWithError('Network error');

            const result = await voteService.voteOnCollection(123, '+1');

            assert.strictEqual(result.success, false);
            assert.ok(result.error);
        });
    });
});
