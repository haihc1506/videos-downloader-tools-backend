# XHS Downloader Backend

Backend API server for downloading media from Xiaohongshu (XHS), TikTok, and Douyin with video editing capabilities.

## Features

- 📥 Media download from multiple platforms (XHS, TikTok, Douyin)
- 🎬 Video editing with watermark removal and trimming
- 🤖 AI-powered media analysis using Google Gemini API
- 📦 Batch download support
- 🔒 Input validation and error handling
- ⚡ Express.js REST API

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- ffmpeg (for video processing)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/xhs-downloader-backend.git
cd xhs-downloader-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env.local` file (copy from `.env.example`):
```bash
cp .env.example .env.local
```

4. Configure environment variables in `.env.local`:
```
PORT=3000
NODE_ENV=development
GEMINI_API_KEY=your_api_key_here
APP_URL=http://localhost:3000
DEBUG=false
LOG_LEVEL=info
```

## Development

Start development server with hot reload:
```bash
npm run dev
```

The server will run on `http://localhost:3000`

## Production

Build for production:
```bash
npm run build
```

Start production server:
```bash
npm start
```

## API Endpoints

### Download
- `POST /api/download` - Download media from URL
- `POST /api/bulk-download` - Batch download from multiple URLs

### Edit
- `POST /api/edit/remove-watermark` - Remove watermark from video
- `POST /api/edit/trim` - Trim video to specific duration

### Health Check
- `GET /api/health` - Server health status

## Project Structure

```
├── server/
│   ├── config.ts           # Configuration management
│   ├── middleware/         # Express middleware
│   │   └── errorHandler.ts
│   ├── routes/             # API routes
│   │   ├── download.ts
│   │   └── edit.ts
│   ├── services/           # Business logic
│   │   ├── mediaService.ts
│   │   └── videoEditService.ts
│   ├── types/              # TypeScript definitions
│   │   └── index.ts
│   └── utils/              # Utility functions
│       ├── ffmpegUtils.ts
│       ├── fileUtils.ts
│       ├── urlUtils.ts
│       └── validation.ts
├── server-new.ts           # Main server entry point
├── server.ts               # Legacy server entry point
├── tsconfig.json           # TypeScript config
├── tsconfig.server.json    # Server-specific TypeScript config
└── package.json            # Dependencies
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Compile TypeScript to JavaScript
- `npm run start` - Run compiled production server
- `npm run lint` - Check TypeScript types
- `npm run type-check` - Full type checking
- `npm run clean` - Remove dist folder

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment (development/production) | development |
| `GEMINI_API_KEY` | Google Gemini API key | - |
| `APP_URL` | Application URL | http://localhost:3000 |
| `DEBUG` | Enable debug logging | false |
| `LOG_LEVEL` | Log level (debug/info/warn/error) | info |

## Technologies

- **Express.js** - Web framework
- **TypeScript** - Language
- **ffmpeg** - Video processing
- **Axios** - HTTP client
- **Cheerio** - Web scraping
- **Google Gemini API** - AI analysis

## Contributing

1. Create a feature branch (`git checkout -b feature/AmazingFeature`)
2. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
3. Push to the branch (`git push origin feature/AmazingFeature`)
4. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Frontend

For the frontend application, see [xhs-downloader-frontend](../xhs-downloader-frontend)

## Support

For issues and questions, please create an issue in the GitHub repository.
