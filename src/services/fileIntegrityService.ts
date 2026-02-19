import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { FileIntegrityInfo, ModificationInfo, IntegrityReport } from '../types/integrityTypes';

/**
 * Service for calculating and verifying file integrity using Node.js built-in crypto
 * Refactored to use BLAKE2b instead of xxhash for better portability
 */
export class FileIntegrityService {
    private static readonly CHUNK_SIZE = 64 * 1024; // 64KB chunks for large files
    private static readonly CURRENT_VERSION = '1.1.0'; // Updated version for crypto change

    /**
     * Calculate comprehensive integrity information for a single file
     */
    async calculateFileIntegrity(filePath: string): Promise<FileIntegrityInfo> {
        const stats = await fs.promises.stat(filePath);
        
        // Calculate both hash algorithms efficiently in a single pass
        const hashes = await this.calculateFileHashes(filePath);
        
        return {
            path: filePath,
            sha256: hashes.sha256,
            xxhash64: hashes.blake2b256, // Using BLAKE2b instead of xxhash for better compatibility
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            permissions: stats.mode.toString(8),
            isExecutable: !!(stats.mode & fs.constants.S_IXUSR),
            isSymlink: stats.isSymbolicLink(),
            symlinkTarget: stats.isSymbolicLink() ? await fs.promises.readlink(filePath) : undefined
        };
    }

    /**
     * Calculate integrity information for multiple files in parallel
     */
    async calculateFilesIntegrity(filePaths: string[], concurrency: number = 5): Promise<FileIntegrityInfo[]> {
        const results: FileIntegrityInfo[] = [];
        const semaphore = new Semaphore(concurrency);

        const promises = filePaths.map(async (filePath) => {
            await semaphore.acquire();
            try {
                const integrity = await this.calculateFileIntegrity(filePath);
                results.push(integrity);
            } finally {
                semaphore.release();
            }
        });

        await Promise.all(promises);
        return results.sort((a, b) => a.path.localeCompare(b.path));
    }

    /**
     * Calculate both SHA256 and BLAKE2b hashes in a single file pass for efficiency
     * Replaces xxhash with BLAKE2b for better portability while maintaining performance
     */
    /**
     * Calculate both SHA256 and secondary hash in a single file pass for efficiency
     * Uses SHA-512 as fallback if BLAKE2b is not available in the extension environment
     */
    private async calculateFileHashes(filePath: string): Promise<{ sha256: string; blake2b256: string }> {
        return new Promise((resolve, reject) => {
            const sha256Hash = crypto.createHash('sha256');
            
            // Try BLAKE2b first, fallback to SHA-512 if not supported
            let secondaryHash: crypto.Hash;
            let useBlake2b = true;
            
            try {
                secondaryHash = crypto.createHash('blake2b512');
            } catch (error) {
                // Fallback to SHA-512 if BLAKE2b is not supported in this environment
                secondaryHash = crypto.createHash('sha512');
                useBlake2b = false;
                console.log('Prompt Registry: BLAKE2b not available, using SHA-512 fallback');
            }
            
            const stream = fs.createReadStream(filePath, { highWaterMark: FileIntegrityService.CHUNK_SIZE });
            
            stream.on('data', (chunk: string | Buffer) => {
                sha256Hash.update(chunk);
                secondaryHash.update(chunk);
            });

            stream.on('end', () => {
                const sha256 = sha256Hash.digest('hex');
                const secondaryDigest = secondaryHash.digest('hex');
                // For SHA-512, truncate to 64 chars (256-bit equivalent); for BLAKE2b512, truncate to 64 chars
                const blake2b256 = secondaryDigest.substring(0, 64);
                resolve({ sha256, blake2b256 });
            });

            stream.on('error', reject);
        });
    }

    /**
     * Verify file integrity against expected values
     */
    async verifyFileIntegrity(filePath: string, expectedIntegrity: FileIntegrityInfo): Promise<ModificationInfo> {
        try {
            const currentIntegrity = await this.calculateFileIntegrity(filePath);
            
            const isUnmodified = (
                currentIntegrity.sha256 === expectedIntegrity.sha256 &&
                currentIntegrity.xxhash64 === expectedIntegrity.xxhash64 &&
                currentIntegrity.size === expectedIntegrity.size
            );

            return {
                isModified: !isUnmodified,
                modifiedAt: isUnmodified ? undefined : new Date().toISOString(),
                verificationType: isUnmodified ? 'hash' : 'hash',
                originalIntegrity: expectedIntegrity,
                currentState: isUnmodified ? undefined : currentIntegrity
            };
        } catch (error) {
            return {
                isModified: true,
                modifiedAt: new Date().toISOString(),
                verificationType: 'missing',
                originalIntegrity: expectedIntegrity,
                currentState: undefined
            };
        }
    }

    /**
     * Generate comprehensive integrity report for files
     */
    async generateIntegrityReport(files: FileIntegrityInfo[], existingFiles: FileIntegrityInfo[]): Promise<IntegrityReport> {
        const modifications: Array<{
            file: string;
            type: 'modified' | 'deleted' | 'corrupted' | 'intact';
            details: ModificationInfo;
            recommendation: 'preserve' | 'restore' | 'backup' | 'ignore' | 'remove';
        }> = [];

        let modifiedFiles = 0;
        let deletedFiles = 0;
        let corruptedFiles = 0;
        let intactFiles = 0;

        // Check each original file
        for (const originalFile of files) {
            const currentFile = existingFiles.find(f => f.path === originalFile.path);
            
            if (!currentFile) {
                deletedFiles++;
                modifications.push({
                    file: originalFile.path,
                    type: 'deleted',
                    details: {
                        isModified: true,
                        modifiedAt: new Date().toISOString(),
                        verificationType: 'missing',
                        originalIntegrity: originalFile
                    },
                    recommendation: 'ignore'
                });
            } else {
                const modInfo = await this.verifyFileIntegrity(originalFile.path, originalFile);
                
                if (!modInfo.isModified) {
                    intactFiles++;
                    modifications.push({
                        file: originalFile.path,
                        type: 'intact',
                        details: modInfo,
                        recommendation: 'remove'
                    });
                } else if (modInfo.verificationType === 'missing') {
                    deletedFiles++;
                    modifications.push({
                        file: originalFile.path,
                        type: 'deleted',
                        details: modInfo,
                        recommendation: 'ignore'
                    });
                } else {
                    modifiedFiles++;
                    modifications.push({
                        file: originalFile.path,
                        type: 'modified',
                        details: modInfo,
                        recommendation: 'preserve'
                    });
                }
            }
        }

        const totalFiles = files.length;
        let summary = `Integrity check completed: ${totalFiles} files tracked.`;
        if (intactFiles > 0) {summary += ` ${intactFiles} intact,`;}
        if (modifiedFiles > 0) {summary += ` ${modifiedFiles} modified,`;}
        if (deletedFiles > 0) {summary += ` ${deletedFiles} deleted,`;}
        if (corruptedFiles > 0) {summary += ` ${corruptedFiles} corrupted.`;}

        return {
            totalFiles,
            modifiedFiles,
            deletedFiles,
            corruptedFiles,
            intactFiles,
            modifications,
            summary,
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Quick integrity verification using fast hash comparison
     * Uses BLAKE2b instead of xxhash for better portability
     */
    async quickVerifyFile(filePath: string, expectedSha256: string, expectedBlake2b?: string): Promise<boolean> {
        try {
            const buffer = await fs.promises.readFile(filePath);
            
            // Primary verification with SHA256
            const currentSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
            if (currentSha256 !== expectedSha256) {
                return false;
            }

            // Secondary verification with BLAKE2b if provided (replaces xxhash)
            if (expectedBlake2b) {
                const currentBlake2b = crypto.createHash('blake2b512').update(buffer).digest('hex').substring(0, 64);
                if (currentBlake2b !== expectedBlake2b) {
                    return false;
                }
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Find files in directory matching optional patterns
     */
    async findFiles(directoryPath: string, patterns?: string[]): Promise<string[]> {
        const glob = require('glob');
        const files: string[] = [];

        if (patterns && patterns.length > 0) {
            for (const pattern of patterns) {
                const matches = await glob.glob(pattern, { cwd: directoryPath, absolute: true });
                files.push(...matches);
            }
        } else {
            const matches = await glob.glob('**/*', { 
                cwd: directoryPath, 
                absolute: true, 
                nodir: true 
            });
            files.push(...matches);
        }

        return [...new Set(files)].sort();
    }

    /**
     * Calculate directory summary statistics
     */
    async calculateDirectoryStats(directoryPath: string): Promise<{
        totalFiles: number;
        totalSize: number;
        largestFile: string;
        largestFileSize: number;
        averageFileSize: number;
    }> {
        const files = await this.findFiles(directoryPath);
        let totalSize = 0;
        let largestFile = '';
        let largestFileSize = 0;

        for (const filePath of files) {
            try {
                const stats = await fs.promises.stat(filePath);
                totalSize += stats.size;
                
                if (stats.size > largestFileSize) {
                    largestFileSize = stats.size;
                    largestFile = filePath;
                }
            } catch (error) {
                // Skip files that can't be accessed
                continue;
            }
        }

        return {
            totalFiles: files.length,
            totalSize,
            largestFile,
            largestFileSize,
            averageFileSize: files.length > 0 ? Math.round(totalSize / files.length) : 0
        };
    }
}

/**
 * Simple semaphore implementation for controlling concurrency
 */
class Semaphore {
    private permits: number;
    private waiting: Array<() => void> = [];

    constructor(permits: number) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.permits > 0) {
                this.permits--;
                resolve();
            } else {
                this.waiting.push(resolve);
            }
        });
    }

    release(): void {
        if (this.waiting.length > 0) {
            const resolve = this.waiting.shift()!;
            resolve();
        } else {
            this.permits++;
        }
    }
}
