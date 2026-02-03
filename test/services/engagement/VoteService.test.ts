import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import nock from 'nock';
import { VoteService, VoteReaction } from '../../../src/services/engagement/VoteService';

suite('VoteService', () => {
    let sandbox: sinon.SinonSandbox;
    let voteService: VoteService;
    let mockSession: vscode.AuthenticationSession;

    const TEST_OWNER = 'test-owner';
    const TEST_REPO = 'test-repo';
    const TEST_DISCUSSION = 42;
    const TEST_COMMENT_ID = 101;
    const TEST_REACTION_ID = 12345;

    setup(() => {
        sandbox = sinon.createSandbox();
        voteService = new VoteService(TEST_OWNER, TEST_REPO);
        
        mockSession = {
            id: 'test-session',
            accessToken: 'test-token',
            account: { id: 'test-user', label: 'Test User' },
            scopes: ['repo']
        };

        // Mock VS Code authentication
        sandbox.stub(vscode.authentication, 'getSession').resolves(mockSession);
    });

    teardown(() => {
        sandbox.restore();
        nock.cleanAll();
    });

    suite('getGitHubSession()', () => {
        test('should return session when authentication succeeds', async () => {
            const session = await voteService.getGitHubSession();
            assert.strictEqual(session.accessToken, 'test-token');
        });

        test('should throw error when authentication fails', async () => {
            (vscode.authentication.getSession as sinon.SinonStub).rejects(new Error('Auth failed'));
            
            await assert.rejects(
                () => voteService.getGitHubSession(),
                /GitHub authentication required/
            );
        });
    });

    suite('voteOnCollection()', () => {
        test('should successfully vote on a collection', async () => {
            nock('https://api.github.com')
                .post(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .reply(201, { id: TEST_REACTION_ID });

            const result = await voteService.voteOnCollection(TEST_DISCUSSION, '+1');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.reactionId, TEST_REACTION_ID);
        });

        test('should handle upvote reaction', async () => {
            nock('https://api.github.com')
                .post(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`, { content: '+1' })
                .reply(201, { id: TEST_REACTION_ID });

            const result = await voteService.voteOnCollection(TEST_DISCUSSION, '+1');
            assert.strictEqual(result.success, true);
        });

        test('should handle downvote reaction', async () => {
            nock('https://api.github.com')
                .post(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`, { content: '-1' })
                .reply(201, { id: TEST_REACTION_ID });

            const result = await voteService.voteOnCollection(TEST_DISCUSSION, '-1');
            assert.strictEqual(result.success, true);
        });

        test('should return error on API failure', async () => {
            nock('https://api.github.com')
                .post(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .reply(403, { message: 'Forbidden' });

            const result = await voteService.voteOnCollection(TEST_DISCUSSION, '+1');
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
        });

        test('should use custom owner and repo', async () => {
            const customOwner = 'custom-owner';
            const customRepo = 'custom-repo';
            
            nock('https://api.github.com')
                .post(`/repos/${customOwner}/${customRepo}/discussions/${TEST_DISCUSSION}/reactions`)
                .reply(201, { id: TEST_REACTION_ID });

            const result = await voteService.voteOnCollection(TEST_DISCUSSION, '+1', customOwner, customRepo);
            assert.strictEqual(result.success, true);
        });
    });

    suite('voteOnResource()', () => {
        test('should successfully vote on a resource comment', async () => {
            nock('https://api.github.com')
                .post(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/comments/${TEST_COMMENT_ID}/reactions`)
                .reply(201, { id: TEST_REACTION_ID });

            const result = await voteService.voteOnResource(TEST_DISCUSSION, TEST_COMMENT_ID, '+1');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.reactionId, TEST_REACTION_ID);
        });

        test('should return error on API failure', async () => {
            nock('https://api.github.com')
                .post(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/comments/${TEST_COMMENT_ID}/reactions`)
                .reply(404, { message: 'Not Found' });

            const result = await voteService.voteOnResource(TEST_DISCUSSION, TEST_COMMENT_ID, '+1');
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
        });
    });

    suite('removeVote()', () => {
        test('should successfully remove a vote', async () => {
            nock('https://api.github.com')
                .delete(`/repos/${TEST_OWNER}/${TEST_REPO}/reactions/${TEST_REACTION_ID}`)
                .reply(204);

            const result = await voteService.removeVote(TEST_REACTION_ID);
            assert.strictEqual(result.success, true);
        });

        test('should return error on API failure', async () => {
            nock('https://api.github.com')
                .delete(`/repos/${TEST_OWNER}/${TEST_REPO}/reactions/${TEST_REACTION_ID}`)
                .reply(403, { message: 'Forbidden' });

            const result = await voteService.removeVote(TEST_REACTION_ID);
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
        });
    });

    suite('getCurrentVote()', () => {
        test('should return current vote when user has voted', async () => {
            nock('https://api.github.com')
                .get('/user')
                .reply(200, { login: 'test-user' });
            
            nock('https://api.github.com')
                .get(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: TEST_REACTION_ID, content: '+1', user: { login: 'test-user' } },
                    { id: 99999, content: '-1', user: { login: 'other-user' } }
                ]);

            const result = await voteService.getCurrentVote(TEST_DISCUSSION);
            
            assert.ok(result);
            assert.strictEqual(result.reaction, '+1');
            assert.strictEqual(result.reactionId, TEST_REACTION_ID);
        });

        test('should return null when user has not voted', async () => {
            nock('https://api.github.com')
                .get('/user')
                .reply(200, { login: 'test-user' });
            
            nock('https://api.github.com')
                .get(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: 99999, content: '+1', user: { login: 'other-user' } }
                ]);

            const result = await voteService.getCurrentVote(TEST_DISCUSSION);
            assert.strictEqual(result, null);
        });

        test('should return null on API error', async () => {
            nock('https://api.github.com')
                .get('/user')
                .reply(401, { message: 'Unauthorized' });

            const result = await voteService.getCurrentVote(TEST_DISCUSSION);
            assert.strictEqual(result, null);
        });

        test('should ignore non-vote reactions', async () => {
            nock('https://api.github.com')
                .get('/user')
                .reply(200, { login: 'test-user' });
            
            nock('https://api.github.com')
                .get(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: 11111, content: 'heart', user: { login: 'test-user' } },
                    { id: 22222, content: 'rocket', user: { login: 'test-user' } }
                ]);

            const result = await voteService.getCurrentVote(TEST_DISCUSSION);
            assert.strictEqual(result, null);
        });

        test('should ignore reactions from other users', async () => {
            nock('https://api.github.com')
                .get('/user')
                .reply(200, { login: 'test-user' });
            
            nock('https://api.github.com')
                .get(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: 88888, content: 'heart', user: { login: 'test-user' } },
                    { id: 99999, content: '+1', user: { login: 'other-user' } }
                ]);

            const result = await voteService.getCurrentVote(TEST_DISCUSSION);
            assert.strictEqual(result, null);
        });
    });

    suite('toggleVote()', () => {
        test('should add vote when user has not voted', async () => {
            // Mock getCurrentVote to return null
            nock('https://api.github.com')
                .get('/user')
                .reply(200, { login: 'test-user' });
            
            nock('https://api.github.com')
                .get(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .query({ per_page: 100, page: 1 })
                .reply(200, []);
            
            // Mock voteOnCollection
            nock('https://api.github.com')
                .post(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .reply(201, { id: TEST_REACTION_ID });

            const result = await voteService.toggleVote(TEST_DISCUSSION, '+1');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.action, 'added');
        });

        test('should remove vote when user has same vote', async () => {
            // Mock getting current vote
            nock('https://api.github.com')
                .get('/user')
                .reply(200, { login: 'test-user' });
            
            nock('https://api.github.com')
                .get(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: TEST_REACTION_ID, content: '+1', user: { login: 'test-user' } }
                ]);

            // Mock removing reaction
            nock('https://api.github.com')
                .delete(`/repos/${TEST_OWNER}/${TEST_REPO}/reactions/${TEST_REACTION_ID}`)
                .reply(204);

            const result = await voteService.toggleVote(TEST_DISCUSSION, '+1');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.action, 'removed');
        });

        test('should change vote when user has different vote', async () => {
            // Mock getting current vote
            nock('https://api.github.com')
                .get('/user')
                .reply(200, { login: 'test-user' });
            
            nock('https://api.github.com')
                .get(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .query({ per_page: 100, page: 1 })
                .reply(200, [
                    { id: TEST_REACTION_ID, content: '+1', user: { login: 'test-user' } }
                ]);

            // Mock removing old reaction
            nock('https://api.github.com')
                .delete(`/repos/${TEST_OWNER}/${TEST_REPO}/reactions/${TEST_REACTION_ID}`)
                .reply(204);

            // Mock adding new reaction
            nock('https://api.github.com')
                .post(`/repos/${TEST_OWNER}/${TEST_REPO}/discussions/${TEST_DISCUSSION}/reactions`)
                .reply(201, { id: 77777, content: '-1' });

            const result = await voteService.toggleVote(TEST_DISCUSSION, '-1');
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.action, 'changed');
            assert.strictEqual(result.reactionId, 77777);
        });
    });

    suite('Default values', () => {
        test('should use default owner and repo when not specified', async () => {
            const defaultService = new VoteService();
            
            nock('https://api.github.com')
                .post('/repos/AmadeusITGroup/prompt-registry/discussions/1/reactions')
                .reply(201, { id: TEST_REACTION_ID });

            const result = await defaultService.voteOnCollection(1, '+1');
            assert.strictEqual(result.success, true);
        });
    });
});
