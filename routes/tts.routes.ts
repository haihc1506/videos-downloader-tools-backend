import { Router } from "express";
import { ElevenLabsClient, play } from "@elevenlabs/elevenlabs-js";

const router = Router();
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

router.get("/voices", async (req, res) => {
  try {
    const voices = await elevenlabs.voices.getAll();
    res.json({ voices });
  } catch (error) {
    console.error("Fetch voices error:", error);
    res.status(500).json({ error: "Failed to fetch voices" });
  }
});

router.post("/convert", async (req, res) => {
  try {
    const { text, voiceId } = req.body;

    if (!process.env.ELEVENLABS_API_KEY) {
      return res
        .status(500)
        .json({ error: "Chưa cấu hình Elevenlabs API Key trên server" });
    }

    // 1. Lấy Stream từ SDK
    const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
      text,
      modelId: "eleven_flash_v2_5", // Lưu ý: SDK ElevenLabs đôi khi yêu cầu snake_case cho model_id
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75, // và similarity_boost
        style: 0.0,
        useSpeakerBoost: false,
      },
    });

    // 2. Chuyển Stream thành Buffer bằng cách gom từng mảnh dữ liệu (chunk)
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream as any) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // 3. Trả về Frontend
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": buffer.length,
    });

    res.send(buffer);
  } catch (error: any) {
    console.error("TTS error:", error);
    res.status(500).json({ error: error.message || "Lỗi tạo voiceover" });
  }
});

export default router;