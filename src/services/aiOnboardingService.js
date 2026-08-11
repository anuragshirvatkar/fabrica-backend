import { openai, openaiEnabled, openaiModel } from '../config/openai.js';
import {
  BUDGET_RANGES,
  BUSINESS_TYPES,
  FABRIC_PREFERENCES,
  INDUSTRIES,
  INTEREST_OPTIONS,
  ORDER_QUANTITY_RANGES,
} from '../constants/buyerPreferences.js';
import {
  INDIAN_STATES,
  OPERATING_HOURS,
  SELLER_FABRIC_TYPES,
  SELLER_MOQ_RANGES,
  SELLER_PRODUCT_CATEGORIES,
} from '../constants/sellerPreferences.js';
import { createError } from '../utils/errors.js';

const NONSENSE_PATTERNS = [
  /^(.)\1{3,}$/i,
  /^(test|testing|asdf|qwerty|lorem|ipsum|xxx|abc|xyz|none|na|n\/a|idk|whatever|haha|lol|ok|hi|hey|yo)$/i,
  /^[^a-zA-Z0-9]+$/,
];

const BUYER_FIELDS = [
  {
    key: 'businessType',
    label: 'business type',
    mode: 'single',
    options: BUSINESS_TYPES,
    allowOther: true,
    otherKey: 'businessTypeOther',
    question:
      'What best describes your business? You can tap an option below or tell me in your own words.',
  },
  {
    key: 'industry',
    label: 'industry',
    mode: 'single',
    options: INDUSTRIES,
    allowOther: true,
    otherKey: 'industryOther',
    question: 'Which industry are you mainly in? Pick one or describe it.',
  },
  {
    key: 'interests',
    label: 'interests',
    mode: 'multi',
    options: INTEREST_OPTIONS,
    question:
      'What are you usually looking for? Select one or more options, or list them in a message.',
  },
  {
    key: 'preferredFabrics',
    label: 'preferred fabrics',
    mode: 'multi',
    options: FABRIC_PREFERENCES,
    question: 'Which fabrics matter most to you? Pick all that apply, or name them.',
  },
  {
    key: 'typicalOrderQuantity',
    label: 'typical order quantity',
    mode: 'single',
    options: ORDER_QUANTITY_RANGES,
    question: 'What’s your typical order size? Choose a range or tell me roughly in meters.',
  },
  {
    key: 'budgetRange',
    label: 'budget range',
    mode: 'single',
    options: BUDGET_RANGES,
    question: 'Last one — what’s your usual buying budget? Pick a range or say it in words.',
  },
];

const SELLER_FIELDS = [
  {
    key: 'companyName',
    label: 'business / company name',
    mode: 'text',
    question: 'What’s your business or company name?',
    minLength: 2,
  },
  {
    key: 'gst',
    label: 'GST number',
    mode: 'text',
    question: 'What’s your GST number? (15 characters)',
    minLength: 15,
  },
  {
    key: 'phone',
    label: 'phone number',
    mode: 'text',
    question: 'What’s the best 10-digit mobile number for your store?',
    minLength: 10,
  },
  {
    key: 'description',
    label: 'business description',
    mode: 'text',
    optional: true,
    question:
      'In one short line, how would you describe your store? You can also say “skip”.',
    minLength: 8,
  },
  {
    key: 'address',
    label: 'business address',
    mode: 'address',
    question:
      'What’s your business address? Include street, city, state, and PIN code — or fill the fields below.',
  },
  {
    key: 'operatingHours',
    label: 'operating hours',
    mode: 'single',
    options: OPERATING_HOURS,
    allowOther: true,
    otherKey: 'operatingHoursOther',
    question: 'When are you usually open? Pick an option or describe your hours.',
  },
  {
    key: 'productCategories',
    label: 'product categories',
    mode: 'multi',
    options: SELLER_PRODUCT_CATEGORIES,
    question: 'Which product categories do you sell? Select all that apply.',
  },
  {
    key: 'fabricTypes',
    label: 'fabric types',
    mode: 'multi',
    options: SELLER_FABRIC_TYPES,
    question: 'Which fabric types do you stock? Pick all that fit.',
  },
  {
    key: 'moqRange',
    label: 'MOQ range',
    mode: 'single',
    options: SELLER_MOQ_RANGES,
    question: 'What’s your usual minimum order quantity (MOQ)?',
  },
];

const looksNonsense = (text) => {
  const value = String(text || '').trim();
  if (!value) return true;
  if (value.length < 2) return true;
  if (NONSENSE_PATTERNS.some((pattern) => pattern.test(value))) return true;
  const letters = value.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 4) {
    const unique = new Set(letters.toLowerCase());
    if (unique.size <= 2) return true;
  }
  return false;
};

const normalize = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');

const compact = (value) => normalize(value).replace(/[^a-z0-9]+/g, '');

const editDistance = (a, b) => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
};

const matchOption = (text, options) => {
  const n = normalize(text);
  if (!n) return null;
  const exact = options.find((option) => normalize(option) === n);
  if (exact) return exact;
  const includes = options.find(
    (option) => n.includes(normalize(option)) || normalize(option).includes(n),
  );
  if (includes) return includes;

  const spoken = compact(text);
  if (!spoken) return null;
  for (const option of options) {
    const o = compact(option);
    if (!o) continue;
    if (spoken === o || spoken.includes(o) || o.includes(spoken)) return option;
  }

  let best = null;
  for (const option of options) {
    const o = compact(option);
    if (o.length < 4) continue;
    const distance = editDistance(spoken, o);
    const allowed = o.length >= 8 ? 3 : 2;
    if (distance <= allowed && (!best || distance < best.distance)) {
      best = { option, distance };
    }
  }
  return best?.option || null;
};

const matchManyOptions = (text, options) => {
  const n = normalize(text);
  if (!n) return [];
  const hits = options.filter((option) => {
    const o = normalize(option);
    return n.includes(o) || o.split(/[\/,&]/).some((part) => part.trim() && n.includes(part.trim()));
  });
  if (hits.length) return [...new Set(hits)];

  const parts = n.split(/,| and | & |\//).map((part) => part.trim()).filter(Boolean);
  const fromParts = parts
    .map((part) => matchOption(part, options))
    .filter(Boolean);
  return [...new Set(fromParts)];
};

const isFieldFilled = (field, answers) => {
  if (field.mode === 'multi') {
    return Array.isArray(answers[field.key]) && answers[field.key].length > 0;
  }
  if (field.mode === 'address') {
    const address = answers.address || {};
    return Boolean(
      address.line1?.trim() &&
        address.city?.trim() &&
        address.state?.trim() &&
        address.pincode?.trim(),
    );
  }
  if (field.allowOther && answers[field.key] === 'Other') {
    return Boolean(String(answers[field.otherKey] || '').trim());
  }
  if (field.optional && answers[field.key] === '__skipped__') return true;
  return Boolean(String(answers[field.key] || '').trim());
};

const nextField = (role, answers) => {
  const fields = role === 'SELLER' ? SELLER_FIELDS : BUYER_FIELDS;
  return fields.find((field) => !isFieldFilled(field, answers)) || null;
};

const progress = (role, answers) => {
  const fields = role === 'SELLER' ? SELLER_FIELDS : BUYER_FIELDS;
  const done = fields.filter((field) => isFieldFilled(field, answers)).length;
  return { done, total: fields.length };
};

const validateGst = (value) => /^[0-9A-Z]{15}$/i.test(String(value || '').trim());
/** Indian mobile: 10 digits, optionally prefixed with +91 / 91 / 0. */
const normalizeIndianPhone = (value) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return digits;
};

const validatePhone = (value) => {
  const digits = normalizeIndianPhone(value);
  return digits.length === 10 && /^[6-9]\d{9}$/.test(digits);
};
const validatePincode = (value) => /^\d{6}$/.test(String(value || '').trim());

const parseJsonSafe = (raw) => {
  try {
    const cleaned = String(raw || '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
};

const buildFieldPayload = (field) => {
  if (!field) return null;
  return {
    key: field.key,
    label: field.label,
    mode: field.mode,
    options: field.options || [],
    allowOther: Boolean(field.allowOther),
    otherKey: field.otherKey || null,
    optional: Boolean(field.optional),
    question: field.question,
    states: field.mode === 'address' ? INDIAN_STATES : undefined,
  };
};

const heuristicAccept = (field, message, answers) => {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  if (field.optional && ['skip', 'no', 'none', 'n/a', 'na', 'pass'].includes(lower)) {
    return {
      accepted: true,
      patch: { [field.key]: '__skipped__' },
      assistantMessage: 'No problem — we’ll skip that.',
    };
  }

  if (field.mode === 'single') {
    const matched = matchOption(text, field.options || []);
    if (matched) {
      const patch = { [field.key]: matched };
      if (matched === 'Other' && field.otherKey) {
        // Wait for other detail in a follow-up if they only said Other
        if (normalize(text) === 'other') {
          return {
            accepted: false,
            assistantMessage: `Got it — what should we put for “Other” ${field.label}?`,
            requireOther: true,
          };
        }
        const otherText = text.replace(/other[:\-]?\s*/i, '').trim();
        if (otherText && otherText.toLowerCase() !== 'other' && !looksNonsense(otherText)) {
          patch[field.otherKey] = otherText;
        } else {
          return {
            accepted: false,
            assistantMessage: `Please tell me the exact ${field.label} for “Other”.`,
            requireOther: true,
          };
        }
      }
      return {
        accepted: true,
        patch,
        assistantMessage: `Nice — saved ${field.label} as ${matched}.`,
      };
    }

    // Free-text → Other only as a local fallback when OpenAI is off.
    // With OpenAI on, we reject here so the AI can decide if it truly makes sense.
    if (field.allowOther && field.otherKey && !looksNonsense(text) && text.length >= 3) {
      if (openaiEnabled) {
        return {
          accepted: false,
          needsAi: true,
          assistantMessage: `I’m not sure “${text}” fits as a ${field.label}. Pick an option below, or describe a real one.`,
        };
      }
      return {
        accepted: true,
        patch: { [field.key]: 'Other', [field.otherKey]: text },
        assistantMessage: `Noted — we’ll use “${text}” for ${field.label}.`,
      };
    }

    return {
      accepted: false,
      assistantMessage: `I didn’t catch a clear ${field.label}. Please pick an option below or give a real answer.`,
    };
  }

  if (field.mode === 'multi') {
    const matched = matchManyOptions(text, field.options || []);
    if (matched.length) {
      const existing = Array.isArray(answers[field.key]) ? answers[field.key] : [];
      const merged = [...new Set([...existing, ...matched])];
      return {
        accepted: true,
        patch: { [field.key]: merged },
        assistantMessage: `Locked in: ${merged.join(', ')}.`,
      };
    }
    return {
      accepted: false,
      assistantMessage: `Please choose at least one ${field.label} from the options, or name them clearly.`,
    };
  }

  if (field.mode === 'address') {
    // Very light parse: "street, city, state, pincode"
    const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 4) {
      const pincode = parts[parts.length - 1].replace(/\D/g, '').slice(0, 6);
      const stateRaw = parts[parts.length - 2];
      const city = parts[parts.length - 3];
      const line1 = parts.slice(0, parts.length - 3).join(', ');
      const state =
        INDIAN_STATES.find((item) => normalize(item) === normalize(stateRaw)) ||
        INDIAN_STATES.find((item) => normalize(stateRaw).includes(normalize(item))) ||
        '';
      if (line1 && city && state && validatePincode(pincode)) {
        return {
          accepted: true,
          patch: {
            address: {
              line1,
              city,
              state,
              pincode,
              country: 'India',
            },
          },
          assistantMessage: 'Address saved. Looking good.',
        };
      }
    }
    return {
      accepted: false,
      assistantMessage:
        'Please share a full address with street, city, state, and 6-digit PIN — or use the fields below.',
    };
  }

  // text fields
  if (field.key === 'gst') {
    const gst = text.replace(/\s+/g, '').toUpperCase();
    if (!validateGst(gst)) {
      return {
        accepted: false,
        assistantMessage: 'That doesn’t look like a valid 15-character GSTIN. Please check and try again.',
      };
    }
    return {
      accepted: true,
      patch: { gst },
      assistantMessage: 'GST saved.',
    };
  }

  if (field.key === 'phone') {
    if (!validatePhone(text)) {
      return {
        accepted: false,
        assistantMessage:
          'Please share a valid 10-digit Indian mobile number (it can start with 6, 7, 8, or 9).',
      };
    }
    return {
      accepted: true,
      patch: { phone: normalizeIndianPhone(text) },
      assistantMessage: 'Phone number saved.',
    };
  }

  if (field.key === 'companyName') {
    if (looksNonsense(text) || text.length < (field.minLength || 2)) {
      return {
        accepted: false,
        assistantMessage: 'Please enter your real business or company name.',
      };
    }
    return {
      accepted: true,
      patch: { companyName: text },
      assistantMessage: `Great — welcome, ${text}.`,
    };
  }

  if (field.key === 'description') {
    if (looksNonsense(text) || text.length < (field.minLength || 8)) {
      return {
        accepted: false,
        assistantMessage:
          'Give a short meaningful description of your store, or say “skip”.',
      };
    }
    return {
      accepted: true,
      patch: { description: text.slice(0, 300) },
      assistantMessage: 'Description saved.',
    };
  }

  if (looksNonsense(text)) {
    return {
      accepted: false,
      assistantMessage: `That doesn’t look meaningful. Please answer with a real ${field.label}.`,
    };
  }

  return {
    accepted: true,
    patch: { [field.key]: text },
    assistantMessage: 'Got it.',
  };
};

const askOpenAi = async ({ role, field, message, answers, history }) => {
  if (!openaiEnabled || !openai) return null;

  const system = `You are Fabrica's onboarding guide for a B2B textile / fabric marketplace in India.
Role: ${role}
Current question field: ${field.key} (${field.label}), mode=${field.mode}
Allowed options: ${JSON.stringify(field.options || [])}
Indian states (if address): ${field.mode === 'address' ? INDIAN_STATES.join(', ') : 'n/a'}
Already collected answers: ${JSON.stringify(answers)}
Rules:
- Reject nonsense, jokes, fantasy words, animals, memes, random characters, placeholder text, or anything unrelated to a real textile/apparel business answer.
- Examples to REJECT for business type / industry: "Dragon", "Superman", "asdf", "test", "banana", "I love pizza".
- Only accept free text if it is a plausible real-world answer for this field (e.g. "garment exporter", "saree wholesaler", "home textiles").
- Prefer mapping free text onto allowed options when close enough (typos OK).
- For multi fields, return an array of option strings from the allowed list only.
- Use value "Other" ONLY when the answer is a real, sensible custom value that is not in the list; put the cleaned label in otherText. Never put nonsense in Other.
- If unsure, set accepted=false and ask them to pick an option.
- For address, return { line1, city, state, pincode, country:"India" }.
- For optional description, accept skip.
- Keep assistantMessage short, warm, and on-brand (no markdown).
- assistantMessage must ONLY acknowledge this answer (one short sentence). Do NOT ask the next question and do NOT invent fields that are not the current field.
Return ONLY JSON:
{
  "accepted": boolean,
  "assistantMessage": string,
  "value": string | string[] | object | null,
  "otherText": string | null
}`;

  const completion = await openai.chat.completions.create({
    model: openaiModel,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      ...history.slice(-8).map((item) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.content || ''),
      })),
      { role: 'user', content: String(message || '') },
    ],
  });

  return parseJsonSafe(completion.choices?.[0]?.message?.content);
};

const applyAiResult = (field, ai, fallback) => {
  if (!ai || typeof ai.accepted !== 'boolean') return fallback;

  if (!ai.accepted) {
    return {
      accepted: false,
      assistantMessage:
        ai.assistantMessage ||
        `Please give a clear answer for ${field.label}, or pick from the options.`,
    };
  }

  const patch = {};
  if (field.mode === 'multi') {
    const values = Array.isArray(ai.value) ? ai.value : [];
    const filtered = values.filter((value) => (field.options || []).includes(value));
    if (!filtered.length) return fallback;
    patch[field.key] = filtered;
  } else if (field.mode === 'address') {
    const address = ai.value && typeof ai.value === 'object' ? ai.value : null;
    if (
      !address?.line1 ||
      !address?.city ||
      !address?.state ||
      !validatePincode(address?.pincode)
    ) {
      return fallback;
    }
    patch.address = {
      line1: String(address.line1).trim(),
      city: String(address.city).trim(),
      state: String(address.state).trim(),
      pincode: String(address.pincode).trim(),
      country: 'India',
    };
  } else if (field.mode === 'single') {
    let value = typeof ai.value === 'string' ? ai.value : '';
    if (value && !(field.options || []).includes(value)) {
      // Fuzzy-map AI value onto an allowed option before falling back to Other
      const mapped = matchOption(value, field.options || []);
      if (mapped) value = mapped;
      else if (field.allowOther) value = 'Other';
      else return fallback;
    }
    if (!value) return fallback;
    patch[field.key] = value;
    if (value === 'Other' && field.otherKey) {
      const otherText = String(ai.otherText || ai.value || '').trim();
      if (!otherText || looksNonsense(otherText) || otherText.toLowerCase() === 'other') {
        return {
          accepted: false,
          assistantMessage:
            ai.assistantMessage ||
            `That doesn’t look like a real ${field.label}. Please pick an option or describe an actual business type.`,
        };
      }
      // Guardrail: refuse obvious non-business free text even if the model slipped
      if (
        otherText.length < 3 ||
        /^(dragon|superman|batman|pokemon|banana|pizza|hello|hi|hey|lol|haha)$/i.test(
          otherText,
        )
      ) {
        return {
          accepted: false,
          assistantMessage: `“${otherText}” isn’t a valid ${field.label}. Please choose from the options below.`,
        };
      }
      patch[field.otherKey] = otherText;
    }
  } else {
    const value = typeof ai.value === 'string' ? ai.value.trim() : '';
    if (!value) return fallback;
    if (field.optional && ['skip', '__skipped__'].includes(normalize(value))) {
      patch[field.key] = '__skipped__';
    } else {
      const local = heuristicAccept(field, value, {});
      if (!local.accepted) {
        return {
          accepted: false,
          assistantMessage: ai.assistantMessage || local.assistantMessage,
        };
      }
      Object.assign(patch, local.patch);
    }
  }

  return {
    accepted: true,
    patch,
    assistantMessage: ai.assistantMessage || 'Got it.',
  };
};

const mergeAnswers = (answers, patch) => {
  const next = { ...answers, ...patch };
  if (patch.address) {
    next.address = { ...(answers.address || {}), ...patch.address, country: 'India' };
  }
  return next;
};

const finalizeAnswers = (role, answers) => {
  if (role === 'BUYER') {
    return {
      businessType: answers.businessType || '',
      businessTypeOther: answers.businessTypeOther || '',
      industry: answers.industry || '',
      industryOther: answers.industryOther || '',
      interests: answers.interests || [],
      preferredFabrics: answers.preferredFabrics || [],
      typicalOrderQuantity: answers.typicalOrderQuantity || '',
      budgetRange: answers.budgetRange || '',
    };
  }

  return {
    companyName: answers.companyName || '',
    phone: answers.phone || '',
    gst: answers.gst || '',
    description:
      answers.description && answers.description !== '__skipped__'
        ? answers.description
        : '',
    address: {
      line1: answers.address?.line1 || '',
      city: answers.address?.city || '',
      state: answers.address?.state || '',
      pincode: answers.address?.pincode || '',
      country: answers.address?.country || 'India',
    },
    operatingHours: answers.operatingHours || '',
    operatingHoursOther: answers.operatingHoursOther || '',
    productCategories: answers.productCategories || [],
    fabricTypes: answers.fabricTypes || [],
    moqRange: answers.moqRange || '',
  };
};

export const startOnboarding = (role) => {
  if (role !== 'BUYER' && role !== 'SELLER') {
    throw createError('Invalid onboarding role', 400, 'INVALID_ROLE');
  }
  const field = nextField(role, {});
  const prog = progress(role, {});
  return {
    role,
    answers: role === 'SELLER' ? { address: { country: 'India' } } : {},
    complete: false,
    progress: prog,
    field: buildFieldPayload(field),
    assistantMessage:
      role === 'BUYER'
        ? `Welcome to Fabrica. I’m here to set up your buying profile — ${prog.total} quick questions. ${field.question}`
        : `Welcome to Fabrica. Let’s set up your seller store — ${prog.total} short steps. ${field.question}`,
  };
};

export const processOnboardingTurn = async ({
  role,
  message,
  answers = {},
  history = [],
  selectedOptions = null,
  addressPatch = null,
  skipOptional = false,
}) => {
  if (role !== 'BUYER' && role !== 'SELLER') {
    throw createError('Invalid onboarding role', 400, 'INVALID_ROLE');
  }

  let currentAnswers =
    role === 'SELLER'
      ? {
          ...answers,
          address: { country: 'India', ...(answers.address || {}) },
        }
      : { ...answers };

  // Direct structured updates from UI chips / address form
  if (addressPatch && typeof addressPatch === 'object') {
    currentAnswers = mergeAnswers(currentAnswers, {
      address: {
        line1: String(addressPatch.line1 || '').trim(),
        city: String(addressPatch.city || '').trim(),
        state: String(addressPatch.state || '').trim(),
        pincode: String(addressPatch.pincode || '').trim(),
        country: 'India',
      },
    });
  }

  let field = nextField(role, currentAnswers);

  if (selectedOptions && field && (field.mode === 'single' || field.mode === 'multi')) {
    if (field.mode === 'single') {
      const value = Array.isArray(selectedOptions) ? selectedOptions[0] : selectedOptions;
      if ((field.options || []).includes(value)) {
        currentAnswers = mergeAnswers(currentAnswers, { [field.key]: value });
        if (value === 'Other' && field.otherKey) {
          return {
            role,
            answers: currentAnswers,
            complete: false,
            progress: progress(role, currentAnswers),
            field: buildFieldPayload(field),
            accepted: true,
            assistantMessage: `What should we put for “Other” ${field.label}?`,
          };
        }
      }
    } else {
      const values = (Array.isArray(selectedOptions) ? selectedOptions : [selectedOptions]).filter(
        (value) => (field.options || []).includes(value),
      );
      if (values.length) {
        currentAnswers = mergeAnswers(currentAnswers, { [field.key]: values });
      }
    }
    field = nextField(role, currentAnswers);
    if (!field) {
      return {
        role,
        answers: finalizeAnswers(role, currentAnswers),
        complete: true,
        progress: progress(role, currentAnswers),
        field: null,
        accepted: true,
        assistantMessage:
          role === 'BUYER'
            ? 'All set — your buying preferences are ready. Finishing setup…'
            : 'All set — your store profile is ready. Finishing setup…',
      };
    }
    return {
      role,
      answers: currentAnswers,
      complete: false,
      progress: progress(role, currentAnswers),
      field: buildFieldPayload(field),
      accepted: true,
      assistantMessage: `Perfect. ${field.question}`,
    };
  }

  if (skipOptional && field?.optional) {
    currentAnswers = mergeAnswers(currentAnswers, { [field.key]: '__skipped__' });
    field = nextField(role, currentAnswers);
    if (!field) {
      return {
        role,
        answers: finalizeAnswers(role, currentAnswers),
        complete: true,
        progress: progress(role, currentAnswers),
        field: null,
        accepted: true,
        assistantMessage: 'All set — finishing setup…',
      };
    }
    return {
      role,
      answers: currentAnswers,
      complete: false,
      progress: progress(role, currentAnswers),
      field: buildFieldPayload(field),
      accepted: true,
      assistantMessage: `Skipped. ${field.question}`,
    };
  }

  // If address was completed via form patch above
  field = nextField(role, currentAnswers);
  if (!field) {
    return {
      role,
      answers: finalizeAnswers(role, currentAnswers),
      complete: true,
      progress: progress(role, currentAnswers),
      field: null,
      accepted: true,
      assistantMessage: 'All set — finishing setup…',
    };
  }

  if (!String(message || '').trim() && !addressPatch) {
    return {
      role,
      answers: currentAnswers,
      complete: false,
      progress: progress(role, currentAnswers),
      field: buildFieldPayload(field),
      accepted: false,
      assistantMessage: field.question,
    };
  }

  // Special case: Other detail after chip select
  if (
    field.allowOther &&
    currentAnswers[field.key] === 'Other' &&
    !String(currentAnswers[field.otherKey] || '').trim()
  ) {
    const otherText = String(message || '').trim();
    if (looksNonsense(otherText) || otherText.length < 2) {
      return {
        role,
        answers: currentAnswers,
        complete: false,
        progress: progress(role, currentAnswers),
        field: buildFieldPayload(field),
        accepted: false,
        assistantMessage: `Please give a real value for Other ${field.label}.`,
      };
    }
    currentAnswers = mergeAnswers(currentAnswers, { [field.otherKey]: otherText });
    field = nextField(role, currentAnswers);
    if (!field) {
      return {
        role,
        answers: finalizeAnswers(role, currentAnswers),
        complete: true,
        progress: progress(role, currentAnswers),
        field: null,
        accepted: true,
        assistantMessage: 'All set — finishing setup…',
      };
    }
    return {
      role,
      answers: currentAnswers,
      complete: false,
      progress: progress(role, currentAnswers),
      field: buildFieldPayload(field),
      accepted: true,
      assistantMessage: `Saved. ${field.question}`,
    };
  }

  const local = heuristicAccept(field, message, currentAnswers);
  let decision = local;

  const exactSingle =
    field.mode === 'single' ? matchOption(message, field.options || []) : null;
  const exactMulti =
    field.mode === 'multi' ? matchManyOptions(message, field.options || []) : [];

  // Structured fields are validated locally — never let the model invent a different question.
  const skipAiFields = new Set(['gst', 'phone']);

  // Ask OpenAI for free-text sense-checks and unclear option mapping.
  const shouldAskAi =
    openaiEnabled &&
    field.mode !== 'address' &&
    !skipAiFields.has(field.key) &&
    Boolean(String(message || '').trim()) &&
    (local.needsAi ||
      !local.accepted ||
      field.key === 'description' ||
      field.key === 'companyName' ||
      (field.mode === 'single' && !exactSingle) ||
      (field.mode === 'multi' && !exactMulti.length) ||
      (field.mode === 'single' && local.patch?.[field.key] === 'Other'));

  if (shouldAskAi) {
    try {
      const ai = await askOpenAi({
        role,
        field,
        message,
        answers: currentAnswers,
        history,
      });
      if (ai) {
        if (!local.accepted && looksNonsense(message) && ai.accepted !== true) {
          decision = local;
        } else if (local.accepted && field.key === 'companyName' && ai.accepted === false) {
          // Keep a locally valid company name; model can be overly strict.
          decision = local;
        } else {
          decision = applyAiResult(field, ai, local);
        }
      }
    } catch {
      // Keep local decision (rejected for unverified free text when AI is required)
      decision = local;
    }
  }

  if (!decision.accepted) {
    return {
      role,
      answers: currentAnswers,
      complete: false,
      progress: progress(role, currentAnswers),
      field: buildFieldPayload(field),
      accepted: false,
      assistantMessage: decision.assistantMessage,
    };
  }

  currentAnswers = mergeAnswers(currentAnswers, decision.patch || {});
  const upcoming = nextField(role, currentAnswers);

  // Prefer a short local ack when the model wandered into asking the wrong next question.
  const ackRaw = String(decision.assistantMessage || local.assistantMessage || 'Got it.').trim();
  const ack =
    ackRaw.includes('?') && local.assistantMessage
      ? String(local.assistantMessage).trim()
      : ackRaw.replace(/\?\s*$/, '.').trim();

  if (!upcoming) {
    return {
      role,
      answers: finalizeAnswers(role, currentAnswers),
      complete: true,
      progress: progress(role, currentAnswers),
      field: null,
      accepted: true,
      assistantMessage: `${ack} You’re done — finishing setup…`,
    };
  }

  return {
    role,
    answers: currentAnswers,
    complete: false,
    progress: progress(role, currentAnswers),
    field: buildFieldPayload(upcoming),
    accepted: true,
    assistantMessage: `${ack} ${upcoming.question}`,
  };
};
