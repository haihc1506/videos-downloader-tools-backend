/**
 * Video editing API routes
 */

import { Router, Request, Response } from 'express';
import { asyncHandler, validationError } from '../middleware/errorHandler.js';
import {
  validateWatermarkRequest,
  validateTrimRequest,
  validateAutoCutRequest,
  validateBurnSubtitlesRequest,
} from '../middleware/validation.js';
import {
  applyCustomWatermark,
  proxyDownload,
  autoCutVideo,
  trimVideoToFile,
  extractAudioFromVideo,
  burnSubtitlesToVideo,
} from '../services/videoEditService.js';
import { validateQueryParam, parseNumberParam } from '../utils/validation.js';

const router = Router();

/**
 * POST /api/edit/custom-watermark
 * Apply custom text or image watermark to video
 */
router.post(
  '/custom-watermark',
  validateWatermarkRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { url, type, text, image, filename } = req.body;

    await applyCustomWatermark(url, res, {
      type,
      text,
      image,
      filename,
    });
  })
);

/**
 * GET /api/proxy-download
 * Download video file via proxy (bypasses CORS)
 */
router.get(
  '/proxy-download',
  asyncHandler(async (req: Request, res: Response) => {
    const { url, filename } = req.query;

    if (!validateQueryParam(url as string)) {
      return validationError(res, 'URL is required');
    }

    await proxyDownload(
      url as string,
      (filename as string) || 'video.mp4',
      res
    );
  })
);

/**
 * GET /api/edit/trim
 * Trim video to specific duration
 */
router.get(
  '/trim',
  validateTrimRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { url, start, end, filename } = req.query;

    const startTime = parseNumberParam(start);
    const endTime = parseNumberParam(end, startTime + 10);

    await trimVideoToFile(
      url as string,
      startTime,
      endTime,
      (filename as string) || `trimmed.mp4`,
      res
    );
  })
);

/**
 * GET /api/edit/extract-audio
 * Extract audio from video
 */
router.get(
  '/extract-audio',
  asyncHandler(async (req: Request, res: Response) => {
    const { url, filename } = req.query;

    if (!validateQueryParam(url as string)) {
      return validationError(res, 'URL is required');
    }

    await extractAudioFromVideo(
      url as string,
      (filename as string) || 'audio.mp3',
      res
    );
  })
);

/**
 * GET /api/edit/auto-cut
 * Detect scene changes and split video
 */
router.get(
  '/auto-cut',
  validateAutoCutRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { url, threshold } = req.query;
    const thresholdValue = parseNumberParam(threshold, 0.3);

    await autoCutVideo(url as string, thresholdValue, res);
  })
);

/**
 * GET /api/edit/burn-subtitles
 * Burn subtitles into video
 */
router.get(
  '/burn-subtitles',
  validateBurnSubtitlesRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { url, srt, filename } = req.query;

    await burnSubtitlesToVideo(
      url as string,
      decodeURIComponent(srt as string),
      (filename as string) || 'subtitled.mp4',
      res
    );
  })
);

export default router;
