# Changelog

All notable changes to the Telegram Drive Serverless project will be documented in this file.

## [2026-07-29 01:26 PM IST]

### Added
- **App Favicon**: Generated and added custom Telegram Drive branding favicon (`favicon.png`) with standard `<link rel="icon">` and `<link rel="apple-touch-icon">` tags in `index.html`.

---

## [2026-07-29 01:17 PM IST]

### Added
- **SPA Back Button & Mobile Gesture Navigation**: Integrated HTML5 History API (`pushState` / `popstate`) so pressing the browser back button or mobile swipe-back gesture navigates to the previous app state instead of closing or reloading the website.
  - **Folder & View Stack**: Navigating folders (`navFolder`) or sidebar views (`switchView`) pushes history states, allowing back button to pop back level-by-level.
  - **File Preview Overlay**: Pressing back while an image/video/pdf/code preview modal is open safely closes the preview overlay while staying on the current folder list.
  - **Modal Dialogs**: Pressing back closes any active modal (Rename, Move, New Folder, Info, Shortcuts) without triggering page reload.
  - **Mobile Messenger Panel**: In Messenger view on mobile devices, pressing back while inside a chat screen returns to the chat dialogs list.

---

## [2026-07-29 12:51 PM IST]

### Added
- **Service Worker Streaming Download for Mobile Browsers**: Introduced a new download tier streaming file chunks directly to the browser's native download manager via a Service Worker, bypassing the RAM bottleneck on mobile devices.
  - **`public/sw-download.js`**: Lightweight Service Worker intercepting `/sw-download/{uuid}` fetch requests and responding with a streaming `Response` backed by a `ReadableStream` fed from a `MessagePort`.
  - **`SwWritableAdapter`**: Wraps a `MessagePort` to mimic a `WritableFileStream` interface (`write`, `close`, `abort`), enabling `DownloadTask` to stream through the Service Worker smoothly.
  - **Reorder Buffer in `DownloadTask`**: Added `sequential` mode with `reorderBuf` (Map) to buffer out-of-order chunks from 4 concurrent workers and flush them sequentially.
  - **`window.swStreamDownload()`**: Manages the `MessageChannel`, iframe trigger, and sequential `DownloadTask`.
  - *Supported browsers:* Chrome Android 90+, Safari iOS 15+, Firefox Android.

### Changed
- **3-Tier Download Fallback Chain**: Updated `downloadFile()` and `performDownloadMedia()` to use:
  1. `showSaveFilePicker` (Desktop - zero RAM, random-access)
  2. Service Worker stream (Mobile - low RAM, sequential stream)
  3. Blob in RAM (Legacy browsers)
- **Auth Handler Global Exports**: Exported `sendCode`, `verifyCode`, `loginAsBot`, `setLoginMethod`, `backToPhone`, and `logout` to `window` for mobile/web login compatibility.

---

## [2026-07-29 05:09 AM IST]

### Added
- **Chats & Channels (Messenger Module)**:
  - Added a new **"Chats & Channels"** view (`#nav-messenger`) accessible when logged in via Telegram User login.
  - Implemented a two-panel responsive messaging UI (`messenger-screen` in `index.html`, styled in `css/messenger.css`, logic in `js/messenger.js`).
  - **Dialogs & Chat Navigation**: Infinite-scrolling dialog list showing user chats, private groups, and public channels with unread badges and avatar indicators.
  - **Universal Search**: Supports searching past dialogs, searching files across all chats via Telegram API (`Api.messages.Search`), and parsing/resolving direct `t.me` message links (e.g. `t.me/c/12345/678`).
  - **Chat View & Message Rendering**: Rich message view supporting media previews (photos, videos, audio, documents), formatted text, inline media playing, and automated pagination on scroll-up.
  - **Interactive Messaging**: Send text messages directly to active chats.
  - **Direct Chat Download Integration**: Integrated chat media attachments with the direct-to-disk concurrent download engine.
- **Direct-to-Disk Concurrent Downloader**: Introduced a new high-performance download architecture that completely bypasses browser memory to prevent lag and Out-of-Memory (OOM) crashes on large files (e.g., 3GB+ files).
  - Uses the File System Access API (`window.showSaveFilePicker()`) to stream chunks directly to the hard drive.
  - Spawns 4 concurrent workers per file via `Api.upload.GetFile` to drastically increase download speeds compared to GramJS's default sequential `iterDownload`.
  - Automatically falls back to memory blobs for unsupported browsers (Firefox/Safari/Mobile).
  - *Functions involved:* `downloadFile` (My Drive), `performDownloadMedia` (Chats & Channels).
- **Download Queue System**: Implemented a global queue to handle multiple file downloads. Instead of running all selected files at once (which triggers Telegram `FLOOD_WAIT` bans), files are queued and downloaded one after another.
  - *Functions/Variables involved:* `window._downloadQueue`, `window._processDownloadQueue`, `fastStreamDownload`.
- **Pause & Resume functionality**: You can now pause an active download. The workers gracefully finish their current chunk and yield. Resuming instantly spawns 4 new workers to pick up from the exact offset chunk.
  - *Functions/Classes involved:* `DownloadTask`, `toggleDownloadPause`.
- **Clean File Cancellation**: Clicking the Dismiss (X) button on an active download now properly aborts the Web Stream, severing connections and automatically deleting the partial/corrupted `.crdownload` file from the user's local disk.
  - *Functions involved:* `DownloadTask.cancel()`, `cancelDownload`.
- **Real-time Progress & ETA UI**: The Transfers panel now calculates and displays accurate transfer speed, "Time Left" (ETA), and percentage metrics.
  - *Functions involved:* `DownloadTask.updateProgress()`.
- **Minimize/Maximize Transfers Panel**: Replaced the "hide" functionality on the Transfers panel with a Minimize feature. The list of items collapses while keeping the header pinned to the screen bottom for clean workspace visibility.
  - *Functions involved:* `toggleUploadPanel`.

### Changed
- Refactored `fastStreamDownload` into a stateful `DownloadTask` class in `js/app.js` to strictly manage worker lifecycles (Paused, Cancelled, Active, Error).
- Auto-Maximize behavior added: The Transfers panel will automatically expand (`classList.remove("minimized")`) whenever a new upload or download is initiated.
  - *Functions involved:* `uploadEntries`, `fastStreamDownload`.
- Upload/Download progress UI elements now persist on-screen after completion, allowing users to manually dismiss them, instead of auto-hiding immediately.
- Adapted `switchView()` in `js/app.js` to hide drive topbar controls (`sort-select`, `view-toggle`, `topbar-new-folder`) when in Messenger mode and restore them when returning to Drive views.
- Exported GramJS `Api` object (`window.tgApi`) and global helper bridges (`window.tgClient`, `window._msgToast`, `window._msgEsc`) to allow `js/messenger.js` access to client and toast notifications.

### Fixed
- Fixed an issue where the download UI element could block user interaction when closed incorrectly.
- Fixed a bug where dismissed downloads would silently continue downloading in the background.
