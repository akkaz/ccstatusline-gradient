# PLAN — akkaz dynamic preset + usage-coupled reset timers

Fork: `ccstatusline-gradient` (repo `/home/akkaz/dev/ccstatusline`, branch `main`).
Author of plan context: akkaz. Date: 2026-05-29.

This plan covers two distinct deliverables that MUST be kept separate:

- **PART A (upstream-candidate)**: add `getFillRatio` to the two reset-timer
  widgets so any `dynamic:` color applied to them tracks usage. Generic, no
  fork branding. Candidate for the upstream PR branch `pr-gradient-dynamic`.
- **PART B (fork-only)**: a named preset `akkaz`, bundled and used as the
  default by `--onboard` (plus a `--preset <name>` flag), README updates,
  version bump and publish. NOT part of the upstream PR.

---

## 1. Context (verified against the repo)

- Dynamic colors are resolved in exactly ONE place: the non-powerline render
  path in `src/utils/renderer.ts` around lines 754-762:

  ```ts
  let effectiveColor = widget.color ?? defaultColor;
  if (widget.color?.startsWith('dynamic:')) {
      const ratio = getWidget(widget.type)?.getFillRatio?.(context, widget);
      const resolved = (ratio === null || ratio === undefined)
          ? undefined
          : resolveDynamicColor(widget.color, ratio);
      effectiveColor = resolved ?? defaultColor;
  }
  ```

  This is GENERIC: any widget with a `getFillRatio` that returns a number in
  [0,1] gets a value-sampled solid color. A `dynamic:` color on a widget
  WITHOUT `getFillRatio` (or returning null) falls back to that widget's
  `getDefaultColor()`. There is only ONE occurrence of
  `startsWith('dynamic:')` in the renderer — the powerline path does not
  resolve dynamic colors. The `akkaz` preset has `powerline.enabled: false`,
  so this does not affect us; it is noted in the PR section as a known
  upstream limitation.

- `Widget.getFillRatio?(context, item): number | null` is declared in
  `src/types/Widget.ts` (lines 47-50).

- Existing `getFillRatio` implementations (the pattern to copy):
  - `src/widgets/SessionUsage.ts:120` → `usageData?.sessionUsage / 100`, clamped [0,1], null if undefined.
  - `src/widgets/WeeklyUsage.ts:120` → `usageData?.weeklyUsage / 100`, clamped, null if undefined.
  - `src/widgets/ContextBar.ts:129`, `src/widgets/ContextPercentage.ts:71` (context metrics).

- The two reset timers currently have NO `getFillRatio`:
  - `src/widgets/BlockResetTimer.ts` → manifest type `reset-timer` (manifest line 86).
  - `src/widgets/WeeklyResetTimer.ts` → manifest type `weekly-reset-timer` (manifest line 87).
  Both `implements Widget`, both `supportsRawValue()`/`supportsColors()` true.

- `RenderContext` (`src/types/RenderContext.ts`) exposes `usageData?.sessionUsage`,
  `usageData?.weeklyUsage` (both `number | undefined`).

- Reset timers RENDER `null` when no usage window resolves:
  `BlockResetTimer.render` returns null when
  `resolveUsageWindowWithFallback(usageData, context.blockMetrics)` is empty
  (~line 135); `WeeklyResetTimer.render` returns null when
  `resolveWeeklyUsageWindow(usageData)` is empty (~line 219). This matters for
  the e2e color test (see Tests §6, gotcha #2).

- `getFillRatio` must be INDEPENDENT of display mode (`slider-only`, `progress`,
  `time`, `date`) and of the `inverted` flag. `inverted` only flips the rendered
  text/bar; the COLOR must track usage consumed so it coincides with the
  bar/percentage of the same group. Returning `1 - ratio` for inverted would
  break the "coincide" guarantee — do NOT do that.

- Presets: `presets/*.json` (`minimal`, `retro-dynamic`, `vibrant`) are
  standalone repo examples — `grep` confirms NOTHING under `src/` imports them.
  Only `src/onboard-config.json` is bundled (imported in `src/utils/onboard.ts:7`).
  Build is `bun build src/ccstatusline.ts --target=node --outfile=dist/ccstatusline.js`
  (package.json line 15); bun bundles JSON imports natively (proven by the
  working `onboard-config.json` import).

- `--onboard` entrypoint: `src/ccstatusline.ts:282` →
  `runOnboard({ skipFont: process.argv.includes('--no-font') })`.
  `runOnboard` (`src/utils/onboard.ts:114`) writes `onboardConfig` via
  `saveSettings`, wires `statusLine` to `CCSTATUSLINE_COMMANDS.AUTO_NPX`, then
  installs the font. `saveSettings`/`getConfigPath` come from `src/utils/config.ts`.

- `CompactionCounterWidget` (`src/widgets/CompactionCounter.ts`): metadata keys
  are `hideZero` ("true"/"false"), `nerdFont` ("true"), `format`
  (`icon-space-number` | `text-and-number` | `number`). Nerd-font icon is
  `` (↻). `isNerdFontEnabled` requires `format === 'icon-space-number'`
  (the default). Default color is `yellow`; `supportsRawValue()` is false.

---

## 2. The single canonical dynamic ramp (hardcoded value)

Use ONLY retro stops, calm→full, lilla→rosa→salmone, stopping at salmon
`f18271` (NOT reaching gold `f3a469`/`f7c978`, which would read as "ok/safe" when
the meter is actually full).

**CANONICAL RAMP (use this exact string verbatim everywhere):**

```
dynamic:7b5fac-a86aa4-cc6b8e-f18271
```

Stops are retro indices 3,5,6,7: `7b5fac` (lilla), `a86aa4` (mauve),
`cc6b8e` (rosa), `f18271` (salmone). This extends the previous
`8f6aae-cc6b8e-f18271` downward by one stop for more low-end gradation while
staying entirely inside the retro palette.

Rule: the SAME color guarantee depends on two things — (a) identical fill
ratio between a timer and its group's usage widget (guaranteed by Part A), and
(b) byte-identical `dynamic:` stops on every widget in the group. The ramp
string above is the single source of truth; it must appear verbatim on all
eight dynamic widgets listed in §4. If the prose ever drifts from the preset
JSON, the same-color test (§6) fails — that test is the guardrail.

---

## 3. PART A — files to touch (upstream-candidate)

### 3a. `src/widgets/BlockResetTimer.ts`
Add a method to the `BlockResetTimerWidget` class (anywhere among the other
methods, e.g. just before `getCustomKeybinds`):

```ts
// Color tracks SESSION usage consumed (not the timer's own elapsed window),
// so a `dynamic:` color on this timer coincides with the session bar/%.
getFillRatio(context: RenderContext): number | null {
    const value = context.usageData?.sessionUsage;
    if (value === undefined) {
        return null;
    }
    return Math.max(0, Math.min(1, value / 100));
}
```

`RenderContext` is already imported (line 3). No other change.

### 3b. `src/widgets/WeeklyResetTimer.ts`
Add to `WeeklyResetTimerWidget`:

```ts
getFillRatio(context: RenderContext): number | null {
    const value = context.usageData?.weeklyUsage;
    if (value === undefined) {
        return null;
    }
    return Math.max(0, Math.min(1, value / 100));
}
```

`RenderContext` already imported (line 3). No other change.

### Do NOT touch
`getColorAnsiCode` / `applyColors` (`src/utils/colors.ts`),
`resolveDynamicColor`/`parseDynamicSpec` (`src/utils/gradient.ts`), the renderer
dynamic block — all already correct and generic.

---

## 4. PART B — the `akkaz` preset (fork-only)

### 4a. New bundled file: `src/presets/akkaz.json`
Create the directory `src/presets/` and the file `akkaz.json` with the exact
content below. (Optionally also copy the same JSON to `presets/akkaz.json` at
repo root as a discoverable example alongside the others — that copy is NOT
bundled and is purely cosmetic.)

Exact preset content (ids, glyphs, colors are all load-bearing):

```json
{
  "version": 3,
  "lines": [
    [
      { "id": "model", "type": "model", "rawValue": true, "bold": true, "color": "gradient:3f51b1-5a55ae-7b5fac-8f6aae-a86aa4-cc6b8e" },
      { "id": "spM", "type": "separator", "character": " " },
      { "id": "lbl-think", "type": "custom-text", "customText": "", "color": "hex:cc6b8e" },
      { "id": "spT", "type": "separator", "character": " " },
      { "id": "think", "type": "thinking-effort", "rawValue": true, "color": "gradient:cc6b8e-f18271-f3a469-f7c978" }
    ],
    [
      { "id": "lbl-ctx", "type": "custom-text", "customText": "Context", "color": "hex:8f6aae" },
      { "id": "sp1", "type": "separator", "character": " " },
      { "id": "ctx-bar", "type": "context-bar", "rawValue": true, "color": "dynamic:7b5fac-a86aa4-cc6b8e-f18271", "metadata": { "display": "slider-only" } },
      { "id": "sp2", "type": "separator", "character": " " },
      { "id": "ctx-pct", "type": "context-percentage", "rawValue": true, "color": "dynamic:7b5fac-a86aa4-cc6b8e-f18271" }
    ],
    [
      { "id": "lbl-ses", "type": "custom-text", "customText": "Session", "color": "hex:8f6aae" },
      { "id": "sp3", "type": "separator", "character": " " },
      { "id": "ses-bar", "type": "session-usage", "rawValue": true, "color": "dynamic:7b5fac-a86aa4-cc6b8e-f18271", "metadata": { "display": "slider-only" } },
      { "id": "ses-b-sp", "type": "separator", "character": " " },
      { "id": "ses", "type": "session-usage", "rawValue": true, "color": "dynamic:7b5fac-a86aa4-cc6b8e-f18271" },
      { "id": "s2", "type": "separator", "character": " " },
      { "id": "lbl-r1", "type": "custom-text", "customText": "", "color": "hex:8f6aae" },
      { "id": "sp4", "type": "separator", "character": " " },
      { "id": "reset", "type": "reset-timer", "rawValue": true, "color": "dynamic:7b5fac-a86aa4-cc6b8e-f18271" },
      { "id": "s3", "type": "separator", "color": "hex:475569" },
      { "id": "lbl-wk", "type": "custom-text", "customText": "Week", "color": "hex:8f6aae" },
      { "id": "sp5", "type": "separator", "character": " " },
      { "id": "wk-bar", "type": "weekly-usage", "rawValue": true, "color": "dynamic:7b5fac-a86aa4-cc6b8e-f18271", "metadata": { "display": "slider-only" } },
      { "id": "wk-b-sp", "type": "separator", "character": " " },
      { "id": "wk", "type": "weekly-usage", "rawValue": true, "color": "dynamic:7b5fac-a86aa4-cc6b8e-f18271" },
      { "id": "s4", "type": "separator", "character": " " },
      { "id": "lbl-r2", "type": "custom-text", "customText": "", "color": "hex:8f6aae" },
      { "id": "sp6", "type": "separator", "character": " " },
      { "id": "wk-reset", "type": "weekly-reset-timer", "rawValue": true, "color": "dynamic:7b5fac-a86aa4-cc6b8e-f18271" }
    ],
    [
      { "id": "compactions", "type": "compaction-counter", "color": "hex:cc6b8e", "metadata": { "hideZero": "true", "format": "icon-space-number", "nerdFont": "true" } }
    ]
  ],
  "flexMode": "full-minus-40",
  "compactThreshold": 60,
  "colorLevel": 3,
  "inheritSeparatorColors": false,
  "globalBold": false,
  "gitCacheTtlSeconds": 5,
  "minimalistMode": false,
  "powerline": {
    "enabled": false,
    "separators": [""],
    "separatorInvertBackground": [false],
    "startCaps": [],
    "endCaps": [],
    "autoAlign": false,
    "continueThemeAcrossLines": false
  }
}
```

Notes on exact values:
- Glyphs: ⚡ = `U+F0E7` (``), reset icon = `U+F1DA` (``). In strict
  JSON these are the literal Nerd-Font codepoints; written as `\uXXXX` escapes
  above so the file is copy-paste-safe. Either the escape or the literal glyph
  is acceptable — the escape is preferred to avoid editor mangling.
- Line 1: model split-gradient `gradient:3f51b1-5a55ae-7b5fac-8f6aae-a86aa4-cc6b8e`;
  seam icon `hex:cc6b8e`; thinking-effort `gradient:cc6b8e-f18271-f3a469-f7c978`.
- The EIGHT widgets carrying the canonical dynamic ramp verbatim:
  `ctx-bar`, `ctx-pct`, `ses-bar`, `ses`, `reset`, `wk-bar`, `wk`, `wk-reset`.
  The two reset timers now coincide with their groups thanks to PART A.
- Group labels: lilla `hex:8f6aae`. Group divider: `hex:475569` (the `s3`
  separator carries a divider color; inner spacing separators use `character: " "`).
- Line 3 compaction-counter: `hideZero:"true"`, `format:"icon-space-number"`,
  `nerdFont:"true"`, color `hex:cc6b8e` (retro). Hidden when count is 0.

### 4b. `src/utils/onboard.ts` — preset registry + option
Replace the single `onboardConfig` import with a static preset registry (NOT a
dynamic/computed import — `bun build` to a single file will not reliably bundle
`import(\`./presets/${name}.json\`)`):

```ts
import akkazPreset from '../presets/akkaz.json';
// (keep any other imports)

const PRESETS: Record<string, unknown> = {
    akkaz: akkazPreset
};
const DEFAULT_PRESET = 'akkaz';

interface OnboardOptions { skipFont?: boolean; preset?: string }
```

In `runOnboard`, resolve the preset and write it:

```ts
export async function runOnboard(options: OnboardOptions = {}): Promise<void> {
    const presetName = options.preset ?? DEFAULT_PRESET;
    const config = PRESETS[presetName];
    if (!config) {
        log(`  ⚠ Unknown preset "${presetName}". Available: ${Object.keys(PRESETS).join(', ')}.`);
        return;
    }
    log(`ccstatusline-gradient — onboarding (preset: ${presetName})\n`);
    await saveSettings(config as unknown as Settings);
    log(`  ✓ Wrote status line config → ${getConfigPath()}`);
    // ... rest unchanged (statusLine wiring + font install) ...
}
```

The old `src/onboard-config.json` may be deleted (its content is now
`presets/akkaz.json`) OR kept and re-registered as a legacy alias; cleanest is
to delete it and remove its import. Decision: delete it to avoid two sources of
truth.

### 4c. `src/ccstatusline.ts` — `--preset <name>` flag
At the `--onboard` branch (line 282), parse an optional `--preset <name>`:

```ts
if (process.argv.includes('--onboard')) {
    const presetIdx = process.argv.indexOf('--preset');
    const preset = presetIdx !== -1 ? process.argv[presetIdx + 1] : undefined;
    await runOnboard({
        skipFont: process.argv.includes('--no-font'),
        preset
    });
    return;
}
```

Default (`--preset` omitted) → `akkaz`.

### 4d. README
Update `README.md`: add an `akkaz` preset section (screenshot-style
description, the dynamic ramp explanation, compaction counter), and document
`npx -y ccstatusline-gradient@latest --onboard [--preset <name>] [--no-font]`,
with `akkaz` as the default. Mention the usage-coupled reset timers behavior.

---

## 5. PR-upstream vs fork — what goes where

| Item | Destination |
|------|-------------|
| `getFillRatio` on `BlockResetTimer.ts` & `WeeklyResetTimer.ts` | **upstream PR** `pr-gradient-dynamic` (generic) |
| Unit tests for those two `getFillRatio` | **upstream PR** |
| End-to-end "same color" renderer test | **upstream PR** (it exercises the generic dynamic path) |
| `src/presets/akkaz.json` + onboard registry + `--preset` | **fork-only** |
| README `akkaz`/`--preset` docs | **fork-only** (an upstream-neutral note about dynamic timers may go upstream) |

**Design note for the upstream PR description (pre-empt reviewer confusion):**
the reset-timer fill ratio is *usage consumed* (`sessionUsage`/`weeklyUsage`),
NOT the timer's own elapsed-window fraction (`window.elapsedPercent`). This is
intentional: the color is meant to track the usage bar of the same group, not
time-to-reset. It is also intentionally independent of the `inverted` flag and
display mode. State this explicitly so upstream evaluates it as a design choice
and can decide whether they want the usage-coupling.

**Known upstream limitation to mention:** dynamic colors are resolved only in
the non-powerline render path (`renderer.ts:758`); powerline mode does not
sample `getFillRatio`. Out of scope here (akkaz uses `powerline.enabled:false`).

---

## 6. Tests

### 6a. Unit — `getFillRatio` of the two timers
Add to `src/widgets/__tests__/BlockResetTimer.test.ts` and
`src/widgets/__tests__/WeeklyResetTimer.test.ts`:

- returns `null` when `usageData` absent / the relevant field undefined.
- returns `sessionUsage/100` (resp. `weeklyUsage/100`) for a mid value
  (e.g. 40 → 0.4).
- clamps: 150 → 1, -10 → 0.
- is INDEPENDENT of `inverted` and `display` metadata: same input usage with
  `{metadata:{display:'slider-only'}}` and `{metadata:{inverted:'true'}}`
  yields the same ratio.

These pure-method tests need only `context.usageData`; no window/blockMetrics.

### 6b. End-to-end — reset-timer color == session-usage color
New file `src/utils/__tests__/renderer-dynamic-reset.test.ts`, modeled on the
existing `src/utils/__tests__/renderer-dynamic.test.ts` (reuse its
`createSettings`, `firstRgb`, `preRenderAllWidgets` →
`calculateMaxWidthsFromPreRendered` → `renderStatusLine` flow).

Assert: with identical usage, the FIRST truecolor RGB code emitted by a
`reset-timer` (dynamic ramp) equals that of a `session-usage` percentage
(same ramp). Likewise `weekly-reset-timer` vs `weekly-usage`.

**Gotcha (critical):** `reset-timer.render` returns `null` unless a usage
window resolves. So the test context MUST provide both the usage fraction AND a
resolvable window. Use:

```ts
const context: RenderContext = {
    isPreview: false,
    terminalWidth: 200,
    usageData: {
        sessionUsage: 60,
        sessionResetAt: '2030-01-01T00:00:00.000Z' // future → non-empty window
    }
};
```

For the weekly case add `weeklyUsage` and `weeklyResetAt` (and whatever
`resolveWeeklyUsageWindow` requires — verify field names in
`src/utils/usage.ts` while implementing). If the window still won't resolve via
`usageData`, supply `context.blockMetrics` instead (per
`resolveUsageWindowWithFallback`). The point: the timer must actually RENDER
text so there is an ANSI code to compare; a null render fails on
"no truecolor code", not on a color mismatch.

Use the same `dynamic:7b5fac-a86aa4-cc6b8e-f18271` ramp on both widgets in the
test so the comparison is apples-to-apples.

### 6c. Regression
`npx vitest run` — note ~16 files already fail for environment reasons
unrelated to this work; confirm the NEW/edited tests pass and no previously
green test regresses.

---

## 7. Execution sequence

1. **Part A code**: add `getFillRatio` to `BlockResetTimer.ts` and
   `WeeklyResetTimer.ts`.
2. **Part A tests**: §6a unit tests + §6b e2e test. Run `npx vitest run` on
   those files; confirm green.
3. **Part B preset**: create `src/presets/akkaz.json` (and optional root
   `presets/akkaz.json`). Remove `src/onboard-config.json`.
4. **Part B onboard**: edit `src/utils/onboard.ts` (registry + `preset` option),
   `src/ccstatusline.ts` (`--preset` parse).
5. **README**: update preset + onboard docs.
6. **Build**: `bun run build`. Verify `dist/ccstatusline.js` bundles
   `akkaz.json` (grep dist for a unique id like `wk-reset` /
   `7b5fac-a86aa4-cc6b8e-f18271`).
7. **Smoke test onboard**: run the built CLI with `--onboard` against a
   throwaway `CCSTATUSLINE_CONFIG`/HOME so as not to clobber the real config;
   confirm the written config matches `akkaz` and `--preset akkaz` is the
   default. (Optional: render a sample status JSON through `dist` and eyeball
   that reset timer and session % share a color.)
8. **Version bump**: `package.json` → `2.4.0`.
9. **Commit & push** (branch first if on default): Part A on the upstream PR
   branch `pr-gradient-dynamic`; Part B + version on the fork `main`. Keep the
   commits separated so the upstream PR is clean.
10. **Publish**: `npm publish` (requires the user's OTP / web-auth).

---

## 8. Critical files for implementation

- /home/akkaz/dev/ccstatusline/src/widgets/BlockResetTimer.ts
- /home/akkaz/dev/ccstatusline/src/widgets/WeeklyResetTimer.ts
- /home/akkaz/dev/ccstatusline/src/utils/onboard.ts
- /home/akkaz/dev/ccstatusline/src/ccstatusline.ts
- /home/akkaz/dev/ccstatusline/src/presets/akkaz.json  (new)
