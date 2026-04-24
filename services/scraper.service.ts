// backend/services/scraper.service.ts
import axios from "axios";
import * as cheerio from "cheerio";

export async function processUrl(
  url: string,
  noWatermark: boolean,
): Promise<{
  type: "image" | "video";
  title: string;
  desc: string;
  images?: string[];
  videoUrl?: string;
  coverUrl?: string;
  author: string;
}> {
  
    const isTikTok = url.includes("tiktok.com");
    const isDouyin = url.includes("douyin.com");
    const isXHS =
      url.includes("xiaohongshu.com") || url.includes("xhslink.com");

    if (!isTikTok && !isXHS && !isDouyin) {
      throw new Error(
        "Vui lòng nhập link Xiaohongshu, TikTok hoặc Douyin hợp lệ.",
      );
    }

    // --- TIKTOK & DOUYIN LOGIC ---
    if (isTikTok || isDouyin) {
      try {
        const tikwmRes = await axios.get("https://www.tikwm.com/api/", {
          params: {
            url: url,
            hd: 1,
          },
          timeout: 10000,
        });

        const data = tikwmRes.data;
        if (data.code === 0 && data.data) {
          const videoData = data.data;

          // Handle image posts
          if (videoData.images && videoData.images.length > 0) {
            return {
              type: "image",
              title:
                videoData.title ||
                (isTikTok ? "TikTok Images" : "Douyin Images"),
              desc: videoData.title || "",
              images: videoData.images,
              author: videoData.author?.nickname || "Unknown",
            };
          }

          // Determine video URL based on watermark preference
          let videoUrl = videoData.play;
          if (noWatermark) {
            videoUrl = videoData.hdplay || videoData.play;
          } else {
            videoUrl = videoData.wmplay || videoData.play;
          }

          if (!videoUrl.startsWith("http")) {
            videoUrl = "https://www.tikwm.com" + videoUrl;
          }

          return {
            type: "video",
            title:
              videoData.title || (isTikTok ? "TikTok Video" : "Douyin Video"),
            desc: videoData.title || "",
            videoUrl: videoUrl,
            coverUrl: videoData.cover,
            author: videoData.author?.nickname || "Unknown",
          };
        } else {
          throw new Error(
            data.msg ||
              "Không thể lấy dữ liệu. Link có thể không hợp lệ hoặc video ở chế độ riêng tư.",
          );
        }
      } catch (err: any) {
        console.error("TikTok/Douyin fetch error:", err.message);
        throw new Error(
          err.message.includes("Không thể lấy dữ liệu")
            ? err.message
            : "Lỗi kết nối đến máy chủ tải video. Vui lòng thử lại sau.",
        );
      }
    }

    // --- XIAOHONGSHU LOGIC ---
    let xhsUrl = url;
    if (xhsUrl.includes("/discovery/item/")) {
      xhsUrl = xhsUrl.replace("/discovery/item/", "/explore/");
    }

    // 1. Fetch the initial URL to handle redirects (e.g., xhslink.com)
    const initialResponse = await axios.get(xhsUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      maxRedirects: 5,
    });

    const finalUrl = initialResponse.request.res.responseUrl || url;
    const html = initialResponse.data;

    // 2. Extract window.__INITIAL_STATE__
    const $ = cheerio.load(html);
    let initialStateStr = "";

    $("script").each((i, el) => {
      const scriptContent = $(el).html();
      if (
        scriptContent &&
        scriptContent.includes("window.__INITIAL_STATE__=")
      ) {
        const startIndex = scriptContent.indexOf("window.__INITIAL_STATE__=");
        if (startIndex !== -1) {
          const jsonStart = scriptContent.indexOf("{", startIndex);
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

              if (char === "\\") {
                escapeNext = true;
                continue;
              }

              if (char === '"') {
                inString = !inString;
                continue;
              }

              if (!inString) {
                if (char === "{") braceCount++;
                else if (char === "}") {
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
              initialStateStr = initialStateStr.replace(/undefined/g, "null");
            }
          }
        }
      }
    });

    if (!initialStateStr) {
      // Try alternative: window.__INITIAL_DATA__
      $("script").each((i, el) => {
        const scriptContent = $(el).html();
        if (
          scriptContent &&
          scriptContent.includes("window.__INITIAL_DATA__=")
        ) {
          const startIndex = scriptContent.indexOf("window.__INITIAL_DATA__=");
          if (startIndex !== -1) {
            const jsonStart = scriptContent.indexOf("{", startIndex);
            if (jsonStart !== -1) {
              // Simple extraction for now
              const jsonEnd = scriptContent.lastIndexOf("}");
              if (jsonEnd > jsonStart) {
                initialStateStr = scriptContent.substring(
                  jsonStart,
                  jsonEnd + 1,
                );
                initialStateStr = initialStateStr.replace(/undefined/g, "null");
              }
            }
          }
        }
      });
    }

    if (!initialStateStr) {
      throw new Error(
        "Could not find video data on this page. Make sure it is a valid Xiaohongshu post URL.",
      );
    }

    let initialState: any;
    try {
      initialState = JSON.parse(initialStateStr);
    } catch (e) {
      throw new Error("Failed to parse video data.");
    }

    // 3. Navigate the JSON to find the video URL
    let noteData: any = null;
    if (initialState?.note?.noteDetailMap) {
      noteData = (Object.values(initialState.note.noteDetailMap)[0] as any)
        ?.note;
    } else if (initialState?.noteData?.data?.noteData) {
      noteData = initialState.noteData.data.noteData;
    } else if (initialState?.noteData) {
      noteData = initialState.noteData;
    }

    if (!noteData) {
      throw new Error(
        "Could not find video data on this page. Make sure it is a valid Xiaohongshu post URL.",
      );
    }

    if (noteData.type !== "video" && noteData.type !== "normal") {
      const images: string[] = (noteData.imageList || []).map(
        (img: any) => img.urlDefault || img.url,
      );
      if (images.length > 0) {
        return {
          type: "image",
          title: noteData.title || "Xiaohongshu Images",
          desc: noteData.desc || "",
          images: images,
          author: noteData.user?.nickname || "Unknown",
        };
      }
      throw new Error("This post does not contain a video or images.");
    }

    const h265 = noteData.video?.media?.stream?.h265;
    const h264 = noteData.video?.media?.stream?.h264;

    let videoUrl = "";
    if (h265 && h265.length > 0) {
      videoUrl = h265[0].masterUrl;
    } else if (h264 && h264.length > 0) {
      videoUrl = h264[0].masterUrl;
    }

    const coverUrl =
      noteData.imageList?.[0]?.urlDefault || noteData.imageList?.[0]?.url;

    if (!videoUrl) {
      throw new Error("Could not extract video URL.");
    }

    return {
      type: "video",
      title: noteData.title || "Xiaohongshu Video",
      desc: noteData.desc || "",
      videoUrl: videoUrl,
      coverUrl: coverUrl,
      author: noteData.user?.nickname || "Unknown",
    };
}