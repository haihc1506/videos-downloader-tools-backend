import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import archiver from "archiver";
import { GoogleGenAI } from "@google/genai";
import { ElevenLabsClient, play } from "@elevenlabs/elevenlabs-js";
import dotenv from "dotenv";
import aiRoutes from "./routes/ai.routes.ts";
import {processUrl} from "./services/scraper.service.ts";

// Load environment variables
dotenv.config();

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Middleware
  app.use(express.json({ limit: "50mb" }));

  // CORS middleware
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (_req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API Route to fetch Xiaohongshu or TikTok video
  app.post("/api/download", async (req, res) => {
    try {
      const { url, noWatermark } = req.body;
      if (!url) return res.status(400).json({ error: "URL is required" });
      const result = await processUrl(url, !!noWatermark);
      return res.json(result);
    } catch (error: any) {
      console.error("Download error:", error.message);
      res
        .status(500)
        .json({ error: error.message || "Failed to process the URL." });
    }
  });

  // Bulk download endpoint
  app.post("/api/bulk-download", async (req, res) => {
    try {
      const { urls, noWatermark } = req.body;
      if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: "URLs array is required" });
      }

      const results: Array<{
        url: string;
        success: boolean;
        data?: any;
        error?: string;
      }> = [];
      for (const url of urls) {
        try {
          const result = await processUrl(url, !!noWatermark);
          results.push({ url, success: true, data: result });
        } catch (error: any) {
          results.push({ url, success: false, error: error.message });
        }
        // Add a delay to respect the 1 request/second limit of the TikWM API
        if (urls.indexOf(url) < urls.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }

      return res.json({ results });
    } catch (error: any) {
      console.error("Bulk download error:", error.message);
      res.status(500).json({ error: "Failed to process bulk download." });
    }
  });

  // Custom Watermark endpoint
  app.post("/api/edit/custom-watermark", async (req, res) => {
    const { url, type, text, image, filename } = req.body;
    if (!url) return res.status(400).send("URL is required");

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputVideo = path.join(tmpDir, `${jobId}_input.mp4`);
    const outputVideo = path.join(tmpDir, `${jobId}_output.mp4`);
    const watermarkImgPath = path.join(tmpDir, `${jobId}_watermark.png`);

    try {
      // 1. Download video
      const response = await axios({
        method: "GET",
        url: url,
        responseType: "stream",
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      const writer = fs.createWriteStream(inputVideo);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on("finish", () => resolve(null));
        writer.on("error", reject);
      });

      // 2. Apply watermark
      await new Promise((resolve, reject) => {
        let command = ffmpeg(inputVideo);

        if (type === "text" && text) {
          const escapedText = text.replace(/'/g, "'\\\\''");
          command = command.videoFilters(
            `drawtext=text='${escapedText}':x=(w-text_w)/2:y=h-text_h-20:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=5`,
          );
        } else if (type === "image" && image) {
          const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
          fs.writeFileSync(watermarkImgPath, base64Data, "base64");

          command = command.input(watermarkImgPath).complexFilter([
            {
              filter: "scale",
              options: "100:-1",
              inputs: "[1:v]",
              outputs: "wm",
            },
            {
              filter: "overlay",
              options: "W-w-10:H-h-10",
              inputs: ["[0:v]", "wm"],
            },
          ]);
        }

        command
          .output(outputVideo)
          .on("error", (err) => {
            console.error("FFmpeg error:", err);
            reject(err);
          })
          .on("end", () => resolve(null))
          .run();
      });

      res.download(outputVideo, filename || `watermarked_${jobId}.mp4`, () => {
        // Cleanup
        [inputVideo, outputVideo, watermarkImgPath].forEach((f) => {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        });
      });
    } catch (error: any) {
      console.error("Custom watermark error:", error);
      if (!res.headersSent) {
        res.status(500).send(error.message || "Failed to apply watermark");
      }
      [inputVideo, outputVideo, watermarkImgPath].forEach((f) => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    }
  });

  app.use("/api/ai", aiRoutes);

  // Endpoint TTS using Elevenlabs
  app.post("/api/tts/convert", async (req, res) => {
    try {
      const { text, voiceId } = req.body;

      if (!process.env.ELEVENLABS_API_KEY) {
        return res
          .status(500)
          .json({ error: "Chưa cấu hình Elevenlabs API Key trên server" });
      }

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?optimize_streaming_latency=0`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": process.env.ELEVENLABS_API_KEY,
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_flash_v2_5",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: false,
            },
            // model_id: "eleven_multilingual_v2"
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Lỗi HTTP ${response.status}: ${errorText || "Không thể tạo voiceover"}`,
        );
      }

      // 1. Lấy dữ liệu thô từ ElevenLabs
      const audioBuffer = await response.arrayBuffer();

      // 2. Chuyển thành định dạng Buffer của Node.js
      const buffer = Buffer.from(audioBuffer);

      // 3. THAY ĐỔI QUAN TRỌNG: Cài đặt Header báo cho trình duyệt biết đây là file Audio
      res.set({
        "Content-Type": "audio/mpeg", // Định dạng file MP3
        "Content-Length": buffer.length, // Kích thước file
      });

      // 4. Gửi trực tiếp file âm thanh về cho Frontend (không dùng res.json nữa)
      res.send(buffer);
    } catch (error: any) {
      console.error("TTS error:", error);
      res.status(500).json({ error: "Lỗi tạo voiceover" });
    }
  });

  // Proxy route to download the video file directly (bypassing CORS on the client)
  app.get("/api/proxy-download", async (req, res) => {
    const { url, filename } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).send("URL is required");
    }

    let targetUrl = url;
    if (targetUrl.startsWith("//")) {
      targetUrl = "https:" + targetUrl;
    } else if (targetUrl.startsWith("/")) {
      targetUrl = "https://www.tikwm.com" + targetUrl;
    }

    try {
      const response = await axios({
        method: "GET",
        url: targetUrl,
        responseType: "stream",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://www.xiaohongshu.com/",
        },
      });

      const safeFilename = encodeURIComponent(
        (filename as string) || "video.mp4",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${safeFilename}`,
      );
      res.setHeader(
        "Content-Type",
        response.headers["content-type"] || "video/mp4",
      );

      response.data.pipe(res);
    } catch (error) {
      console.error("Proxy download error:", error);
      res.status(500).send("Failed to download file");
    }
  });

  // Auto-cut scenes endpoint
  app.get("/api/edit/auto-cut", async (req, res) => {
    const { url, threshold = 0.3 } = req.query;
    if (!url || typeof url !== "string")
      return res.status(400).send("URL is required");

    let targetUrl = url;
    if (targetUrl.startsWith("//")) targetUrl = "https:" + targetUrl;
    else if (targetUrl.startsWith("/"))
      targetUrl = "https://www.tikwm.com" + targetUrl;

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${jobId}_input.mp4`);
    const outputPattern = path.join(tmpDir, `${jobId}_out_%03d.mp4`);

    try {
      const response = await axios({
        method: "GET",
        url: targetUrl,
        responseType: "stream",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.xiaohongshu.com/",
        },
      });

      const writer = fs.createWriteStream(inputPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on("finish", () => resolve(null));
        writer.on("error", reject);
      });

      const timestamps: number[] = [];
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            "-filter:v",
            `select='gt(scene,${threshold})',showinfo`,
            "-f",
            "null",
          ])
          .on("stderr", (stderrLine) => {
            const match = stderrLine.match(/pts_time:([0-9\.]+)/);
            if (match) {
              const time = parseFloat(match[1]);
              if (time > 0.5) timestamps.push(time);
            }
          })
          .on("error", reject)
          .on("end", resolve)
          .output("/dev/null")
          .run();
      });

      const times = timestamps.join(",");
      await new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath);
        if (times.length > 0) {
          command = command.outputOptions([
            "-f",
            "segment",
            "-segment_times",
            times,
            "-reset_timestamps",
            "1",
            "-c",
            "copy",
          ]);
        } else {
          command = command.outputOptions(["-c", "copy"]);
        }
        command
          .output(outputPattern)
          .on("error", reject)
          .on("end", resolve)
          .run();
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="auto_cut_${jobId}.zip"`,
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);

      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => f.startsWith(`${jobId}_out_`) && f.endsWith(".mp4"));
      for (const file of files) {
        archive.file(path.join(tmpDir, file), {
          name: file.replace(`${jobId}_`, ""),
        });
      }

      await archive.finalize();

      // Cleanup
      fs.unlinkSync(inputPath);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    } catch (error) {
      console.error("Auto-cut error:", error);
      if (!res.headersSent) res.status(500).send("Failed to process video");
    }
  });

  // Trim video endpoint
  app.get("/api/edit/trim", async (req, res) => {
    const { url, start, end } = req.query;
    if (!url || typeof url !== "string")
      return res.status(400).send("URL is required");

    let targetUrl = url;
    if (targetUrl.startsWith("//")) targetUrl = "https:" + targetUrl;
    else if (targetUrl.startsWith("/"))
      targetUrl = "https://www.tikwm.com" + targetUrl;

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${jobId}_input.mp4`);
    const outputPath = path.join(tmpDir, `${jobId}_output.mp4`);

    try {
      // 1. Tải video về
      const response = await axios({
        method: "GET",
        url: targetUrl,
        responseType: "stream",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.xiaohongshu.com/",
        },
      });

      const writer = fs.createWriteStream(inputPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      // 2. Cắt video bằng FFMPEG
      await new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath);
        if (start) command = command.setStartTime(parseFloat(start as string));
        if (end && start)
          command = command.setDuration(
            parseFloat(end as string) - parseFloat(start as string),
          );

        command
          .outputOptions(["-c", "copy"])
          .output(outputPath)
          .on("error", reject)
          .on("end", resolve)
          .run();
      });

      // 3. Gửi file cho người dùng
      res.download(outputPath, `trimmed_${jobId}.mp4`);
    } catch (error) {
      console.error("Trim error:", error);
      if (!res.headersSent) res.status(500).send("Failed to trim video");
    } finally {
      // DỌN DẸP: Luôn chạy phần này để xóa file rác
      setTimeout(() => {
        // Dùng setTimeout 1 chút để đảm bảo res.download đã bắt đầu đọc file
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }, 5000);
    }
  });

  // Extract audio endpoint
  app.get("/api/edit/extract-audio", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string")
      return res.status(400).send("URL is required");

    let targetUrl = url;
    if (targetUrl.startsWith("//")) targetUrl = "https:" + targetUrl;
    else if (targetUrl.startsWith("/"))
      targetUrl = "https://www.tikwm.com" + targetUrl;

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `${jobId}_input.mp4`);
    const outputPath = path.join(tmpDir, `${jobId}_audio.mp3`);

    try {
      const response = await axios({
        method: "GET",
        url: targetUrl,
        responseType: "stream",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.xiaohongshu.com/",
        },
      });

      const writer = fs.createWriteStream(inputPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on("finish", () => resolve(null));
        writer.on("error", reject);
      });

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .noVideo()
          .audioCodec("libmp3lame")
          .output(outputPath)
          .on("error", reject)
          .on("end", () => resolve(null))
          .run();
      });

      res.download(outputPath, `audio_${jobId}.mp3`, () => {
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
      });
    } catch (error) {
      console.error("Extract audio error:", error);
      if (!res.headersSent) res.status(500).send("Failed to extract audio");
    }
  });

  // Burn subtitles endpoint
  app.get("/api/edit/burn-subtitles", async (req, res) => {
    const { url, srt } = req.query;
    if (!url || typeof url !== "string")
      return res.status(400).send("URL is required");
    if (!srt || typeof srt !== "string")
      return res.status(400).send("SRT content is required");

    let targetUrl = url;
    if (targetUrl.startsWith("//")) targetUrl = "https:" + targetUrl;
    else if (targetUrl.startsWith("/"))
      targetUrl = "https://www.tikwm.com" + targetUrl;

    const jobId = uuidv4();
    const tmpDir = os.tmpdir();
    const inputVideo = path.join(tmpDir, `${jobId}_input.mp4`);
    const subtitleFile = path.join(tmpDir, `${jobId}_subs.ass`);
    const outputVideo = path.join(tmpDir, `${jobId}_output.mp4`);

    try {
      // 1. Download video
      const response = await axios({
        method: "GET",
        url: targetUrl,
        responseType: "stream",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://www.xiaohongshu.com/",
        },
      });

      const writer = fs.createWriteStream(inputVideo);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on("finish", () => resolve(null));
        writer.on("error", reject);
      });

      // 2. Write SRT file
      fs.writeFileSync(subtitleFile, srt);

      // 3. Burn subtitles into video
      const escapedSrtPath = subtitleFile
        .replace(/\\/g, "/")
        .replace(/:/g, "\\\\:");

      await new Promise((resolve, reject) => {
        ffmpeg(inputVideo)
          .outputOptions(["-vf", `subtitles=${escapedSrtPath}`, "-c:a", "copy"])
          .output(outputVideo)
          .on("error", reject)
          .on("end", () => resolve(null))
          .run();
      });

      res.download(outputVideo, `subtitled_${jobId}.mp4`, () => {
        // Cleanup
        [inputVideo, subtitleFile, outputVideo].forEach((f) => {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        });
      });
    } catch (error: any) {
      console.error("Burn subtitles error:", error);
      if (!res.headersSent) {
        res.status(500).send(error.message || "Failed to burn subtitles");
      }
      // Cleanup on error
      [inputVideo, subtitleFile, outputVideo].forEach((f) => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    }
  });

  // Endpoint to fetch voices from Evenlabs
  app.get("/api/tts/voices", async (req, res) => {
    try {
      const elevenlabs = new ElevenLabsClient({
        apiKey: process.env.ELEVENLABS_API_KEY,
      });

      const voices = await elevenlabs.voices.getAll();
      res.json({ voices });
    } catch (error) {
      console.error("Fetch voices error:", error);
      res.status(500).json({ error: "Failed to fetch voices" });
    }
  });

  // Endpoint to check quota/status of Gemini API and Elevenlabs API
  // Thêm vào server.ts
  app.get("/api/quota", async (req, res) => {
    const result: any = {
      gemini: { available: false },
      elevenlabs: { available: false },
    };

    // 1. Check Gemini
    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ text: "ping" }],
        });
        result.gemini.available = true;
      } catch (err: any) {
        result.gemini.error =
          err.message.includes("quota") || err.message.includes("429")
            ? "Đã vượt giới hạn free tier."
            : "Lỗi kết nối Gemini API.";
      }
    } else {
      result.gemini.error = "Chưa cấu hình API Key.";
    }

    // 2. Check ElevenLabs
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        const response = await axios.get("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
        });
        const sub = response.data.subscription;
        result.elevenlabs = {
          available: true,
          characterLimit: sub?.character_limit || 0,
          characterCount: sub?.character_count || 0,
          percentageUsed:
            sub?.character_limit > 0
              ? Math.round((sub.character_count / sub.character_limit) * 100)
              : 0,
        };
      } catch (err: any) {
        result.elevenlabs.error =
          "API Key ElevenLabs không hợp lệ hoặc hết hạn.";
      }
    } else {
      result.elevenlabs.error = "Chưa cấu hình API Key.";
    }

    res.json(result);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global error handler (must be last)
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      console.error("Error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Internal server error",
      });
    },
  );

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

startServer();
