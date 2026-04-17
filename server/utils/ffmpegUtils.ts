/**
 * FFmpeg wrapper and utilities
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

// Configure FFmpeg path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

/**
 * Convert stream to seconds
 */
function toSeconds(timeStr: string | number | undefined): number | undefined {
  if (!timeStr) return undefined;
  return typeof timeStr === 'string' ? parseFloat(timeStr) : timeStr;
}

/**
 * Trim/cut video
 */
export async function trimVideo(
  inputPath: string,
  outputPath: string,
  startTime?: number | string,
  endTime?: number | string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);

    const start = toSeconds(startTime);
    const end = toSeconds(endTime);

    if (start !== undefined) {
      command = command.setStartTime(start);
    }

    if (end !== undefined && start !== undefined) {
      command = command.setDuration(end - start);
    }

    command
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
      .on('error', reject)
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Extract audio from video
 */
export async function extractAudio(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .output(outputPath)
      .on('error', reject)
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Add text watermark to video
 */
export async function addTextWatermark(
  inputPath: string,
  outputPath: string,
  text: string,
  options?: {
    position?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright' | 'center';
    fontSize?: number;
    fontColor?: string;
  }
): Promise<void> {
  const {
    position = 'bottomright',
    fontSize = 24,
    fontColor = 'white',
  } = options || {};

  const positionMap = {
    topleft: '10:10',
    topright: 'W-text_w-10:10',
    bottomleft: '10:H-text_h-20',
    bottomright: '(w-text_w)/2:h-text_h-20', // default center bottom
    center: '(w-text_w)/2:(h-text_h)/2',
  };

  const escapedText = text.replace(/'/g, "'\\\\''");
  const filter = `drawtext=text='${escapedText}':x=${positionMap[position]}:y=${positionMap[position]}:fontsize=${fontSize}:fontcolor=${fontColor}:box=1:boxcolor=black@0.5:boxborderw=5`;

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(filter)
      .output(outputPath)
      .on('error', reject)
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Add image watermark to video
 */
export async function addImageWatermark(
  inputPath: string,
  watermarkPath: string,
  outputPath: string,
  options?: {
    position?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
    scale?: number;
  }
): Promise<void> {
  const { position = 'bottomright', scale = 100 } = options || {};

  const positionMap = {
    topleft: 'x=10:y=10',
    topright: 'x=W-w-10:y=10',
    bottomleft: 'x=10:y=H-h-10',
    bottomright: 'x=W-w-10:y=H-h-10',
  };

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .input(watermarkPath)
      .complexFilter([
        {
          filter: 'scale',
          options: `${scale}:-1`,
          inputs: '[1:v]',
          outputs: 'wm',
        },
        {
          filter: 'overlay',
          options: positionMap[position],
          inputs: ['[0:v]', 'wm'],
          outputs: '[v]',
        },
      ], ['[v]'])
      .output(outputPath)
      .on('error', reject)
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Burn subtitles into video
 */
export async function burnSubtitles(
  inputPath: string,
  subtitlePath: string,
  outputPath: string
): Promise<void> {
  // Escape colons in Windows paths for FFmpeg
  const escapedPath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\\\:');

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-vf', `subtitles=${escapedPath}`, '-c:a', 'copy'])
      .output(outputPath)
      .on('error', reject)
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Detect scene cuts in video and return timestamps
 */
export async function detectSceneCuts(
  inputPath: string,
  threshold: number = 0.3
): Promise<number[]> {
  const timestamps: number[] = [];

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-filter:v',
        `select='gt(scene,${threshold})',showinfo`,
        '-f',
        'null',
      ])
      .on('stderr', (line: string) => {
        const match = line.match(/pts_time:([0-9\.]+)/);
        if (match) {
          const time = parseFloat(match[1]);
          if (time > 0.5) {
            timestamps.push(time);
          }
        }
      })
      .on('error', reject)
      .on('end', () => resolve(timestamps))
      .output('/dev/null')
      .run();
  });
}

/**
 * Split video by timestamps (for auto-cut)
 */
export async function splitVideoByTimestamps(
  inputPath: string,
  outputPattern: string,
  timestamps: number[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);

    const opts: string[] = ['-f', 'segment', '-reset_timestamps', '1', '-c', 'copy'];

    if (timestamps.length > 0) {
      opts.splice(2, 0, '-segment_times', timestamps.join(','));
    }

    command
      .outputOptions(opts)
      .output(outputPattern)
      .on('error', reject)
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Get video metadata
 */
export async function getVideoMetadata(
  inputPath: string
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const stream = metadata.streams.find((s: any) => s.codec_type === 'video');
        resolve({
          duration: metadata.format.duration || 0,
          width: stream?.width || 0,
          height: stream?.height || 0,
        });
      }
    });
  });
}
