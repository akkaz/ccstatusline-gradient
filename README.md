<div align="center">

# ccstatusline-gradient

**🎨 A fork of [ccstatusline](https://github.com/sirmalloc/ccstatusline) that adds true gradient and value-driven dynamic colors to your Claude Code status line.**

</div>

---

> This is a community fork of **[ccstatusline](https://github.com/sirmalloc/ccstatusline)** by
> [@sirmalloc](https://github.com/sirmalloc) (Matthew Breedlove). All of the original features are
> intact — this fork only **adds two new color options**. Huge thanks to the upstream project; please
> star it too. Licensed under MIT (see [`LICENSE`](./LICENSE)).

## ✨ What this fork adds

Two new values you can give to any widget's `color` field, alongside the existing
named colors / `ansi256:N` / `hex:RRGGBB`:

| Format | What it does | Example |
| --- | --- | --- |
| `gradient:<preset\|stops>` | A **per-character gradient** across the widget's text. | `gradient:vice`, `gradient:5ee7df-b490ca` |
| `dynamic:<preset\|stops>` | A **single color picked by the widget's value** (0→100%). Great for "turns red as it fills". | `dynamic:22c55e-eab308-ef4444` |

- **Presets** (from `gradient-string`): `atlas, cristal, teen, mind, morning, vice, passion, fruit, instagram, retro, summer, rainbow, pastel`.
- **Custom stops**: two or more `RRGGBB` hex colors joined by `-` (e.g. `gradient:ff5f6d-ffc371`).
- `dynamic:` works on the "fill" widgets that report a value: **context-bar, context-percentage, session-usage, weekly-usage**.
- Both are selectable from the interactive TUI color menu: press **`g`** for a gradient or **`d`** for a dynamic color.
- Truecolor (`colorLevel: 3`) recommended; at 256-color they degrade gracefully, at 16-color they fall back to a solid first stop.

### Continuous gradient trick (no extra feature needed)

Want one gradient that flows across *several* widgets without restarting? Split the stops so each
widget **ends on the color the next one begins with**. Example for `Opus 4.8 ⚡ high`:

```jsonc
{ "type": "model",          "color": "gradient:3f51b1-cc6b8e" }        // start → seam
{ "type": "custom-text",    "color": "hex:cc6b8e", "customText": "⚡" } // the seam
{ "type": "thinking-effort","color": "gradient:cc6b8e-f7c978" }        // seam → end
```

## 🚀 Install

One command, just like upstream — no clone, no build step (Node 18+).

**1. Point Claude Code at it.** Add to `~/.claude/settings.json`:

```jsonc
{
  "statusLine": {
    "type": "command",
    "command": "npx -y ccstatusline-gradient@latest"
  }
}
```

> Prefer the GitHub source (works even before the npm release):
> `"command": "npx -y github:akkaz/ccstatusline-gradient"`

**2. Configure it** — run the same command in a terminal to open the interactive TUI
(add widgets, pick `g`radient / `d`ynamic colors, install a preset):

```bash
npx -y ccstatusline-gradient@latest
```

That's it. Restart Claude Code (the status line command is read at startup).

> **Prefer a one-liner preset?** Drop a ready-made config in directly:
> ```bash
> mkdir -p ~/.config/ccstatusline
> curl -fsSL https://raw.githubusercontent.com/akkaz/ccstatusline-gradient/main/presets/retro-dynamic.json -o ~/.config/ccstatusline/settings.json
> ```

## 🧩 Default presets

In [`presets/`](./presets):

| File | Look |
| --- | --- |
| `retro-dynamic.json` | 3 lines. Identity row with a continuous **retro** gradient (`model ⚡ effort`), then context + session + weekly with **dynamic** green→red bars. Subscription-friendly (no cost/git). |
| `vibrant.json` | 2 lines. Vice gradient on the model, dynamic context, session + reset. |
| `minimal.json` | 1 line. Model gradient + dynamic context bar only. |

## 🛠️ Building from source (optional)

Uses [Bun](https://bun.sh). Only needed if you change the TypeScript source.

```bash
bun install
bun run build      # -> dist/ccstatusline.js
bun run start      # open the TUI
npx vitest run src/utils/__tests__/gradient.test.ts src/utils/__tests__/dynamic-color.test.ts
```

## 📦 Upstream & license

- Upstream: https://github.com/sirmalloc/ccstatusline — for all the core functionality, docs and widget reference.
- License: MIT, © 2025 Matthew Breedlove. This fork keeps the same license; new code is contributed under MIT as well.
