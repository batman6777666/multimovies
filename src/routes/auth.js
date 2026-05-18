const express = require('express');
const rateLimit = require('express-rate-limit');
const { createKey } = require('../services/keyStore');

const router = express.Router();

// Strict rate limit on registration — prevent abuse
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,                   // 10 key registrations per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: 'Too many registration attempts. Try again in an hour.',
      code: 'REGISTER_RATE_LIMITED',
    });
  },
});

// ─── POST /auth/register ──────────────────────────────────────────────────────

router.post('/register', registerLimiter, (req, res) => {
  const { name, email } = req.body;

  // Validate name
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({
      success: false,
      error: 'Name is required (minimum 2 characters)',
      code: 'INVALID_NAME',
    });
  }

  if (name.trim().length > 80) {
    return res.status(400).json({
      success: false,
      error: 'Name too long (max 80 characters)',
      code: 'INVALID_NAME',
    });
  }

  // Validate email if provided
  if (email && typeof email === 'string') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
        code: 'INVALID_EMAIL',
      });
    }
  }

  try {
    const apiKey = createKey(name, email || null);

    console.log(`[Auth] New API key registered — Name: ${name.trim()}`);

    return res.status(201).json({
      success: true,
      message: 'API key created successfully. Save it — it won\'t be shown again.',
      data: {
        api_key: apiKey,
        name: name.trim(),
        created_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[Auth] Key creation failed:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to create API key. Please try again.',
      code: 'INTERNAL_ERROR',
    });
  }
});

module.exports = router;
