import { openai, openaiEnabled, openaiModel } from '../config/openai.js';

const NAVIGATE_LIKE_RE =
  /\b(open|go to|take me to|navigate to|show|view)\b[\w\s]{0,40}\b(cart|card|kart|favorites|favourites|wishlist|address|addresses|marketplace|market place|profile|account|orders?|store|shop)\b/i;

const fixNavigateHomophones = (value) => {
  let next = String(value || '');
  // Whisper almost always hears "cart" as "card" — never rewrite inside address phrases.
  if (!/\baddress/i.test(next)) {
    next = next.replace(/\bcard\b/gi, 'cart').replace(/\bkart\b/gi, 'cart');
  }
  return next
    .replace(/\bfavourites\b/gi, 'favorites')
    .replace(/\bwish list\b/gi, 'wishlist');
};

const stripSearchCommands = (value) =>
  String(value || '')
    .replace(
      /^(please\s+)?(can you\s+)?(show(\s+me)?|find(\s+me)?|search(\s+for)?|look(\s+for)?|get(\s+me)?|display|i\s+(want|need))\s+/i,
      '',
    )
    .trim();

const contextInstructions = (context, hint) => {
  if (context === 'onboarding') {
    return `Context: user is answering an onboarding question${hint ? ` about "${hint}"` : ''}. Return a clear short answer (or option label), not a chat sentence unless they spoke one.`;
  }

  if (context === 'search') {
    return `Context: user is doing FULLSCREEN VOICE SEARCH on Fabrica (B2B fabric marketplace in India).
If the user is asking to open a buyer section, keep that intent unchanged:
profile, marketplace, cart, orders, favorites/wishlist, address/addresses.
Critical STT fix: "open the card" / "open card" almost always means "open the cart" — rewrite card→cart (never when they said address).
Do NOT rewrite jeans↔denim. If they said jeans, keep "jeans". If they said denim, keep "denim".
Examples:
- "Show Denim Shirts" → "denim shirts"
- "show fabric for jeans" → "fabric for jeans"
- "show fabric for t-shirts" → "fabric for t-shirts"
- "open the cart" → "open the cart"
- "open the card" → "open the cart"
- "open marketplace section" → "open marketplace section"
- "open the address section" → "open the address section"
- "find me black linen under 300" → "black linen under 300"
Otherwise return ONLY clean product/search keywords — strip show/find/search for/etc.`;
  }

  return `Context: user is talking to Fabrica AI chatbot (B2B fabric marketplace in India).
Keep navigate phrases intact for buyer menu sections: profile, marketplace, cart, orders, favorites, address.
Critical STT fix: Whisper often hears cart as "card" — rewrite "open the card" → "open the cart" (never rewrite address phrases).
Do NOT rewrite jeans↔denim. Keep the buyer's spoken word.
Fix other STT mistakes in fabric queries (soups→suits, etc.). Never return "" for a clear short command.`;
};

/**
 * Light AI pass over Whisper text so homophones / nonsense become sensible Fabrica input.
 * e.g. "clothes for soups" → "clothes for suits"
 * search context also strips "show/find/search for…" into keywords only.
 */
export const cleanupVoiceText = async (rawText, { context = 'marketplace', hint = '' } = {}) => {
  const original = String(rawText || '').trim();
  if (!original) return { text: '', raw: '', changed: false };

  // Deterministic fix before/without AI — Whisper routinely outputs "card" for "cart".
  const text = NAVIGATE_LIKE_RE.test(original)
    ? fixNavigateHomophones(original)
    : original;

  if (!openaiEnabled || !openai) {
    if (context === 'search') {
      if (NAVIGATE_LIKE_RE.test(text)) {
        return { text, raw: original, changed: text !== original };
      }
      const stripped = stripSearchCommands(text);
      return {
        text: stripped || text,
        raw: original,
        changed: Boolean(stripped && stripped !== original),
      };
    }
    return { text, raw: original, changed: text !== original };
  }

  const contextLine = contextInstructions(context, hint);

  try {
    const completion = await openai.chat.completions.create({
      model: openaiModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You clean speech-to-text for Fabrica.
${contextLine}
Rules:
- Fix only clear STT mistakes that make the phrase nonsense (soups→suits, card→cart for open/go-to commands, etc.).
- NEVER rewrite "jeans" to "denim" or "denim" to "jeans". Keep the buyer's exact fabric/garment word.
- Keep the user's intent; do not invent a new request.
- NEVER return "" for navigate phrases (cart / favorites / wishlist) or other clear short commands.
- If it is silence filler / gibberish with no recoverable intent, return "".
- Return ONLY JSON: { "text": string, "changed": boolean }`,
        },
        { role: 'user', content: text },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || '{}';
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    let cleaned = String(parsed?.text ?? '').trim();

    // Model sometimes blanks short commands — keep the Whisper text.
    if (!cleaned) {
      if (NAVIGATE_LIKE_RE.test(text) || text.split(/\s+/).length <= 8) {
        cleaned = text;
      } else {
        return { text: '', raw: original, changed: true };
      }
    }

    if (NAVIGATE_LIKE_RE.test(cleaned) || NAVIGATE_LIKE_RE.test(text)) {
      cleaned = fixNavigateHomophones(cleaned);
    }

    // Never let the model silently rewrite jeans ↔ denim.
    if (/\bjeans\b/i.test(original) && /\bdenim\b/i.test(cleaned) && !/\bjeans\b/i.test(cleaned)) {
      cleaned = cleaned.replace(/\bdenim\b/gi, 'jeans');
    }
    if (/\bdenim\b/i.test(original) && /\bjeans\b/i.test(cleaned) && !/\bdenim\b/i.test(cleaned)) {
      cleaned = cleaned.replace(/\bjeans\b/gi, 'denim');
    }
    // Also guard against rewrite relative to pre-AI text (card→cart etc.).
    if (/\bjeans\b/i.test(text) && /\bdenim\b/i.test(cleaned) && !/\bjeans\b/i.test(cleaned)) {
      cleaned = cleaned.replace(/\bdenim\b/gi, 'jeans');
    }
    if (/\bdenim\b/i.test(text) && /\bjeans\b/i.test(cleaned) && !/\bdenim\b/i.test(cleaned)) {
      cleaned = cleaned.replace(/\bjeans\b/gi, 'denim');
    }

    if (context === 'search' && !NAVIGATE_LIKE_RE.test(cleaned)) {
      const stripped = stripSearchCommands(cleaned);
      if (stripped) cleaned = stripped;
    }

    return {
      text: cleaned,
      raw: original,
      changed: Boolean(parsed?.changed) || cleaned !== original,
    };
  } catch {
    if (context === 'search' && !NAVIGATE_LIKE_RE.test(text)) {
      const stripped = stripSearchCommands(text);
      return {
        text: stripped || text,
        raw: original,
        changed: Boolean(stripped && stripped !== original),
      };
    }
    return { text, raw: original, changed: text !== original };
  }
};
