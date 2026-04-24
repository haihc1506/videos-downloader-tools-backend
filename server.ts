import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import aiRoutes from "./routes/ai.routes.js";
import downloadRoutes from "./routes/download.routes.js";
import ttsRoutes from "./routes/tts.routes.js";
import editRoutes from "./routes/edit.routes.js";
import quotaRoutes from "./routes/quota.routes.js";

// Load environment variables
dotenv.config();

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

  // Route mặc định khi truy cập vào trang chủ của API
  app.get("/", (req, res) => {
    res.send("🚀 XHS Downloader API Server is running successfully!");
  });
  
  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api/download", downloadRoutes);

  app.use("/api/ai", aiRoutes);

  app.use("/api/tts", ttsRoutes);

  app.use("/api/edit", editRoutes);

  app.use("/api/quota", quotaRoutes);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
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
