/**
 * Collection Validator
 * 
 * Standalone validation logic for awesome-copilot collections.
 * Can be used by VS Code extension or standalone CLI scripts.
 * 
 * Attribution: Inspired by github/awesome-copilot
 * https://github.com/github/awesome-copilot
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Validation error with file context
 */
export interface ValidationError {
    file: string;
    message: string;
    line?: number;
}

/**
 * Validation warning with file context
 */
export interface ValidationWarning {
    file: string;
    message: string;
    line?: number;
}

/**
 * Result of validation
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

/**
 * Collection item structure
 */
interface CollectionItem {
    path: string;
    kind: string;
}

/**
 * Collection structure
 */
interface Collection {
    id?: string;
    name?: string;
    description?: string;
    tags?: string[];
    items?: CollectionItem[];
    display?: {
        ordering?: string;
        show_badge?: boolean;
    };
}

/**
 * CollectionValidator
 * 
 * Validates awesome-copilot collection files:
 * - Required fields (id, name, description, items)
 * - ID format (lowercase, numbers, hyphens only)
 * - Description length (max 500 chars)
 * - Item structure (path, kind)
 * - Valid kinds (prompt, instruction, chat-mode, agent)
 * - File references exist
 * - Tags (optional, max 10, each max 30 chars)
 */
export class CollectionValidator {
    private readonly VALID_KINDS = ['prompt', 'instruction', 'chat-mode', 'agent'];
    private readonly MAX_DESCRIPTION_LENGTH = 500;
    private readonly MAX_TAGS = 10;
    private readonly MAX_TAG_LENGTH = 30;
    private readonly MAX_ITEMS = 50;
    private readonly ID_PATTERN = /^[a-z0-9-]+$/;

    /**
     * Validate a single collection file
     * 
     * @param collectionPath - Absolute path to collection file
     * @param projectRoot - Project root directory for resolving item paths
     * @returns Validation result with errors and warnings
     */
    validateCollection(collectionPath: string, projectRoot: string): ValidationResult {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];
        const fileName = path.basename(collectionPath);

        try {
            // Check file exists
            if (!fs.existsSync(collectionPath)) {
                return {
                    valid: false,
                    errors: [{
                        file: fileName,
                        message: 'Collection file does not exist'
                    }],
                    warnings: []
                };
            }

            // Parse YAML
            const content = fs.readFileSync(collectionPath, 'utf8');
            let collection: Collection;

            try {
                collection = yaml.load(content) as Collection;
            } catch (parseError) {
                return {
                    valid: false,
                    errors: [{
                        file: fileName,
                        message: `Failed to parse YAML: ${(parseError as Error).message}`
                    }],
                    warnings: []
                };
            }

            if (!collection) {
                return {
                    valid: false,
                    errors: [{
                        file: fileName,
                        message: 'Empty or invalid YAML file'
                    }],
                    warnings: []
                };
            }

            // Validate required fields
            this.validateRequiredFields(collection, fileName, errors);

            // Validate ID format
            if (collection.id) {
                this.validateId(collection.id, fileName, errors);
            }

            // Validate description
            if (collection.description) {
                this.validateDescription(collection.description, fileName, warnings);
            }

            // Validate items
            if (collection.items) {
                this.validateItems(collection.items, fileName, projectRoot, errors, warnings);
            }

            // Validate tags
            if (collection.tags) {
                this.validateTags(collection.tags, fileName, errors, warnings);
            }

            return {
                valid: errors.length === 0,
                errors,
                warnings
            };

        } catch (error) {
            return {
                valid: false,
                errors: [{
                    file: fileName,
                    message: `Unexpected error: ${(error as Error).message}`
                }],
                warnings: []
            };
        }
    }

    /**
     * Validate all collections in a directory
     * 
     * @param collectionsDir - Absolute path to collections directory
     * @returns Aggregated validation result
     */
    validateAllCollections(collectionsDir: string): ValidationResult {
        const allErrors: ValidationError[] = [];
        const allWarnings: ValidationWarning[] = [];

        // Check directory exists
        if (!fs.existsSync(collectionsDir)) {
            return {
                valid: false,
                errors: [{
                    file: '',
                    message: `Collections directory not found: ${collectionsDir}`
                }],
                warnings: []
            };
        }

        // Get project root (parent of collections dir)
        const projectRoot = path.dirname(collectionsDir);

        try {
            // Find all collection files
            const files = fs.readdirSync(collectionsDir)
                .filter(f => f.endsWith('.collection.yml'))
                .sort();

            // Validate each file
            for (const file of files) {
                const filePath = path.join(collectionsDir, file);
                const result = this.validateCollection(filePath, projectRoot);

                allErrors.push(...result.errors);
                allWarnings.push(...result.warnings);
            }

            return {
                valid: allErrors.length === 0,
                errors: allErrors,
                warnings: allWarnings
            };

        } catch (error) {
            return {
                valid: false,
                errors: [{
                    file: '',
                    message: `Failed to read collections directory: ${(error as Error).message}`
                }],
                warnings: []
            };
        }
    }

    /**
     * Validate required fields
     */
    private validateRequiredFields(collection: Collection, fileName: string, errors: ValidationError[]): void {
        if (!collection.id) {
            errors.push({
                file: fileName,
                message: 'Missing required field: id'
            });
        }

        if (!collection.name) {
            errors.push({
                file: fileName,
                message: 'Missing required field: name'
            });
        }

        if (!collection.description) {
            errors.push({
                file: fileName,
                message: 'Missing required field: description'
            });
        }

        if (!collection.items || !Array.isArray(collection.items)) {
            errors.push({
                file: fileName,
                message: 'Missing or invalid field: items (must be an array)'
            });
        }
    }

    /**
     * Validate ID format
     */
    private validateId(id: string, fileName: string, errors: ValidationError[]): void {
        if (!this.ID_PATTERN.test(id)) {
            errors.push({
                file: fileName,
                message: 'Invalid id format (must be lowercase letters, numbers, and hyphens only)'
            });
        }
    }

    /**
     * Validate description length
     */
    private validateDescription(description: string, fileName: string, warnings: ValidationWarning[]): void {
        if (description.length > this.MAX_DESCRIPTION_LENGTH) {
            warnings.push({
                file: fileName,
                message: `Description is longer than recommended (${this.MAX_DESCRIPTION_LENGTH} characters)`
            });
        }
    }

    /**
     * Validate items array
     */
    private validateItems(
        items: CollectionItem[],
        fileName: string,
        projectRoot: string,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): void {
        if (items.length === 0) {
            warnings.push({
                file: fileName,
                message: 'Collection has no items'
            });
        }

        if (items.length > this.MAX_ITEMS) {
            warnings.push({
                file: fileName,
                message: `Collection has more than ${this.MAX_ITEMS} items (recommended max)`
            });
        }

        items.forEach((item: any, index: number) => {
            const itemNumber = index + 1;

            // Validate path field
            if (!item.path) {
                errors.push({
                    file: fileName,
                    message: `Item ${itemNumber}: Missing 'path' field`
                });
            }

            // Validate kind field
            if (!item.kind) {
                errors.push({
                    file: fileName,
                    message: `Item ${itemNumber}: Missing 'kind' field`
                });
            } else if (!this.VALID_KINDS.includes(item.kind)) {
                errors.push({
                    file: fileName,
                    message: `Item ${itemNumber}: Invalid 'kind' value (must be one of: ${this.VALID_KINDS.join(', ')})`
                });
            }

            // Validate file exists
            if (item.path) {
                const itemPath = path.join(projectRoot, item.path);
                if (!fs.existsSync(itemPath)) {
                    errors.push({
                        file: fileName,
                        message: `Item ${itemNumber}: Referenced file does not exist: ${item.path}`
                    });
                }
            }
        });
    }

    /**
     * Validate tags array
     */
    private validateTags(
        tags: any,
        fileName: string,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): void {
        if (!Array.isArray(tags)) {
            errors.push({
                file: fileName,
                message: 'Tags must be an array'
            });
            return;
        }

        if (tags.length > this.MAX_TAGS) {
            warnings.push({
                file: fileName,
                message: `More than ${this.MAX_TAGS} tags (recommended max)`
            });
        }

        tags.forEach((tag: any, index: number) => {
            const tagNumber = index + 1;

            if (typeof tag !== 'string') {
                errors.push({
                    file: fileName,
                    message: `Tag ${tagNumber}: Must be a string`
                });
            } else if (tag.length > this.MAX_TAG_LENGTH) {
                warnings.push({
                    file: fileName,
                    message: `Tag ${tagNumber}: Longer than ${this.MAX_TAG_LENGTH} characters`
                });
            }
        });
    }
}
