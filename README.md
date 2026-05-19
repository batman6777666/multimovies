# Hugging Face Spaces configuration
# This Space runs the Video Embed Link Extractor API
# Docs: https://huggingface.co/docs/hub/spaces-sdks-docker

title: Video Embed Link Extractor API
emoji: 🔍
color: blue

sdk: docker

# Hardware configuration (choose based on your needs)
# cpu-basic is free, upgrade if you need more performance
hardware: cpu-basic

# Tags for discoverability
tags:
  - api
  - web-scraping
  - puppeteer
  - video

# Environment variables (set these in Hugging Face Space Settings > Secrets)
# PORT=7860 (required by HF, already set in Dockerfile)
# API_KEYS=your_pre_seeded_keys_here
# REDIS_URL= (optional, leave unset for in-memory cache)
# CACHE_TTL_SECONDS=3600
# BROWSER_POOL_SIZE=2
# PAGE_LOAD_TIMEOUT_MS=15000
# TOTAL_REQUEST_TIMEOUT_MS=30000
# RATE_LIMIT_WINDOW_MS=60000
# RATE_LIMIT_MAX=100
