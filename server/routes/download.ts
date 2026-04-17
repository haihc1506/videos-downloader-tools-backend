/**
 * Download API routes
 */

import { Router, Request, Response } from 'express';
import { asyncHandler, successResponse, serverError } from '../middleware/errorHandler.js';
import {
  validateDownloadRequest,
  validateBulkDownloadRequest,
} from '../middleware/validation.js';
import { processUrl } from '../services/mediaService.js';

const router = Router();

/**
 * POST /api/download
 * Download single video/image
 */
router.post(
  '/download',
  validateDownloadRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { url, noWatermark } = req.body;
    const result = await processUrl(url, !!noWatermark);
    return successResponse(res, result);
  })
);

/**
 * POST /api/bulk-download
 * Download multiple videos/images with delay between requests
 */
router.post(
  '/bulk-download',
  validateBulkDownloadRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { urls, noWatermark } = req.body;
    const results = [];

    for (const url of urls) {
      try {
        const result = await processUrl(url, !!noWatermark);
        results.push({ url, success: true, data: result });
      } catch (error: any) {
        results.push({
          url,
          success: false,
          error: error.message || 'Failed to process URL',
        });
      }

      // Rate limiting: delay between requests
      if (urls.indexOf(url) < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }

    return successResponse(res, { results });
  })
);

export default router;
