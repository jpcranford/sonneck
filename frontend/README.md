# Sonneck frontend

React + Vite + TypeScript. See the repo root `README.md` for what Sonneck is; see `sonneck-design.md` and `CLAUDE.md` for the design doc and cross-cutting conventions this frontend follows.

## Running locally

The Go backend must be running separately (see the root README) — the dev server proxies `/api` to `http://localhost:8080`.

```sh
npm install
npm run dev
```

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — type-check (`tsc -b`) then production build
- `npm run lint` — ESLint
- `npm run format` / `npm run format:check` — Prettier

## Notable choices

- **Baskervville** is self-hosted (`src/assets/fonts/`, `@font-face` in `src/index.css`) rather than loaded from Google Fonts at runtime — see the root README's Acknowledgements. It's used for display text only (headings, piece/card titles, sidebar nav); general UI chrome uses a system sans-serif stack.
- **Design tokens** (colors, fonts) live in `src/index.css` under `@theme` (Tailwind v4's CSS-first config) — e.g. `bg-paper`, `text-ink`, `font-display` are all defined there, not scattered through components.
- **`src/api/`** mirrors the backend's `{data}`/`{error}` response contract and JSON types by hand (`client.ts`, `types.ts`) — this is the main defense against frontend/backend drift across sessions (CLAUDE.md > Frontend). When a backend response shape changes, this is where the frontend catches up.
- **`src/components/Modal.tsx`** and **`ContextMenu.tsx`** are shared primitives (Escape-to-close, click-outside-to-close) built once so every popup/menu in the app behaves consistently, rather than each screen reimplementing the behavior.
