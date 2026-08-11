import 'dotenv/config';
import connectDB from '../src/config/db.js';
import Product from '../src/models/Product.js';
import { openai, openaiEnabled, openaiModel } from '../src/config/openai.js';

const MARKER = 'Specs:';

const buildPrompt = (product) => {
  const colors = (product.variants || [])
    .map((v) => v.colorHex)
    .filter(Boolean)
    .join(', ');

  return `You enrich fabric product listings for Fabrica, a B2B textile marketplace in India.

Current product JSON:
${JSON.stringify(
    {
      name: product.name,
      category: product.category,
      description: product.description,
      price: product.price,
      gsm: product.gsm,
      width: product.width,
      moq: product.moq,
      availableQuantity: product.availableQuantity,
      unit: product.unit,
      colors,
    },
    null,
    2,
  )}

Task:
1. Keep the existing marketing description almost as-is (you may lightly clean typos).
2. Append ONE short line starting exactly with "${MARKER}" that fills gaps buyers ask about but are missing as structured fields.
3. Cover in that Specs line (compact, semicolon-separated): composition %; weave/construction; stretch; season/climate fit; care; shrinkage; finish; certifications if plausible; human color names for the hexes; typical uses; lead time hint for India B2B.
4. Infer only what is reasonable for this fabric type/name. Be concrete and useful for Q&A. Do not invent wild claims (no medical claims). Prefer typical industry-realistic values.
5. Do NOT repeat price/GSM/MOQ/width/stock if already clear above — focus on missing attributes.
6. Keep Specs under ~350 characters. No markdown. No bullet list. One paragraph description + one Specs line.

Return ONLY the full new description text (original meaning + Specs line).`;
};

const enrichOne = async (product) => {
  const completion = await openai.chat.completions.create({
    model: openaiModel,
    temperature: 0.35,
    messages: [
      {
        role: 'system',
        content:
          'You write concise, realistic fabric catalog copy for Indian B2B buyers. Output plain text only.',
      },
      { role: 'user', content: buildPrompt(product) },
    ],
  });

  const text = String(completion.choices?.[0]?.message?.content || '').trim();
  if (!text || text.length < 40) {
    throw new Error(`Empty enrichment for ${product._id}`);
  }
  // Ensure Specs line exists; if model forgot, keep text anyway
  return text;
};

const run = async () => {
  if (!openaiEnabled || !openai) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  await connectDB();

  const products = await Product.find({ status: 'published' }).sort({ updatedAt: -1 });
  console.log(`Enriching ${products.length} published products…`);

  let updated = 0;
  let skipped = 0;

  for (const product of products) {
    const name = String(product.name || '');
    const desc = String(product.description || '');

    // Skip junk / already enriched
    if (/^testing$/i.test(name.trim()) || /^testing$/i.test(desc.trim())) {
      console.log(`skip junk: ${product._id} ${name}`);
      skipped += 1;
      continue;
    }
    if (desc.includes(MARKER) && process.argv.includes('--force') === false) {
      console.log(`skip already has Specs: ${product._id} ${name}`);
      skipped += 1;
      continue;
    }

    process.stdout.write(`enrich: ${name} … `);
    const nextDescription = await enrichOne(product.toObject());
    product.description = nextDescription;
    await product.save();
    updated += 1;
    console.log('ok');
  }

  console.log(JSON.stringify({ updated, skipped, total: products.length }, null, 2));
  process.exit(0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
