/**
 * Shared ZIP utility for adapter tests.
 *
 * Previously duplicated in both awesome-copilot-plugin and local-awesome-copilot-plugin
 * test files. Extracted here so all adapter tests share a single implementation.
 */

import yauzl from 'yauzl';

/**
 * Extract all entries from a ZIP buffer into a map of path → content (string).
 * Directory entries are skipped.
 * @param buffer - ZIP file as a Buffer
 */
export function extractZipBuffer(buffer: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err || new Error('Failed to open ZIP'));
        return;
      }
      const entries = new Map<string, string>();
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            reject(streamErr || new Error('Failed to read entry'));
            return;
          }
          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
          readStream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zipfile.readEntry();
          });
          readStream.on('error', reject);
        });
      });
      zipfile.on('end', () => resolve(entries));
      zipfile.on('error', reject);
    });
  });
}
