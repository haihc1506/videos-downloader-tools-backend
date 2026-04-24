import { GoogleGenAI } from "@google/genai";
import axios from "axios";
import { Router } from "express";

const router = Router();

router.get("/", async (req, res) => {
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
      result.elevenlabs.error = "API Key ElevenLabs không hợp lệ hoặc hết hạn.";
    }
  } else {
    result.elevenlabs.error = "Chưa cấu hình API Key.";
  }

  res.json(result);
});

export default router;
