import express, { Request, Response } from 'express';
import cors from 'cors';
import { inspectPage } from './inspector';
import { closeBrowser } from './browser';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.post('/api/inspect', async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'Invalid or missing URL',
    });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({
      success: false,
      message: 'Invalid URL format',
    });
  }

  console.log(`Inspecting: ${url}`);
  const result = await inspectPage(url);
  console.log(`Result: ${JSON.stringify(result)}`);

  if (result.success) {
    return res.json(result);
  } else {
    return res.status(404).json(result);
  }
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await closeBrowser();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
