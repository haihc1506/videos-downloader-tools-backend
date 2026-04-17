/**
 * Input validation utilities
 */

/**
 * Validate URL string
 */
export function validateUrl(url: unknown): url is string {
  return typeof url === 'string' && url.trim().length > 0;
}

/**
 * Validate array of URLs
 */
export function validateUrlArray(urls: unknown): urls is string[] {
  return Array.isArray(urls) && urls.every(url => validateUrl(url));
}

/**
 * Validate query parameter as string
 */
export function validateQueryParam(param: unknown): param is string {
  return typeof param === 'string' && param.length > 0;
}

/**
 * Validate numbers (timestamps, thresholds)
 */
export function validateNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && value >= 0;
}

/**
 * Parse query parameter to number
 */
export function parseNumberParam(param: unknown, defaultValue: number = 0): number {
  if (typeof param === 'string') {
    const parsed = parseFloat(param);
    return !isNaN(parsed) ? parsed : defaultValue;
  }
  return defaultValue;
}

/**
 * Validate base64 string
 */
export function validateBase64(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value.replace(/^data:image\/\w+;base64,/, '')
    );
  } catch {
    return false;
  }
}

/**
 * Validate SRT subtitle format
 */
export function validateSRT(content: string): boolean {
  if (!content || typeof content !== 'string') return false;
  // Simple SRT validation: check for common patterns
  return /\d+\n\d{2}:\d{2}:\d{2}/m.test(content);
}

/**
 * Validate watermark type
 */
export function validateWatermarkType(type: unknown): type is 'text' | 'image' | 'none' {
  return type === 'text' || type === 'image' || type === 'none';
}

/**
 * Validate environment variables
 */
export function validateEnvironment(): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Optional but recommended
  if (!process.env.GEMINI_API_KEY) {
    errors.push('GEMINI_API_KEY not set (optional, but required for AI features)');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize error message (don't expose internal paths)
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    // Remove file paths from error messages
    return error.message
      .replace(/[A-Za-z]:\\[^\s]*/g, '[path]')
      .replace(/\/[^\s]*/g, '[path]');
  }
  return 'An unexpected error occurred';
}
