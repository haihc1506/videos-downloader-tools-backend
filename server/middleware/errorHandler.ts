/**
 * Error handling middleware and utilities
 */

import { Request, Response, NextFunction } from 'express';
import { sanitizeError } from '../utils/validation.js';

/**
 * Custom API Error class
 */
export class APIError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public isOperational: boolean = true
  ) {
    super(message);
    Object.setPrototypeOf(this, APIError.prototype);
  }
}

/**
 * Error response formatter
 */
export function formatErrorResponse(error: unknown) {
  if (error instanceof APIError) {
    return {
      success: false,
      error: error.message,
      statusCode: error.statusCode,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    error: sanitizeError(error),
    statusCode: 500,
  };
}

/**
 * Global error handler middleware
 */
export function errorHandler(
  err: Error | APIError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error('Error:', err);

  if (err instanceof APIError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
  }

  // Unknown error
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
}

/**
 * Async route wrapper to catch errors
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Validation error response
 */
export function validationError(res: Response, message: string) {
  return res.status(400).json({
    success: false,
    error: message,
  });
}

/**
 * Not found error
 */
export function notFound(res: Response, message: string = 'Resource not found') {
  return res.status(404).json({
    success: false,
    error: message,
  });
}

/**
 * Server error response
 */
export function serverError(res: Response, message: string = 'Internal server error') {
  return res.status(500).json({
    success: false,
    error: message,
  });
}

/**
 * Success response
 */
export function successResponse<T>(res: Response, data: T, statusCode: number = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
  });
}

/**
 * Create timeout error
 */
export function createTimeoutError(operation: string): APIError {
  return new APIError(
    408,
    `Operation '${operation}' timed out. Please try again.`
  );
}

/**
 * Create validation error
 */
export function createValidationError(message: string): APIError {
  return new APIError(400, message);
}

/**
 * Create server error
 */
export function createServerError(message: string): APIError {
  return new APIError(500, message);
}
