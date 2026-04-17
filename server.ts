import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import archiver from 'archiver';
import { GoogleGenAI } from '@google/genai';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  async function processUrl(url: string, noWatermark: boolean) {
    const isTikTok = url.includes('tiktok.com');
    const isDouyin = url.includes('douyin.com');
    const isXHS = url.includes('xiaohongshu.com') || url.includes('xhslink.com');

    if (!isTikTok && !isXHS && !isDouyin) {
      throw new Error('Vui lòng nhập link Xiaohongshu, TikTok hoặc Douyin hợp lệ.');
    }

    // --- TIKTOK & DOUYIN LOGIC ---
    if (isTikTok || isDouyin) {
      try {
        const tikwmRes = await axios.get('https://www.tikwm.com/api/', {
          params: {
            url: url,
            hd: 1
          },
          timeout: 10000
        });

        const data = tikwmRes.data;
        if (data.code === 0 && data.data) {
          const videoData = data.data;
          
          // Handle image posts
          if (videoData.images && videoData.images.length > 0) {
             return {
                type: 'image',
                title: videoData.title || (isTikTok ? 'TikTok Images' : 'Douyin Images'),
                desc: videoData.title || '',
                images: videoData.images,
                author: videoData.author?.nickname || 'Unknown'
             };
          }

          // Determine video URL based on watermark preference
          let videoUrl = videoData.play;
          if (noWatermark) {
            videoUrl = videoData.hdplay || videoData.play;
          } else {
            videoUrl = videoData.wmplay || videoData.play;
          }

          if (!videoUrl.startsWith('http')) {
            videoUrl = 'https://www.tikwm.com' + videoUrl;
          }

          return {
            type: 'video',
            title: videoData.title || (isTikTok ? 'TikTok Video' : 'Douyin Video'),
            desc: videoData.title || '',
            videoUrl: videoUrl,
            coverUrl: videoData.cover,
            author: videoData.author?.nickname || 'Unknown'
          };
        } else {
          throw new Error(data.msg || 'Không thể lấy dữ liệu. Link có thể không hợp lệ hoặc video ở chế độ riêng tư.');
        }
      } catch (err: any) {
        console.error('TikTok/Douyin fetch error:', err.message);
        throw new Error(err.message.includes('Không thể lấy dữ liệu') ? err.message : 'Lỗi kết nối đến máy chủ tải video. Vui lòng thử lại sau.');
      }
    }

    // --- XIAOHONGSHU LOGIC ---
    let xhsUrl = url;
    if (xhsUrl.includes('/discovery/item/')) {
      xhsUrl = xhsUrl.replace('/discovery/item/', '/explore/');
    }

    // 1. Fetch the initial URL to handle redirects (e.g., xhslink.com)
    const initialResponse = await axios.get(xhsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5
    });

    const finalUrl = initialResponse.request.res.responseUrl || url;
    const html = initialResponse.data;

    // 2. Extract window.__INITIAL_STATE__
    const $ = cheerio.load(html);
    let initialStateStr = '';
    
    $('script').each((i, el) => {
      const scriptContent = $(el).html();
      if (scriptContent && scriptContent.includes('window.__INITIAL_STATE__=')) {
        const startIndex = scriptContent.indexOf('window.__INITIAL_STATE__=');
        if (startIndex !== -1) {
          const jsonStart = scriptContent.indexOf('{', startIndex);
          if (jsonStart !== -1) {
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
              initialStateStr = scriptContent.substring(jsonStart, jsonEnd);
              // Replace undefined with null to make it valid JSON
              initialStateStr = initialStateStr.replace(/undefined/g, 'null');
            }
          }
        }
      }
    });

    if (!initialStateStr) {
      // Try alternative: window.__INITIAL_DATA__
      $('script').each((i, el) => {
        const scriptContent = $(el).html();
        if (scriptContent && scriptContent.includes('window.__INITIAL_DATA__=')) {
          const startIndex = scriptContent.indexOf('window.__INITIAL_DATA__=');
          if (startIndex !== -1) {
            const jsonStart = scriptContent.indexOf('{', startIndex);
            if (jsonStart !== -1) {
              // Simple extraction for now
              const jsonEnd = scriptContent.lastIndexOf('}');
              if (jsonEnd > jsonStart) {
                initialStateStr = scriptContent.substring(jsonStart, jsonEnd + 1);
                initialStateStr = initialStateStr.replace(/undefined/g, 'null');
              }
            }
          }
        }
      });
    }

    if (!initialStateStr) {
      throw new Error('Could not find video data on this page. Make sure it is a valid Xiaohongshu post URL.');
    }

    let initialState: any;
    try {
      initialState = JSON.parse(initialStateStr);
    } catch (e) {
      throw new Error('Failed to parse video data.');
    }

    // 3. Navigate the JSON to find the video URL
    let noteData = null;
    if (initialState?.note?.noteDetailMap) {
      noteData = (Object.values(initialState.note.noteDetailMap)[0] as any)?.note;
    } else if (initialState?.noteData?.data?.noteData) {
      noteData = initialState.noteData.data.noteData;
    } else if (initialState?.noteData) {
      noteData = initialState.noteData;
    }

    if (!noteData) {
      throw new Error('Could not find video data on this page. Make sure it is a valid Xiaohongshu post URL.');
    }

    if (noteData.type !== 'video' && noteData.type !== 'normal') {
       const images = noteData.imageList?.map((img: any) => img.urlDefault || img.url) || [];
       if (images.length > 0) {
           return {
               type: 'image',
               title: noteData.title || 'Xiaohongshu Images',
               desc: noteData.desc || '',
               images: images,
               author: noteData.user?.nickname || 'Unknown'
           };
       }
       throw new Error('This post does not contain a video or images.');
    }

    const h265 = noteData.video?.media?.stream?.h265;
    const h264 = noteData.video?.media?.stream?.h264;
    
    let videoUrl = '';
    if (h265 && h265.length > 0) {
      videoUrl = h265[0].masterUrl;
    } else if (h264 && h264.length > 0) {
      videoUrl = h264[0].masterUrl;
    }

    const coverUrl = noteData.imageList?.[0]?.urlDefault || noteData.imageList?.[0]?.url;

    if (!videoUrl) {
      throw new Error('Could not extract video URL.');
    }

    return {
      type: 'video',
      title: noteData.title || 'Xiaohongshu Video',
      desc: noteData.desc || '',
      videoUrl: videoUrl,
      coverUrl: coverUrl,
      author: noteData.user?.nickname || 'Unknown'
    };
  }

  // API Route to fetch Xiaohongshu or TikTok video
  app.post('/api/download', async (req, res) => {
    try {
      const { url, noWatermark } = req.body;
      if (!url) return res.status(400).json({ error: 'URL is required' });
      const result = await processUrl(url, !!noWatermark);
      return res.json(result);
    } catch (error: any) {
      console.error('Download error:', error.message);
      res.status(500).json({ error: error.message || 'Failed to process the URL.' });
    }
  });

  // Bulk download endpoint
  app.post('/api/bulk-download', async (req, res) => {
    try {
      const { urls, noWatermark } = req.body;
      if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: 'URLs array is required' });
      }

      const results = [];
      for (const url of urls) {
        try {
          const result = await processUrl(url, !!noWatermark);
          results.push({ url, success: true, data: result });
        } catch (error: any) {
          results.push({ url, success: false, error: error.message });
        }
        // Add a delay to respect the 1 request/second limit of the TikWM API
        if (urls.indexOf(url) < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1200));
        }
      }

      return res.json({ results });
    } catch (error: any) {
      console.error('Bulk download error:', error.message);
      res.status(500).json({ error: 'Failed to process bulk download.' });
    }
  });

  // Custom Watermark endpoint
  app.post('/api/edit/custom-watermark', async (req, res) => {
    const { url, type, text, image, filename } = req.body;
    if (!url) return res.status(400).send('URL is required');

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputVideo = path.join(tmpDir, `${jobId}_input.mp4`);
    const outputVideo = path.join(tmpDir, `${jobId}_output.mp4`);
    const watermarkImgPath = path.join(tmpDir, `${jobId}_watermark.png`);

    try {
      // 1. Download video
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      const writer = fs.createWriteStream(inputVideo);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(null));
        writer.on('error', reject);
      });

      // 2. Apply watermark
      await new Promise((resolve, reject) => {
        let command = ffmpeg(inputVideo);

        if (type === 'text' && text) {
          const escapedText = text.replace(/'/g, "'\\\\''");
          command = command.videoFilters(`drawtext=text='${escapedText}':x=(w-text_w)/2:y=h-text_h-20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5`);
        } else if (type === 'image' && image) {
          const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
          fs.writeFileSync(watermarkImgPath, base64Data, 'base64');
          
          command = command
            .input(watermarkImgPath)
            .complexFilter([
              {
                filter: 'scale',
                options: '100:-1',
                inputs: '[1:v]',
                outputs: 'wm'
              },
              {
                filter: 'overlay',
                options: 'W-w-10:H-h-10',
                inputs: ['[0:v]', 'wm']
              }
            ]);
        }

        command
          .output(outputVideo)
          .on('error', (err) => {
            console.error('FFmpeg error:', err);
            reject(err);
          })
          .on('end', () => resolve(null))
          .run();
      });

      res.download(outputVideo, filename || `watermarked_${jobId}.mp4`, () => {
        // Cleanup
        [inputVideo, outputVideo, watermarkImgPath].forEach(f => {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        });
      });

    } catch (error: any) {
      console.error('Custom watermark error:', error);
      if (!res.headersSent) {
        res.status(500).send(error.message || 'Failed to apply watermark');
      }
      [inputVideo, outputVideo, watermarkImgPath].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    }
  });

  // Proxy route to download the video file directly (bypassing CORS on the client)
  app.get('/api/proxy-download', async (req, res) => {
      const { url, filename } = req.query;
      if (!url || typeof url !== 'string') {
          return res.status(400).send('URL is required');
      }

      let targetUrl = url;
      if (targetUrl.startsWith('//')) {
          targetUrl = 'https:' + targetUrl;
      } else if (targetUrl.startsWith('/')) {
          targetUrl = 'https://www.tikwm.com' + targetUrl;
      }

      try {
          const response = await axios({
              method: 'GET',
              url: targetUrl,
              responseType: 'stream',
              headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Referer': 'https://www.xiaohongshu.com/'
              }
          });

          const safeFilename = encodeURIComponent((filename as string) || 'video.mp4');
          res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}`);
          res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
          
          response.data.pipe(res);
      } catch (error) {
          console.error('Proxy download error:', error);
          res.status(500).send('Failed to download file');
      }
  });

  // Auto-cut scenes endpoint
  app.get('/api/edit/auto-cut', async (req, res) => {
    const { url, threshold = 0.3 } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).send('URL is required');

    let targetUrl = url;
    if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl;
    else if (targetUrl.startsWith('/')) targetUrl = 'https://www.tikwm.com' + targetUrl;

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${jobId}_input.mp4`);
    const outputPattern = path.join(tmpDir, `${jobId}_out_%03d.mp4`);

    try {
      const response = await axios({
        method: 'GET',
        url: targetUrl,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.xiaohongshu.com/' }
      });

      const writer = fs.createWriteStream(inputPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(null));
        writer.on('error', reject);
      });

      const timestamps: number[] = [];
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-filter:v', `select='gt(scene,${threshold})',showinfo`,
            '-f', 'null'
          ])
          .on('stderr', (stderrLine) => {
            const match = stderrLine.match(/pts_time:([0-9\.]+)/);
            if (match) {
              const time = parseFloat(match[1]);
              if (time > 0.5) timestamps.push(time);
            }
          })
          .on('error', reject)
          .on('end', resolve)
          .output('/dev/null')
          .run();
      });

      const times = timestamps.join(',');
      await new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath);
        if (times.length > 0) {
          command = command.outputOptions([
            '-f', 'segment',
            '-segment_times', times,
            '-reset_timestamps', '1',
            '-c', 'copy'
          ]);
        } else {
          command = command.outputOptions(['-c', 'copy']);
        }
        command.output(outputPattern).on('error', reject).on('end', resolve).run();
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="auto_cut_${jobId}.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);

      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`${jobId}_out_`) && f.endsWith('.mp4'));
      for (const file of files) {
        archive.file(path.join(tmpDir, file), { name: file.replace(`${jobId}_`, '') });
      }

      await archive.finalize();

      // Cleanup
      fs.unlinkSync(inputPath);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    } catch (error) {
      console.error('Auto-cut error:', error);
      if (!res.headersSent) res.status(500).send('Failed to process video');
    }
  });

  // Trim video endpoint
  app.get('/api/edit/trim', async (req, res) => {
    const { url, start, end } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).send('URL is required');

    let targetUrl = url;
    if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl;
    else if (targetUrl.startsWith('/')) targetUrl = 'https://www.tikwm.com' + targetUrl;

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${jobId}_input.mp4`);
    const outputPath = path.join(tmpDir, `${jobId}_output.mp4`);

    try {
      const response = await axios({
        method: 'GET',
        url: targetUrl,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.xiaohongshu.com/' }
      });

      const writer = fs.createWriteStream(inputPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(null));
        writer.on('error', reject);
      });

      await new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath);
        if (start) command = command.setStartTime(parseFloat(start as string));
        if (end && start) command = command.setDuration(parseFloat(end as string) - parseFloat(start as string));
        
        command
          .outputOptions(['-c', 'copy'])
          .output(outputPath)
          .on('error', reject)
          .on('end', resolve)
          .run();
      });

      res.download(outputPath, `trimmed_${jobId}.mp4`, () => {
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
      });
    } catch (error) {
      console.error('Trim error:', error);
      if (!res.headersSent) res.status(500).send('Failed to trim video');
    }
  });

  // Extract audio endpoint
  app.get('/api/edit/extract-audio', async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).send('URL is required');

    let targetUrl = url;
    if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl;
    else if (targetUrl.startsWith('/')) targetUrl = 'https://www.tikwm.com' + targetUrl;

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${jobId}_input.mp4`);
    const outputPath = path.join(tmpDir, `${jobId}_audio.mp3`);

    try {
      const response = await axios({
        method: 'GET',
        url: targetUrl,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.xiaohongshu.com/' }
      });

      const writer = fs.createWriteStream(inputPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(null));
        writer.on('error', reject);
      });

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .output(outputPath)
          .on('error', reject)
          .on('end', () => resolve(null))
          .run();
      });

      res.download(outputPath, `audio_${jobId}.mp3`, () => {
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
      });
    } catch (error) {
      console.error('Extract audio error:', error);
      if (!res.headersSent) res.status(500).send('Failed to extract audio');
    }
  });

  // Burn subtitles endpoint
  app.get('/api/edit/burn-subtitles', async (req, res) => {
    const { url, srt } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).send('URL is required');
    if (!srt || typeof srt !== 'string') return res.status(400).send('SRT content is required');

    let targetUrl = url;
    if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl;
    else if (targetUrl.startsWith('/')) targetUrl = 'https://www.tikwm.com' + targetUrl;

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputVideo = path.join(tmpDir, `${jobId}_input.mp4`);
    const srtFile = path.join(tmpDir, `${jobId}_subs.srt`);
    const outputVideo = path.join(tmpDir, `${jobId}_output.mp4`);

    try {
      // 1. Download video
      const response = await axios({
        method: 'GET',
        url: targetUrl,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.xiaohongshu.com/' }
      });

      const writer = fs.createWriteStream(inputVideo);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(null));
        writer.on('error', reject);
      });

      // 2. Write SRT file
      fs.writeFileSync(srtFile, srt);

      // 3. Burn subtitles into video
      const escapedSrtPath = srtFile.replace(/\\/g, '/').replace(/:/g, '\\\\:');
      
      await new Promise((resolve, reject) => {
        ffmpeg(inputVideo)
          .outputOptions([
            '-vf', `subtitles=${escapedSrtPath}`,
            '-c:a', 'copy'
          ])
          .output(outputVideo)
          .on('error', reject)
          .on('end', () => resolve(null))
          .run();
      });

      res.download(outputVideo, `subtitled_${jobId}.mp4`, () => {
        // Cleanup
        [inputVideo, srtFile, outputVideo].forEach(f => {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        });
      });

    } catch (error: any) {
      console.error('Burn subtitles error:', error);
      if (!res.headersSent) {
        res.status(500).send(error.message || 'Failed to burn subtitles');
      }
      // Cleanup on error
      [inputVideo, srtFile, outputVideo].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
