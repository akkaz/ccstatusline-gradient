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
import bracePreset from '../presets/brace.json';
import carbonaraPreset from '../presets/carbonara.json';
import inchiostroPreset from '../presets/inchiostro.json';
import vaporPreset from '../presets/vapor.json';
import type { Settings } from '../types/Settings';

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
    { name: 'akkaz', settings: akkazPreset, blurb: 'Retro indigo→amber gradient · full telemetry · dynamic bars' },
    { name: 'vapor', settings: vaporPreset, blurb: 'Synthwave · cyan→magenta neon gradient' },
    { name: 'bosco', settings: boscoPreset, blurb: 'Forest greens · usage runs green→amber as it fills' },
    { name: 'brace', settings: bracePreset, blurb: 'Embers · amber→deep-red, runs hot toward your limits' },
    { name: 'barocco', settings: baroccoPreset, blurb: 'Italian tricolore 🇮🇹 · green→white→red' },
    { name: 'inchiostro', settings: inchiostroPreset, blurb: 'Ink on paper · solid monochrome, one cyan accent (no gradient)' },
    { name: 'carbonara', settings: carbonaraPreset, blurb: 'Cozy & warm · egg-yellow + pancetta tones (no gradient)' }
];
const PRESETS: Record<string, unknown> = Object.fromEntries(PRESET_LIST.map(p => [p.name, p.settings]));
const DEFAULT_PRESET = 'akkaz';

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

interface OnboardOptions { skipFont?: boolean; preset?: string }

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

function isInteractive(): boolean {
    return process.stdin.isTTY && process.stdout.isTTY;
}

// Prompt for a single line of input (readline closes after one answer).
function ask(question: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// Show every bundled preset with a live, real-renderer preview of its first line,
// then let the user pick one. Empty/invalid input falls back to the default.
async function pickPreset(level: ColorLevel): Promise<string> {
    log(`  ${chalk.dim('Pick a style — live preview of each:')}\n`);
    PRESET_LIST.forEach((p, i) => {
        log(`  ${chalk.bold(String(i + 1))}. ${gradientText(p.name, level)}  ${chalk.dim(p.blurb)}`);
        const preview = renderPreviewLines(p.settings as Settings);
        if (preview[0]) {
            log(`     ${preview[0]}`);
        }
        log('');
    });

    const answer = (await ask(`  Choose 1-${PRESET_LIST.length} or a name (Enter = ${DEFAULT_PRESET}): `)).trim();
    if (answer === '') {
        return DEFAULT_PRESET;
    }
    const byNumber = PRESET_LIST[Number.parseInt(answer, 10) - 1];
    if (byNumber) {
        return byNumber.name;
    }
    const byName = PRESET_LIST.find(p => p.name === answer.toLowerCase());
    if (byName) {
        return byName.name;
    }
    log(`  ${chalk.dim(`"${answer}" not recognized — using ${DEFAULT_PRESET}.`)}`);
    return DEFAULT_PRESET;
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

async function installNerdFont(): Promise<void> {
    const platform = process.platform;
    if (platform !== 'linux' && platform !== 'darwin') {
        log('  ⚠ Skipping font install on this OS. Install "JetBrainsMono Nerd Font" manually and select it in your terminal.');
        return;
    }
    if (nerdFontAlreadyInstalled()) {
        log('  ✓ A JetBrainsMono Nerd Font is already installed.');
        return;
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
        log('    → Set your terminal font to "JetBrainsMono Nerd Font" to see the icons.');
    } catch (err) {
        log(`  ⚠ Could not auto-install the font (${err instanceof Error ? err.message : String(err)}).`);
        log('    Install "JetBrainsMono Nerd Font" manually: https://github.com/ryanoasis/nerd-fonts/releases/latest');
    } finally {
        try {
            fs.unlinkSync(tmpZip);
        } catch {
            // ignore cleanup errors
        }
    }
}

export async function runOnboard(options: OnboardOptions = {}): Promise<void> {
    // An explicit --preset must be valid; bail early with the available names.
    if (options.preset && !PRESETS[options.preset]) {
        log(`  ⚠ Unknown preset "${options.preset}". Available: ${PRESET_LIST.map(p => p.name).join(', ')}.`);
        return;
    }

    // Enable color for the brand header, the picker and the previews. All presets
    // are truecolor; use the default's level as the baseline.
    chalk.level = (akkazPreset as unknown as Settings).colorLevel;
    updateColorMap();
    const level = colorLevelString(chalk.level);

    // Brand header: the "akkaz" wordmark in the retro gradient.
    log('');
    log(renderBanner(level));
    log(`   ${gradientText('ccstatusline · gradient edition', level)}\n`);

    // Resolve the preset: explicit flag wins; otherwise let the user pick
    // interactively (with live previews), or fall back to the default when
    // there's no TTY (piped/automated runs).
    const presetName = options.preset
        ?? (isInteractive() ? await pickPreset(level) : DEFAULT_PRESET);
    const presetSettings = PRESETS[presetName] as Settings;
    log(`  ${chalk.dim(`Style: ${presetName}`)}\n`);

    // 1. Write the signature status line config.
    await saveSettings(presetSettings);
    log(`  ✓ Wrote status line config → ${getConfigPath()}`);

    // 2. Wire up Claude Code's status line command (preserving other settings).
    let claudeSettings;
    try {
        claudeSettings = await loadClaudeSettings({ logErrors: false });
    } catch {
        claudeSettings = {};
    }
    claudeSettings.statusLine = {
        type: 'command',
        command: CCSTATUSLINE_COMMANDS.AUTO_NPX,
        padding: 0
    };
    await saveClaudeSettings(claudeSettings);
    log(`  ✓ Set Claude Code statusLine → "${CCSTATUSLINE_COMMANDS.AUTO_NPX}" (${getClaudeSettingsPath()})`);

    // 3. Install the Nerd Font used by the config's icons.
    if (options.skipFont) {
        log('  • Skipped font install (--no-font).');
    } else {
        await installNerdFont();
    }

    // 4. Show the real thing — render the freshly-installed preset so the user
    //    sees their status line right now (best-effort; never break onboarding).
    try {
        const previewLines = renderPreviewLines(presetSettings);
        if (previewLines.length > 0) {
            log(`\n  ${chalk.dim('Your status line, live:')}`);
            for (const line of previewLines) {
                log(`  ${line}`);
            }
        }
    } catch {
        // Preview is cosmetic — ignore any rendering hiccup.
    }

    log(`\n  ${gradientText('All set! Restart Claude Code to see it in action.', level)}`);
    log(`  ${chalk.dim('Tip: rerun')} npx -y ccstatusline-gradient@latest ${chalk.dim('anytime to tweak it in the TUI.')}`);
    log(`  ${gradientText('— forged with ❤ by akkaz', level)}`);
}
