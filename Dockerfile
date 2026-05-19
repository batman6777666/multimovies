FROM node:20-slim

# Install system dependencies for Puppeteer (Chromium)
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# HF Spaces clones repo to /home/user/app
WORKDIR /home/user/app

# Copy everything (node_modules, .env excluded by .dockerignore)
COPY . .

# Install backend dependencies
WORKDIR /home/user/app/backend
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --only=production 2>/dev/null || npm install --only=production

# Ensure data directory exists
RUN mkdir -p /home/user/app/backend/data && chmod 755 /home/user/app/backend/data

# Hugging Face requires port 7860
ENV PORT=7860
ENV NODE_ENV=production
ENV BROWSER_POOL_SIZE=2
ENV PAGE_LOAD_TIMEOUT_MS=15000
ENV TOTAL_REQUEST_TIMEOUT_MS=30000
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:7860/health || exit 1

CMD ["node", "/home/user/app/backend/src/server.js"]
