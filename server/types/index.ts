/**
 * Type definitions for the application
 */

export interface MediaResult {
  type: 'video' | 'image';
  title: string;
  desc: string;
  author: string;
  videoUrl?: string;
  coverUrl?: string;
  images?: string[];
}

export interface BulkDownloadResult {
  url: string;
  success: boolean;
  data?: MediaResult;
  error?: string;
}

export interface VideoEditOptions {
  url: string;
  filename?: string;
  watermarkType?: 'none' | 'text' | 'image';
  watermarkText?: string;
  watermarkImage?: string;
  start?: number;
  end?: number;
  threshold?: number;
  srtContent?: string;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TikWMResponse {
  code: number;
  msg?: string;
  data?: {
    title: string;
    author?: {
      nickname: string;
    };
    images?: string[];
    play?: string;
    hdplay?: string;
    wmplay?: string;
    cover?: string;
  };
}

export interface XHSNoteData {
  type: string;
  title: string;
  desc: string;
  user?: {
    nickname: string;
  };
  video?: {
    media?: {
      stream?: {
        h265?: Array<{ masterUrl: string }>;
        h264?: Array<{ masterUrl: string }>;
      };
    };
  };
  imageList?: Array<{
    urlDefault?: string;
    url?: string;
  }>;
}

export interface ProcessUrlOptions {
  url: string;
  noWatermark: boolean;
}

export interface FFmpegJobConfig {
  jobId: string;
  tmpDir: string;
  inputPath: string;
  outputPath: string;
}

export interface PlatformType {
  isTikTok: boolean;
  isDouyin: boolean;
  isXHS: boolean;
}
