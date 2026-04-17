/**
 * Video editing service
 * Handles video processing operations (trim, watermark, subtitles, etc.)
 */

import axios from 'axios';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import {
  deleteFiles,
  createTempFilePath,
  writeStreamToFile,
  writeBase64ToFile,
  writeTextToFile,
  findFiles,
  getTmpDir,
} from '../utils/fileUtils.js';
import {
  trimVideo,
  extractAudio,
  addTextWatermark,
  addImageWatermark,
  burnSubtitles,
  detectSceneCuts,
  splitVideoByTimestamps,
} from '../utils/ffmpegUtils.js';
import { normalizeVideoUrl } from '../utils/urlUtils.js';
import { APIError } from '../middleware/errorHandler.js';
import { Response } from 'express';
import fs from 'fs';
import path from 'path';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Download video from URL
 */
async function downloadVideo(url: string, outputPath: string): Promise<void> {
  try {
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.xiaohongshu.com/',
      },
      timeout: 60000,
    });

    await writeStreamToFile(response.data, outputPath);
  } catch (error) {
    throw new APIError(500, 'Failed to download video from URL');
  }
}

/**
 * Apply custom watermark to video
 */
export async function applyCustomWatermark(
  url: string,
  res: Response,
  options: {
    type: 'text' | 'image';
    text?: string;
    image?: string;
    filename?: string;
  }
): Promise<void> {
  const jobId = uuidv4();
  const tmpDir = getTmpDir();
  const inputVideo = createTempFilePath(jobId, 'input.mp4');
  const outputVideo = createTempFilePath(jobId, 'output.mp4');
  const watermarkImgPath = createTempFilePath(jobId, 'watermark.png');

  try {
    await downloadVideo(url, inputVideo);

    if (options.type === 'text' && options.text) {
      await addTextWatermark(inputVideo, outputVideo, options.text);
    } else if (options.type === 'image' && options.image) {
      writeBase64ToFile(watermarkImgPath, options.image);
      await addImageWatermark(inputVideo, watermarkImgPath, outputVideo);
    } else {
      throw new APIError(400, 'Invalid watermark options');
    }

    const filename = options.filename || `watermarked_${jobId}.mp4`;
    res.download(outputVideo, filename, () => {
      deleteFiles([inputVideo, outputVideo, watermarkImgPath]);
    });
  } catch (error) {
    deleteFiles([inputVideo, outputVideo, watermarkImgPath]);
    if (error instanceof APIError) throw error;
    throw new APIError(500, 'Failed to apply watermark');
  }
}

/**
 * Download video via proxy
 */
export async function proxyDownload(
  url: string,
  filename: string,
  res: Response
): Promise<void> {
  try {
    let targetUrl = normalizeVideoUrl(url);

    const response = await axios({
      method: 'GET',
      url: targetUrl,
      responseType: 'stream',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://www.xiaohongshu.com/',
      },
      timeout: 60000,
    });

    const safeFilename = encodeURIComponent(filename || 'video.mp4');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');

    response.data.pipe(res);
  } catch (error) {
    throw new APIError(500, 'Failed to download file');
  }
}

/**
 * Auto-cut video into scenes
 */
export async function autoCutVideo(
  url: string,
  threshold: number,
  res: Response
): Promise<void> {
  const jobId = uuidv4();
  const tmpDir = getTmpDir();
  const inputPath = createTempFilePath(jobId, 'input.mp4');
  const outputPattern = createTempFilePath(jobId, 'out_%03d.mp4');

  try {
    await downloadVideo(url, inputPath);

    // Detect scene cuts
    const timestamps = await detectSceneCuts(inputPath, threshold);

    // Split video by timestamps
    await splitVideoByTimestamps(inputPath, outputPattern, timestamps);

    // Create ZIP archive
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="auto_cut_${jobId}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const files = findFiles(
      tmpDir,
      (f) => f.startsWith(`${jobId}_out_`) && f.endsWith('.mp4')
    );

    for (const file of files) {
      const filePath = path.join(tmpDir, file);
      archive.file(filePath, { name: file.replace(`${jobId}_`, '') });
    }

    await archive.finalize();

    // Cleanup
    deleteFiles([inputPath, ...files.map(f => path.join(tmpDir, f))]);
  } catch (error) {
    const files = findFiles(
      tmpDir,
      (f) => f.startsWith(`${jobId}_`) && f.endsWith('.mp4')
    );
    deleteFiles([
      inputPath,
      ...files.map(f => path.join(tmpDir, f)),
    ]);

    if (error instanceof APIError) throw error;
    throw new APIError(500, 'Failed to process video');
  }
}

/**
 * Trim video to specific duration
 */
export async function trimVideoToFile(
  url: string,
  startTime: number | string,
  endTime: number | string,
  filename: string,
  res: Response
): Promise<void> {
  const jobId = uuidv4();
  const inputPath = createTempFilePath(jobId, 'input.mp4');
  const outputPath = createTempFilePath(jobId, 'output.mp4');

  try {
    await downloadVideo(url, inputPath);
    await trimVideo(inputPath, outputPath, startTime, endTime);

    const safeFilename = filename || `trimmed_${jobId}.mp4`;
    res.download(outputPath, safeFilename, () => {
      deleteFiles([inputPath, outputPath]);
    });
  } catch (error) {
    deleteFiles([inputPath, outputPath]);
    if (error instanceof APIError) throw error;
    throw new APIError(500, 'Failed to trim video');
  }
}

/**
 * Extract audio from video
 */
export async function extractAudioFromVideo(
  url: string,
  filename: string,
  res: Response
): Promise<void> {
  const jobId = uuidv4();
  const inputPath = createTempFilePath(jobId, 'input.mp4');
  const outputPath = createTempFilePath(jobId, 'audio.mp3');

  try {
    await downloadVideo(url, inputPath);
    await extractAudio(inputPath, outputPath);

    const safeFilename = filename || `audio_${jobId}.mp3`;
    res.download(outputPath, safeFilename, () => {
      deleteFiles([inputPath, outputPath]);
    });
  } catch (error) {
    deleteFiles([inputPath, outputPath]);
    if (error instanceof APIError) throw error;
    throw new APIError(500, 'Failed to extract audio');
  }
}

/**
 * Burn subtitles into video
 */
export async function burnSubtitlesToVideo(
  url: string,
  srtContent: string,
  filename: string,
  res: Response
): Promise<void> {
  const jobId = uuidv4();
  const inputVideo = createTempFilePath(jobId, 'input.mp4');
  const srtFile = createTempFilePath(jobId, 'subs.srt');
  const outputVideo = createTempFilePath(jobId, 'output.mp4');

  try {
    await downloadVideo(url, inputVideo);
    writeTextToFile(srtFile, srtContent);
    await burnSubtitles(inputVideo, srtFile, outputVideo);

    const safeFilename = filename || `subtitled_${jobId}.mp4`;
    res.download(outputVideo, safeFilename, () => {
      deleteFiles([inputVideo, srtFile, outputVideo]);
    });
  } catch (error) {
    deleteFiles([inputVideo, srtFile, outputVideo]);
    if (error instanceof APIError) throw error;
    throw new APIError(500, 'Failed to burn subtitles');
  }
}
