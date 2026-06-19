import chalk from 'chalk';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

import akkazPreset from '../presets/akkaz.json';
import baroccoPreset from '../presets/barocco.json';
import boscoPreset from '../presets/bosco.json';
import carbonaraPreset from '../presets/carbonara.json';
import ferroPreset from '../presets/ferro.json';
import inchiostroPreset from '../presets/inchiostro.json';
import vaporPreset from '../presets/vapor.json';
import type { Settings } from '../types/Settings';

import { truncateStyledText } from './ansi';
import {
    CCSTATUSLINE_COMMANDS,
    getClaudeSettingsPath,
    loadClaudeSettings,
    saveClaudeSettings
} from './claude-settings';
import { updateColorMap } from './colors';
import {
    getConfigPath,
    saveSettings
} from './config';
import {
    applyGradientToText,
    gradientCodeAt,
    parseGradientSpec
} from './gradient';
import { sanitizeNerdGlyphs } from './nerd-icons';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from './renderer';
import { advanceGlobalSeparatorIndex } from './separator-index';

// Bundled status line presets that `--onboard` can install. Imports are static
// so `bun build` reliably bundles the JSON into the single-file output. Order is
// the order shown in the interactive picker (gradient signatures first, the two
// solid/no-gradient looks last); the first entry is the default.
interface PresetInfo { name: string; settings: unknown; blurb: string }
const PRESET_LIST: PresetInfo[] = [
    // Gradient signatures
    { name: 'akkaz', settings: akkazPreset, blurb: 'Neon cyan→viola→magenta · brain/clock/cache telemetry · dynamic value-colored bars' },
    { name: 'barocco', settings: baroccoPreset, blurb: 'Italian tricolore · green→white→red gradient' },
    { name: 'vapor', settings: vaporPreset, blurb: 'Synthwave · cyan→magenta neon gradient' },
    // Sober, solid-color looks — each with a thematic Nerd Font badge
    { name: 'inchiostro', settings: inchiostroPreset, blurb: 'Ink on paper ✎ · solid monochrome, cyan accent' },
    { name: 'carbonara', settings: carbonaraPreset, blurb: 'Warm & cozy · egg-yellow + pancetta' },
    { name: 'ferro', settings: ferroPreset, blurb: 'Brushed steel · cool gray-blue, calm and pro' },
    { name: 'bosco', settings: boscoPreset, blurb: 'Forest · solid greens, quiet and natural' }
];
const PRESETS: Record<string, unknown> = Object.fromEntries(PRESET_LIST.map(p => [p.name, p.settings]));
const DEFAULT_PRESET = 'akkaz';

// Sentinel select() values that are not real choices.
const OPEN_TUI = ' open-tui';
const SKIP_WIRING = ' skip-wiring';

// Glyph probe shown in step 1: bolt + history clock + a powerline arrow, plus
// the supplementary-plane "brain" icon (Material Design Icons, Nerd Fonts v3+)
// the default preset uses for the context label. The first three live in nearly
// every Nerd Font — even old v2 ones — so on their own they wrongly certify a v2
// font as fine; the brain only renders on a v3 font, catching the common "most
// icons work but one shows a box" case. All are private-use-area codepoints — on
// a missing or too-old font they show up as boxes or blanks.
const GLYPH_TEST = '         󰧑';

const TOTAL_STEPS = 4;

// Nerd Fonts "latest" release asset (stable URL).
const NERD_FONT_URL = 'https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip';
const FONT_MATCH = 'JetBrainsMonoNerdFont-*.ttf';

// The "akkaz" wordmark (ANSI Shadow). Six rows so the retro ramp gets one stop
// per row when the gradient flows top→bottom.
const AKKAZ_BANNER = [
    ' █████╗ ██╗  ██╗██╗  ██╗ █████╗ ███████╗',
    '██╔══██╗██║ ██╔╝██║ ██╔╝██╔══██╗╚══███╔╝',
    '███████║█████╔╝ █████╔╝ ███████║  ███╔╝ ',
    '██╔══██║██╔═██╗ ██╔═██╗ ██╔══██║ ███╔╝  ',
    '██║  ██║██║  ██╗██║  ██╗██║  ██║███████╗',
    '╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝'
];

// The retro ramp — the same gradient the TUI title and the installed status line
// use, so onboarding, config and the live status line share one signature look.
const RETRO_STOPS = parseGradientSpec('gradient:retro');

const RESET_FG = '\x1b[39m';

type ColorLevel = 'ansi16' | 'ansi256' | 'truecolor';
type IconMode = Settings['iconMode'];

interface OnboardOptions { skipFont?: boolean; preset?: string; firstRun?: boolean }

function log(msg: string): void {
    process.stdout.write(`${msg}\n`);
}

function colorLevelString(level: number): ColorLevel {
    if (level >= 3) {
        return 'truecolor';
    }
    if (level === 2) {
        return 'ansi256';
    }
    return 'ansi16';
}

// "akkaz" wordmark with the retro ramp flowing top→bottom (one ramp stop per row).
function renderBanner(level: ColorLevel): string {
    if (level === 'ansi16' || !RETRO_STOPS) {
        return AKKAZ_BANNER.join('\n');
    }
    const last = Math.max(1, AKKAZ_BANNER.length - 1);
    return AKKAZ_BANNER
        .map((row, i) => gradientCodeAt(RETRO_STOPS, i / last, level) + row + RESET_FG)
        .join('\n');
}

// Horizontal retro sweep across a single line of text (tagline / signature).
function gradientText(text: string, level: ColorLevel): string {
    if (level === 'ansi16' || !RETRO_STOPS) {
        return text;
    }
    return applyGradientToText(text, RETRO_STOPS, level) + RESET_FG;
}

// Step header: a short gradient rule, a bold "n/total · title" label and a dim
// rule out to a fixed width, e.g.  ──── 2/4 · Pick your style ───────────────
function logStepHeader(step: number, title: string, level: ColorLevel): void {
    const label = ` ${step}/${TOTAL_STEPS} · ${title} `;
    const fill = Math.max(4, 58 - 4 - label.length);
    log(`\n  ${gradientText('────', level)}${chalk.bold(label)}${chalk.dim('─'.repeat(fill))}\n`);
}

// Render the freshly-installed preset through the real renderer in preview mode,
// so the user sees their actual status line (widgets self-generate sample values
// when isPreview is true — see StatusLinePreview).
function renderPreviewLines(preset: Settings): string[] {
    const terminalWidth = process.stdout.columns && process.stdout.columns > 0
        ? process.stdout.columns
        : 100;

    const lines = preset.lines;
    const baseContext = {
        terminalWidth,
        isPreview: true,
        minimalist: preset.minimalistMode,
        gitCacheTtlSeconds: preset.gitCacheTtlSeconds
    };

    const preRendered = preRenderAllWidgets(lines, preset, baseContext);
    const maxWidths = calculateMaxWidthsFromPreRendered(preRendered, preset);

    const out: string[] = [];
    let separatorIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        const items = lines[i];
        if (items && items.length > 0) {
            const line = renderStatusLine(
                items,
                preset,
                {
                    ...baseContext,
                    lineIndex: i,
                    globalSeparatorIndex: separatorIndex,
                    globalPowerlineThemeIndex: 0
                },
                preRendered[i] ?? [],
                maxWidths
            );
            out.push(line);
            separatorIndex = advanceGlobalSeparatorIndex(separatorIndex, items);
        }
    }
    return out;
}

function withIconMode(preset: Settings, iconMode: IconMode): Settings {
    return { ...preset, iconMode };
}

function isInteractive(): boolean {
    return process.stdin.isTTY && process.stdout.isTTY;
}

interface SelectEntry { label: string; blurb?: string; preview?: string; value: string }
interface SelectOptions { question?: string; initial?: number }

// Build the menu region (question, one block per entry, key hints), highlighting
// the current selection. Returns the exact lines so the caller can redraw the
// region in place. Lines are truncated to the terminal width so nothing wraps
// (which would desync the redraw line count).
function buildSelectRegion(entries: SelectEntry[], selected: number, level: ColorLevel, width: number, question?: string): string[] {
    const fit = (s: string) => truncateStyledText(s, Math.max(0, width - 1), { ellipsis: true });
    const lines: string[] = [];
    if (question) {
        lines.push(fit(`  ${chalk.bold(question)}`));
        lines.push('');
    }
    entries.forEach((e, i) => {
        const on = i === selected;
        const marker = on ? gradientText('❯', level) : ' ';
        const num = chalk.bold(String(i + 1));
        const name = on ? chalk.bold(gradientText(e.label, level)) : chalk.bold(e.label);
        const blurb = e.blurb ? `  ${chalk.dim(e.blurb)}` : '';
        lines.push(fit(`  ${marker} ${num}. ${name}${blurb}`));
        if (e.preview !== undefined) {
            lines.push(fit(`     ${e.preview}`));
        }
    });
    lines.push('');
    lines.push(`  ${chalk.dim('↑/↓ move · 1-9 jump · Enter confirm · Esc cancel')}`);
    return lines;
}

// Arrow-key single-choice prompt, redrawn in place. On confirm or cancel the
// whole region is erased — the caller prints a one-line "✓ …" summary instead,
// so each completed step collapses to a single tidy line.
// Returns the selected entry's value, or null when the user cancels (Esc / q).
async function select(entries: SelectEntry[], level: ColorLevel, options: SelectOptions = {}): Promise<string | null> {
    const width = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 100;

    let selected = options.initial ?? 0;
    let drawnLines = 0;
    const draw = () => {
        const body = buildSelectRegion(entries, selected, level, width, options.question);
        process.stdout.write(`${drawnLines ? `\x1b[${drawnLines}A` : ''}\x1b[0J${body.join('\n')}\n`);
        drawnLines = body.length;
    };
    const erase = () => {
        if (drawnLines) {
            process.stdout.write(`\x1b[${drawnLines}A\x1b[0J`);
        }
    };

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    return new Promise<string | null>((resolve) => {
        const cleanup = () => {
            process.stdin.removeListener('keypress', onKey);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(wasRaw);
            }
            process.stdin.pause();
            erase();
        };
        const finish = (value: string | null) => {
            cleanup();
            resolve(value);
        };
        const onKey = (str: string | undefined, key: readline.Key) => {
            if (key.name === 'up' || key.name === 'k') {
                selected = (selected - 1 + entries.length) % entries.length;
                draw();
            } else if (key.name === 'down' || key.name === 'j') {
                selected = (selected + 1) % entries.length;
                draw();
            } else if (str && /^[1-9]$/.test(str) && Number(str) <= entries.length) {
                selected = Number(str) - 1;
                draw();
            } else if (key.name === 'return' || key.name === 'enter') {
                finish(entries[selected]?.value ?? null);
            } else if (key.name === 'escape' || str === 'q') {
                finish(null);
            } else if (key.ctrl && key.name === 'c') {
                cleanup();
                process.exit(130);
            }
        };
        process.stdin.on('keypress', onKey);
        draw();
    });
}

// Download a URL to a file, following GitHub's redirects to the CDN.
function download(url: string, dest: string, redirects = 0): Promise<void> {
    return new Promise((resolve, reject) => {
        if (redirects > 5) {
            reject(new Error('too many redirects'));
            return;
        }
        https.get(url, { headers: { 'User-Agent': 'ccstatusline-gradient' } }, (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                download(res.headers.location, dest, redirects + 1).then(resolve, reject);
                return;
            }
            if (status !== 200) {
                res.resume();
                reject(new Error(`HTTP ${status}`));
                return;
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    resolve();
                });
            });
            file.on('error', reject);
        }).on('error', reject);
    });
}

function nerdFontAlreadyInstalled(): boolean {
    try {
        const out = execFileSync('fc-list', [], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
        return /JetBrainsMono Nerd Font/i.test(out);
    } catch {
        // fc-list not available (e.g. macOS without fontconfig) - best effort
        return false;
    }
}

// Where to point the user for the "select the font in your terminal" step,
// based on the terminal we're actually running in.
function terminalFontHint(): string {
    const termProgram = process.env.TERM_PROGRAM ?? '';
    if (termProgram === 'Apple_Terminal') {
        return 'Terminal → Settings → Profiles → Text → Font';
    }
    if (termProgram === 'iTerm.app') {
        return 'iTerm2 → Settings → Profiles → Text → Font';
    }
    if (termProgram === 'vscode') {
        return 'VS Code settings → "terminal.integrated.fontFamily": "JetBrainsMono Nerd Font"';
    }
    if (termProgram === 'WezTerm') {
        return '~/.wezterm.lua → font = wezterm.font(\'JetBrainsMono Nerd Font\')';
    }
    if (termProgram === 'ghostty') {
        return 'Ghostty config → font-family = JetBrainsMono Nerd Font';
    }
    if (process.env.KITTY_WINDOW_ID) {
        return 'kitty.conf → font_family JetBrainsMono Nerd Font';
    }
    if (process.env.ALACRITTY_WINDOW_ID ?? process.env.ALACRITTY_SOCKET) {
        return 'alacritty.toml → [font] normal = { family = "JetBrainsMono Nerd Font" }';
    }
    if (gnomeTerminalDetected()) {
        // A copy-pasteable one-liner that resolves the default profile UUID inline.
        return 'p=$(gsettings get org.gnome.Terminal.ProfilesList default | tr -d "\'"); '
            + 'gsettings set "org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:$p/" use-system-font false; '
            + 'gsettings set "org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:$p/" font "JetBrainsMono Nerd Font 12"';
    }
    return 'your terminal settings → font → "JetBrainsMono Nerd Font"';
}

// GNOME Terminal sets these in every child shell; either is a reliable signal
// that the live terminal is GNOME Terminal (VTE).
function gnomeTerminalDetected(): boolean {
    return Boolean(process.env.GNOME_TERMINAL_SERVICE ?? process.env.GNOME_TERMINAL_SCREEN);
}

// Force GNOME Terminal's *default* profile to render the Nerd Font. Installing
// the .ttf is not enough — the profile must point at it — and GNOME's fontconfig
// fallback is unreliable for private-use-area glyphs (especially the v3 material
// icons in the supplementary plane). Applies live, no restart. Returns true only
// when the font was actually set; best-effort, never throws.
function configureGnomeTerminalFont(): boolean {
    const gsettings = (args: string[]): string => execFileSync('gsettings', args, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
    });
    try {
        const uuid = gsettings(['get', 'org.gnome.Terminal.ProfilesList', 'default'])
            .trim()
            .replace(/^['"]|['"]$/g, '');
        if (!uuid) {
            return false;
        }
        const schemaPath = `org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:${uuid}/`;

        // Preserve the profile's current point size if we can read it; else 12.
        let size = 12;
        try {
            const parsed = /(\d+)\s*['"]?\s*$/.exec(gsettings(['get', schemaPath, 'font']).trim());
            if (parsed?.[1]) {
                size = Number(parsed[1]);
            }
        } catch {
            // no readable current font — fall back to the default size
        }

        gsettings(['set', schemaPath, 'use-system-font', 'false']);
        gsettings(['set', schemaPath, 'font', `JetBrainsMono Nerd Font ${size}`]);
        return true;
    } catch {
        return false;
    }
}

// Offer to set the GNOME Terminal font for the user (the install-but-still-tofu
// case). Returns true only when we actually set it, so the caller can skip the
// generic "set your font manually" reminder.
async function offerGnomeTerminalFontFix(level: ColorLevel): Promise<boolean> {
    const choice = await select([
        { label: 'Yes, set it for me (recommended)', blurb: 'updates your GNOME Terminal default profile font now', value: 'yes' },
        { label: 'No, I\'ll do it myself', blurb: 'we\'ll print the exact command instead', value: 'no' }
    ], level, { question: 'Set your GNOME Terminal font to "JetBrainsMono Nerd Font" automatically?' });
    if (choice !== 'yes') {
        return false;
    }
    if (configureGnomeTerminalFont()) {
        log('  ✓ Set GNOME Terminal default profile font → JetBrainsMono Nerd Font');
        log(`    ${chalk.dim('Open a new tab/window to apply.')}`);
        return true;
    }
    log('  ⚠ Could not set the GNOME Terminal font automatically — use the command below.');
    return false;
}

// Returns true when a JetBrainsMono Nerd Font is on disk afterwards (already
// present or installed now) — i.e. the only missing step can be selecting it
// in the terminal. Returns false when nothing could be installed.
async function installNerdFont(): Promise<boolean> {
    const platform = process.platform;
    if (platform !== 'linux' && platform !== 'darwin') {
        log('  ⚠ Skipping font install on this OS. Install "JetBrainsMono Nerd Font" manually and select it in your terminal.');
        return false;
    }
    if (nerdFontAlreadyInstalled()) {
        log('  ✓ A JetBrainsMono Nerd Font is already installed.');
        return true;
    }

    const fontsDir = platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Fonts')
        : path.join(os.homedir(), '.local', 'share', 'fonts', 'ccstatusline-gradient');

    const tmpZip = path.join(os.tmpdir(), 'ccstatusline-gradient-JetBrainsMono.zip');
    try {
        fs.mkdirSync(fontsDir, { recursive: true });
        log('  ↓ Downloading JetBrainsMono Nerd Font…');
        await download(NERD_FONT_URL, tmpZip);
        // Extract just the standard (mono) variants.
        execFileSync('unzip', ['-o', tmpZip, FONT_MATCH, '-d', fontsDir], { stdio: 'ignore' });
        if (platform === 'linux') {
            execFileSync('fc-cache', ['-f', fontsDir], { stdio: 'ignore' });
        }
        log(`  ✓ Installed JetBrainsMono Nerd Font to ${fontsDir}`);
        return true;
    } catch (err) {
        log(`  ⚠ Could not auto-install the font (${err instanceof Error ? err.message : String(err)}).`);
        log('    Install "JetBrainsMono Nerd Font" manually: https://github.com/ryanoasis/nerd-fonts/releases/latest');
        return false;
    } finally {
        try {
            fs.unlinkSync(tmpZip);
        } catch {
            // ignore cleanup errors
        }
    }
}

// A reminder the user cannot miss: installing the font file is not enough,
// the terminal must be told to use it (macOS terminals never fall back to
// other installed fonts for private-use-area glyphs).
function logFontReminderBox(): void {
    const lines = [
        'One manual step left — installing the font is not enough:',
        'set your terminal font to "JetBrainsMono Nerd Font".',
        terminalFontHint(),
        'Then restart the terminal. Icons show as ⍰ until you do.'
    ];
    const inner = Math.max(...lines.map(l => l.length)) + 2;
    log('');
    log(`  ${chalk.yellow(`╭${'─'.repeat(inner)}╮`)}`);
    lines.forEach((l, i) => {
        const body = i === 0 ? chalk.bold(l.padEnd(inner - 2)) : l.padEnd(inner - 2);
        log(`  ${chalk.yellow('│')} ${body} ${chalk.yellow('│')}`);
    });
    log(`  ${chalk.yellow(`╰${'─'.repeat(inner)}╯`)}`);
}

async function wireClaudeCode(command: string): Promise<void> {
    let claudeSettings;
    try {
        claudeSettings = await loadClaudeSettings({ logErrors: false });
    } catch {
        claudeSettings = {};
    }
    claudeSettings.statusLine = {
        type: 'command',
        command,
        padding: 0
    };
    await saveClaudeSettings(claudeSettings);
}

function logLivePreview(preset: Settings): void {
    // Best-effort; never break onboarding over a cosmetic preview.
    try {
        const previewLines = renderPreviewLines(preset);
        if (previewLines.length > 0) {
            log(`\n  ${chalk.dim('Your status line, live:')}`);
            for (const line of previewLines) {
                log(`  ${line}`);
            }
        }
    } catch {
        // Preview is cosmetic — ignore any rendering hiccup.
    }
}

function logSignOff(level: ColorLevel): void {
    log(`\n  ${gradientText('All set! Restart Claude Code to see it in action.', level)}`);
    log(`  ${chalk.dim('Tip: rerun')} npx -y ccstatusline-gradient@latest ${chalk.dim('anytime to tweak it in the TUI.')}`);
    log(`  ${gradientText('— forged with ❤ by akkaz', level)}`);
}

function cancelled(): OnboardResult {
    log(`  ${chalk.dim('Cancelled — nothing was changed.')}`);
    return { openTui: false };
}

// Non-interactive path (piped/automated runs, e.g. dotfile scripts): no
// questions, default or --preset style, npx wiring, best-effort font install.
async function runQuickOnboard(options: OnboardOptions, level: ColorLevel): Promise<OnboardResult> {
    const presetName = options.preset ?? DEFAULT_PRESET;
    const presetSettings = PRESETS[presetName] as Settings;
    log(`  ${chalk.dim(`Style: ${presetName}`)}\n`);

    await saveSettings(presetSettings);
    log(`  ✓ Wrote status line config → ${getConfigPath()}`);

    await wireClaudeCode(CCSTATUSLINE_COMMANDS.AUTO_NPX);
    log(`  ✓ Set Claude Code statusLine → "${CCSTATUSLINE_COMMANDS.AUTO_NPX}" (${getClaudeSettingsPath()})`);

    if (options.skipFont) {
        log('  • Skipped font install (--no-font).');
    } else if (await installNerdFont()) {
        if (gnomeTerminalDetected() && configureGnomeTerminalFont()) {
            log('    → Set GNOME Terminal\'s default profile font → JetBrainsMono Nerd Font (open a new tab to apply).');
        } else {
            log(`    → Set your terminal font to "JetBrainsMono Nerd Font" to see the icons (${terminalFontHint()}).`);
        }
    }

    logLivePreview(presetSettings);
    logSignOff(level);
    return { openTui: false };
}

export interface OnboardResult { openTui: boolean }

export async function runOnboard(options: OnboardOptions = {}): Promise<OnboardResult> {
    // An explicit --preset must be valid; bail early with the available names.
    if (options.preset && !PRESETS[options.preset]) {
        log(`  ⚠ Unknown preset "${options.preset}". Available: ${PRESET_LIST.map(p => p.name).join(', ')}.`);
        return { openTui: false };
    }

    // Enable color for the brand header, the steps and the previews. All presets
    // are truecolor; use the default's level as the baseline.
    chalk.level = (akkazPreset as unknown as Settings).colorLevel;
    updateColorMap();
    const level = colorLevelString(chalk.level);

    // Brand header: the "akkaz" wordmark in the retro gradient.
    log('');
    log(renderBanner(level));
    log(`   ${gradientText('ccstatusline · gradient edition', level)}\n`);

    if (!isInteractive()) {
        return runQuickOnboard(options, level);
    }

    if (options.firstRun) {
        log(`  ${chalk.dim('No status line config found yet — let\'s set one up.')}`);
        log(`  ${chalk.dim('Four quick steps, one choice at a time. Esc quits without changes.')}`);
    }

    // ─── Step 1 · Terminal icons ──────────────────────────────────────────
    // The renderer cannot detect the terminal's font, so we ask the only
    // reliable judge: the user's eyes.
    logStepHeader(1, 'Terminal icons', level);
    log(`      ${GLYPH_TEST}\n`);
    const seen = await select([
        { label: 'Four crisp symbols', blurb: 'a bolt, a clock, a solid arrow and a brain', value: 'icons' },
        { label: 'A box, "?" or blank gap', blurb: 'even one missing means your font lacks (or is too old for) some glyphs', value: 'boxes' }
    ], level, { question: 'Right above this menu there are four test symbols — do you see all four crisply?' });
    if (seen === null) {
        return cancelled();
    }

    let iconMode: IconMode = 'nerd';
    let needsFontSwitch = false;
    let fontAutoSet = false;
    if (seen === 'boxes') {
        const fix = await select([
            { label: 'Universal symbols (recommended)', blurb: `plain-Unicode icons (${sanitizeNerdGlyphs(GLYPH_TEST)}) — work with any font, nothing to install`, value: 'unicode' },
            { label: 'Install JetBrainsMono Nerd Font', blurb: 'real icons — downloads the font, then you select it in your terminal', value: 'nerd' }
        ], level, { question: 'Those icons need a patched "Nerd Font". How do you want to handle it?' });
        if (fix === null) {
            return cancelled();
        }
        iconMode = fix as IconMode;
        if (iconMode === 'unicode') {
            log(`  ✓ Icons: universal symbols ${chalk.dim(`(${sanitizeNerdGlyphs(GLYPH_TEST)})`)}`);
        } else {
            needsFontSwitch = await installNerdFont();
            if (needsFontSwitch && gnomeTerminalDetected()) {
                fontAutoSet = await offerGnomeTerminalFontFix(level);
            }
        }
    } else {
        log(`  ✓ Icons: Nerd Font glyphs ${chalk.dim('(your font already renders them)')}`);
    }

    // ─── Step 2 · Pick a style ────────────────────────────────────────────
    logStepHeader(2, 'Pick your style', level);
    let presetName: string;
    if (options.preset) {
        presetName = options.preset;
        log(`  ✓ Style: ${chalk.bold(presetName)} ${chalk.dim('(from --preset)')}`);
    } else {
        const entries: SelectEntry[] = PRESET_LIST.map(p => ({
            label: p.name,
            blurb: p.blurb,
            preview: renderPreviewLines(withIconMode(p.settings as Settings, iconMode))[0] ?? '',
            value: p.name
        }));
        entries.push({
            label: 'Full configurator',
            blurb: 'none of these — build your own in the TUI',
            preview: chalk.dim('↳ opens the interactive editor'),
            value: OPEN_TUI
        });
        const picked = await select(entries, level, { question: 'Pick a style — live preview of each:' });
        if (picked === null) {
            return cancelled();
        }
        if (picked === OPEN_TUI) {
            return { openTui: true };
        }
        presetName = picked;
        log(`  ✓ Style: ${chalk.bold(presetName)}`);
    }

    // ─── Step 3 · Hook into Claude Code ───────────────────────────────────
    logStepHeader(3, 'Hook into Claude Code', level);
    const runner = await select([
        { label: 'npx (recommended)', blurb: `"${CCSTATUSLINE_COMMANDS.AUTO_NPX}" — auto-updates via npm`, value: CCSTATUSLINE_COMMANDS.AUTO_NPX },
        { label: 'bunx', blurb: `"${CCSTATUSLINE_COMMANDS.AUTO_BUNX}" — auto-updates via Bun`, value: CCSTATUSLINE_COMMANDS.AUTO_BUNX },
        { label: 'Skip', blurb: 'I\'ll wire Claude Code\'s settings.json myself', value: SKIP_WIRING }
    ], level, { question: `How should Claude Code launch the status line? (writes ${getClaudeSettingsPath()})` });
    if (runner === null) {
        return cancelled();
    }
    if (runner === SKIP_WIRING) {
        log(`  • Claude Code hook: skipped ${chalk.dim('(wire it later, see below)')}`);
    } else {
        log(`  ✓ Claude Code hook: ${chalk.bold(runner === CCSTATUSLINE_COMMANDS.AUTO_BUNX ? 'bunx' : 'npx')}`);
    }

    // ─── Step 4 · Apply & preview ─────────────────────────────────────────
    logStepHeader(4, 'Apply & preview', level);
    const presetSettings = withIconMode(PRESETS[presetName] as Settings, iconMode);
    await saveSettings(presetSettings);
    log(`  ✓ Status line config → ${getConfigPath()}`);

    if (runner === SKIP_WIRING) {
        log(`  • To wire it manually, add this to ${getClaudeSettingsPath()}:`);
        log(`    ${chalk.dim(`"statusLine": { "type": "command", "command": "${CCSTATUSLINE_COMMANDS.AUTO_NPX}", "padding": 0 }`)}`);
    } else {
        await wireClaudeCode(runner);
        log(`  ✓ Claude Code statusLine → "${runner}" (${getClaudeSettingsPath()})`);
    }
    log(`  ✓ Icons → ${iconMode === 'nerd' ? 'Nerd Font glyphs' : 'universal symbols (no special font needed)'}`);

    logLivePreview(presetSettings);

    if (needsFontSwitch && !fontAutoSet) {
        logFontReminderBox();
    }

    logSignOff(level);
    return { openTui: false };
}
