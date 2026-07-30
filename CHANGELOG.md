# Changelog

All notable changes to the Telegram Drive Serverless project will be documented in this file.

## [2026-07-30 02:05 PM IST]

### Added
- **Comprehensive Technical Architecture Documentation (`Architecture.md`)**:
  - Created [Architecture.md](Architecture.md) detailing the complete client-side SPA system architecture, zero-backend design philosophy, data storage strategy, and Mermaid flow diagrams.
  - Documented technology stack choices and explicit engineering rationale for Vanilla JS (ES Modules), Vanilla CSS3, GramJS MTProto client, `fflate` compression, `IndexedDB` caching, and ServiceWorker/FileSystemAccess streaming pipelines.
  - Added project directory map, file responsibility matrix, and comprehensive technical reference for all notable functions across `js/app.js`, `js/messenger.js`, and `js/idb-cache.js`.
  - Updated sidebar view label from `"Telegram Files"` to `"Drive All Files"`.

## [2026-07-30 01:05 PM IST]

### Added
- **Context-Aware Top Header Search Bar**: Updated the main top bar search input (`#search-input`) to dynamically adapt based on active view. When navigating to the **"Chats & Channels"** (`messenger`) view, the search bar placeholder updates to `"Search chats, files or paste Telegram link..."` and routes typing/clearing/Enter key directly to chat filtering, global file searching across chats, and Telegram link resolution. When navigating back to Drive views, it restores to `"Search files..."` and filters Drive files.

### Fixed
- **Grouped Telegram File Attachments / Albums Display**: Fixed an issue where chat or channel posts with multiple attached files (Telegram albums / grouped messages with `groupedId`) only displayed the first file in the Messenger view. Added `getMsgGroupedId()` and `renderMessageGroup()` in `js/messenger.js` to group consecutive messages sharing the same `groupedId` into a single message bubble, displaying all attached files with individual file names, sizes, icons, and download buttons.
- **Search Result Open Chat / File Jump Button Fix**: Fixed an issue where clicking the "Open Chat" / jump button (`msgSearchOpenChat`) in global search results failed to navigate to the chat or message location. Updated `searchOpenChat` in `js/messenger.js` to resolve channel `inputEntity`, activate `messenger` view via `openMessenger()`, set state flags (`chatHasMoreOlder` / `chatHasMoreNewer`), load messages centered around `r.msgId`, scroll to the target message, and trigger glowing message highlight.
- **PWA Install App Button Fix**: Exposed `window.installPwa = installPwa` in `js/app.js` so clicking `#pwa-install-btn` in `index.html` triggers the browser's native PWA installation dialog (`beforeinstallprompt`). Added fallback guidance toasts for standalone mode or browsers requiring manual installation via browser menu (⋮ -> Install App).
- **Sidebar Scrolling & Storage Widget Layout Fix**: Made the entire `.sidebar` container smoothly scrollable (`overflow-y: auto`), styled custom 5px scrollbar tracks, anchored `.storage-info` above `.sidebar-footer` using `margin-top: auto; margin-bottom: 12px;`, and ensured the storage widget is fully visible with hard-drive icon, 6px progress bar, chevron indicator, and hover glow effects without any cut-offs.
- **Telegram Link Message Jumping & Bi-directional History Loading**: Fixed an issue where jumping to a Telegram message link (`t.me/c/.../1475`) loaded disconnected batches of messages. Replaced fragmented dual API calls with GramJS `{ limit: 50, offsetId: targetMsgId, addOffset: -25 }` for contiguous message fetching centered around the target ID. Added bi-directional history state tracking (`chatHasMoreOlder` / `chatHasMoreNewer`) and a **"Load newer messages"** control button for seamless scrolling past jump targets.

## [2026-07-30 12:35 PM IST]

### Added
- **Bulk Queue Download for Selected Files & Folders**:
  - Added **"Download All"** action button to the floating Selection Bar (`#sel-btn-download`) when multiple files/folders are selected.
  - Added **"Download Selected Queue"** entry to the right-click context menu for multi-selected items.
  - Implemented recursive folder resolution to gather nested files, file deduplication, trashed item filtering, and sequential download processing with real-time transfer drawer progress and cancel support (`AbortController`).
  - Added **Telegram Drive Web Deep Links**: Updated file share links (`copyShareLink`) to construct web app deep links (`?file=<id>`) and added `checkUrlParameters()` on load to open shared files directly inside Telegram Drive.
  - Added **In-App Telegram Link Resolution & Deep Jumping**: Added `parseTgLink` and `openTgLink` in `js/messenger.js` to parse `t.me` links (e.g. `https://t.me/udem?/single` or `/c/123456789/42`), resolve chat entities, navigate to Messenger view, load messages around target ID, scroll into view, and trigger pulsing message highlights without opening external `telegram.org` pages.
  - Added **5-Second Glowing Target Highlight Animation**: Updated both `.file-card.file-highlight` and `.msg-row.msg-highlight` animations in `style.css` and `messenger.css` with 5-second glowing pulse keyframes (`@keyframes fileHighlight` / `@keyframes msgHighlight`) and 5000ms JavaScript timeouts so jumped target files and messages glow clearly for 5 seconds upon location navigation.

### Fixed
- **Storage Analytics Modal Opaque Background Fix**: Replaced semi-transparent glass background with a solid, high-contrast opaque surface (`background: var(--bg-2)`), updated `.modal-content` class bindings, and elevated modal backdrop depth (`rgba(4,6,12,.82)`) so text underneath no longer bleeds through.
- **Transfer Panel Header Title Fix**: Updated the floating transfer drawer header (`#upload-panel-title`) to dynamically toggle between **"File Uploads"**, **"Folder Downloads"**, **"Queue Downloads"**, and **"Transfers"** depending on active transfer operations, replacing the previous static "Uploads" header during download tasks.

## [2026-07-30 11:17 AM IST]

### Added
- **Keyboard Navigation Enhancements**:
  - **Backspace Previous State Navigation**: Pressing `Backspace` (when outside text inputs) steps back to the previous view (`switchView`), parent folder (`navFolder`), preview, or modal state via HTML5 History API (`window.history.back()`).
  - **Tab Sidebar View Switching**: Pressing `Tab` (and `Shift + Tab`) cycles forward and backward through all visible sidebar navigation items (`My Drive`, `Recent`, `Starred`, `Images`, `Videos`, `Audio`, `Documents`, `Telegram Files`, `Storage Analytics`, `Trash`).
  - **Escape Open File & Modal Close**: Pressing `Esc` immediately closes file preview modal (`closePreview()`), active modal dialogs, help drawer, context menus, and unfocuses input fields.
  - **Keyboard Shortcuts Menu Info**: Updated the Keyboard Shortcuts modal (`?` key / topbar button) with `Backspace` (Previous state), `Tab` (Switch sidebars), and `Esc` (Close open files / modals).

## [2026-07-30 11:02 AM IST]

### Fixed
- **First-Time User Onboarding Tour Overhaul**: Resolved invalid target selector bug (`#btn-new`), added pulsating glowing spotlights (`.tour-highlight`) on active elements, added `Prev` step navigation controls, implemented target visibility fallbacks for hidden elements, auto-scrolling into view, popover collision prevention, and added a manual "Take Interactive Tour" button to the Help Drawer.
- **Drag & Drop Invisible Overlay Fix**: Fixed an issue where dragging internal files or folders activated the full-screen `#drop-zone` backdrop overlay (`z-index: 500` blur layer), blocking folder drop targets. Added `isDraggingInternal` state tracking, external OS `"Files"` type validation, folder-to-folder drag-and-drop support, multi-selected item dragging, and breadcrumb folder drop targets.


## [2026-07-30 12:44 AM IST]
### Added
- **PWA (Progressive Web App) Support**: Added `public/manifest.json`, offline app-shell Service Worker (`public/sw.js`), and install prompt banner.
- **Folder Download as ZIP**: Implemented recursive folder zip export using `fflate` with real-time download and compression progress in context menu.
- **Upload Progress Per-File with Cancel, Speed & ETA**: Added per-file cancel button (`AbortController`), real-time upload speed calculation (MB/s), and ETA time remaining indicator.
- **Drag & Drop Move**: Made file cards draggable (`draggable="true"`) to move files directly by dragging them onto folder cards or sidebar folder tree items.
- **Keyboard File Grid Navigation**: Arrow keys navigate focus ring (`.focused`) across grid cards, `Enter` opens folders/previews, `Space` toggles selection.
- **First-Time User Onboarding Tour**: Added 3-step interactive tour guiding first-time visitors through uploads, folder navigation, and Messenger features with `localStorage` persistence.
- **Dark / Light Theme Toggle**: Added light theme custom CSS variable overrides (`[data-theme="light"]`) in `style.css`, topbar sun/moon icon sync, and system theme persistence.
- **File Sharing Links**: Added "Copy Telegram Link" and "Share to Telegram Chat" right-click options for instant channel file sharing.
- **IndexedDB Thumbnail Cache**: Created `js/idb-cache.js` to store downloaded thumbnails in IndexedDB for instant grid rendering across page reloads.
- **Multi-Tab Conflict Detection**: Added `BroadcastChannel('tg_drive_sync')` to synchronize file database updates across concurrent browser tabs.
- **Resilient Error Handling & Network Recovery**: Wrapped database saves in `callWithRetry()` for FLOOD_WAIT protection and added online/offline network listeners with auto-reconnect.
- **Storage Analytics Dashboard & Detail Page**: Added dedicated Storage Analytics sidebar navigation item (`switchView('analytics')`), full detail page with metric cards (Storage Used, Total Files, Total Folders, Avg File Size), interactive category distribution bar, size filters (>10MB, >100MB, >500MB, >1GB), and interactive file management table.
- **Accessibility & SEO**: Added skip-to-content link, `aria-live="polite"` on toasts, ARIA dialog roles across all modals, Open Graph, Twitter Cards, and WebApplication JSON-LD schema.

---

## [2026-07-30 12:17 AM IST]

### Fixed
- **Sidebar & View Navigation (`switchView`)**:
  - Fixed issue where clicking sidebar items on desktop browsers would fail to navigate by preventing default link actions (`window.event.preventDefault()`).
  - Mobile sidebar auto-closes when a view is selected on mobile screens ($\le$ 768px).
  - Unified view routing for **Images**, **Videos**, **Audio**, and **Documents** to pass through `loadFiles()`, resolving missing file counts, grid layouts, sorting, and breadcrumbs.
- **`file://` Protocol Compatibility**:
  - Safe-wrapped all `history.pushState()` and `history.replaceState()` calls in `try/catch` blocks to prevent `SecurityError` exceptions on local `file://` contexts from blocking SPA view changes.
- **Telegram Messenger Dialog Loading (`js/messenger.js`)**:
  - Fixed `CastError` when loading dialogs by ensuring `offsetDate` parameter is omitted when `dialogsOffset` is `null`/`undefined`.
- **Asset Paths (`index.html`)**:
  - Updated favicon `<link>` tags to use absolute paths (`/favicon.png`).

---

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
