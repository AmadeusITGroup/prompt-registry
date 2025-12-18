/**
 * OlafAdapter Integration Tests
 * Tests bundle packaging and installation functionality
 */

import * as assert from 'assert';
import nock from 'nock';
import * as sinon from 'sinon';
import { OlafAdapter } from '../../src/adapters/OlafAdapter';
import { OlafRuntimeManager } from '../../src/services/OlafRuntimeManager';
import { RegistrySource } from '../../src/types/registry';
import { Logger } from '../../src/utils/logger';
import * as vscode from 'vscode';

suite('OlafAdapter Integration Tests', () => {
    const mockSource: RegistrySource = {
        id: 'test-olaf-source',
        name: 'Test OLAF Source',
        type: 'olaf',
        url: 'https://github.com/test-owner/test-olaf-repo',
        enabled: true,
        priority: 1,
        token: 'test-token',
    };

    let runtimeManagerStub: sinon.SinonStubbedInstance<OlafRuntimeManager>;
    let workspaceStub: sinon.SinonStub;

    setup(() => {
        // Mock OlafRuntimeManager
        runtimeManagerStub = sinon.createStubInstance(OlafRuntimeManager);
        sinon.stub(OlafRuntimeManager, 'getInstance').returns(runtimeManagerStub as any);
        
        // Mock VSCode workspace
        workspaceStub = sinon.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: { fsPath: '/test/workspace' } }
        ]);
    });

    teardown(() => {
        nock.cleanAll();
        sinon.restore();
    });

    suite('Bundle Packaging', () => {
        test('should generate deployment manifest for skill', async () => {
            // Mock OLAF repository structure
            nock('https://api.github.com')
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills')
                .reply(200, [
                    {
                        name: 'data-analysis',
                        path: '.olaf/core/skills/data-analysis',
                        type: 'dir'
                    }
                ])
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills/data-analysis')
                .reply(200, [
                    {
                        name: 'skill-manifest.json',
                        type: 'file',
                        download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/.olaf/core/skills/data-analysis/skill-manifest.json'
                    },
                    {
                        name: 'main.py',
                        type: 'file',
                        download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/.olaf/core/skills/data-analysis/main.py'
                    }
                ]);

            // Mock skill manifest download
            nock('https://raw.githubusercontent.com')
                .get('/test-owner/test-olaf-repo/main/.olaf/core/skills/data-analysis/skill-manifest.json')
                .reply(200, JSON.stringify({
                    name: 'Data Analysis Skill',
                    version: '1.0.0',
                    description: 'Advanced data analysis capabilities',
                    author: 'Test Author',
                    tags: ['data', 'analysis', 'python']
                }));

            const adapter = new OlafAdapter(mockSource);
            const bundles = await adapter.fetchBundles();

            assert.strictEqual(bundles.length, 1);
            assert.strictEqual(bundles[0].name, 'Data Analysis Skill');
            assert.strictEqual(bundles[0].version, '1.0.0');
            assert.strictEqual(bundles[0].description, 'Advanced data analysis capabilities');
            assert.deepStrictEqual(bundles[0].tags, ['olaf', 'skill', 'data', 'analysis', 'python']);
        });

        test('should create ZIP bundle with deployment manifest and skill files', async () => {
            // Setup runtime manager mocks
            runtimeManagerStub.ensureRuntimeInstalled.resolves(true);
            runtimeManagerStub.hasWorkspaceLinks.resolves(false);
            runtimeManagerStub.createWorkspaceLinks.resolves();

            // Mock skill discovery (called twice - once for fetchBundles, once for downloadBundle)
            nock('https://api.github.com')
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills')
                .times(2)
                .reply(200, [
                    {
                        name: 'test-skill',
                        path: '.olaf/core/skills/test-skill',
                        type: 'dir'
                    }
                ])
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills/test-skill')
                .times(3) // Called for fetchBundles, downloadBundle scan, and packageSkillAsBundle
                .reply(200, [
                    {
                        name: 'skill-manifest.json',
                        type: 'file',
                        download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/skill-manifest.json'
                    },
                    {
                        name: 'main.py',
                        type: 'file',
                        download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/main.py'
                    }
                ]);

            // Mock file downloads (called multiple times)
            nock('https://raw.githubusercontent.com')
                .get('/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/skill-manifest.json')
                .times(3) // Called for fetchBundles, downloadBundle scan, and packageSkillAsBundle
                .reply(200, JSON.stringify({
                    name: 'Test Skill',
                    version: '1.0.0',
                    description: 'Test skill for packaging'
                }))
                .get('/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/main.py')
                .reply(200, 'print("Hello from OLAF skill!")');

            const adapter = new OlafAdapter(mockSource);
            
            // First get the bundle info
            const bundles = await adapter.fetchBundles();
            const testBundle = bundles[0];

            // Then download the bundle
            const zipBuffer = await adapter.downloadBundle(testBundle);

            assert.ok(Buffer.isBuffer(zipBuffer));
            assert.ok(zipBuffer.length > 0);

            // Verify ZIP contents using AdmZip
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(zipBuffer);
            const entries = zip.getEntries();

            // Should contain deployment manifest
            const manifestEntry = entries.find((entry: any) => entry.entryName === 'deployment-manifest.yml');
            assert.ok(manifestEntry, 'ZIP should contain deployment-manifest.yml');

            // Should contain skill files
            const skillManifestEntry = entries.find((entry: any) => entry.entryName === 'test-skill/skill-manifest.json');
            const skillMainEntry = entries.find((entry: any) => entry.entryName === 'test-skill/main.py');
            
            assert.ok(skillManifestEntry, 'ZIP should contain skill manifest');
            assert.ok(skillMainEntry, 'ZIP should contain skill main file');
        });
    });

    suite('Runtime Installation Integration', () => {
        test('should ensure runtime is installed before skill download', async () => {
            // Setup runtime manager mocks
            runtimeManagerStub.ensureRuntimeInstalled.resolves(true);
            runtimeManagerStub.hasWorkspaceLinks.resolves(true);

            // Mock skill discovery and download (called multiple times)
            nock('https://api.github.com')
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills')
                .times(2)
                .reply(200, [
                    {
                        name: 'test-skill',
                        path: '.olaf/core/skills/test-skill',
                        type: 'dir'
                    }
                ])
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills/test-skill')
                .times(3) // Called for fetchBundles, downloadBundle scan, and packageSkillAsBundle
                .reply(200, [
                    {
                        name: 'skill-manifest.json',
                        type: 'file',
                        download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/skill-manifest.json'
                    }
                ]);

            nock('https://raw.githubusercontent.com')
                .get('/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/skill-manifest.json')
                .times(3) // Called for fetchBundles, downloadBundle scan, and packageSkillAsBundle
                .reply(200, JSON.stringify({
                    name: 'Test Skill',
                    version: '1.0.0'
                }));

            const adapter = new OlafAdapter(mockSource);
            const bundles = await adapter.fetchBundles();
            
            await adapter.downloadBundle(bundles[0]);

            // Verify runtime manager was called
            assert.ok(runtimeManagerStub.ensureRuntimeInstalled.calledOnce);
            assert.ok(runtimeManagerStub.hasWorkspaceLinks.calledOnce);
        });

        test('should create workspace links when not present', async () => {
            // Setup runtime manager mocks
            runtimeManagerStub.ensureRuntimeInstalled.resolves(true);
            runtimeManagerStub.hasWorkspaceLinks.resolves(false);
            runtimeManagerStub.createWorkspaceLinks.resolves();

            // Mock skill discovery and download (called multiple times)
            nock('https://api.github.com')
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills')
                .times(2)
                .reply(200, [
                    {
                        name: 'test-skill',
                        path: '.olaf/core/skills/test-skill',
                        type: 'dir'
                    }
                ])
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills/test-skill')
                .times(3) // Called for fetchBundles, downloadBundle scan, and packageSkillAsBundle
                .reply(200, [
                    {
                        name: 'skill-manifest.json',
                        type: 'file',
                        download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/skill-manifest.json'
                    }
                ]);

            nock('https://raw.githubusercontent.com')
                .get('/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/skill-manifest.json')
                .times(3) // Called for fetchBundles, downloadBundle scan, and packageSkillAsBundle
                .reply(200, JSON.stringify({
                    name: 'Test Skill',
                    version: '1.0.0'
                }));

            const adapter = new OlafAdapter(mockSource);
            const bundles = await adapter.fetchBundles();
            
            await adapter.downloadBundle(bundles[0]);

            // Verify workspace links were created
            assert.ok(runtimeManagerStub.createWorkspaceLinks.calledOnce);
            assert.ok(runtimeManagerStub.createWorkspaceLinks.calledWith('/test/workspace'));
        });

        test('should fail skill installation when runtime installation fails', async () => {
            // Setup runtime manager to fail
            runtimeManagerStub.ensureRuntimeInstalled.resolves(false);

            // Mock skill discovery for fetchBundles
            nock('https://api.github.com')
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills')
                .reply(200, [
                    {
                        name: 'test-skill',
                        path: '.olaf/core/skills/test-skill',
                        type: 'dir'
                    }
                ])
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills/test-skill')
                .reply(200, [
                    {
                        name: 'skill-manifest.json',
                        type: 'file',
                        download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/skill-manifest.json'
                    }
                ]);

            nock('https://raw.githubusercontent.com')
                .get('/test-owner/test-olaf-repo/main/.olaf/core/skills/test-skill/skill-manifest.json')
                .reply(200, JSON.stringify({
                    name: 'Test Skill',
                    version: '1.0.0'
                }));

            const adapter = new OlafAdapter(mockSource);
            const bundles = await adapter.fetchBundles();
            
            // Runtime installation should fail and cause skill installation to fail
            await assert.rejects(
                () => adapter.downloadBundle(bundles[0]),
                /Failed to install OLAF runtime - OLAF skills cannot function without the runtime/
            );
            
            // Verify runtime installation was attempted
            assert.ok(runtimeManagerStub.ensureRuntimeInstalled.calledOnce, 'Runtime manager should be called');
        });
    });

    suite('Bundle Validation', () => {
        test('should validate OLAF repository structure', async () => {
            // Mock repository validation
            nock('https://api.github.com')
                .get('/repos/test-owner/test-olaf-repo')
                .reply(200, { name: 'test-olaf-repo' })
                .get('/repos/test-owner/test-olaf-repo/releases')
                .reply(200, [])
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills')
                .times(2) // Called once for validate, once for scanSkillsDirectory
                .reply(200, [
                    {
                        name: 'skill1',
                        path: '.olaf/core/skills/skill1',
                        type: 'dir'
                    },
                    {
                        name: 'skill2',
                        path: '.olaf/core/skills/skill2',
                        type: 'dir'
                    }
                ])
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills/skill1')
                .reply(200, [
                    {
                        name: 'skill-manifest.json',
                        type: 'file',
                        download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/.olaf/core/skills/skill1/skill-manifest.json'
                    }
                ])
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills/skill2')
                .reply(200, [
                    {
                        name: 'skill-manifest.json',
                        type: 'file',
                        download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/.olaf/core/skills/skill2/skill-manifest.json'
                    }
                ]);

            // Mock skill manifest downloads
            nock('https://raw.githubusercontent.com')
                .get('/test-owner/test-olaf-repo/main/.olaf/core/skills/skill1/skill-manifest.json')
                .reply(200, JSON.stringify({ name: 'Skill 1' }))
                .get('/test-owner/test-olaf-repo/main/.olaf/core/skills/skill2/skill-manifest.json')
                .reply(200, JSON.stringify({ name: 'Skill 2' }));

            const adapter = new OlafAdapter(mockSource);
            const result = await adapter.validate();

            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
            assert.strictEqual(result.bundlesFound, 2);
        });

        test('should report validation failure for missing OLAF structure', async () => {
            // Mock repository validation - missing .olaf/core/skills
            nock('https://api.github.com')
                .get('/repos/test-owner/test-olaf-repo')
                .reply(200, { name: 'test-olaf-repo' })
                .get('/repos/test-owner/test-olaf-repo/releases')
                .reply(200, [])
                .get('/repos/test-owner/test-olaf-repo/contents/.olaf/core/skills')
                .reply(404, { message: 'Not Found' });

            const adapter = new OlafAdapter(mockSource);
            const result = await adapter.validate();

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0);
            assert.ok(result.errors[0].includes('.olaf/core/skills'));
        });
    });

    suite('Post-Installation', () => {
        test('should register skill in competency index after installation', async () => {
            const fs = require('fs');
            const path = require('path');
            
            // Mock workspace path
            const workspacePath = '/test/workspace';
            const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source', 'test-skill');
            const competencyIndexPath = path.join(workspacePath, '.olaf', 'olaf-core', 'reference', 'competency-index.json');
            
            // Create mock skill manifest
            const skillManifest = {
                metadata: {
                    name: 'Test Skill',
                    version: '1.0.0',
                    description: 'A test skill',
                    aliases: ['test-pattern', 'test skill'],
                    protocol: 'Propose-Confirm-Act'
                }
            };
            
            // Mock file system operations
            const existsSyncStub = sinon.stub(fs, 'existsSync');
            const mkdirSyncStub = sinon.stub(fs, 'mkdirSync');
            const readFileSyncStub = sinon.stub(fs, 'readFileSync');
            const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
            
            // Setup: competency index doesn't exist yet
            existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(false);
            existsSyncStub.withArgs(sinon.match(/skill-manifest\.json$/)).returns(true);
            
            // Mock skill manifest read
            readFileSyncStub.withArgs(sinon.match(/skill-manifest\.json$/), 'utf-8')
                .returns(JSON.stringify(skillManifest));
            
            const adapter = new OlafAdapter(mockSource);
            await adapter.postInstall('olaf-test-owner-test-repo-test-skill', installPath);
            
            // Verify competency index was created
            assert.ok(mkdirSyncStub.calledWith(sinon.match(/reference$/), { recursive: true }));
            
            // Verify skill was written to competency index
            assert.ok(writeFileSyncStub.calledOnce);
            const writtenData = JSON.parse(writeFileSyncStub.firstCall.args[1]);
            
            assert.ok(Array.isArray(writtenData), 'Competency index should be an array');
            assert.strictEqual(writtenData.length, 1);
            assert.deepStrictEqual(writtenData[0].patterns, ['test-pattern', 'test skill']);
            assert.strictEqual(writtenData[0].file, 'external-skills/test-source/test-skill/prompts/test-skill.md');
            assert.strictEqual(writtenData[0].protocol, 'Propose-Confirm-Act');
        });

        test('should update existing skill entry in competency index', async () => {
            const fs = require('fs');
            const path = require('path');
            
            const workspacePath = '/test/workspace';
            const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source', 'test-skill');
            
            // Existing competency index with the skill already registered (flat array format)
            const existingIndex = [
                {
                    patterns: ['old-pattern'],
                    file: 'external-skills/test-source/test-skill/prompts/test-skill.md',
                    protocol: 'Act'
                }
            ];
            
            const updatedManifest = {
                metadata: {
                    name: 'Updated Skill',
                    version: '2.0.0',
                    description: 'Updated description',
                    aliases: ['new-pattern', 'updated skill'],
                    protocol: 'Propose-Confirm-Act'
                }
            };
            
            const existsSyncStub = sinon.stub(fs, 'existsSync');
            const mkdirSyncStub = sinon.stub(fs, 'mkdirSync');
            const readFileSyncStub = sinon.stub(fs, 'readFileSync');
            const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
            
            existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(true);
            existsSyncStub.withArgs(sinon.match(/skill-manifest\.json$/)).returns(true);
            
            readFileSyncStub.withArgs(sinon.match(/competency-index\.json$/), 'utf-8')
                .returns(JSON.stringify(existingIndex));
            readFileSyncStub.withArgs(sinon.match(/skill-manifest\.json$/), 'utf-8')
                .returns(JSON.stringify(updatedManifest));
            
            const adapter = new OlafAdapter(mockSource);
            await adapter.postInstall('olaf-test-owner-test-repo-test-skill', installPath);
            
            // Verify the existing entry was updated
            assert.ok(writeFileSyncStub.calledOnce);
            const writtenData = JSON.parse(writeFileSyncStub.firstCall.args[1]);
            
            assert.ok(Array.isArray(writtenData), 'Competency index should be an array');
            assert.strictEqual(writtenData.length, 1);
            assert.deepStrictEqual(writtenData[0].patterns, ['new-pattern', 'updated skill']);
            assert.strictEqual(writtenData[0].file, 'external-skills/test-source/test-skill/prompts/test-skill.md');
            assert.strictEqual(writtenData[0].protocol, 'Propose-Confirm-Act');
        });
    });

    suite('Post-Uninstallation', () => {
        test('should remove skill from competency index after uninstallation', async () => {
            const fs = require('fs');
            const path = require('path');
            
            const workspacePath = '/test/workspace';
            const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source', 'test-skill');
            
            // Existing competency index with multiple skills including the one to remove
            const existingIndex = [
                {
                    patterns: ['test-pattern'],
                    file: 'external-skills/test-source/test-skill/prompts/test-skill.md',
                    protocol: 'Act'
                },
                {
                    patterns: ['other-pattern'],
                    file: 'external-skills/other-source/other-skill/prompts/other-skill.md',
                    protocol: 'Propose-Confirm-Act'
                }
            ];
            
            const existsSyncStub = sinon.stub(fs, 'existsSync');
            const readFileSyncStub = sinon.stub(fs, 'readFileSync');
            const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
            
            existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(true);
            
            readFileSyncStub.withArgs(sinon.match(/competency-index\.json$/), 'utf-8')
                .returns(JSON.stringify(existingIndex));
            
            const adapter = new OlafAdapter(mockSource);
            await adapter.postUninstall('olaf-test-owner-test-repo-test-skill', installPath);
            
            // Verify the skill was removed from competency index
            assert.ok(writeFileSyncStub.calledOnce);
            const writtenData = JSON.parse(writeFileSyncStub.firstCall.args[1]);
            
            assert.ok(Array.isArray(writtenData), 'Competency index should be an array');
            assert.strictEqual(writtenData.length, 1, 'Should have one skill remaining');
            assert.strictEqual(writtenData[0].file, 'external-skills/other-source/other-skill/prompts/other-skill.md');
            assert.deepStrictEqual(writtenData[0].patterns, ['other-pattern']);
        });

        test('should handle empty competency index after removing last skill', async () => {
            const fs = require('fs');
            const path = require('path');
            
            const workspacePath = '/test/workspace';
            const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source', 'test-skill');
            
            // Existing competency index with only the skill to remove
            const existingIndex = [
                {
                    patterns: ['test-pattern'],
                    file: 'external-skills/test-source/test-skill/prompts/test-skill.md',
                    protocol: 'Act'
                }
            ];
            
            const existsSyncStub = sinon.stub(fs, 'existsSync');
            const readFileSyncStub = sinon.stub(fs, 'readFileSync');
            const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
            
            existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(true);
            
            readFileSyncStub.withArgs(sinon.match(/competency-index\.json$/), 'utf-8')
                .returns(JSON.stringify(existingIndex));
            
            const adapter = new OlafAdapter(mockSource);
            await adapter.postUninstall('olaf-test-owner-test-repo-test-skill', installPath);
            
            // Verify the competency index is now empty
            assert.ok(writeFileSyncStub.calledOnce);
            const writtenData = JSON.parse(writeFileSyncStub.firstCall.args[1]);
            
            assert.ok(Array.isArray(writtenData), 'Competency index should be an array');
            assert.strictEqual(writtenData.length, 0, 'Should be empty after removing the only skill');
        });

        test('should handle non-existent competency index gracefully', async () => {
            const fs = require('fs');
            const path = require('path');
            
            const workspacePath = '/test/workspace';
            const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source', 'test-skill');
            
            const existsSyncStub = sinon.stub(fs, 'existsSync');
            const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
            
            existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(false);
            
            const adapter = new OlafAdapter(mockSource);
            await adapter.postUninstall('olaf-test-owner-test-repo-test-skill', installPath);
            
            // Verify no write operation was attempted
            assert.ok(writeFileSyncStub.notCalled, 'Should not attempt to write when file does not exist');
        });

        test('should handle skill not found in competency index', async () => {
            const fs = require('fs');
            const path = require('path');
            
            const workspacePath = '/test/workspace';
            const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source', 'test-skill');
            
            // Existing competency index without the skill to remove
            const existingIndex = [
                {
                    patterns: ['other-pattern'],
                    file: 'external-skills/other-source/other-skill/prompts/other-skill.md',
                    protocol: 'Propose-Confirm-Act'
                }
            ];
            
            const existsSyncStub = sinon.stub(fs, 'existsSync');
            const readFileSyncStub = sinon.stub(fs, 'readFileSync');
            const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');
            
            existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(true);
            
            readFileSyncStub.withArgs(sinon.match(/competency-index\.json$/), 'utf-8')
                .returns(JSON.stringify(existingIndex));
            
            const adapter = new OlafAdapter(mockSource);
            await adapter.postUninstall('olaf-test-owner-test-repo-test-skill', installPath);
            
            // Verify no write operation was attempted since skill was not found
            assert.ok(writeFileSyncStub.notCalled, 'Should not write when skill is not found');
        });
    });
});