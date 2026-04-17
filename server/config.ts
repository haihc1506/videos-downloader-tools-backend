/**
 * Configuration management
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config({
  path: '.env.local',
});

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV !== 'production',
  isProduction: process.env.NODE_ENV === 'production',

  // API Keys
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  // URLs
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  // Features
  disableHMR: process.env.DISABLE_HMR === 'true',
  debug: process.env.DEBUG === 'true',
  logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',

  // API Limits
  maxJsonSize: '50mb',
  maxBulkUrls: 50,
  requestTimeout: 60000,
  rateLimit: {
    tickwmDelay: 1200, // ms between requests
  },

  // File handling
  maxVideoSize: 500 * 1024 * 1024, // 500MB
  tempDir: '/tmp',
};

/**
 * Validate required configuration
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.geminiApiKey) {
    errors.push('GEMINI_API_KEY is not configured (optional but recommended)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default config;
