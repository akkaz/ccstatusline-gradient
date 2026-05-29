import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';

import onboardConfig from '../onboard-config.json';
import type { Settings } from '../types/Settings';

import {
    CCSTATUSLINE_COMMANDS,
    getClaudeSettingsPath,
    loadClaudeSettings,
    saveClaudeSettings
} from './claude-settings';
import {
    getConfigPath,
    saveSettings
} from './config';

// The signature status line config shipped with the package, written to the
// user's ccstatusline config on `--onboard`.

// Nerd Fonts "latest" release asset (stable URL).
const NERD_FONT_URL = 'https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip';
const FONT_MATCH = 'JetBrainsMonoNerdFont-*.ttf';

interface OnboardOptions { skipFont?: boolean }

function log(msg: string): void {
    process.stdout.write(`${msg}\n`);
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
    log('ccstatusline-gradient — onboarding\n');

    // 1. Write the signature status line config.
    await saveSettings(onboardConfig as unknown as Settings);
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

    log('\nDone! Restart Claude Code to see your status line.');
    log('Tip: run "npx -y ccstatusline-gradient@latest" anytime to tweak it in the TUI.');
}
