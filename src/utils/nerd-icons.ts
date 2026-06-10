/**
 * Fallbacks for Nerd Font private-use-area glyphs, applied when the user's
 * terminal font has no Nerd Font patch (settings.iconMode === 'unicode').
 *
 * Every fallback MUST be a single-width, widely-supported Unicode character:
 * sanitizing happens after all width math in the renderer, so a double-width
 * replacement (e.g. an emoji) would overflow the computed line width.
 */
const NERD_GLYPH_FALLBACKS: Record<string, string> = {
    // Powerline separators and caps
    '': '▶', // solid right arrow → ▶
    '': '❯', // thin right arrow → ❯
    '': '◀', // solid left arrow → ◀
    '': '❮', // thin left arrow → ❮
    '': '▶', // round right cap → ▶
    '': '❯', // thin round right → ❯
    '': '◀', // round left cap → ◀
    '': '❮', // thin round left → ❮
    // Icons used by the bundled presets and widgets
    '': '↯', // bolt (thinking effort label) → ↯
    '': '↻', // history clock (session / weekly reset timers) → ↻
    '': '↻', // refresh (compaction counter) → ↻
    '': '♣', // tree (bosco preset) → ♣
    '': 'Ψ', // cutlery (carbonara preset) → Ψ
    '': '⚙', // wrench (ferro preset) → ⚙
    '': '✎', // pencil (inchiostro preset) → ✎
    '': '♪', // microphone (voice status) → ♪
    '': '♪', // microphone slash (voice status) → ♪
    '': '⌁', // wifi (remote control status) → ⌁
    '': '⌁', // remote (remote control status) → ⌁
    '': '◈' // jj revision badge → ◈
};

const GENERIC_FALLBACK = '•'; // •

// BMP private use area (U+E000–U+F8FF) plus planes 15/16 (U+F0000 and up),
// where Nerd Fonts v3 relocated the Material Design icons.
function isPrivateUse(codePoint: number): boolean {
    return (codePoint >= 0xE000 && codePoint <= 0xF8FF) || codePoint >= 0xF0000;
}

/** Replace every private-use-area glyph with a font-independent equivalent. */
export function sanitizeNerdGlyphs(text: string): string {
    let needsWork = false;
    for (const ch of text) {
        if (isPrivateUse(ch.codePointAt(0) ?? 0)) {
            needsWork = true;
            break;
        }
    }
    if (!needsWork) {
        return text;
    }

    let out = '';
    for (const ch of text) {
        out += isPrivateUse(ch.codePointAt(0) ?? 0)
            ? (NERD_GLYPH_FALLBACKS[ch] ?? GENERIC_FALLBACK)
            : ch;
    }
    return out;
}
