// Nano Banana (Gemini 2.5 Flash Image) — server-side proxy
// Keys live only in Netlify env vars. Browser never sees them.
//
// Required env vars (set in Netlify dashboard):
//   GEMINI_API_KEY      — Google AI Studio key (https://aistudio.google.com)
//   DASHBOARD_PASSWORD  — shared password for this site's users
//
// Frontend calls:
//   POST /.netlify/functions/nano-banana
//   Authorization: Bearer <DASHBOARD_PASSWORD>
//   Body: { "prompt": "..." }
//
// Response:
//   { "image": "<base64>", "mimeType": "image/png" }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { ...cors, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // Auth gate (optional — only enforced if DASHBOARD_PASSWORD env var is set)
  const expected = process.env.DASHBOARD_PASSWORD;
  if (expected) {
    const auth = event.headers.authorization || event.headers.Authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== expected) {
      return json(401, { error: 'Unauthorized — wrong or missing password' });
    }
  }

  // API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'Server not configured: GEMINI_API_KEY missing' });
  }

  // Parse body
  let prompt;
  try {
    const body = JSON.parse(event.body || '{}');
    prompt = (body.prompt || '').trim();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!prompt) {
    return json(400, { error: 'No prompt provided' });
  }

  // Call Gemini
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!r.ok) {
      return json(r.status, {
        error: 'Gemini API error',
        status: r.status,
        detail: data?.error?.message || text.slice(0, 400),
      });
    }

    // Find first inline image part. Gemini returns parts with either
    // camelCase (inlineData) or snake_case (inline_data) depending on
    // SDK normalisation; handle both.
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData || p.inline_data);
    if (!imagePart) {
      const textOut = parts.map((p) => p.text).filter(Boolean).join(' ');
      return json(500, {
        error: 'Gemini returned no image',
        textOutput: textOut || null,
        finishReason: data?.candidates?.[0]?.finishReason,
      });
    }
    const inline = imagePart.inlineData || imagePart.inline_data;

    return json(200, {
      image: inline.data,
      mimeType: inline.mimeType || inline.mime_type || 'image/png',
    });
  } catch (e) {
    return json(500, { error: 'Function exception: ' + (e?.message || String(e)) });
  }
};
