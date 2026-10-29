# Madura AI — Intelligent Conversational Assistant

Madura AI is a modern, full-stack AI assistant inspired by ChatGPT, featuring high-speed streaming, multi-model intelligence (Auto / GPT-OSS-20B, Gemini 2.5 Flash, Qwen 3.8, GPT-OSS-120B, and Ultron Nemotron), voice-to-text (Groq Whisper), photorealistic image generation, real-time live web search (Tavily), persistent vector memory (Supabase), and multi-key auto-failover resilience.

---

## 🚀 Features

- **Multi-Model Intelligence**: Auto (GPT-OSS-20B), Gemini 2.5 Flash, Qwen 3.8, GPT-OSS-120B, and Ultron Nemotron 550B.
- **Multi-Key Auto-Rotation & Fallback**: Support for multiple API keys per provider (`NVIDIA_API_KEYS`, `GEMINI_API_KEYS`, `GROQ_API_KEYS`, `TAVILY_API_KEYS`). Automatic rotation with cooldown upon reaching rate limits (`429`) or quota exhaustion (`401`/`403`).
- **Live Web Search**: Tavily-powered real-time internet search with smart intent classification and source citation badges.
- **Voice Transcription**: High-performance voice-to-text with Groq Whisper Large V3 Turbo.
- **Image Generation**: Automated prompt detection and image generation powered by FLUX architecture.
- **Long-Term Memory & Supabase**: Semantic memory storage with vector embeddings.
- **Vercel Ready**: Preconfigured for seamless deployment on Vercel with Serverless Functions (`api/index.js`) and Vite SPA routing.

---

## 🛠️ Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your keys:
```bash
cp .env.example .env
```

### 3. Run Development Server
```bash
npm run dev
```
- Client runs on `http://localhost:5173`
- API server runs on `http://localhost:3001`

### 4. Build and Test
```bash
# Run unit test suite
npm test

# Build production bundle
npm run build
```

---

## 🌐 Deploy to Vercel

1. Import this repository in **[Vercel](https://vercel.com)**.
2. Vercel automatically detects the **Vite** preset:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist/client`
3. In **Project Settings $\rightarrow$ Environment Variables**, add your keys:
   - `NVIDIA_API_KEYS` (or `NVIDIA_API_KEY`)
   - `GEMINI_API_KEYS` (or `GEMINI_API_KEY`)
   - `GROQ_API_KEYS` (or `GROQ_API_KEY`)
   - `TAVILY_API_KEYS` (or `TAVILY_API_KEY`)
   - `SUPABASE_URL` & `SUPABASE_PUBLISHABLE_KEY` (optional for cloud memory)
4. Click **Deploy**. Vercel will build both the frontend and the serverless API routes (`/api/*`).

---

## 📄 License
MIT
