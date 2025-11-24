/**
 * Command utility functions for handling command parameters
 * Provides parameter extraction and normalization for command handlers
 */

import { RegistrySource } from '../types/registry';

/**
 * Extracts a source ID from various parameter types
 * 
 * This function normalizes command parameters to handle different invocation contexts:
 * - Contextual menu: Receives RegistryTreeItem object with source data
 * - Command palette: Receives undefined (triggers picker)
 * - Direct invocation: Receives string ID
 * 
 * @param param - The parameter passed to the command handler (unknown type)
 * @returns The extracted source ID, or undefined if extraction fails or param is undefined
 * 
 * @example
 * // From contextual menu (right-click on tree item)
 * const id = extractSourceId(treeItem); // Returns source.id
 * 
 * @example
 * // From command palette (no parameter)
 * const id = extractSourceId(undefined); // Returns undefined (triggers picker)
 * 
 * @example
 * // From direct invocation with string ID
 * const id = extractSourceId("my-source-id"); // Returns "my-source-id"
 */
export function extractSourceId(param: unknown): string | undefined {
    // Handle RegistryTreeItem from contextual menu
    if (isRegistryTreeItem(param)) {
        const treeItem = param as any;
        
        // Verify the tree item contains source data
        // TreeItemType.SOURCE has the value 'source'
        if (treeItem.type === 'source' && treeItem.data) {
            const source = treeItem.data as RegistrySource;
            return source?.id;
        }
    }
    
    // Handle string ID from command palette or direct invocation
    if (typeof param === 'string') {
        return param;
    }
    
    // Return undefined to trigger picker (command palette invocation)
    return undefined;
}

/**
 * Type guard to check if an object is a RegistryTreeItem
 * 
 * Validates that the object has the required properties of a RegistryTreeItem:
 * - label: string property for display text
 * - type: TreeItemType enum value
 * - data: optional property containing the actual data (source, bundle, profile, etc.)
 * 
 * @param obj - The object to check
 * @returns True if the object is a RegistryTreeItem, false otherwise
 * 
 * @example
 * if (isRegistryTreeItem(param)) {
 *   const treeItem = param as RegistryTreeItem;
 *   // Safe to access treeItem.data, treeItem.type, etc.
 * }
 */
export function isRegistryTreeItem(obj: unknown): boolean {
    return (
        obj !== null &&
        obj !== undefined &&
        typeof obj === 'object' &&
        'label' in obj &&
        'type' in obj &&
        'data' in obj
    );
}
