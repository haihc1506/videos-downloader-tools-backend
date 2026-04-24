import archiver from "archiver";
import axios from "axios";
import { Router } from "express";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// SỬA THÀNH THẾ NÀY:
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

router.post("/custom-watermark", async (req, res) => {
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

    res.download(outputVideo, filename || `watermarked_${jobId}.mp4`);
  } catch (error: any) {
    console.error("Custom watermark error:", error);
    if (!res.headersSent) {
      res.status(500).send(error.message || "Failed to apply watermark");
    }
  } finally {
    setTimeout(() => {
      [inputVideo, outputVideo, watermarkImgPath].forEach((f) => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    }, 5000);
  }
});

// Auto-cut video endpoint
router.get("/auto-cut", async (req, res) => {
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
  } catch (error) {
    console.error("Auto-cut error:", error);
    if (!res.headersSent) res.status(500).send("Failed to process video");
  } finally {
    setTimeout(() => {
      try {
        // Quét và xóa toàn bộ file rác (input, các mảnh video cut) chứa jobId
        const tmpFiles = fs.readdirSync(tmpDir).filter((f) => f.includes(jobId));
        for (const file of tmpFiles) {
          const filePath = path.join(tmpDir, file);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      } catch (cleanupError) {
        console.error("Lỗi khi dọn dẹp thư mục auto-cut:", cleanupError);
      }
    }, 5000);
  }
});

// Trim video endpoint
router.get("/trim", async (req, res) => {
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
    await new Promise<void>((resolve, reject) => {
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
router.get("/extract-audio", async (req, res) => {
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

    // Thay vì truyền callback xóa file, ta chỉ gọi download
    res.download(outputPath, `audio_${jobId}.mp3`);
  } catch (error) {
    console.error("Extract audio error:", error);
    if (!res.headersSent) res.status(500).send("Failed to extract audio");
  } finally {
    // Luôn dọn dẹp ở đây, chờ 5 giây để res.download có thời gian đọc file
    setTimeout(() => {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }, 5000);
  }
});

// Burn subtitles endpoint
router.get("/burn-subtitles", async (req, res) => {
  const { url, ass } = req.query;
  if (!url || typeof url !== "string")
    return res.status(400).send("URL is required");
  if (!ass || typeof ass !== "string")
    return res.status(400).send("ASS content is required");

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

    // 2. Write ASS file
    fs.writeFileSync(subtitleFile, ass);

    // 3. Burn subtitles into video
    const escapedAssPath = subtitleFile
      .replace(/\\/g, "/")
      .replace(/:/g, "\\\\:");

    await new Promise((resolve, reject) => {
      ffmpeg(inputVideo)
        .outputOptions(["-vf", `subtitles=${escapedAssPath}`, "-c:a", "copy"])
        .output(outputVideo)
        .on("error", reject)
        .on("end", () => resolve(null))
        .run();
    });

    res.download(outputVideo, `subtitled_${jobId}.mp4`);
  } catch (error: any) {
    console.error("Burn subtitles error:", error);
    if (!res.headersSent) {
      res.status(500).send(error.message || "Failed to burn subtitles");
    }
  } finally {
    setTimeout(() => {
      [inputVideo, subtitleFile, outputVideo].forEach((f) => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    }, 5000);
  }
});

export default router;
