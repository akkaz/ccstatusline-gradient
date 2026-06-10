import {
    describe,
    expect,
    it
} from 'vitest';

import { sanitizeNerdGlyphs } from '../nerd-icons';

describe('sanitizeNerdGlyphs', () => {
    it('returns plain text untouched', () => {
        const text = 'Model | ctx 53.0% | 4hr 48m';
        expect(sanitizeNerdGlyphs(text)).toBe(text);
    });

    it('keeps standard Unicode (shade bars, box drawing, arrows) untouched', () => {
        const text = '░▒▓█ ─│ ↑↓ ⚡ ✓';
        expect(sanitizeNerdGlyphs(text)).toBe(text);
    });

    it('maps the preset icons (bolt, history clock) to single-width fallbacks', () => {
        expect(sanitizeNerdGlyphs('xhigh')).toBe('↯xhigh');
        expect(sanitizeNerdGlyphs('4hr 48m')).toBe('↻4hr 48m');
    });

    it('maps powerline separators to triangle/chevron fallbacks', () => {
        expect(sanitizeNerdGlyphs('abcde')).toBe('a▶b❯c◀d❮e');
    });

    it('replaces unknown BMP private-use glyphs with the generic fallback', () => {
        expect(sanitizeNerdGlyphs('xy')).toBe('x•y');
    });

    it('replaces supplementary-plane private-use glyphs (Nerd Fonts v3 material icons)', () => {
        const materialIcon = String.fromCodePoint(0xF0001);
        expect(sanitizeNerdGlyphs(`a${materialIcon}b`)).toBe('a•b');
    });

    it('preserves ANSI escape sequences around replaced glyphs', () => {
        const input = '\x1b[38;5;212m\x1b[39m';
        expect(sanitizeNerdGlyphs(input)).toBe('\x1b[38;5;212m↯\x1b[39m');
    });

    it('never changes the visible width (all fallbacks are single-width)', () => {
        const input = '   ';
        expect(Array.from(sanitizeNerdGlyphs(input)).length).toBe(Array.from(input).length);
    });
});
