/**
 * URL and platform detection utilities
 */

import { PlatformType } from '../types/index.js';

/**
 * Detect which platform a URL belongs to
 */
export function detectPlatform(url: string): PlatformType {
  return {
    isTikTok: url.includes('tiktok.com'),
    isDouyin: url.includes('douyin.com'),
    isXHS: url.includes('xiaohongshu.com') || url.includes('xhslink.com'),
  };
}

/**
 * Validate if URL is from a supported platform
 */
export function isValidMediaUrl(url: string): boolean {
  const platform = detectPlatform(url);
  return platform.isTikTok || platform.isDouyin || platform.isXHS;
}

/**
 * Normalize URL for processing
 */
export function normalizeUrl(url: string): string {
  const platform = detectPlatform(url);

  if (platform.isXHS) {
    // Convert discovery URL to explore URL
    return url.replace('/discovery/item/', '/explore/');
  }

  return url;
}

/**
 * Normalize video URL (handles relative and protocol-relative URLs)
 */
export function normalizeVideoUrl(url: string, baseUrl: string = 'https://www.tikwm.com'): string {
  if (!url) return '';
  
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  if (url.startsWith('//')) {
    return 'https:' + url;
  }

  if (url.startsWith('/')) {
    return baseUrl + url;
  }

  return url;
}

/**
 * Safe filename generation from URL
 */
export function generateSafeFilename(originalName: string, fileType: string): string {
  const sanitized = originalName
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase()
    .slice(0, 50);

  return `${sanitized}.${fileType}`;
}

/**
 * Get platform name from URL
 */
export function getPlatformName(url: string): 'tiktok' | 'douyin' | 'xiaohongshu' {
  const platform = detectPlatform(url);
  
  if (platform.isTikTok) return 'tiktok';
  if (platform.isDouyin) return 'douyin';
  return 'xiaohongshu';
}
