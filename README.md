# Ludo Game

A Ludo board game built with Vite + React + TypeScript. Installable as a PWA
and playable offline.

- 2–4 players: play against bots or pass-and-play on one device
- Provably-fair dice (SHA-256 commitment + HMAC-SHA256 roll derivation)
- Rule-based bot opponents behind a swappable interface
- Egyptian-Arabic football-commentator reactions
- Synthesized sound effects (no audio assets) and haptics
- Optional house rules: mandatory capture, quick mode, three-sixes penalty

## Scripts

```bash
npm run dev      # dev server
npm run build    # tsc -b && vite build
npm test         # vitest (engine, fairness, bot, headless bot-game simulation)
npm run lint     # oxlint
npm run preview  # serve the production build locally
```

## Project layout

- `src/game/` — pure logic, no React: `engine.ts` (rules), `board.ts`
  (coordinates), `bot.ts`, `fairness.ts`, `sound.ts`, `commentary.ts`
- `src/components/` — `Board.tsx` (SVG board), `InstallPrompt.tsx`
- `src/App.tsx` — orchestration, animation, settings

## Icons

The PWA icons in `public/` are generated from `scripts/icon.svg` and
`scripts/icon-maskable.svg`. They are committed, so a normal build does not
need to regenerate them. To change the artwork:

```bash
npm i -D sharp
node scripts/gen-icons.mjs
npm uninstall -D sharp
```

## Deploying

The repo is a plain static Vite build (`dist/`), so any static host works.

```bash
# 1. GitHub (requires the gh CLI, authenticated as the repo owner)
gh repo create monzergrgar-ui/ludo-game --public --source=. --remote=origin --push

# 2. Vercel — links the repo and deploys; no global install needed
npx vercel@latest --prod
```

Vercel auto-detects Vite (build `npm run build`, output `dist`). Once the
GitHub repo is linked in the Vercel dashboard, every push to `master`
redeploys automatically.
