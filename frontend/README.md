# Sonneck frontend

React 19 + Vite + TypeScript, styled with Tailwind CSS v4. See the repo root `README.md` for what Sonneck is, `CONTRIBUTING.md` for how to contribute, and `CLAUDE.md` for the conventions this frontend follows (it wins over this file if the two disagree).

## Running locally

The Go backend runs separately, and the dev server proxies `/api` to `http://localhost:8080`. On macOS and Windows the backend's own default port is 26163, so start it with the port set explicitly:

```sh
# from the repo root
DATA_DIR=./data PORT=8080 go run ./cmd/sonneck

# then, in frontend/
npm install
npm run dev
```

The dev server listens on every interface (`host: true`), so a phone or tablet on the same network can open it at `http://<your-computer>:5173`.

In production there is no separate frontend server: the Go binary embeds the built `dist/` and serves it, with every API call same-origin.

## Scripts

- `npm run dev`: the Vite dev server
- `npm run build`: type-check (`tsc -b`), then the production build into `dist/`
- `npm test`: unit tests (Vitest, `src/**/*.test.ts`; pure logic only, no component tests)
- `npm run lint`: ESLint, including the React Compiler's rules
- `npm run format` / `npm run format:check`: Prettier
- `npm run generate:music-emoji-images`: regenerates the `:shortcode:` preview images (see `CONTRIBUTING.md`)

To type-check without building, run `npx tsc --noEmit -p tsconfig.app.json`. Plain `tsc -p .` checks nothing, because `tsconfig.json` only references the other configs.

## Layout

- **`src/api/`**: one file per backend area, plus `client.ts` (the shared request helper) and `types.ts`. These mirror the backend's `{data}` / `{error}` response shape and JSON types by hand; when a response changes, this is where the frontend catches up.
- **`src/routes/`**: one file per page. Files ending in `Mockup.tsx` (or `Sample.tsx`) are the hand-kept design references at `/mockup/*`; `/mockup` lists them all.
- **`src/components/`**: shared pieces. Use them instead of building your own: `Modal`, `ContextMenu`, `Checkbox`, `Radio`, `Toggle`, `Slider`, `SingleSelect`, `TagComboBox`, `EmptyState`, `MarkdownText`, `ClickableCard`.
- **`src/lib/`**: logic with no markup, such as formatting, the shortcut registry (`shortcuts.ts`), confirm and alert dialogs (`dialogs.ts`), the clipboard (`clipboard.ts`) and the theme (`theme.ts`). The unit tests live here.
- **`src/hooks/`**: shared React hooks, for example `useAnchoredPanel` for popups attached to a button.
- **`scripts/`**: developer tools. `check-hit-areas.mjs` checks the Sheet Viewer's 48×48 touch targets with Playwright, and `pad-bravura-subset.py` pads the music-symbol font.

## Notable choices

- **Data fetching is TanStack Query throughout.** Loaded data stays fresh for a minute; each save refreshes what it changed on screen and marks everything else stale (`main.tsx`).
- **Design tokens live in `src/index.css` under `@theme`.** That covers colors, fonts and shadows. The dark theme redefines the same tokens in one `:root[data-theme='dark']` block, so components never use `dark:` variants. A new color needs both a light and a dark value.
- **Every font is self-hosted** in `src/assets/fonts/` (SIL Open Font License), never loaded from Google at runtime:
  - Libre Baskerville for display text
  - Cabin for the interface
  - Bravura Text for ♭/♯ and music symbols (second in every font stack)
  - Atkinson Hyperlegible Next for the Sheet Viewer's clock
  - Lexend for its text annotations
- **Icons are Tabler** (`@tabler/icons-react`), each imported by name.
- **Forms use react-hook-form** with light checks only. The backend is the one that validates.
- **Never use the browser's own dialogs, checkboxes or selects.** That rules out `window.confirm`, `alert`, a bare `<select>` and a bare checkbox: they ignore the theme, and the Mac desktop app can't show `confirm()` at all. Use the components above instead.
- **Keyboard shortcuts go through `lib/shortcuts.ts`.** Don't add your own `keydown` listener. Holding `/` or `?` shows the current page's keys.
