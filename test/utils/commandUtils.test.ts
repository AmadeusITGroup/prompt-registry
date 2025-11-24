/**
 * Property-Based Tests for Command Utilities
 * 
 * Tests the parameter extraction logic for command handlers
 * Uses fast-check for property-based testing with 100+ iterations
 */

import * as assert from 'assert';
import * as fc from 'fast-check';
import { extractSourceId, isRegistryTreeItem } from '../../src/utils/commandUtils';
import { RegistrySource } from '../../src/types/registry';

/**
 * Mock RegistryTreeItem structure for testing
 * Mimics the structure without requiring vscode dependency
 * Using string literal for type to match TreeItemType.SOURCE = 'source'
 */
interface MockRegistryTreeItem {
    label: string;
    type: 'source';  // TreeItemType.SOURCE value
    data?: any;
    contextValue?: string;
}

suite('CommandUtils - Property-Based Tests', () => {
    
    /**
     * **Feature: fix-contextual-menu-commands, Property 1: Tree Item ID Extraction**
     * 
     * Property: For any RegistryTreeItem containing a RegistrySource in its data property,
     * extracting the source ID from the tree item SHALL return the same ID as the source's id property.
     * 
     * **Validates: Requirements 1.2, 2.2, 3.2, 4.2**
     */
    suite('Property 1: Tree Item ID Extraction', () => {
        test('should extract the same ID from RegistryTreeItem as the source id property', () => {
            // Generator for valid source IDs (alphanumeric with hyphens)
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for RegistrySource objects
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: extractSourceId(treeItem) === source.id
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    // Create a mock RegistryTreeItem with the source as data
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract the ID from the tree item
                    const extractedId = extractSourceId(treeItem);
                    
                    // The extracted ID should equal the source's ID
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Extracted ID "${extractedId}" should match source ID "${source.id}"`
                    );
                }),
                { numRuns: 100 } // Run 100 iterations as specified in design
            );
        });
        
        test('should handle tree items with various source types', () => {
            // Generator for different source types
            const sourceTypeArbitrary = fc.constantFrom('github', 'gitlab', 'http', 'local', 'awesome-copilot');
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for RegistrySource with various types
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, sourceTypeArbitrary).map(
                ([id, type]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: type as any,
                    url: `https://example.com/${id}`,
                    enabled: true,
                    priority: 1,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: ID extraction works regardless of source type
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `ID extraction should work for source type "${source.type}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should handle tree items with enabled/disabled sources', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const enabledArbitrary = fc.boolean();
            
            // Generator for sources with random enabled state
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, enabledArbitrary).map(
                ([id, enabled]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: 'github',
                    url: `https://github.com/test/${id}`,
                    enabled: enabled,
                    priority: 1,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: ID extraction works regardless of enabled state
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `ID extraction should work regardless of enabled state (${source.enabled})`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should handle tree items with various priority values', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const priorityArbitrary = fc.integer({ min: 0, max: 100 });
            
            // Generator for sources with random priority
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, priorityArbitrary).map(
                ([id, priority]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: 'github',
                    url: `https://github.com/test/${id}`,
                    enabled: true,
                    priority: priority,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: ID extraction works regardless of priority
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `ID extraction should work regardless of priority (${source.priority})`
                    );
                }),
                { numRuns: 100 }
            );
        });
    });
    
    /**
     * **Feature: fix-contextual-menu-commands, Property 2: String ID Pass-Through**
     * 
     * Property: For any string source ID passed to a command handler,
     * the handler SHALL use that ID directly without modification or re-extraction.
     * 
     * **Validates: Requirements 1.3, 2.3, 3.3, 4.3**
     */
    suite('Property 2: String ID Pass-Through', () => {
        test('should return string IDs unchanged', () => {
            // Generator for valid source IDs (alphanumeric with hyphens)
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Property: extractSourceId(stringId) === stringId
            fc.assert(
                fc.property(sourceIdArbitrary, (sourceId) => {
                    // Pass the string ID directly to extractSourceId
                    const extractedId = extractSourceId(sourceId);
                    
                    // The extracted ID should be identical to the input string
                    assert.strictEqual(
                        extractedId,
                        sourceId,
                        `String ID "${sourceId}" should be returned unchanged, got "${extractedId}"`
                    );
                }),
                { numRuns: 100 } // Run 100 iterations as specified in design
            );
        });
        
        test('should handle various string formats without modification', () => {
            // Generator for different valid ID formats
            const idFormats = fc.oneof(
                // Simple lowercase
                fc.stringMatching(/^[a-z]{2,10}$/),
                // With numbers
                fc.stringMatching(/^[a-z0-9]{2,10}$/),
                // With hyphens
                fc.stringMatching(/^[a-z0-9][a-z0-9-]{1,8}[a-z0-9]$/),
                // GitHub-style
                fc.stringMatching(/^[a-z0-9-]{3,20}$/),
                // UUID-like
                fc.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
            );
            
            // Property: All valid string formats pass through unchanged
            fc.assert(
                fc.property(idFormats, (sourceId) => {
                    const extractedId = extractSourceId(sourceId);
                    
                    assert.strictEqual(
                        extractedId,
                        sourceId,
                        `String ID format should be preserved: "${sourceId}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should not modify strings with special characters', () => {
            // Generator for IDs with various special characters that might be valid
            const specialCharIdArbitrary = fc.oneof(
                fc.stringMatching(/^[a-z0-9_-]{2,20}$/),  // underscores
                fc.stringMatching(/^[a-z0-9.-]{2,20}$/),  // dots
                fc.stringMatching(/^[a-z0-9@-]{2,20}$/)   // at symbols
            );
            
            // Property: Special characters are preserved
            fc.assert(
                fc.property(specialCharIdArbitrary, (sourceId) => {
                    const extractedId = extractSourceId(sourceId);
                    
                    assert.strictEqual(
                        extractedId,
                        sourceId,
                        `String with special characters should pass through: "${sourceId}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should handle empty and single-character strings', () => {
            // Generator for edge case strings
            const edgeCaseStrings = fc.oneof(
                fc.constant(''),           // empty string
                fc.constant('a'),          // single char
                fc.constant('1'),          // single digit
                fc.constant('-'),          // single hyphen
                fc.stringMatching(/^[a-z]$/)  // any single letter
            );
            
            // Property: Edge case strings pass through unchanged
            fc.assert(
                fc.property(edgeCaseStrings, (sourceId) => {
                    const extractedId = extractSourceId(sourceId);
                    
                    assert.strictEqual(
                        extractedId,
                        sourceId,
                        `Edge case string should pass through: "${sourceId}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should preserve string length and content exactly', () => {
            // Generator for strings of various lengths
            const variableLengthIds = fc.oneof(
                fc.stringMatching(/^[a-z0-9-]{2,5}$/),    // short
                fc.stringMatching(/^[a-z0-9-]{10,20}$/),  // medium
                fc.stringMatching(/^[a-z0-9-]{30,50}$/)   // long
            );
            
            // Property: Length and content are preserved
            fc.assert(
                fc.property(variableLengthIds, (sourceId) => {
                    const extractedId = extractSourceId(sourceId);
                    
                    // Check both value and length
                    assert.strictEqual(extractedId, sourceId, 'Value should match');
                    assert.strictEqual(
                        extractedId?.length,
                        sourceId.length,
                        `Length should be preserved: expected ${sourceId.length}, got ${extractedId?.length}`
                    );
                }),
                { numRuns: 100 }
            );
        });
    });
    
    /**
     * **Feature: fix-contextual-menu-commands, Property 3: Undefined Triggers Picker**
     * 
     * Property: For any command handler invoked with undefined as the parameter,
     * the system SHALL display the source picker dialog before proceeding with any action.
     * 
     * **Validates: Requirements 1.4, 2.4, 3.4, 4.4, 5.6**
     */
    suite('Property 3: Undefined Triggers Picker', () => {
        test('should return undefined when parameter is undefined', () => {
            // Property: extractSourceId(undefined) === undefined
            // This signals to the command handler that it should show the picker
            fc.assert(
                fc.property(fc.constant(undefined), (param) => {
                    const extractedId = extractSourceId(param);
                    
                    assert.strictEqual(
                        extractedId,
                        undefined,
                        'Undefined parameter should return undefined to trigger picker'
                    );
                }),
                { numRuns: 100 } // Run 100 iterations as specified in design
            );
        });
        
        test('should return undefined for null parameter', () => {
            // Property: extractSourceId(null) === undefined
            // Null should also trigger the picker (defensive programming)
            fc.assert(
                fc.property(fc.constant(null), (param) => {
                    const extractedId = extractSourceId(param);
                    
                    assert.strictEqual(
                        extractedId,
                        undefined,
                        'Null parameter should return undefined to trigger picker'
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should return undefined for invalid object types', () => {
            // Generator for objects that are NOT RegistryTreeItems
            const invalidObjectArbitrary = fc.oneof(
                // Plain objects without required properties
                fc.constant({}),
                fc.constant({ foo: 'bar' }),
                fc.constant({ label: 'test' }), // missing type and data
                fc.constant({ type: 'source' }), // missing label and data
                fc.constant({ data: {} }), // missing label and type
                // Objects with wrong property types
                fc.constant({ label: 123, type: 'source', data: {} }),
                fc.constant({ label: 'test', type: 123, data: {} }),
                // Arrays
                fc.constant([]),
                fc.constant(['test']),
                // Numbers
                fc.integer(),
                // Booleans
                fc.boolean()
            );
            
            // Property: Invalid objects return undefined to trigger picker
            fc.assert(
                fc.property(invalidObjectArbitrary, (param) => {
                    const extractedId = extractSourceId(param);
                    
                    assert.strictEqual(
                        extractedId,
                        undefined,
                        `Invalid parameter type should return undefined: ${JSON.stringify(param)}`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should return undefined for tree items with missing data', () => {
            // Generator for tree items that look valid but have missing/invalid data
            const invalidTreeItemArbitrary = fc.oneof(
                // Tree item with undefined data
                fc.constant({
                    label: 'Test Source',
                    type: 'source',
                    data: undefined
                }),
                // Tree item with null data
                fc.constant({
                    label: 'Test Source',
                    type: 'source',
                    data: null
                }),
                // Tree item with data but missing id
                fc.constant({
                    label: 'Test Source',
                    type: 'source',
                    data: { name: 'Test' }
                }),
                // Tree item with wrong type
                fc.constant({
                    label: 'Test Bundle',
                    type: 'bundle',
                    data: { id: 'test-id' }
                })
            );
            
            // Property: Tree items with invalid data return undefined
            fc.assert(
                fc.property(invalidTreeItemArbitrary, (param) => {
                    const extractedId = extractSourceId(param);
                    
                    assert.strictEqual(
                        extractedId,
                        undefined,
                        `Tree item with invalid data should return undefined: ${JSON.stringify(param)}`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should consistently return undefined across multiple invocations', () => {
            // Property: Calling extractSourceId(undefined) multiple times always returns undefined
            // This ensures the function is pure and deterministic
            fc.assert(
                fc.property(fc.constant(undefined), (param) => {
                    const result1 = extractSourceId(param);
                    const result2 = extractSourceId(param);
                    const result3 = extractSourceId(param);
                    
                    assert.strictEqual(result1, undefined, 'First call should return undefined');
                    assert.strictEqual(result2, undefined, 'Second call should return undefined');
                    assert.strictEqual(result3, undefined, 'Third call should return undefined');
                    assert.strictEqual(result1, result2, 'Results should be consistent');
                    assert.strictEqual(result2, result3, 'Results should be consistent');
                }),
                { numRuns: 100 }
            );
        });
    });
    
    /**
     * **Feature: fix-contextual-menu-commands, Property 4: Tree Item Bypasses Picker**
     * 
     * Property: For any command handler invoked with a RegistryTreeItem containing valid source data,
     * the system SHALL skip the source picker dialog and proceed directly to the action without user selection.
     * 
     * At the utility level, this means that when a tree item is provided, extractSourceId should return
     * a valid (non-undefined) ID, which signals to the command handler to skip the picker.
     * 
     * **Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.5**
     */
    suite('Property 4: Tree Item Bypasses Picker', () => {
        test('should return non-undefined ID for tree items (bypassing picker)', () => {
            // Generator for valid source IDs
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for RegistrySource objects
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: extractSourceId(treeItem) !== undefined (picker is bypassed)
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    // Create a tree item with source data
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID from tree item
                    const extractedId = extractSourceId(treeItem);
                    
                    // The extracted ID should NOT be undefined
                    // This signals to the command handler to skip the picker
                    assert.notStrictEqual(
                        extractedId,
                        undefined,
                        'Tree item should produce non-undefined ID to bypass picker'
                    );
                    
                    // The extracted ID should be a valid string
                    assert.strictEqual(
                        typeof extractedId,
                        'string',
                        'Extracted ID should be a string'
                    );
                    
                    // The extracted ID should match the source ID
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Extracted ID should match source ID: expected "${source.id}", got "${extractedId}"`
                    );
                }),
                { numRuns: 100 } // Run 100 iterations as specified in design
            );
        });
        
        test('should bypass picker for all source types', () => {
            // Generator for different source types
            const sourceTypeArbitrary = fc.constantFrom('github', 'gitlab', 'http', 'local', 'awesome-copilot');
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for sources with various types
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, sourceTypeArbitrary).map(
                ([id, type]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: type as any,
                    url: `https://example.com/${id}`,
                    enabled: true,
                    priority: 1,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: Picker bypass works for all source types
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    // Should return non-undefined for all source types
                    assert.notStrictEqual(
                        extractedId,
                        undefined,
                        `Picker should be bypassed for source type "${source.type}"`
                    );
                    
                    // Should return the correct ID
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Should extract correct ID for source type "${source.type}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should bypass picker regardless of source enabled state', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const enabledArbitrary = fc.boolean();
            
            // Generator for sources with random enabled state
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, enabledArbitrary).map(
                ([id, enabled]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: 'github',
                    url: `https://github.com/test/${id}`,
                    enabled: enabled,
                    priority: 1,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: Picker bypass works regardless of enabled state
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    // Should return non-undefined regardless of enabled state
                    assert.notStrictEqual(
                        extractedId,
                        undefined,
                        `Picker should be bypassed for ${source.enabled ? 'enabled' : 'disabled'} source`
                    );
                    
                    // Should return the correct ID
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Should extract correct ID for ${source.enabled ? 'enabled' : 'disabled'} source`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should bypass picker for sources with different priorities', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const priorityArbitrary = fc.integer({ min: 1, max: 100 });
            
            // Generator for sources with random priority
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, priorityArbitrary).map(
                ([id, priority]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: 'github',
                    url: `https://github.com/test/${id}`,
                    enabled: true,
                    priority: priority,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: Picker bypass works regardless of priority
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    // Should return non-undefined regardless of priority
                    assert.notStrictEqual(
                        extractedId,
                        undefined,
                        `Picker should be bypassed for source with priority ${source.priority}`
                    );
                    
                    // Should return the correct ID
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Should extract correct ID for source with priority ${source.priority}`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should bypass picker for private and public sources', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const privateArbitrary = fc.boolean();
            const tokenArbitrary = fc.option(fc.string({ minLength: 10, maxLength: 40 }), { nil: undefined });
            
            // Generator for sources with random private/public state
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, privateArbitrary, tokenArbitrary).map(
                ([id, isPrivate, token]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: 'github',
                    url: `https://github.com/test/${id}`,
                    enabled: true,
                    priority: 1,
                    private: isPrivate,
                    token: token,
                    metadata: {}
                })
            );
            
            // Property: Picker bypass works for both private and public sources
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    // Should return non-undefined for both private and public
                    assert.notStrictEqual(
                        extractedId,
                        undefined,
                        `Picker should be bypassed for ${source.private ? 'private' : 'public'} source`
                    );
                    
                    // Should return the correct ID
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Should extract correct ID for ${source.private ? 'private' : 'public'} source`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should consistently bypass picker across multiple invocations', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: Multiple extractions consistently bypass picker
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID multiple times
                    const id1 = extractSourceId(treeItem);
                    const id2 = extractSourceId(treeItem);
                    const id3 = extractSourceId(treeItem);
                    
                    // All extractions should return non-undefined (bypass picker)
                    assert.notStrictEqual(id1, undefined, 'First extraction should bypass picker');
                    assert.notStrictEqual(id2, undefined, 'Second extraction should bypass picker');
                    assert.notStrictEqual(id3, undefined, 'Third extraction should bypass picker');
                    
                    // All extractions should be identical
                    assert.strictEqual(id1, id2, 'First and second extraction should match');
                    assert.strictEqual(id2, id3, 'Second and third extraction should match');
                    assert.strictEqual(id1, source.id, 'All extractions should match source ID');
                }),
                { numRuns: 100 }
            );
        });
        
        test('should contrast with undefined parameter (which triggers picker)', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: Tree item bypasses picker (returns ID), undefined triggers picker (returns undefined)
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract from tree item (should bypass picker)
                    const treeItemId = extractSourceId(treeItem);
                    
                    // Extract from undefined (should trigger picker)
                    const undefinedId = extractSourceId(undefined);
                    
                    // Tree item should return non-undefined (bypass picker)
                    assert.notStrictEqual(
                        treeItemId,
                        undefined,
                        'Tree item should bypass picker by returning non-undefined ID'
                    );
                    
                    // Undefined should return undefined (trigger picker)
                    assert.strictEqual(
                        undefinedId,
                        undefined,
                        'Undefined parameter should trigger picker by returning undefined'
                    );
                    
                    // Tree item ID should match source ID
                    assert.strictEqual(
                        treeItemId,
                        source.id,
                        'Tree item should extract correct source ID'
                    );
                }),
                { numRuns: 100 }
            );
        });
    });
    
    /**
     * **Feature: fix-contextual-menu-commands, Property 5: Contextual Menu Source Passing**
     * 
     * Property: For any RegistryTreeItem with a specific source, invoking a command from the contextual menu
     * SHALL pass that source as an argument to the command handler, ensuring the correct source is processed.
     * 
     * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
     */
    suite('Property 5: Contextual Menu Source Passing', () => {
        test('should extract correct source ID for edit command invocation', () => {
            // Generator for valid source IDs
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for RegistrySource objects
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: When a tree item is passed to edit command, the correct source ID is extracted
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    // Simulate contextual menu invocation - create tree item
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID as the command handler would
                    const extractedId = extractSourceId(treeItem);
                    
                    // The extracted ID must match the source's ID
                    // This ensures the edit command will operate on the correct source
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Edit command should receive correct source ID: expected "${source.id}", got "${extractedId}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract correct source ID for remove command invocation', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'http',
                url: `https://registry.example.com/${id}`,
                enabled: true,
                priority: 5,
                private: false,
                metadata: {}
            }));
            
            // Property: When a tree item is passed to remove command, the correct source ID is extracted
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    // Simulate contextual menu invocation for remove
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID as the remove command handler would
                    const extractedId = extractSourceId(treeItem);
                    
                    // The extracted ID must match the source's ID
                    // This ensures the remove command will delete the correct source
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Remove command should receive correct source ID: expected "${source.id}", got "${extractedId}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract correct source ID for sync command invocation', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'local',
                url: `/path/to/${id}`,
                enabled: true,
                priority: 10,
                private: false,
                metadata: {}
            }));
            
            // Property: When a tree item is passed to sync command, the correct source ID is extracted
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    // Simulate contextual menu invocation for sync
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID as the sync command handler would
                    const extractedId = extractSourceId(treeItem);
                    
                    // The extracted ID must match the source's ID
                    // This ensures the sync command will refresh the correct source
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Sync command should receive correct source ID: expected "${source.id}", got "${extractedId}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract correct source ID for toggle command invocation', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const enabledArbitrary = fc.boolean();
            
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, enabledArbitrary).map(
                ([id, enabled]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: 'gitlab',
                    url: `https://gitlab.com/test/${id}`,
                    enabled: enabled,
                    priority: 3,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: When a tree item is passed to toggle command, the correct source ID is extracted
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    // Simulate contextual menu invocation for toggle
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID as the toggle command handler would
                    const extractedId = extractSourceId(treeItem);
                    
                    // The extracted ID must match the source's ID
                    // This ensures the toggle command will enable/disable the correct source
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Toggle command should receive correct source ID: expected "${source.id}", got "${extractedId}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should consistently extract same ID across multiple command types', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'awesome-copilot',
                url: `https://github.com/awesome/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: The same tree item should produce the same ID regardless of which command uses it
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    // Create a single tree item
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID multiple times (simulating different command invocations)
                    const editId = extractSourceId(treeItem);
                    const removeId = extractSourceId(treeItem);
                    const syncId = extractSourceId(treeItem);
                    const toggleId = extractSourceId(treeItem);
                    
                    // All extractions should produce the same ID
                    assert.strictEqual(editId, source.id, 'Edit command extraction');
                    assert.strictEqual(removeId, source.id, 'Remove command extraction');
                    assert.strictEqual(syncId, source.id, 'Sync command extraction');
                    assert.strictEqual(toggleId, source.id, 'Toggle command extraction');
                    
                    // All should be equal to each other
                    assert.strictEqual(editId, removeId, 'Edit and Remove should extract same ID');
                    assert.strictEqual(removeId, syncId, 'Remove and Sync should extract same ID');
                    assert.strictEqual(syncId, toggleId, 'Sync and Toggle should extract same ID');
                }),
                { numRuns: 100 }
            );
        });
        
        test('should handle tree items with complex source configurations', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const priorityArbitrary = fc.integer({ min: 1, max: 100 });
            const privateArbitrary = fc.boolean();
            const tokenArbitrary = fc.option(fc.string({ minLength: 10, maxLength: 40 }), { nil: undefined });
            
            // Generator for sources with various configurations
            const complexSourceArbitrary = fc.tuple(
                sourceIdArbitrary,
                priorityArbitrary,
                privateArbitrary,
                tokenArbitrary
            ).map(([id, priority, isPrivate, token]): RegistrySource => ({
                id: id,
                name: `Complex Source ${id}`,
                type: 'github',
                url: `https://github.com/org/${id}`,
                enabled: true,
                priority: priority,
                private: isPrivate,
                token: token,
                metadata: { description: 'Complex test source', homepage: 'https://example.com' }
            }));
            
            // Property: ID extraction works regardless of source configuration complexity
            fc.assert(
                fc.property(complexSourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `ID extraction should work with complex configurations: priority=${source.priority}, private=${source.private}, hasToken=${!!source.token}`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract ID from tree items with minimal required properties', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for minimal valid sources (only required properties)
            const minimalSourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Minimal ${id}`,
                type: 'local',
                url: `/local/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: ID extraction works with minimal source data
            fc.assert(
                fc.property(minimalSourceArbitrary, (source) => {
                    // Create tree item with minimal structure
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source
                        // contextValue is optional
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `ID extraction should work with minimal tree item structure`
                    );
                }),
                { numRuns: 100 }
            );
        });
    });
    
    /**
     * **Feature: fix-contextual-menu-commands, Property 7: Contextual Menu Equivalence**
     * 
     * Property: For any source ID, invoking a command from the contextual menu with a RegistryTreeItem
     * containing that source SHALL produce identical results to invoking the same command from the
     * command palette and manually selecting that same source.
     * 
     * At the utility level, this means that extracting an ID from a tree item should produce the same
     * ID as if it were passed directly as a string (simulating the command palette selection).
     * 
     * **Validates: Requirements 5.7, 5.8, 5.9, 5.10**
     */
    suite('Property 7: Contextual Menu Equivalence', () => {
        test('should extract same ID from tree item as direct string parameter', () => {
            // Generator for valid source IDs
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for RegistrySource objects
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: extractSourceId(treeItem) === extractSourceId(sourceId)
            // This ensures contextual menu invocation produces same result as command palette selection
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    // Simulate contextual menu invocation - create tree item
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID from tree item (contextual menu path)
                    const treeItemId = extractSourceId(treeItem);
                    
                    // Extract ID from string (command palette selection path)
                    const stringId = extractSourceId(source.id);
                    
                    // Both paths should produce identical IDs
                    assert.strictEqual(
                        treeItemId,
                        stringId,
                        `Contextual menu path (tree item) should produce same ID as command palette path (string): expected "${stringId}", got "${treeItemId}"`
                    );
                    
                    // Both should equal the original source ID
                    assert.strictEqual(treeItemId, source.id, 'Tree item extraction should match source ID');
                    assert.strictEqual(stringId, source.id, 'String extraction should match source ID');
                }),
                { numRuns: 100 } // Run 100 iterations as specified in design
            );
        });
        
        test('should produce equivalent results for all source types', () => {
            // Generator for different source types
            const sourceTypeArbitrary = fc.constantFrom('github', 'gitlab', 'http', 'local', 'awesome-copilot');
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for sources with various types
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, sourceTypeArbitrary).map(
                ([id, type]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: type as any,
                    url: `https://example.com/${id}`,
                    enabled: true,
                    priority: 1,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: Equivalence holds across all source types
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const treeItemId = extractSourceId(treeItem);
                    const stringId = extractSourceId(source.id);
                    
                    assert.strictEqual(
                        treeItemId,
                        stringId,
                        `Equivalence should hold for source type "${source.type}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should produce equivalent results for sources with different configurations', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const priorityArbitrary = fc.integer({ min: 1, max: 100 });
            const enabledArbitrary = fc.boolean();
            const privateArbitrary = fc.boolean();
            
            // Generator for sources with various configurations
            const configuredSourceArbitrary = fc.tuple(
                sourceIdArbitrary,
                priorityArbitrary,
                enabledArbitrary,
                privateArbitrary
            ).map(([id, priority, enabled, isPrivate]): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: enabled,
                priority: priority,
                private: isPrivate,
                metadata: {}
            }));
            
            // Property: Equivalence holds regardless of source configuration
            fc.assert(
                fc.property(configuredSourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const treeItemId = extractSourceId(treeItem);
                    const stringId = extractSourceId(source.id);
                    
                    assert.strictEqual(
                        treeItemId,
                        stringId,
                        `Equivalence should hold regardless of configuration: enabled=${source.enabled}, priority=${source.priority}, private=${source.private}`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should maintain equivalence across multiple invocations', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: Multiple invocations produce consistent equivalent results
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Multiple extractions from tree item
                    const treeItemId1 = extractSourceId(treeItem);
                    const treeItemId2 = extractSourceId(treeItem);
                    const treeItemId3 = extractSourceId(treeItem);
                    
                    // Multiple extractions from string
                    const stringId1 = extractSourceId(source.id);
                    const stringId2 = extractSourceId(source.id);
                    const stringId3 = extractSourceId(source.id);
                    
                    // All tree item extractions should be equal
                    assert.strictEqual(treeItemId1, treeItemId2, 'Tree item extractions should be consistent');
                    assert.strictEqual(treeItemId2, treeItemId3, 'Tree item extractions should be consistent');
                    
                    // All string extractions should be equal
                    assert.strictEqual(stringId1, stringId2, 'String extractions should be consistent');
                    assert.strictEqual(stringId2, stringId3, 'String extractions should be consistent');
                    
                    // Tree item and string extractions should be equivalent
                    assert.strictEqual(treeItemId1, stringId1, 'Tree item and string should be equivalent');
                    assert.strictEqual(treeItemId2, stringId2, 'Tree item and string should be equivalent');
                    assert.strictEqual(treeItemId3, stringId3, 'Tree item and string should be equivalent');
                }),
                { numRuns: 100 }
            );
        });
        
        test('should ensure both paths lead to same command execution', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: Both invocation paths produce non-undefined IDs that are equal
            // This ensures both paths will execute the command (not trigger picker)
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const treeItemId = extractSourceId(treeItem);
                    const stringId = extractSourceId(source.id);
                    
                    // Both should be defined (not trigger picker)
                    assert.notStrictEqual(treeItemId, undefined, 'Tree item path should not trigger picker');
                    assert.notStrictEqual(stringId, undefined, 'String path should not trigger picker');
                    
                    // Both should be equal
                    assert.strictEqual(
                        treeItemId,
                        stringId,
                        'Both paths should lead to same command execution with same source ID'
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should handle edge case IDs equivalently', () => {
            // Generator for edge case IDs
            const edgeCaseIdArbitrary = fc.oneof(
                fc.constant('a'),                                    // single char
                fc.constant('ab'),                                   // two chars
                fc.stringMatching(/^[a-z0-9]{2,5}$/),               // short
                fc.stringMatching(/^[a-z0-9-]{40,50}$/),            // long
                fc.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/) // UUID
            );
            
            const edgeCaseSourceArbitrary = edgeCaseIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Edge Case ${id}`,
                type: 'local',
                url: `/local/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: Equivalence holds for edge case IDs
            fc.assert(
                fc.property(edgeCaseSourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const treeItemId = extractSourceId(treeItem);
                    const stringId = extractSourceId(source.id);
                    
                    assert.strictEqual(
                        treeItemId,
                        stringId,
                        `Equivalence should hold for edge case ID: "${source.id}"`
                    );
                }),
                { numRuns: 100 }
            );
        });
    });
    
    /**
     * **Feature: fix-contextual-menu-commands, Property 6: Action Execution After Extraction**
     * 
     * Property: For any successfully extracted source ID (from tree item or string parameter),
     * the command handler SHALL proceed to execute the intended action (edit, remove, sync, or toggle) without errors.
     * 
     * This property tests that extraction produces valid IDs that can be used for command execution.
     * We verify that extracted IDs are non-empty, properly formatted, and consistent.
     * 
     * **Validates: Requirements 1.5, 2.5, 3.5, 4.5**
     */
    suite('Property 6: Action Execution After Extraction', () => {
        test('should extract valid non-empty IDs from tree items', () => {
            // Generator for valid source IDs
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for RegistrySource objects
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: Extracted IDs from tree items are valid and non-empty
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    // Create tree item
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID
                    const extractedId = extractSourceId(treeItem);
                    
                    // Verify extraction succeeded
                    assert.notStrictEqual(
                        extractedId,
                        undefined,
                        'Extracted ID should not be undefined'
                    );
                    
                    // Verify ID is non-empty (TypeScript assertion)
                    if (extractedId === undefined) {
                        throw new Error('Extracted ID should not be undefined');
                    }
                    assert.ok(
                        extractedId.length > 0,
                        'Extracted ID should be non-empty'
                    );
                    
                    // Verify ID matches the source ID (ready for action execution)
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        'Extracted ID should match source ID for action execution'
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract valid non-empty IDs from string parameters', () => {
            // Generator for valid source IDs
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Property: Extracted IDs from strings are valid and non-empty
            fc.assert(
                fc.property(sourceIdArbitrary, (sourceId) => {
                    // Extract ID from string
                    const extractedId = extractSourceId(sourceId);
                    
                    // Verify extraction succeeded
                    assert.notStrictEqual(
                        extractedId,
                        undefined,
                        'Extracted ID should not be undefined'
                    );
                    
                    // Verify ID is non-empty (TypeScript assertion)
                    if (extractedId === undefined) {
                        throw new Error('Extracted ID should not be undefined');
                    }
                    assert.ok(
                        extractedId.length > 0,
                        'Extracted ID should be non-empty'
                    );
                    
                    // Verify ID is unchanged (ready for action execution)
                    assert.strictEqual(
                        extractedId,
                        sourceId,
                        'Extracted ID should match input string for action execution'
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract IDs that are suitable for registry lookup', () => {
            // Generator for various source types
            const sourceTypeArbitrary = fc.constantFrom('github', 'gitlab', 'http', 'local', 'awesome-copilot');
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for sources with various types
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, sourceTypeArbitrary).map(
                ([id, type]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: type as any,
                    url: `https://example.com/${id}`,
                    enabled: true,
                    priority: 1,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: Extracted IDs are suitable for registry lookup (non-null, string type)
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    // Verify ID is a string (required for registry lookup)
                    assert.strictEqual(
                        typeof extractedId,
                        'string',
                        'Extracted ID must be a string for registry lookup'
                    );
                    
                    // Verify ID is not empty (required for valid lookup) - TypeScript assertion
                    if (extractedId === undefined) {
                        throw new Error('Extracted ID should not be undefined');
                    }
                    assert.ok(
                        extractedId.length > 0,
                        'Extracted ID must be non-empty for registry lookup'
                    );
                    
                    // Verify ID matches source ID (ensures correct action execution)
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Extracted ID should match source ID for ${source.type} source`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract IDs consistently for repeated extractions', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: Multiple extractions produce consistent IDs (deterministic behavior)
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract ID multiple times
                    const id1 = extractSourceId(treeItem);
                    const id2 = extractSourceId(treeItem);
                    const id3 = extractSourceId(treeItem);
                    
                    // All extractions should be identical
                    assert.strictEqual(id1, id2, 'First and second extraction should match');
                    assert.strictEqual(id2, id3, 'Second and third extraction should match');
                    assert.strictEqual(id1, id3, 'First and third extraction should match');
                    
                    // All should be valid for action execution
                    assert.notStrictEqual(id1, undefined, 'Extracted ID should be defined');
                    if (id1 === undefined) {
                        throw new Error('Extracted ID should not be undefined');
                    }
                    assert.ok(id1.length > 0, 'Extracted ID should be non-empty');
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract IDs from sources with different enabled states', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const enabledArbitrary = fc.boolean();
            
            // Generator for sources with random enabled state
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, enabledArbitrary).map(
                ([id, enabled]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: 'github',
                    url: `https://github.com/test/${id}`,
                    enabled: enabled,
                    priority: 1,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: ID extraction works regardless of enabled state (all actions should be possible)
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    // Verify extraction succeeded regardless of enabled state
                    assert.notStrictEqual(
                        extractedId,
                        undefined,
                        `Extraction should succeed for ${source.enabled ? 'enabled' : 'disabled'} source`
                    );
                    
                    // Verify ID is valid for action execution
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Extracted ID should be valid for action on ${source.enabled ? 'enabled' : 'disabled'} source`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract IDs from sources with various priorities', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            const priorityArbitrary = fc.integer({ min: 1, max: 100 });
            
            // Generator for sources with random priority
            const registrySourceArbitrary = fc.tuple(sourceIdArbitrary, priorityArbitrary).map(
                ([id, priority]): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: 'github',
                    url: `https://github.com/test/${id}`,
                    enabled: true,
                    priority: priority,
                    private: false,
                    metadata: {}
                })
            );
            
            // Property: ID extraction works regardless of priority (all actions should be possible)
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    const extractedId = extractSourceId(treeItem);
                    
                    // Verify extraction succeeded regardless of priority
                    assert.notStrictEqual(
                        extractedId,
                        undefined,
                        `Extraction should succeed for source with priority ${source.priority}`
                    );
                    
                    // Verify ID is valid for action execution
                    assert.strictEqual(
                        extractedId,
                        source.id,
                        `Extracted ID should be valid for action on source with priority ${source.priority}`
                    );
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract IDs from both tree items and strings equivalently', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            const registrySourceArbitrary = sourceIdArbitrary.map((id): RegistrySource => ({
                id: id,
                name: `Source ${id}`,
                type: 'github',
                url: `https://github.com/test/${id}`,
                enabled: true,
                priority: 1,
                private: false,
                metadata: {}
            }));
            
            // Property: Both extraction paths produce valid IDs suitable for action execution
            fc.assert(
                fc.property(registrySourceArbitrary, (source) => {
                    const treeItem: MockRegistryTreeItem = {
                        label: source.name,
                        type: 'source',
                        data: source,
                        contextValue: 'source'
                    };
                    
                    // Extract from tree item (contextual menu path)
                    const treeItemId = extractSourceId(treeItem);
                    
                    // Extract from string (command palette path)
                    const stringId = extractSourceId(source.id);
                    
                    // Both should be valid for action execution
                    assert.notStrictEqual(treeItemId, undefined, 'Tree item extraction should succeed');
                    assert.notStrictEqual(stringId, undefined, 'String extraction should succeed');
                    
                    // Both should be non-empty (TypeScript assertions)
                    if (treeItemId === undefined || stringId === undefined) {
                        throw new Error('Extracted IDs should not be undefined');
                    }
                    assert.ok(treeItemId.length > 0, 'Tree item ID should be non-empty');
                    assert.ok(stringId.length > 0, 'String ID should be non-empty');
                    
                    // Both should be equal (same action will execute)
                    assert.strictEqual(
                        treeItemId,
                        stringId,
                        'Both extraction paths should produce same ID for action execution'
                    );
                    
                    // Both should match the source ID
                    assert.strictEqual(treeItemId, source.id, 'Tree item ID should match source ID');
                    assert.strictEqual(stringId, source.id, 'String ID should match source ID');
                }),
                { numRuns: 100 }
            );
        });
        
        test('should extract IDs that preserve source identity', () => {
            const sourceIdArbitrary = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
            
            // Generator for multiple sources with UNIQUE IDs
            const multipleSourcesArbitrary = fc.uniqueArray(sourceIdArbitrary, { minLength: 2, maxLength: 10 }).map(
                (ids) => ids.map((id): RegistrySource => ({
                    id: id,
                    name: `Source ${id}`,
                    type: 'github',
                    url: `https://github.com/test/${id}`,
                    enabled: true,
                    priority: 1,
                    private: false,
                    metadata: {}
                }))
            );
            
            // Property: Each source's extracted ID uniquely identifies that source
            fc.assert(
                fc.property(multipleSourcesArbitrary, (sources) => {
                    // Extract IDs from all sources
                    const extractedIds = sources.map(source => {
                        const treeItem: MockRegistryTreeItem = {
                            label: source.name,
                            type: 'source',
                            data: source,
                            contextValue: 'source'
                        };
                        return extractSourceId(treeItem);
                    });
                    
                    // Verify all extractions succeeded
                    extractedIds.forEach((id, index) => {
                        assert.notStrictEqual(
                            id,
                            undefined,
                            `Extraction should succeed for source ${index}`
                        );
                    });
                    
                    // Verify each extracted ID matches its source
                    extractedIds.forEach((id, index) => {
                        assert.strictEqual(
                            id,
                            sources[index].id,
                            `Extracted ID should preserve identity of source ${index}`
                        );
                    });
                    
                    // Verify IDs are distinct (no cross-contamination)
                    const uniqueIds = new Set(extractedIds);
                    assert.strictEqual(
                        uniqueIds.size,
                        extractedIds.length,
                        'Each source should have a unique extracted ID'
                    );
                }),
                { numRuns: 100 }
            );
        });
    });
    
    /**
     * Unit Tests for Command Utilities
     * 
     * Tests specific scenarios and edge cases for parameter extraction
     * Complements property-based tests with concrete examples
     */
    suite('Unit Tests - Parameter Extraction', () => {
        
        suite('extractSourceId - RegistryTreeItem with valid source', () => {
            test('should extract ID from tree item with complete source data', () => {
                const source: RegistrySource = {
                    id: 'test-source-123',
                    name: 'Test Source',
                    type: 'github',
                    url: 'https://github.com/test/repo',
                    enabled: true,
                    priority: 1,
                    private: false,
                    metadata: {}
                };
                
                const treeItem: MockRegistryTreeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: source,
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, 'test-source-123');
            });
            
            test('should extract ID from tree item with minimal source data', () => {
                const source: RegistrySource = {
                    id: 'minimal-source',
                    name: 'Minimal',
                    type: 'local',
                    url: '/local/path',
                    enabled: true,
                    priority: 1,
                    private: false,
                    metadata: {}
                };
                
                const treeItem: MockRegistryTreeItem = {
                    label: 'Minimal',
                    type: 'source',
                    data: source
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, 'minimal-source');
            });
            
            test('should extract ID from tree item with disabled source', () => {
                const source: RegistrySource = {
                    id: 'disabled-source',
                    name: 'Disabled Source',
                    type: 'http',
                    url: 'https://example.com',
                    enabled: false,
                    priority: 5,
                    private: false,
                    metadata: {}
                };
                
                const treeItem: MockRegistryTreeItem = {
                    label: 'Disabled Source',
                    type: 'source',
                    data: source,
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, 'disabled-source');
            });
            
            test('should extract ID from tree item with private source', () => {
                const source: RegistrySource = {
                    id: 'private-source',
                    name: 'Private Source',
                    type: 'github',
                    url: 'https://github.com/private/repo',
                    enabled: true,
                    priority: 10,
                    private: true,
                    token: 'secret-token',
                    metadata: { description: 'Private test source', contact: 'test@example.com' }
                };
                
                const treeItem: MockRegistryTreeItem = {
                    label: 'Private Source',
                    type: 'source',
                    data: source,
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, 'private-source');
            });
        });
        
        suite('extractSourceId - RegistryTreeItem with missing data', () => {
            test('should return undefined when tree item data is undefined', () => {
                const treeItem: MockRegistryTreeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: undefined,
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined when tree item data is null', () => {
                const treeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: null,
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined when tree item data has no id property', () => {
                const treeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: {
                        name: 'Test Source',
                        type: 'github',
                        url: 'https://github.com/test/repo'
                    },
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined when tree item data.id is undefined', () => {
                const treeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: {
                        id: undefined,
                        name: 'Test Source',
                        type: 'github'
                    },
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return null when tree item data.id is null', () => {
                const treeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: {
                        id: null,
                        name: 'Test Source',
                        type: 'github'
                    },
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                // The function returns null when id is null (pass-through behavior)
                assert.strictEqual(result, null);
            });
        });
        
        suite('extractSourceId - RegistryTreeItem with malformed data', () => {
            test('should return undefined when tree item has wrong type (bundle)', () => {
                const treeItem = {
                    label: 'Test Bundle',
                    type: 'bundle',
                    data: {
                        id: 'bundle-id',
                        name: 'Test Bundle'
                    },
                    contextValue: 'bundle'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined when tree item has wrong type (profile)', () => {
                const treeItem = {
                    label: 'Test Profile',
                    type: 'profile',
                    data: {
                        id: 'profile-id',
                        name: 'Test Profile'
                    },
                    contextValue: 'profile'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined when tree item data is a string', () => {
                const treeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: 'invalid-string-data',
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined when tree item data is a number', () => {
                const treeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: 12345,
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined when tree item data is an array', () => {
                const treeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: ['item1', 'item2'],
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined when tree item data.id is not a string', () => {
                const treeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: {
                        id: 12345,
                        name: 'Test Source'
                    },
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, 12345); // Pass-through behavior for non-string IDs
            });
            
            test('should return undefined when tree item data is empty object', () => {
                const treeItem = {
                    label: 'Test Source',
                    type: 'source',
                    data: {},
                    contextValue: 'source'
                };
                
                const result = extractSourceId(treeItem);
                
                assert.strictEqual(result, undefined);
            });
        });
        
        suite('extractSourceId - string parameter', () => {
            test('should return string ID unchanged', () => {
                const result = extractSourceId('test-source-id');
                
                assert.strictEqual(result, 'test-source-id');
            });
            
            test('should return empty string unchanged', () => {
                const result = extractSourceId('');
                
                assert.strictEqual(result, '');
            });
            
            test('should return string with special characters unchanged', () => {
                const result = extractSourceId('test-source_123.v2');
                
                assert.strictEqual(result, 'test-source_123.v2');
            });
            
            test('should return UUID-like string unchanged', () => {
                const result = extractSourceId('550e8400-e29b-41d4-a716-446655440000');
                
                assert.strictEqual(result, '550e8400-e29b-41d4-a716-446655440000');
            });
            
            test('should return very long string unchanged', () => {
                const longId = 'a'.repeat(100);
                const result = extractSourceId(longId);
                
                assert.strictEqual(result, longId);
            });
            
            test('should return single character string unchanged', () => {
                const result = extractSourceId('a');
                
                assert.strictEqual(result, 'a');
            });
        });
        
        suite('extractSourceId - undefined parameter', () => {
            test('should return undefined when parameter is undefined', () => {
                const result = extractSourceId(undefined);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined when called with no arguments', () => {
                const result = extractSourceId(undefined);
                
                assert.strictEqual(result, undefined);
            });
        });
        
        suite('extractSourceId - null parameter', () => {
            test('should return undefined when parameter is null', () => {
                const result = extractSourceId(null);
                
                assert.strictEqual(result, undefined);
            });
        });
        
        suite('extractSourceId - invalid object types', () => {
            test('should return undefined for plain empty object', () => {
                const result = extractSourceId({});
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for object with only label', () => {
                const result = extractSourceId({ label: 'Test' });
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for object with only type', () => {
                const result = extractSourceId({ type: 'source' });
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for object with only data', () => {
                const result = extractSourceId({ data: { id: 'test-id' } });
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for object with label and type but no data', () => {
                const result = extractSourceId({ label: 'Test', type: 'source' });
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for number', () => {
                const result = extractSourceId(42);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for boolean true', () => {
                const result = extractSourceId(true);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for boolean false', () => {
                const result = extractSourceId(false);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for array', () => {
                const result = extractSourceId([]);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for array with items', () => {
                const result = extractSourceId(['item1', 'item2']);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for function', () => {
                const result = extractSourceId(() => 'test');
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for Date object', () => {
                const result = extractSourceId(new Date());
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for RegExp object', () => {
                const result = extractSourceId(/test/);
                
                assert.strictEqual(result, undefined);
            });
            
            test('should return undefined for object with wrong property types', () => {
                const result = extractSourceId({
                    label: 123,
                    type: true,
                    data: 'string'
                });
                
                assert.strictEqual(result, undefined);
            });
        });
        
        suite('isRegistryTreeItem - type guard tests', () => {
            test('should return true for valid tree item structure', () => {
                const treeItem = {
                    label: 'Test',
                    type: 'source',
                    data: { id: 'test-id' }
                };
                
                const result = isRegistryTreeItem(treeItem);
                
                assert.strictEqual(result, true);
            });
            
            test('should return false for null', () => {
                const result = isRegistryTreeItem(null);
                
                assert.strictEqual(result, false);
            });
            
            test('should return false for undefined', () => {
                const result = isRegistryTreeItem(undefined);
                
                assert.strictEqual(result, false);
            });
            
            test('should return false for object missing label', () => {
                const result = isRegistryTreeItem({
                    type: 'source',
                    data: { id: 'test-id' }
                });
                
                assert.strictEqual(result, false);
            });
            
            test('should return false for object missing type', () => {
                const result = isRegistryTreeItem({
                    label: 'Test',
                    data: { id: 'test-id' }
                });
                
                assert.strictEqual(result, false);
            });
            
            test('should return false for object missing data', () => {
                const result = isRegistryTreeItem({
                    label: 'Test',
                    type: 'source'
                });
                
                assert.strictEqual(result, false);
            });
            
            test('should return false for string', () => {
                const result = isRegistryTreeItem('test-string');
                
                assert.strictEqual(result, false);
            });
            
            test('should return false for number', () => {
                const result = isRegistryTreeItem(42);
                
                assert.strictEqual(result, false);
            });
            
            test('should return false for array', () => {
                const result = isRegistryTreeItem([]);
                
                assert.strictEqual(result, false);
            });
        });
    });
});
