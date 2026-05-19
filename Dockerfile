# Hugging Face Spaces Docker template for Video Embed Link Extractor API
# Requires a GPU or CPU Space with Docker support

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

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./

# Install dependencies (skip Puppeteer download since we'll use system Chromium)
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci --only=production 2>/dev/null || npm install --only=production

# Copy application source
COPY src/ ./src/
COPY config/ ./config/
COPY public/ ./public/
COPY data/ ./data/
COPY .env.example ./.env

# Create data directory with proper permissions
RUN mkdir -p /app/data && chmod 755 /app/data

# Expose the port Hugging Face expects
EXPOSE 7860

# Environment variables optimized for Hugging Face Spaces
ENV PORT=7860
ENV NODE_ENV=production
ENV BROWSER_POOL_SIZE=2
ENV PAGE_LOAD_TIMEOUT_MS=15000
ENV TOTAL_REQUEST_TIMEOUT_MS=30000
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:7860/health || exit 1

# Start the server
CMD ["node", "src/server.js"]
