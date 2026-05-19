---
title: Multimovies
emoji: 🎬
colorFrom: indigo
colorTo: purple
sdk: docker
pinned: false
---

# Video Embed Link Extractor API

A web scraping service that extracts streaming server links (RPM, P2P, UPN) from video hosting sites.

## Project Structure

```
multimovies/
├── backend/          # Node.js + Express API (Puppeteer)
│   ├── src/          # Server code
│   ├── config/       # Environment config
│   ├── data/         # API key storage
│   ├── public/       # Static files (docs, frontend)
│   ├── package.json
│   └── .env.example
├── backend-ts/       # TypeScript + Express API (Playwright) - alternative
├── frontend/         # React + Vite frontend app
├── Dockerfile        # Docker config for Hugging Face
└── .dockerignore
```

## Quick Start (Backend)

```bash
cd backend
npm install
cp .env.example .env
npm start
```

## Deploy to Hugging Face

See `DEPLOY_HF.md` for detailed instructions.
<!-- rebuild v2 -->
