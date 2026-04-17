/**
 * Optimized Express server with modular architecture
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

// Middleware and error handling
import { errorHandler, asyncHandler } from './server/middleware/errorHandler';
import { validateEnvironment } from './server/utils/validation';

// Routes
import downloadRoutes from './server/routes/download';
import editRoutes from './server/routes/edit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Start server
 */
async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Validate environment
  const envValidation = validateEnvironment();
  if (!envValidation.isValid) {
    console.warn('Environment validation warnings:', envValidation.errors);
  }

  // Middleware
  app.use(express.json({ limit: '50mb' }));

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // API routes
  app.use('/api', downloadRoutes);
  app.use('/api/edit', editRoutes);

  // Static file serving and Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    // Development mode with Vite HMR
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode with static files
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    
    // Fallback to index.html for SPA routing
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global error handler (must be last)
  app.use(errorHandler);

  // Start listening
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

// Start server
startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
