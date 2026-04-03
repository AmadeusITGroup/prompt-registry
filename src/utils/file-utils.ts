import * as fs from 'node:fs';
import {
  promisify,
} from 'node:util';

const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);
const access = promisify(fs.access);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);

/**
 * File utility functions for Prompt Registry extension
 */
export class FileUtils {
  /**
   * Check if a file or directory exists
   * @param filePath
   */
  public static async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a directory exists, creating it if necessary
   * @param dirPath
   */
  public static async ensureDirectory(dirPath: string): Promise<void> {
    if (!(await this.exists(dirPath))) {
      await mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Read a file as a string
   * @param filePath
   */
  public static async readFile(filePath: string): Promise<string> {
    return await readFile(filePath, 'utf8');
  }

  /**
   * Get file statistics
   * @param filePath
   */
  public static async getStats(filePath: string): Promise<fs.Stats> {
    return await stat(filePath);
  }

  /**
   * Check if a path is a directory
   * @param filePath
   */
  public static async isDirectory(filePath: string): Promise<boolean> {
    try {
      const stats = await this.getStats(filePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * List directory contents
   * @param dirPath
   */
  public static async listDirectory(dirPath: string): Promise<string[]> {
    return await readdir(dirPath);
  }
}
