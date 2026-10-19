import { describe, it, expect } from 'vitest';
import { toEmbed } from '@/content/videos';
describe('guest video links', () => {
  it('converts supported links to embeds', () => {
    expect(toEmbed('https://www.instagram.com/reel/C9abc_12/?igsh=x')?.src).toBe('https://www.instagram.com/reel/C9abc_12/embed');
    expect(toEmbed('https://www.instagram.com/someone/reel/XYZ/')?.src).toBe('https://www.instagram.com/reel/XYZ/embed');
    expect(toEmbed('https://www.tiktok.com/@trav.eller/video/7312345678901234567')?.src).toBe('https://www.tiktok.com/embed/v2/7312345678901234567');
    expect(toEmbed('https://youtube.com/shorts/abcDEF12345')?.src).toBe('https://www.youtube-nocookie.com/embed/abcDEF12345');
    expect(toEmbed('https://cdn.example.com/v.mp4')?.kind).toBe('mp4');
  });
  it('rejects anything else (no arbitrary iframes)', () => {
    for (const u of ['http://instagram.com/reel/X', 'https://evil.com/reel/X', 'javascript:alert(1)', '']) expect(toEmbed(u)).toBeNull();
  });
});
