/**
 * @prompt-registry/collection-scripts
 * 
 * Shared scripts for building, validating, and publishing Copilot prompt collections.
 * @module @prompt-registry/collection-scripts
 */

// Type exports
export type {
  ValidationResult,
  ObjectValidationResult,
  FileValidationResult,
  AllCollectionsResult,
  CollectionItem,
  Collection,
  ValidationRules,
  VersionInfo,
  BundleInfo,
} from './types';

// Validation exports
export {
  VALIDATION_RULES,
  loadItemKindsFromSchema,
  validateCollectionId,
  validateVersion,
  validateItemKind,
  normalizeRepoRelativePath,
  isSafeRepoRelativePath,
  validateCollectionObject,
  validateCollectionFile,
  validateAllCollections,
  generateMarkdown,
} from './validate';

// Collection utilities exports
export {
  listCollectionFiles,
  readCollection,
  resolveCollectionItemPaths,
} from './collections';

// Bundle ID exports
export { generateBundleId } from './bundle-id';

// CLI utilities exports
export {
  parseSingleArg,
  parseMultiArg,
  hasFlag,
  getPositionalArg,
} from './cli';
