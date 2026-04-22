import { Router } from "express";
import { ElevenLabsClient, play } from "@elevenlabs/elevenlabs-js";

const router = Router();

router.get("/tts/voices", async (req, res) => {
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

router.post("/tts/convert", async (req, res) => {
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
