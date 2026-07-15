# ☁️ Telegram Drive — Serverless

A Google Drive–style cloud storage app that uses **Telegram as its storage backend** — free and unlimited. It runs 100% in the browser (no backend server): the app talks to Telegram's API directly via [GramJS](https://gram.js.org/), so your files and credentials never touch any third-party server.

**Live demo:** https://atanucsejgec.github.io/Telegram.com/

## How it works

- Every file you upload is sent as a document message to your **Saved Messages** (user login) or to a **private channel** (bot login).
- The folder structure, file names, stars, trash, etc. are stored in a single JSON database file (`filedb.json`) that is uploaded as a pinned message tagged `#TelegramDriveDatabase`. **Do not delete this message.**
- When you open the app, it downloads that database message and rebuilds your drive.

## Features

- 📤 **File & folder upload** — upload entire folders with subfolders; the structure is recreated automatically. Drag & drop supported (including dropping folders).
- 🗂 **Full file management** — nested folders with colors, rename, move, copy, star, trash/restore, bulk actions.
- 👁 **Previews** — images, video, audio, PDF, text/code (with thumbnails for images).
- 🔎 **Search & sort**, grid/list views, keyboard shortcuts (`Ctrl+U` upload, `F2` rename, …).
- ✈️ **Telegram Files view** — a flat view of *everything* in the storage chat, including files you sent directly from the Telegram app ("Unlisted"), with one-click **Import** into your drive.
- 🔐 **Two login modes:**
  - **User account** — phone number + login code (2FA supported). Files stored in Saved Messages.
  - **Bot** — bot token + private channel ID. Files stored in the channel.

## Getting started

### 1. Get Telegram API credentials

1. Go to [my.telegram.org](https://my.telegram.org) → **API development tools**.
2. Create an app and copy your **api_id** and **api_hash**.

You can enter these in the login screen (they're saved in your browser), or pre-configure them in a `.env` file:

```env
VITE_TELEGRAM_API_ID=123456
VITE_TELEGRAM_API_HASH=your_api_hash
```

### 2. (Optional, for bot login) Create a bot + channel

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Create a **private channel** and add the bot as an **administrator with post permission**.
3. Use the channel ID (e.g. `-100xxxxxxxxxx`) in the login screen.

### 3. Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

### 4. Deploy to GitHub Pages

```bash
npm run deploy     # builds and pushes dist/ to the gh-pages branch
```

Then in your repo: **Settings → Pages → Source: `gh-pages` branch, `/ (root)`**.

> ⚠️ The raw source cannot be served directly (it uses npm module imports) — it must be built by Vite. Always deploy with `npm run deploy`; pushing to `main` does not update the live site.

## Project structure

```
├── index.html        # Single-page UI (login, drive, modals)
├── css/style.css     # All styling
├── js/app.js         # App logic: auth, Telegram sync, uploads, views
└── vite.config.js    # Vite + node polyfills (required by GramJS)
```

## Security notes

- Your API credentials and Telegram **session string are stored in `localStorage`** of your browser. Anyone with access to your browser profile can access your Telegram account — don't log in on shared computers, and use **Logout** when done.
- All Telegram traffic goes directly from your browser to Telegram over WSS. No data is sent anywhere else.

## Limitations

- Max **2 GB per file** (Telegram limit; 4 GB with Telegram Premium user accounts).
- Files are buffered in browser memory during upload/download, so very large files are limited by your device's RAM.
- Bots cannot read channel history — the app works around this by pinning the database message and scanning message IDs, so the first "Telegram Files" scan with a bot may be slower.
