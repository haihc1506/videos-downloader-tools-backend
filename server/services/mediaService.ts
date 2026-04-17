/**
 * Media processing service
 * Handles fetching and processing media from different platforms
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  MediaResult,
  TikWMResponse,
  XHSNoteData,
} from '../types/index.js';
import {
  detectPlatform,
  normalizeUrl,
  normalizeVideoUrl,
} from '../utils/urlUtils.js';
import { APIError } from '../middleware/errorHandler.js';

const TIKWM_API_URL = 'https://www.tikwm.com/api/';
const TIKWM_BASE_URL = 'https://www.tikwm.com';
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1';

/**
 * Process TikTok/Douyin URL
 */
async function processTikTokUrl(
  url: string,
  noWatermark: boolean
): Promise<MediaResult> {
  try {
    const platform = detectPlatform(url);
    const response = await axios.get<TikWMResponse>(TIKWM_API_URL, {
      params: {
        url,
        hd: 1,
      },
      timeout: 10000,
    });

    const data = response.data;

    if (data.code !== 0 || !data.data) {
      throw new APIError(
        400,
        data.msg || 'Invalid URL or video is private'
      );
    }

    const videoData = data.data;

    // Handle image posts
    if (videoData.images && videoData.images.length > 0) {
      return {
        type: 'image',
        title: videoData.title || (platform.isTikTok ? 'TikTok Images' : 'Douyin Images'),
        desc: videoData.title || '',
        images: videoData.images,
        author: videoData.author?.nickname || 'Unknown',
      };
    }

    // Determine video URL based on watermark preference
    let videoUrl = videoData.play || '';
    if (noWatermark) {
      videoUrl = videoData.hdplay || videoData.play || '';
    } else {
      videoUrl = videoData.wmplay || videoData.play || '';
    }

    videoUrl = normalizeVideoUrl(videoUrl, TIKWM_BASE_URL);

    if (!videoUrl) {
      throw new APIError(400, 'Could not extract video URL');
    }

    return {
      type: 'video',
      title: videoData.title || (platform.isTikTok ? 'TikTok Video' : 'Douyin Video'),
      desc: videoData.title || '',
      videoUrl,
      coverUrl: videoData.cover,
      author: videoData.author?.nickname || 'Unknown',
    };
  } catch (error) {
    if (error instanceof APIError) throw error;
    if (axios.isAxiosError(error)) {
      throw new APIError(
        500,
        'Failed to connect to TikTok/Douyin service. Please try again.'
      );
    }
    throw error;
  }
}

/**
 * Extract JSON from script tag
 */
function extractJsonFromScript(
  html: string,
  searchString: string
): string | null {
  const $ = cheerio.load(html);
  let jsonStr = '';

  $('script').each((_i, el) => {
    const scriptContent = $(el).html();
    if (!scriptContent || !scriptContent.includes(searchString)) return;

    const startIndex = scriptContent.indexOf(searchString);
    if (startIndex === -1) return;

    const jsonStart = scriptContent.indexOf('{', startIndex);
    if (jsonStart === -1) return;

    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let jsonEnd = -1;

    for (let j = jsonStart; j < scriptContent.length; j++) {
      const char = scriptContent[j];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') braceCount++;
        else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = j + 1;
            break;
          }
        }
      }
    }

    if (jsonEnd !== -1) {
      jsonStr = scriptContent.substring(jsonStart, jsonEnd);
      jsonStr = jsonStr.replace(/undefined/g, 'null');
    }
  });

  return jsonStr || null;
}

/**
 * Extract note data from initial state
 */
function extractNoteData(initialState: any): XHSNoteData | null {
  if (initialState?.note?.noteDetailMap) {
    return (Object.values(initialState.note.noteDetailMap)[0] as any)?.note;
  }
  if (initialState?.noteData?.data?.noteData) {
    return initialState.noteData.data.noteData;
  }
  if (initialState?.noteData) {
    return initialState.noteData;
  }
  return null;
}

/**
 * Process Xiaohongshu URL
 */
async function processXHSUrl(url: string): Promise<MediaResult> {
  try {
    const xhsUrl = normalizeUrl(url);

    // Fetch initial page with redirects
    const response = await axios.get(xhsUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5,
      timeout: 10000,
    });

    const html = response.data;

    // Try to extract initial state
    let initialStateStr =
      extractJsonFromScript(html, 'window.__INITIAL_STATE__=') ||
      extractJsonFromScript(html, 'window.__INITIAL_DATA__=');

    if (!initialStateStr) {
      throw new APIError(
        400,
        'Could not find video data. Make sure the URL is valid.'
      );
    }

    let initialState: any;
    try {
      initialState = JSON.parse(initialStateStr);
    } catch {
      throw new APIError(400, 'Failed to parse video data');
    }

    const noteData = extractNoteData(initialState);

    if (!noteData) {
      throw new APIError(
        400,
        'Could not find video data. Make sure the URL is valid.'
      );
    }

    // Handle image posts
    if (noteData.type !== 'video' && noteData.type !== 'normal') {
      const images = noteData.imageList
        ?.map((img: any) => img.urlDefault || img.url)
        .filter((img: string) => img);

      if (images && images.length > 0) {
        return {
          type: 'image',
          title: noteData.title || 'Xiaohongshu Images',
          desc: noteData.desc || '',
          images,
          author: noteData.user?.nickname || 'Unknown',
        };
      }

      throw new APIError(400, 'This post does not contain a video or images');
    }

    // Extract video URL
    const h265 = noteData.video?.media?.stream?.h265;
    const h264 = noteData.video?.media?.stream?.h264;

    let videoUrl = '';
    if (h265 && h265.length > 0) {
      videoUrl = h265[0].masterUrl;
    } else if (h264 && h264.length > 0) {
      videoUrl = h264[0].masterUrl;
    }

    const coverUrl =
      noteData.imageList?.[0]?.urlDefault || noteData.imageList?.[0]?.url;

    if (!videoUrl) {
      throw new APIError(400, 'Could not extract video URL');
    }

    return {
      type: 'video',
      title: noteData.title || 'Xiaohongshu Video',
      desc: noteData.desc || '',
      videoUrl,
      coverUrl,
      author: noteData.user?.nickname || 'Unknown',
    };
  } catch (error) {
    if (error instanceof APIError) throw error;
    if (axios.isAxiosError(error)) {
      throw new APIError(
        500,
        'Failed to connect to Xiaohongshu. Please try again.'
      );
    }
    throw error;
  }
}

/**
 * Main process URL function
 */
export async function processUrl(
  url: string,
  noWatermark: boolean = true
): Promise<MediaResult> {
  const platform = detectPlatform(url);

  if (!platform.isTikTok && !platform.isDouyin && !platform.isXHS) {
    throw new APIError(
      400,
      'Please provide a valid Xiaohongshu, TikTok, or Douyin URL'
    );
  }

  if (platform.isTikTok || platform.isDouyin) {
    return processTikTokUrl(url, noWatermark);
  }

  return processXHSUrl(url);
}
