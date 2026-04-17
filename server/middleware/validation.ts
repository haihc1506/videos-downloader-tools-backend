/**
 * Request validation middleware
 */

import { Request, Response, NextFunction } from 'express';
import { validationError } from './errorHandler.js';
import {
  validateUrl,
  validateUrlArray,
  validateQueryParam,
  parseNumberParam,
} from '../utils/validation.js';

/**
 * Middleware to validate download endpoint
 */
export function validateDownloadRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { url, noWatermark } = req.body;

  if (!validateUrl(url)) {
    return validationError(res, 'URL is required and must be a non-empty string');
  }

  if (noWatermark !== undefined && typeof noWatermark !== 'boolean') {
    return validationError(res, 'noWatermark must be a boolean');
  }

  next();
}

/**
 * Middleware to validate bulk download endpoint
 */
export function validateBulkDownloadRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { urls, noWatermark } = req.body;

  if (!validateUrlArray(urls)) {
    return validationError(
      res,
      'urls must be an array of non-empty strings'
    );
  }

  if (urls.length === 0) {
    return validationError(res, 'At least one URL is required');
  }

  if (urls.length > 50) {
    return validationError(res, 'Maximum 50 URLs per request');
  }

  if (noWatermark !== undefined && typeof noWatermark !== 'boolean') {
    return validationError(res, 'noWatermark must be a boolean');
  }

  next();
}

/**
 * Middleware to validate trim video endpoint
 */
export function validateTrimRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { url, start, end } = req.query;

  if (!validateQueryParam(url)) {
    return validationError(res, 'URL is required');
  }

  const startTime = parseNumberParam(start);
  const endTime = parseNumberParam(end);

  if (startTime < 0 || endTime < 0) {
    return validationError(res, 'start and end times must be non-negative');
  }

  if (startTime >= endTime && end !== undefined) {
    return validationError(res, 'start time must be less than end time');
  }

  next();
}

/**
 * Middleware to validate watermark endpoint
 */
export function validateWatermarkRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { url, type, text, image } = req.body;

  if (!validateUrl(url)) {
    return validationError(res, 'URL is required');
  }

  if (!['text', 'image', 'none'].includes(type)) {
    return validationError(res, 'type must be "text", "image", or "none"');
  }

  if (type === 'text' && !text) {
    return validationError(res, 'text is required for text watermark');
  }

  if (type === 'image' && !image) {
    return validationError(res, 'image is required for image watermark');
  }

  next();
}

/**
 * Middleware to validate auto-cut endpoint
 */
export function validateAutoCutRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { url, threshold } = req.query;

  if (!validateQueryParam(url)) {
    return validationError(res, 'URL is required');
  }

  const thresholdValue = parseNumberParam(threshold, 0.3);

  if (thresholdValue < 0 || thresholdValue > 1) {
    return validationError(res, 'threshold must be between 0 and 1');
  }

  next();
}

/**
 * Middleware to validate subtitle burn endpoint
 */
export function validateBurnSubtitlesRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { url, srt } = req.query;

  if (!validateQueryParam(url)) {
    return validationError(res, 'URL is required');
  }

  if (!validateQueryParam(srt)) {
    return validationError(res, 'srt content is required');
  }

  next();
}
