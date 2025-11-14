import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { McpConfigLocator } from '../../src/utils/mcpConfigLocator';

suite('McpConfigLocator Test Suite', () => {

    test('getUserMcpConfigPath returns correct path for current platform', () => {
        const configPath = McpConfigLocator.getUserMcpConfigPath();
        assert.ok(configPath, 'Config path should not be empty');
        assert.ok(configPath.includes('mcp.json'), 'Path should contain mcp.json');
        
        const platform = os.platform();
        if (platform === 'linux') {
            assert.ok(configPath.includes('.config'), 'Linux path should contain .config');
        } else if (platform === 'darwin') {
            assert.ok(configPath.includes('Library/Application Support'), 'macOS path should contain Library/Application Support');
        } else if (platform === 'win32') {
            assert.ok(configPath.includes('AppData'), 'Windows path should contain AppData');
        }
    });

    test('getUserTrackingPath returns correct path parallel to mcp.json', () => {
        const trackingPath = McpConfigLocator.getUserTrackingPath();
        const configPath = McpConfigLocator.getUserMcpConfigPath();
        
        assert.ok(trackingPath, 'Tracking path should not be empty');
        assert.ok(trackingPath.includes('prompt-registry-mcp-tracking.json'), 
            'Path should contain tracking filename');
        assert.strictEqual(
            path.dirname(trackingPath),
            path.dirname(configPath),
            'Tracking file should be in same directory as mcp.json'
        );
    });

    test('getMcpConfigLocation returns location info for user scope', () => {
        const location = McpConfigLocator.getMcpConfigLocation('user');
        
        assert.ok(location, 'Should return location object');
        assert.ok(location.configPath, 'Should have config path');
        assert.ok(location.trackingPath, 'Should have tracking path');
        assert.strictEqual(typeof location.exists, 'boolean', 'Should have exists flag');
    });
});
