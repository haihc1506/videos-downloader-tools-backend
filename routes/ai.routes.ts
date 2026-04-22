import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// Lưu ý quan trọng: Vì ở server.ts ta sẽ khai báo tiền tố "/api/ai" cho route này,
// nên ở đây ta chỉ cần viết đường dẫn phần đuôi.
// Thay vì "/api/ai/rewrite-voiceover", ta chỉ cần "/rewrite-voiceover"

// rewrite voiceover route
router.post("/rewrite-voiceover", async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: "URL is required" });
  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({ error: "No Gemini Key" });

  const jobId = uuidv4();
  const tmpVideoPath = path.join(os.tmpdir(), `${jobId}_analyze.mp4`);
  let uploadedFile: any = null; // Biến lưu thông tin file đã upload lên Gemini

  try {
    // 1. Backend tự tải video về
    const response = await axios({
      method: "GET",
      url: videoUrl,
      responseType: "stream",
    });
    const writer = fs.createWriteStream(tmpVideoPath);
    response.data.pipe(writer);
    await new Promise<void>((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // 2. Khởi tạo AI SDK (Dùng SDK mới của bạn)
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // 3. Upload file lên hệ thống của Gemini
    uploadedFile = await ai.files.upload({
      file: tmpVideoPath,
      config: {
        mimeType: "video/mp4",
        displayName: "Video to Analyze",
      }
    });
    console.log("Đã upload lên Gemini. Đang chờ xử lý file...");

    // THÊM MỚI: Vòng lặp chờ file chuyển sang trạng thái ACTIVE
    let fileState = uploadedFile.state;
    while (fileState === "PROCESSING") {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Đợi 2 giây rồi kiểm tra lại
      const fileInfo = await ai.files.get({ name: uploadedFile.name });
      fileState = fileInfo.state;
      console.log(`Trạng thái file: ${fileState}`);
    }

    if (fileState === "FAILED") {
      throw new Error("Hệ thống Gemini báo lỗi khi xử lý video này (FAILED).");
    }

    // 4. Gọi Gemini phân tích
    const prompt = `Bạn là một chuyên gia biên kịch và lồng tiếng. Hãy xem video này và thực hiện các bước sau:
                        1. Phân tích nội dung hình ảnh và âm thanh gốc của video.
                        2. Viết lại kịch bản lời thoại (voice over) bằng tiếng Việt.
                        3. Yêu cầu quan trọng: Lời thoại mới phải bám sát nội dung video, hấp dẫn, tự nhiên và đặc biệt là phải có độ dài (số chữ/tốc độ nói) phù hợp hoàn hảo với thời lượng của video để khi lồng tiếng không bị quá nhanh hay quá chậm.
                        4. Trình bày kịch bản theo định dạng: Voiceover Script liên tục, không phân đoạn theo thời gian, không có timestamp, chỉ có nội dung lời thoại thuần túy.

                        Chỉ trả về nội dung kịch bản bằng tiếng Việt.`;

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          fileData: {
            fileUri: uploadedFile.uri,
            mimeType: uploadedFile.mimeType,
          },
        },
        prompt,
      ],
    });

    // 5. Trả kết quả về Frontend
    res.json({ script: aiResponse.text || "" });
  } catch (error: any) {
    console.error("AI Rewrite error:", error);
    res.status(500).json({ error: "Lỗi phân tích video từ AI" });
  } finally {
    // Luôn dọn dẹp file để tránh đầy ổ cứng!

    // Xóa file mp4 tạm trên máy chủ
    if (fs.existsSync(tmpVideoPath)) fs.unlinkSync(tmpVideoPath);

    // Xóa file đã upload trên server của Gemini
    if (uploadedFile && uploadedFile.name) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        await ai.files.delete({ name: uploadedFile.name });
      } catch (cleanupError) {
        console.error("Lỗi xóa file trên Gemini:", cleanupError);
      }
    }
  }
});

// Subtitle generation route
router.post("/generate-subtitle", async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: "URL là bắt buộc" });
  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({ error: "Chưa cấu hình Gemini API Key" });

  const jobId = uuidv4();
  const tmpVideoPath = path.join(os.tmpdir(), `${jobId}_sub_input.mp4`);
  let uploadedFile: any = null;

  try {
    // 1. Backend tự tải video về để xử lý
    const response = await axios({
      method: "GET",
      url: videoUrl,
      responseType: "stream",
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const writer = fs.createWriteStream(tmpVideoPath);
    response.data.pipe(writer);
    await new Promise<void>((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // 2. Khởi tạo Gemini và Upload File
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    uploadedFile = await ai.files.upload({
      file: tmpVideoPath,
      config: {
        mimeType: "video/mp4",
        displayName: `Sub_Process_${jobId}`,
      },
    });

    // 3. Vòng lặp chờ file ACTIVE (Bắt buộc đối với video)
    let fileState = uploadedFile.state;
    while (fileState === "PROCESSING") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const fileInfo = await ai.files.get({ name: uploadedFile.name });
      fileState = fileInfo.state;
      console.log(`[Subtitle] Trạng thái file: ${fileState}`);
    }

    if (fileState === "FAILED")
      throw new Error("Gemini không thể xử lý video này.");
    // 4. Gọi Gemini tạo phụ đề ASS (Giữ nguyên prompt chuyên sâu của bạn)
    const prompt = `Bạn là một chuyên gia làm phụ đề video. Hãy nghe âm thanh/xem video đầu vào và tạo tệp phụ đề định dạng ASS (Advanced SubStation Alpha) với các yêu cầu sau:

                        1. Ngôn ngữ & Nội dung: Nếu ngôn ngữ gốc là tiếng Việt, hãy chép lời chính xác. Nếu là ngôn ngữ khác, hãy dịch sát nghĩa sang tiếng Việt. Chia nhỏ phụ đề một cách tự nhiên theo ngữ điệu (tối đa khoảng 10 từ mỗi dòng).

                        2. Cấu trúc File ASS: Bạn PHẢI xuất ra đầy đủ 3 phần chuẩn của một file ASS: [Script Info], [V4+ Styles], và [Events].
                        3. Cấu hình như sau:
                        - PlayResX: 1080
                        - PlayResY: 1920
                        - BorderStyle=3
                        - Alignment=2
                        - MarginV=30
                        - PrimaryColour=&H00FFFFFF 
                        - BackColour=&H00000000
                        - WrapStyle=0
                        - Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
                        - Style: Default,Arial,75,&H00FFFFFF,&H000000FF,&H0000A5FF,&H00000000,-1,0,0,0,100,100,0,0,3,10,0,2,10,10,120,1

                        4. Định dạng thời gian: Tuân thủ nghiêm ngặt chuẩn thời gian của ASS là H:MM:SS.cc (Giờ:Phút:Giây.Phần_trăm_giây, ví dụ: 0:01:23.45).

                        5. Định dạng Dòng thoại (Dialogue): Cấu trúc mỗi dòng trong phần [Events] phải tuân theo mẫu:
                        Dialogue: 0,Start_Time,End_Time,Default,,0,0,0,,Nội dung phụ đề

                        6. Định dạng hiển thị thêm (Tùy chọn): Nếu cần in nghiêng giọng nói suy nghĩ/nhạc, dùng thẻ {\i1}văn bản{\i0}.

                        7. Xử lý khoảng lặng: Nếu video hoàn toàn không có lời nói, xuất phần [Events] với một dòng duy nhất:
                        Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,{\i1}[Không có tiếng]{\i0}

                        8. Định dạng xuất ra: CHỈ xuất ra văn bản định dạng ASS thô. Tuyệt đối KHÔNG bọc trong khối mã (code block như ass), không dùng Markdown, không có lời chào hay giải thích thừa.`;

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          fileData: {
            fileUri: uploadedFile.uri,
            mimeType: uploadedFile.mimeType,
          },
        },
        { text: prompt },
      ],
    });

    let srtText = aiResponse.text || "";
    srtText = srtText
      .replace(/^```srt\n/i, "")
      .replace(/^```\n/i, "")
      .replace(/\n```$/i, "")
      .trim();

    res.json({
      srt: srtText || "1\n00:00:00,000 --> 00:00:02,000\n[No Speech Detected]",
    });
  } catch (error: any) {
    console.error("AI Subtitle error:", error);
    res.status(500).json({ error: "Lỗi tạo phụ đề từ AI" });
  }
});

export default router;
