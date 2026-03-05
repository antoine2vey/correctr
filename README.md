# Correctr

> AI-powered grammar correction, right where you type.

Correctr is a Chrome extension that corrects your selected text in-place using GPT-4o. Select any text on any page, right-click, and get clean, corrected prose — no copy-pasting, no switching tabs.

---

## How it works

1. Select text on any webpage
2. Right-click → **Correct with Correctr**
3. A toast appears while the text is being corrected
4. Your selection is replaced with the corrected version — instantly

---

## Architecture

```
correctr/
├── packages/
│   ├── server/        Hono API server (GPT-4o backend)
│   └── extension/     Chrome MV3 content script + background worker
```

**Server** — a lightweight [Hono](https://hono.dev) server that proxies text to the OpenAI API. All business logic is written with [Effect](https://effect.website) for typed error handling, dependency injection, and structured logging.

**Extension** — a Chrome Manifest V3 extension with:
- A **background service worker** that registers a context menu entry
- A **content script** that reads the selection, calls the server, and replaces the text in-place — with animated toast feedback

Both packages are TypeScript strict, using [Effect](https://effect.website) throughout instead of raw Promises or try/catch.

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Server framework | [Hono](https://hono.dev) |
| AI model | OpenAI GPT-4o |
| Effect system | [Effect](https://effect.website) |
| Extension | Chrome MV3 |
| Linter / Formatter | [Biome](https://biomejs.dev) |
| Language | TypeScript (strict) |

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) installed
- An OpenAI API key

### 1. Install dependencies

```bash
bun install
```

### 2. Configure the server

```bash
cp packages/server/.env.example packages/server/.env
# then set OPENAI_API_KEY in .env
```

### 3. Start the server

```bash
bun run server
# Server running on http://localhost:3000
```

### 4. Build the extension

```bash
bun run extension:build
```

### 5. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `packages/extension/dist/`

---

## Development

```bash
# Start server with hot reload
bun run server

# Watch extension
bun run extension:dev

# Lint & format
bun run check
bun run format
```

---

## API

`POST /correct`

```json
{ "text": "i dont think this is corect" }
```

```json
{ "corrected": "I don't think this is correct." }
```

`GET /health` — returns `{ "status": "ok" }`

---

## License

MIT
