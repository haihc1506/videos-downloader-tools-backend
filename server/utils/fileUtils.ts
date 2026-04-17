/**
 * File management utilities
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Get temporary directory
 */
export function getTmpDir(): string {
  return os.tmpdir();
}

/**
 * Safely delete files
 */
export function deleteFiles(filePaths: string[]): void {
  filePaths.forEach(filePath => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn(`Failed to delete file: ${filePath}`, error);
    }
  });
}

/**
 * Safely delete a single file
 */
export function deleteFile(filePath: string): void {
  deleteFiles([filePath]);
}

/**
 * Create temp file path
 */
export function createTempFilePath(jobId: string, suffix: string): string {
  return path.join(getTmpDir(), `${jobId}_${suffix}`);
}

/**
 * Write stream to file
 */
export function writeStreamToFile(
  stream: NodeJS.ReadableStream,
  filePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    stream.pipe(writer);
    writer.on('finish', () => resolve());
    writer.on('error', reject);
  });
}

/**
 * Read file as buffer
 */
export function readFileAsBuffer(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/**
 * Write text to file
 */
export function writeTextToFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Write base64 to file
 */
export function writeBase64ToFile(filePath: string, base64Content: string): void {
  const cleanBase64 = base64Content.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(filePath, cleanBase64, 'base64');
}

/**
 * List files matching pattern in directory
 */
export function findFiles(
  dir: string,
  pattern: RegExp | ((filename: string) => boolean)
): string[] {
  try {
    const files = fs.readdirSync(dir);
    return files.filter(file => {
      if (typeof pattern === 'function') {
        return pattern(file);
      }
      return pattern.test(file);
    });
  } catch (error) {
    console.error('Error listing files:', error);
    return [];
  }
}

/**
 * Directory cleanup with retry
 */
export async function cleanupDirectory(
  dir: string,
  pattern: RegExp,
  maxRetries: number = 3
): Promise<void> {
  const files = findFiles(dir, pattern);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        deleteFile(filePath);
        break;
      } catch (error) {
        retries++;
        if (retries >= maxRetries) {
          console.error(`Failed to delete ${filePath} after ${maxRetries} retries`);
        } else {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  }
}
