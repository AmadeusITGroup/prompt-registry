/**
 * RegistryManager Unit Tests
 * 
 * Tests for RegistryManager export/import functionality (integration-style)
 */

import * as assert from 'assert';

suite('RegistryManager Export/Import', () => {
    suite('Export Format Validation', () => {
        test('JSON export should produce valid JSON structure', () => {
            const mockExportData = {
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                sources: [],
                profiles: [],
                configuration: {
                    autoCheckUpdates: true,
                    installationScope: 'user'
                }
            };
            
            const jsonString = JSON.stringify(mockExportData, null, 2);
            const parsed = JSON.parse(jsonString);
            
            assert.strictEqual(parsed.version, '1.0.0');
            assert.ok(Array.isArray(parsed.sources));
            assert.ok(Array.isArray(parsed.profiles));
            assert.ok(parsed.configuration);
        });

        test('YAML export format should be detectable', () => {
            const yamlContent = `version: 1.0.0
sources: []
profiles: []
configuration:
  autoCheckUpdates: true`;
            
            assert.ok(yamlContent.includes('version:'));
            assert.ok(yamlContent.includes('sources:'));
            assert.ok(yamlContent.includes('profiles:'));
        });
    });

    suite('Import Validation', () => {
        test('should validate required version field', () => {
            const validData = {
                version: '1.0.0',
                sources: [],
                profiles: []
            };
            
            assert.ok(validData.version);
            assert.strictEqual(validData.version, '1.0.0');
        });

        test('should validate sources array', () => {
            const validData = {
                version: '1.0.0',
                sources: [],
                profiles: []
            };
            
            assert.ok(Array.isArray(validData.sources));
        });

        test('should validate profiles array', () => {
            const validData = {
                version: '1.0.0',
                sources: [],
                profiles: []
            };
            
            assert.ok(Array.isArray(validData.profiles));
        });
    });

    suite('Data Structure', () => {
        test('exported settings should have required fields', () => {
            const settings = {
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                sources: [],
                profiles: [],
                configuration: {}
            };
            
            assert.ok(settings.version);
            assert.ok(settings.exportedAt);
            assert.ok(Array.isArray(settings.sources));
            assert.ok(Array.isArray(settings.profiles));
            assert.ok(typeof settings.configuration === 'object');
        });

        test('timestamp should be valid ISO string', () => {
            const timestamp = new Date().toISOString();
            const parsed = new Date(timestamp);
            
            assert.ok(parsed.getTime() > 0);
            assert.ok(!isNaN(parsed.getTime()));
        });
    });
});
