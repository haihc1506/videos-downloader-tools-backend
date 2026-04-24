import { Router } from "express";
import { processUrl } from "../services/scraper.service.ts";
import axios from "axios";

const router = Router();

router.get("/proxy-download", async (req, res) => {
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

router.post("/", async (req, res) => {
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

router.post("bulk-download", async (req, res) => {
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

export default router;
