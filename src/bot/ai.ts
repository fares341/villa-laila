import { spawn } from 'node:child_process';
import { env } from '@/lib/env';
import type { Lang } from '@/i18n/bot';

// The AI is used ONLY to (1) transcribe voice notes + detect their language, (2) extract structured fields from free text,
// (3) answer questions from APPROVED facts, (4) summarise for staff / translate staff-written text.
// It never decides availability, prices, policy or confirmation: those come from backend services.
//
// Provider: OpenRouter when OPENROUTER_API_KEY is set (default model google/gemini-2.5-flash, which accepts audio),
// otherwise Google Gemini directly when GEMINI_API_KEY is set.

type Schema = { type: 'object'; properties: Record<string, any>; required: string[] };
type Part = { text: string } | { audio: Buffer; format: string; mime: string };

export const aiProvider = (): 'openrouter' | 'gemini' | null => (env.openrouterKey ? 'openrouter' : env.geminiKey ? 'gemini' : null);
export const aiEnabled = () => aiProvider() !== null;
/** @deprecated kept for older imports */
export const geminiEnabled = aiEnabled;

function parseJson(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

async function openrouter(parts: Part[], schema: Schema, system?: string, useSchema = true): Promise<any> {
  const content = parts.map((p) => ('text' in p ? { type: 'text', text: p.text } : { type: 'input_audio', input_audio: { data: p.audio.toString('base64'), format: p.format } }));
  const sys = (system ? system + '\n\n' : '') + `Reply with a single JSON object matching this JSON schema, nothing else: ${JSON.stringify(schema)}`;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.openrouterKey}`, 'HTTP-Referer': env.baseUrl || 'https://villalaylahostel.com', 'X-Title': 'Villa Layla Hostel' },
    body: JSON.stringify({
      model: env.openrouterModel, temperature: 0,
      messages: [{ role: 'system', content: sys }, { role: 'user', content }],
      ...(useSchema ? { response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: { ...schema, additionalProperties: false } } } } : {}),
    }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    // Some models reject json_schema: retry once with plain instructions.
    if (useSchema && res.status === 400 && /response_format|json_schema|structured/i.test(body)) return openrouter(parts, schema, system, false);
    throw new Error(`OpenRouter ${res.status}: ${body}`);
  }
  const j: any = await res.json();
  const msg = j?.choices?.[0]?.message?.content;
  const text = Array.isArray(msg) ? msg.map((m: any) => m.text ?? '').join('') : String(msg ?? '');
  return parseJson(text);
}

const toGemini = (s: any): any => s.type === 'object'
  ? { type: 'OBJECT', properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGemini(v)])), required: s.required }
  : Array.isArray(s.type)
    ? { ...(s.enum ? { enum: s.enum.filter((x: unknown) => x !== null) } : {}), type: String(s.type[0]).toUpperCase(), nullable: true }
    : { ...s, type: String(s.type).toUpperCase() };

async function gemini(parts: Part[], schema: Schema, system?: string): Promise<any> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.geminiKey },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts: parts.map((p) => ('text' in p ? { text: p.text } : { inlineData: { mimeType: p.mime, data: p.audio.toString('base64') } })) }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: toGemini(schema) },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  return parseJson(j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '');
}

async function generate(parts: Part[], schema: Schema, system?: string): Promise<any> {
  const p = aiProvider();
  if (p === 'openrouter') return openrouter(parts, schema, system);
  if (p === 'gemini') return gemini(parts, schema, system);
  throw new Error('No AI key set (OPENROUTER_API_KEY or GEMINI_API_KEY)');
}

/** Telegram voice notes are OGG/Opus. Convert to MP3 with ffmpeg when available (widest model support); otherwise send OGG as is. */
export async function toMp3(audio: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'mp3', 'pipe:1']);
      const out: Buffer[] = [];
      ff.on('error', () => resolve(null));
      ff.stdout.on('data', (d) => out.push(d));
      ff.on('close', (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
      ff.stdin.on('error', () => resolve(null));
      ff.stdin.end(audio);
    } catch { resolve(null); }
  });
}

const LANG_ENUM = ['en', 'es', 'fr', 'ar', 'other'];

export async function transcribeVoice(audio: Buffer, mimeType: string): Promise<{ transcript: string; language: Lang | 'other' }> {
  let part: Part = { audio, mime: mimeType, format: /ogg|opus/.test(mimeType) ? 'ogg' : mimeType.split('/')[1] || 'ogg' };
  if (aiProvider() === 'openrouter') { const mp3 = await toMp3(audio); if (mp3) part = { audio: mp3, mime: 'audio/mpeg', format: 'mp3' }; }
  const out = await generate(
    [{ text: 'Transcribe this voice message exactly in the language spoken (Arabic dialects, including Egyptian, are common; keep Arabic script). Then say which language it is: en, es, fr, ar or other.' }, part],
    { type: 'object', properties: { transcript: { type: 'string' }, language: { type: 'string', enum: LANG_ENUM } }, required: ['transcript', 'language'] },
  );
  return { transcript: String(out.transcript ?? '').trim(), language: LANG_ENUM.includes(out.language) ? out.language : 'other' };
}

export type Extracted = {
  intent: 'new_booking' | 'availability' | 'my_reservation' | 'extend' | 'rooms' | 'info' | 'payment' | 'reception' | 'change_language' | 'greeting' | 'cancel' | 'other';
  checkIn?: string; checkOut?: string; guests?: number; roomKind?: 'dorm' | 'private'; name?: string; reference?: string; nationality?: string; language?: Lang;
};

const INTENTS = ['new_booking', 'availability', 'my_reservation', 'extend', 'rooms', 'info', 'payment', 'reception', 'change_language', 'greeting', 'cancel', 'other'];
const opt = (t: any) => ({ ...t, type: [t.type, 'null'] });

export async function extract(text: string, today: string, _lang: Lang | null): Promise<Extracted> {
  const system = `You extract structured fields from a hostel guest's message (any language). Today is ${today}. Resolve relative dates ("next Friday", "tomorrow", "الأسبوع الجاي") to ISO YYYY-MM-DD in the future.
Only fill a field if the guest clearly stated it, otherwise null. Do not invent. intent "reception" means the guest wants a human; "cancel" means they want to abort the current flow.`;
  const props = {
    intent: { type: 'string', enum: INTENTS }, checkIn: opt({ type: 'string' }), checkOut: opt({ type: 'string' }), guests: opt({ type: 'integer' }),
    roomKind: opt({ type: 'string', enum: ['dorm', 'private', null] }), name: opt({ type: 'string' }), reference: opt({ type: 'string' }), nationality: opt({ type: 'string' }),
    language: opt({ type: 'string', enum: ['en', 'es', 'fr', 'ar', null] }),
  };
  const out = await generate([{ text }], { type: 'object', properties: props, required: Object.keys(props) }, system);
  // drop nulls so callers can use simple truthiness checks
  return Object.fromEntries(Object.entries(out ?? {}).filter(([, v]) => v !== null && v !== '')) as Extracted;
}

/** Answer a general question using ONLY approved hostel facts. Returns null when the facts do not cover it. */
export async function answerFromFacts(question: string, facts: Record<string, unknown>, lang: Lang): Promise<string | null> {
  const names = { en: 'English', es: 'Spanish', fr: 'French', ar: 'Arabic' }[lang];
  const out = await generate([{ text: question }],
    { type: 'object', properties: { answer: { type: 'string' }, covered: { type: 'boolean' } }, required: ['answer', 'covered'] },
    `You are the assistant of Villa Layla Hostel. Answer ONLY using the approved facts below, in ${names}, in 1-3 short sentences. If the facts do not clearly contain the answer, set covered=false and answer="". NEVER guess prices, availability, policies, or confirm bookings.\nAPPROVED FACTS (JSON): ${JSON.stringify(facts)}`);
  return out.covered && out.answer ? String(out.answer) : null;
}

export async function summarize(transcript: string): Promise<string | null> {
  if (!aiEnabled()) return null;
  try {
    const out = await generate([{ text: transcript }], { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      'Summarise this hostel guest conversation for a receptionist in 2 short English sentences: what the guest wants and what is missing. No invented facts.');
    return out.summary ?? null;
  } catch { return null; }
}

