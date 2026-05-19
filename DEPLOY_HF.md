# Deploy to Hugging Face Spaces

## Quick Start

1. Go to https://huggingface.co/spaces and click "Create new Space"
2. Set:
   - **Space name**: your-choice
   - **License**: MIT (or your preference)
   - **SDK**: Docker
   - **Visibility**: Public or Private
3. Click "Create Space"

## Upload Files

Upload ONLY these files and folders to your Space repository:

```
Dockerfile
.dockerignore
backend/
```

That's it. The Dockerfile copies from `backend/` automatically.

**DO NOT upload:**
- `node_modules/`
- `.env` (use HF Space Secrets instead)
- `backend-ts/`
- `frontend/`
- `.git/`

## Configure Secrets

In your Space settings, go to **Settings > Variables and Secrets** and add:

| Secret | Required | Example |
|--------|----------|---------|
| `API_KEYS` | Yes | `mk-key1,mk-key2` |
| `REDIS_URL` | No | `redis://...` (optional) |
| `CACHE_TTL_SECONDS` | No | `3600` |
| `BROWSER_POOL_SIZE` | No | `2` |
| `PAGE_LOAD_TIMEOUT_MS` | No | `15000` |
| `TOTAL_REQUEST_TIMEOUT_MS` | No | `30000` |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` |
| `RATE_LIMIT_MAX` | No | `100` |

## Hardware

- Start with **cpu-basic** (free tier)
- Upgrade to **cpu-upgrade** if you need more RAM for browser instances
- Reduce `BROWSER_POOL_SIZE` to `1` or `2` on free tier

## Test Your Deployment

Once the Space builds and starts:

```bash
# Health check
curl https://your-username-your-space.hf.space/health

# Register an API key
curl -X POST https://your-username-your-space.hf.space/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com"}'

# Extract links
curl -X POST https://your-username-your-space.hf.space/v1/extract \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"type":"movie","name":"Movie Name"}'
```

## Troubleshooting

- **Space won't start**: Check logs in Space > "Logs" tab
- **Browser crashes**: Increase hardware tier or reduce `BROWSER_POOL_SIZE`
- **502 errors**: The app is still starting, wait 30-60 seconds
- **Port errors**: Ensure `PORT=7860` is set (done automatically by Dockerfile)
