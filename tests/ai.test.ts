import { describe, it, expect, vi, afterEach } from 'vitest';
import { extract, transcribeVoice, answerFromFacts, aiProvider } from '@/bot/ai';

const okJson = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
afterEach(() => { vi.restoreAllMocks(); delete process.env.OPENROUTER_API_KEY; delete process.env.GEMINI_API_KEY; });

describe('AI provider (mocked network)', () => {
  it('prefers OpenRouter when its key is set', () => {
    process.env.OPENROUTER_API_KEY = 'k'; process.env.GEMINI_API_KEY = 'g';
    expect(aiProvider()).toBe('openrouter');
    delete process.env.OPENROUTER_API_KEY; expect(aiProvider()).toBe('gemini');
    delete process.env.GEMINI_API_KEY; expect(aiProvider()).toBe(null);
  });
  it('sends a json_schema request to OpenRouter and drops null fields', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson('{"intent":"new_booking","checkIn":"2026-11-01","checkOut":null,"guests":2,"roomKind":null,"name":null,"reference":null,"nationality":null,"language":"es"}'));
    const ex = await extract('quiero reservar el 1 de noviembre para 2', '2026-10-14', 'es');
    expect(ex).toEqual({ intent: 'new_booking', checkIn: '2026-11-01', guests: 2, language: 'es' });
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(init.headers.authorization).toBe('Bearer k');
    expect(body.response_format.type).toBe('json_schema');
  });
  it('retries without response_format when the model rejects structured output', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('response_format json_schema not supported', { status: 400 }))
      .mockResolvedValueOnce(okJson('```json\n{"answer":"","covered":false}\n```'));
    expect(await answerFromFacts('is there a gym?', {}, 'en')).toBeNull();
    expect(JSON.parse((f.mock.calls[1] as any)[1].body).response_format).toBeUndefined();
  });
  it('sends voice notes as input_audio and returns transcript + language', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okJson('{"transcript":"عايز أحجز سرير","language":"ar"}'));
    const r = await transcribeVoice(Buffer.from('not-really-audio'), 'audio/ogg');
    expect(r).toEqual({ transcript: 'عايز أحجز سرير', language: 'ar' });
    const part = JSON.parse((f.mock.calls[0] as any)[1].body).messages[1].content[1];
    expect(part.type).toBe('input_audio');
    expect(['ogg', 'mp3']).toContain(part.input_audio.format);
  });
  it('unknown language from the model maps to "other" (bot then shows language buttons)', async () => {
    process.env.GEMINI_API_KEY = 'g';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"transcript":"Hallo","language":"de"}' }] } }] }), { status: 200 }));
    expect((await transcribeVoice(Buffer.from('x'), 'audio/ogg')).language).toBe('other');
  });
});
