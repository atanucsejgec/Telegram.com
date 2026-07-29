// ============================================================
//  MESSENGER — Chats & Channels Module
//  Provides a two-panel messaging interface inside Telegram Drive.
//  Requires a User Phone session (not bot).
// ============================================================
import { Api } from "telegram";

// ── State ──
let messengerOpen = false;
let dialogsList = [];
let dialogsOffset = null;
let dialogsHasMore = true;
let dialogsLoading = false;
let dialogSearch = "";

// Search state
let searchMode = null;       // null | "file" | "link"
let searchResults = [];       // normalized search result entries
let searchLoading = false;
let searchTimeout = null;

let activeDialog = null;   // { peer, title, type, entity }
let chatMessages = [];
let chatOffsetId = 0;
let chatHasMore = true;
let chatLoading = false;
let mySelfId = null;
let highlightMsgId = null;  // message ID to highlight after rendering

// ── Helpers (reuse from app.js via window) ──
const el  = (id) => document.getElementById(id);
const esc = (s) => window._msgEsc ? window._msgEsc(s) : (s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function fmtBytes(b) {
  if (!b) return "0 B";
  const k = 1024, s = ["B","KB","MB","GB","TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

function fmtMsgTime(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtMsgDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  const now = new Date();
  const diff = Math.floor((now - dt) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: dt.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function fmtDialogTime(d) {
  if (!d) return "";
  const dt = new Date(d);
  const now = new Date();
  const diff = Math.floor((now - dt) / 864e5);
  if (diff === 0) return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Yesterday";
  if (diff < 7) return dt.toLocaleDateString("en-US", { weekday: "short" });
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fileIconClass(mime, name) {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "fas fa-image";
  if (m.startsWith("video/")) return "fas fa-video";
  if (m.startsWith("audio/")) return "fas fa-music";
  if (m.includes("pdf")) return "fas fa-file-pdf";
  if (m.includes("zip") || m.includes("rar") || m.includes("archive")) return "fas fa-file-archive";
  if (m.includes("text") || m.includes("json") || m.includes("javascript")) return "fas fa-file-code";
  if (name) {
    const ext = name.split(".").pop().toLowerCase();
    if (["jpg","jpeg","png","gif","webp","svg","bmp"].includes(ext)) return "fas fa-image";
    if (["mp4","mkv","avi","mov","webm"].includes(ext)) return "fas fa-video";
    if (["mp3","wav","flac","aac","ogg","m4a"].includes(ext)) return "fas fa-music";
    if (ext === "pdf") return "fas fa-file-pdf";
  }
  return "fas fa-file";
}

function toast(msg, type) {
  if (window._msgToast) window._msgToast(msg, type);
  else console.log(`[${type}] ${msg}`);
}

function getClient() {
  return window.tgClient;
}

// ── Open / Close Messenger ──
function openMessenger() {
  const screen = el("messenger-screen");
  if (!screen) return;
  messengerOpen = true;

  // Hide the drive content area, show messenger
  const driveContent = el("content-area");
  const selBar = el("selection-bar");
  const dropZone = el("drop-zone");
  if (driveContent) driveContent.style.display = "none";
  if (selBar) selBar.classList.add("hidden");
  if (dropZone) dropZone.style.display = "none";

  screen.classList.add("active");

  // Get self ID for outgoing message detection
  const client = getClient();
  if (client) {
    client.getMe().then(me => { mySelfId = me.id; }).catch(() => {});
  }

  // Load dialogs if empty
  if (dialogsList.length === 0) {
    loadDialogs(true);
  } else {
    renderDialogs();
  }
}

function closeMessenger() {
  const screen = el("messenger-screen");
  if (!screen) return;
  messengerOpen = false;
  screen.classList.remove("active");
  screen.classList.remove("chat-open");

  // Restore drive content area
  const driveContent = el("content-area");
  const dropZone = el("drop-zone");
  if (driveContent) driveContent.style.display = "";
  if (dropZone) dropZone.style.display = "";
}

// ── Load Dialogs ──
async function loadDialogs(reset = true) {
  const client = getClient();
  if (!client) return toast("Not connected to Telegram", "error");
  if (dialogsLoading) return;

  if (reset) {
    dialogsList = [];
    dialogsOffset = null;
    dialogsHasMore = true;
  }

  dialogsLoading = true;
  const listEl = el("messenger-dialog-list");
  if (reset && listEl) {
    listEl.innerHTML = `<div class="dialogs-loading"><div class="spinner"></div> Loading chats...</div>`;
  }

  try {
    const result = await client.getDialogs({
      limit: 40,
      offsetDate: dialogsOffset,
    });

    if (!result || result.length === 0) {
      dialogsHasMore = false;
    } else {
      for (const dlg of result) {
        // Avoid duplicates
        const existingIdx = dialogsList.findIndex(d => d._id === getDialogId(dlg));
        if (existingIdx >= 0) continue;

        dialogsList.push(normalizeDialog(dlg));
      }
      // Offset for next page = date of last dialog
      const last = result[result.length - 1];
      if (last?.date) {
        dialogsOffset = last.date;
      }
      if (result.length < 40) dialogsHasMore = false;
    }
  } catch (e) {
    console.error("Failed to load dialogs:", e);
    toast("Failed to load chats: " + (e.message || e), "error");
    dialogsHasMore = false;
  }
  dialogsLoading = false;
  renderDialogs();
}

function getDialogId(dlg) {
  try {
    if (dlg.id) return dlg.id.toString();
    if (dlg.entity?.id) return dlg.entity.id.toString();
    return Math.random().toString();
  } catch { return Math.random().toString(); }
}

function normalizeDialog(dlg) {
  let title = dlg.title || dlg.name || "";
  let type = "user";
  let unreadCount = dlg.unreadCount || 0;
  let lastMessage = "";
  let lastDate = null;
  let peerId = null;

  try {
    const entity = dlg.entity;
    if (entity) {
      peerId = entity.id;
      if (entity.className === "Channel") {
        type = entity.megagroup ? "group" : "channel";
        title = title || entity.title || "Channel";
      } else if (entity.className === "Chat") {
        type = "group";
        title = title || entity.title || "Group";
      } else if (entity.className === "User") {
        type = "user";
        if (entity.self) {
          title = "Saved Messages";
          type = "saved";
        } else {
          title = title || [entity.firstName, entity.lastName].filter(Boolean).join(" ") || "User";
        }
      }
    }
  } catch {}

  try {
    if (dlg.message) {
      lastDate = dlg.message.date ? new Date(dlg.message.date * 1000) : null;
      const msg = dlg.message;
      if (msg.message) {
        lastMessage = msg.message.substring(0, 80);
      } else if (msg.media) {
        if (msg.media.document) lastMessage = "📎 File";
        else if (msg.media.photo) lastMessage = "📷 Photo";
        else lastMessage = "📎 Media";
      }
    }
  } catch {}

  return {
    _id: getDialogId(dlg),
    title,
    type,
    unreadCount,
    lastMessage,
    lastDate,
    peerId,
    entity: dlg.entity,
    dialog: dlg.dialog,
    inputEntity: dlg.inputEntity,
  };
}

// ── Render Dialogs ──
function renderDialogs() {
  const listEl = el("messenger-dialog-list");
  if (!listEl) return;

  let filtered = dialogsList;
  if (dialogSearch) {
    const q = dialogSearch.toLowerCase();
    filtered = dialogsList.filter(d => d.title.toLowerCase().includes(q));
  }

  if (filtered.length === 0 && !dialogsHasMore) {
    listEl.innerHTML = `<div class="dialogs-empty"><i class="fas fa-comments"></i> ${dialogSearch ? "No matching chats" : "No chats found"}</div>`;
    return;
  }

  let html = filtered.map((d, i) => {
    const initials = getInitials(d.title);
    const isActive = activeDialog && activeDialog._id === d._id;
    const unread = d.unreadCount > 0 ? `<span class="dialog-unread">${d.unreadCount > 99 ? "99+" : d.unreadCount}</span>` : "";
    const timeStr = d.lastDate ? fmtDialogTime(d.lastDate) : "";

    return `<div class="dialog-item${isActive ? " active" : ""}" data-idx="${i}" onclick="window.msgSelectDialog(${i})">
      <div class="dialog-avatar type-${d.type}">
        ${initials}
        ${d.type === "channel" ? '<span class="type-icon"><i class="fas fa-bullhorn"></i></span>' : ""}
        ${d.type === "group" ? '<span class="type-icon"><i class="fas fa-users"></i></span>' : ""}
        ${d.type === "saved" ? '<span class="type-icon"><i class="fas fa-bookmark"></i></span>' : ""}
      </div>
      <div class="dialog-body">
        <div class="dialog-top">
          <span class="dialog-name">${esc(d.title)}</span>
          <span class="dialog-time">${timeStr}</span>
        </div>
        <div class="dialog-bottom">
          <span class="dialog-preview">${esc(d.lastMessage)}</span>
          ${unread}
        </div>
      </div>
    </div>`;
  }).join("");

  if (dialogsHasMore) {
    html += `<div class="dialog-load-more" onclick="window.msgLoadMoreDialogs()"><i class="fas fa-chevron-down"></i> Load more</div>`;
  }

  listEl.innerHTML = html;
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return esc(parts[0].charAt(0));
  return esc(parts[0].charAt(0) + parts[parts.length - 1].charAt(0));
}

// ── Select Dialog ──
async function selectDialog(idx) {
  const filtered = dialogSearch
    ? dialogsList.filter(d => d.title.toLowerCase().includes(dialogSearch.toLowerCase()))
    : dialogsList;
  const dlg = filtered[idx];
  if (!dlg) return;

  activeDialog = dlg;
  chatMessages = [];
  chatOffsetId = 0;
  chatHasMore = true;

  // Show chat on mobile
  const screen = el("messenger-screen");
  if (screen) {
    screen.classList.add("chat-open");
    if (window.innerWidth <= 768 && !window.isHandlingPopState) {
      history.pushState({ view: "messenger", chatOpen: true, dialogId: dlg._id }, "");
    }
  }

  renderDialogs(); // update active highlight
  renderChatHeader();
  renderChatMessages(); // show loading
  await loadChatMessages(true);
}

// ── Chat Header ──
function renderChatHeader() {
  const nameEl = el("msg-chat-name");
  const statusEl = el("msg-chat-status");
  if (!activeDialog) return;

  if (nameEl) nameEl.textContent = activeDialog.title;
  if (statusEl) {
    const typeLabels = { user: "Private Chat", group: "Group", channel: "Channel", saved: "Saved Messages" };
    statusEl.textContent = typeLabels[activeDialog.type] || "Chat";
  }
}

// ── Load Messages ──
async function loadChatMessages(reset = true) {
  const client = getClient();
  if (!client || !activeDialog) return;
  if (chatLoading) return;

  chatLoading = true;
  const container = el("msg-chat-messages");

  if (reset) {
    chatMessages = [];
    chatOffsetId = 0;
    chatHasMore = true;
    if (container) container.innerHTML = `<div class="chat-loading"><div class="spinner"></div> Loading messages...</div>`;
  }

  try {
    const peer = activeDialog.inputEntity || activeDialog.entity;
    const opts = { limit: 50 };
    if (chatOffsetId) opts.offsetId = chatOffsetId;

    const messages = await client.getMessages(peer, opts);

    if (!messages || messages.length === 0) {
      chatHasMore = false;
    } else {
      for (const msg of messages) {
        if (!chatMessages.some(m => m.id === msg.id)) {
          chatMessages.push(msg);
        }
      }
      chatOffsetId = messages[messages.length - 1].id;
      if (messages.length < 50) chatHasMore = false;
    }
  } catch (e) {
    console.error("Failed to load messages:", e);
    toast("Failed to load messages: " + (e.message || e), "error");
    chatHasMore = false;
  }

  chatLoading = false;
  renderChatMessages();

  // Scroll to bottom on first load
  if (reset && container) {
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }
}

// Load messages centered around a specific message ID
async function loadChatMessagesAround(targetMsgId) {
  const client = getClient();
  if (!client || !activeDialog) return;
  if (chatLoading) return;

  chatLoading = true;
  const container = el("msg-chat-messages");
  chatMessages = [];
  chatHasMore = true;

  if (container) container.innerHTML = `<div class="chat-loading"><div class="spinner"></div> Jumping to message...</div>`;

  try {
    const peer = activeDialog.inputEntity || activeDialog.entity;

    // Fetch messages BEFORE the target (older) — offsetId = targetMsgId+1 gets messages <= targetMsgId
    const olderMsgs = await client.getMessages(peer, {
      limit: 25,
      offsetId: targetMsgId + 1,
    });

    // Fetch messages AFTER the target (newer) — use minId = targetMsgId-1 with reverse
    // GramJS: offsetId=0, minId=targetMsgId-1 gets messages with id > targetMsgId-1 (i.e. >= targetMsgId)
    const newerMsgs = await client.getMessages(peer, {
      limit: 25,
      minId: targetMsgId - 1,
    });

    // Merge and deduplicate
    const allMsgs = [...(olderMsgs || []), ...(newerMsgs || [])];
    const seenIds = new Set();
    for (const msg of allMsgs) {
      if (msg && !seenIds.has(msg.id)) {
        seenIds.add(msg.id);
        chatMessages.push(msg);
      }
    }

    // Set offset for "load older" pagination
    const sorted = chatMessages.sort((a, b) => a.id - b.id);
    if (sorted.length > 0) {
      chatOffsetId = sorted[0].id;
    }
    chatHasMore = sorted.length > 0 && sorted[0].id > 1;

  } catch (e) {
    console.error("Failed to load messages around target:", e);
    toast("Failed to jump to message: " + (e.message || e), "error");
    chatHasMore = false;
  }

  chatLoading = false;

  // Set the highlight before rendering
  highlightMsgId = targetMsgId;
  renderChatMessages();

  // Scroll to the target message
  requestAnimationFrame(() => {
    const targetEl = container?.querySelector(`[data-msg-id="${targetMsgId}"]`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (container) {
      container.scrollTop = container.scrollHeight;
    }
    // Clear highlight after animation
    setTimeout(() => { highlightMsgId = null; }, 3000);
  });
}

// ── Render Messages ──
function renderChatMessages() {
  const container = el("msg-chat-messages");
  if (!container) return;

  if (chatMessages.length === 0 && !chatHasMore) {
    container.innerHTML = `<div class="chat-empty-state"><i class="fas fa-comments"></i><p>No messages yet. Start the conversation!</p></div>`;
    return;
  }

  if (chatMessages.length === 0) {
    container.innerHTML = `<div class="chat-loading"><div class="spinner"></div> Loading messages...</div>`;
    return;
  }

  // Sort oldest-first for display
  const sorted = [...chatMessages].sort((a, b) => a.id - b.id);

  let html = "";

  if (chatHasMore) {
    html += `<div class="chat-load-more" onclick="window.msgLoadMoreMessages()"><i class="fas fa-chevron-up"></i> Load older messages</div>`;
  }

  let lastDateStr = "";
  for (const msg of sorted) {
    // Date separator
    const msgDate = msg.date ? new Date(msg.date * 1000) : null;
    const dateStr = msgDate ? fmtMsgDate(msgDate) : "";
    if (dateStr && dateStr !== lastDateStr) {
      html += `<div class="msg-date-sep"><span>${dateStr}</span></div>`;
      lastDateStr = dateStr;
    }

    html += renderSingleMessage(msg);
  }

  container.innerHTML = html;
}

function renderSingleMessage(msg) {
  if (!msg) return "";

  // Determine outgoing vs incoming
  const fromId = msg.fromId?.userId || msg.peerId?.userId;
  const isOutgoing = msg.out || (mySelfId && fromId && BigInt(fromId) === BigInt(mySelfId));
  const direction = isOutgoing ? "outgoing" : "incoming";

  // Sender name (for groups)
  let senderHtml = "";
  if (!isOutgoing && activeDialog && (activeDialog.type === "group" || activeDialog.type === "channel")) {
    let senderName = "";
    if (msg._sender) {
      senderName = [msg._sender.firstName, msg._sender.lastName].filter(Boolean).join(" ") || msg._sender.title || "";
    }
    if (senderName) {
      senderHtml = `<div class="msg-sender">${esc(senderName)}</div>`;
    }
  }

  // Time
  const time = msg.date ? fmtMsgTime(new Date(msg.date * 1000)) : "";

  // Message text
  let textHtml = "";
  if (msg.message) {
    // Linkify URLs
    const linked = esc(msg.message).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$1</a>'
    );
    textHtml = `<div>${linked}</div>`;
  }

  // Media / File attachment
  let mediaHtml = "";
  if (msg.media) {
    if (msg.media.photo) {
      mediaHtml = `<div class="msg-file-card" onclick="window.msgDownloadMedia(${msg.id})" title="Click to download photo">
        <div class="msg-file-icon"><i class="fas fa-image"></i></div>
        <div class="msg-file-info">
          <div class="msg-file-name">Photo</div>
          <div class="msg-file-size">Click to download</div>
        </div>
        <button class="msg-file-dl" onclick="event.stopPropagation();window.msgDownloadMedia(${msg.id})"><i class="fas fa-download"></i></button>
      </div>`;
    } else if (msg.media.document) {
      const doc = msg.media.document;
      const nameAttr = doc.attributes?.find(a => a.fileName);
      const fileName = nameAttr?.fileName || "File";
      const fileSize = Number(doc.size) || 0;
      const mime = doc.mimeType || "";
      const icon = fileIconClass(mime, fileName);

      mediaHtml = `<div class="msg-file-card" onclick="window.msgDownloadMedia(${msg.id})" title="Click to download">
        <div class="msg-file-icon"><i class="${icon}"></i></div>
        <div class="msg-file-info">
          <div class="msg-file-name">${esc(fileName)}</div>
          <div class="msg-file-size">${fmtBytes(fileSize)}</div>
        </div>
        <button class="msg-file-dl" onclick="event.stopPropagation();window.msgDownloadMedia(${msg.id})"><i class="fas fa-download"></i></button>
      </div>`;
    } else if (msg.media.webpage) {
      // Ignore web page previews — the link is already in the text
    } else {
      mediaHtml = `<div class="msg-file-card" onclick="window.msgDownloadMedia(${msg.id})" title="Click to download">
        <div class="msg-file-icon"><i class="fas fa-paperclip"></i></div>
        <div class="msg-file-info">
          <div class="msg-file-name">Media</div>
          <div class="msg-file-size">Click to download</div>
        </div>
        <button class="msg-file-dl" onclick="event.stopPropagation();window.msgDownloadMedia(${msg.id})"><i class="fas fa-download"></i></button>
      </div>`;
    }
  }

  // Service messages (user joined, etc.)
  if (!msg.message && !msg.media && msg.action) {
    let actionText = "System message";
    try {
      if (msg.action.className === "MessageActionChatAddUser") actionText = "User joined the group";
      else if (msg.action.className === "MessageActionChatDeleteUser") actionText = "User left the group";
      else if (msg.action.className === "MessageActionChatEditTitle") actionText = "Group title changed";
      else if (msg.action.className === "MessageActionChatEditPhoto") actionText = "Group photo updated";
      else if (msg.action.className === "MessageActionPinMessage") actionText = "Message pinned";
      else if (msg.action.className === "MessageActionChatCreate") actionText = "Group created";
      else if (msg.action.className === "MessageActionChannelCreate") actionText = "Channel created";
    } catch {}
    return `<div class="msg-date-sep"><span>${esc(actionText)}</span></div>`;
  }

  // Skip empty
  if (!textHtml && !mediaHtml) return "";

  const highlightClass = (highlightMsgId && msg.id === highlightMsgId) ? " msg-highlight" : "";

  return `<div class="msg-row ${direction}${highlightClass}" data-msg-id="${msg.id}">
    ${senderHtml}
    <div class="msg-bubble">
      ${textHtml}
      ${mediaHtml}
    </div>
    <span class="msg-time">${time}</span>
  </div>`;
}

// ── Send Message ──
async function sendMessage() {
  const client = getClient();
  if (!client || !activeDialog) return;

  const input = el("msg-chat-input");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  const sendBtn = el("msg-send-btn");
  if (sendBtn) sendBtn.disabled = true;
  input.value = "";
  autoResizeInput(input);

  try {
    const peer = activeDialog.inputEntity || activeDialog.entity;
    const result = await client.sendMessage(peer, { message: text });

    // Add to local messages
    chatMessages.push(result);
    renderChatMessages();

    // Scroll to bottom
    const container = el("msg-chat-messages");
    if (container) {
      requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    }

    // Update dialog preview
    const dlg = dialogsList.find(d => d._id === activeDialog._id);
    if (dlg) {
      dlg.lastMessage = text.substring(0, 80);
      dlg.lastDate = new Date();
      renderDialogs();
    }
  } catch (e) {
    console.error("Send message failed:", e);
    toast("Failed to send message: " + (e.message || e), "error");
    // Put the text back
    input.value = text;
  }

  if (sendBtn) sendBtn.disabled = false;
  input.focus();
}

// ── Download Media ──
async function downloadMedia(msgId) {
  const client = getClient();
  if (!client || !activeDialog) return;

  const peer = activeDialog.inputEntity || activeDialog.entity;

  try {
    const msgs = await client.getMessages(peer, { ids: [msgId] });
    if (!msgs?.[0]) throw new Error("Message not found");
    const msg = msgs[0];

    // Determine file name
    let fileName = "download";
    if (msg.media?.document) {
      const nameAttr = msg.media.document.attributes?.find(a => a.fileName);
      fileName = nameAttr?.fileName || `file_${msgId}`;
    } else if (msg.media?.photo) {
      fileName = `photo_${msgId}.jpg`;
    }

    await performDownloadMedia(client, msg, fileName);
  } catch (e) {
    console.error("Download failed:", e);
    toast("Download failed: " + (e.message || e), "error");
  }
}

// ── Shared Download Logic for Messenger ──
async function performDownloadMedia(client, msg, fileName) {
  // Determine mime and size for SW stream
  let mime = "application/octet-stream";
  let size = 0;
  if (msg.media?.document) {
    mime = msg.media.document.mimeType || mime;
    size = Number(msg.media.document.size || 0);
  } else if (msg.media?.photo) {
    mime = "image/jpeg";
  }

  // 1. Direct-to-Disk Streaming (Desktop Chrome/Edge/Opera)
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: fileName });
      const writable = await handle.createWritable();
      
      toast(`Downloading "${fileName}"... (Streaming direct to disk)`, "info");
      
      await window.fastStreamDownload(client, window.tgApi, msg, writable, fileName);
      
      await writable.close();
      
      toast(`"${fileName}" downloaded successfully`, "success");
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error("Stream download failed:", e);
      toast("Stream download failed, trying alternative...", "warning");
    }
  }

  // 2. Service Worker Streaming (Mobile Chrome/Safari/Firefox)
  if (window.swStreamDownload && navigator.serviceWorker?.controller) {
    try {
      toast(`Downloading "${fileName}"... (Streaming via Service Worker)`, "info");
      
      await window.swStreamDownload(client, window.tgApi, msg, fileName, mime, size);
      
      toast(`"${fileName}" download started`, "success");
      return;
    } catch (e) {
      console.error("SW stream download failed:", e);
      toast("Stream download failed, falling back to memory...", "warning");
    }
  }

  // 3. Fallback: Download to Memory (legacy browsers)
  if (size > 500 * 1024 * 1024) {
    toast("Warning: Large file will be loaded into memory. Tab may freeze.", "warning");
  }
  toast(`Downloading "${fileName}" to memory...`, "info");
  
  const buffer = await client.downloadMedia(msg, {});
  if (!buffer) throw new Error("Download failed");

  const rawUint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const blob = new Blob([rawUint8], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);

  toast(`"${fileName}" downloaded`, "success");
}

// ── Chat Back (mobile) ──
function chatBack() {
  const screen = el("messenger-screen");
  if (screen) screen.classList.remove("chat-open");
  activeDialog = null;
  renderDialogs();
}

// ── Load More ──
async function loadMoreDialogs() {
  if (dialogsLoading) return;
  await loadDialogs(false);
}

async function loadMoreMessages() {
  if (chatLoading) return;
  const container = el("msg-chat-messages");
  const prevHeight = container ? container.scrollHeight : 0;

  await loadChatMessages(false);

  // Keep scroll position after prepending older messages
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight - prevHeight;
    });
  }
}

// ── Search System ──
// Detects: (1) t.me link → fetch specific message  (2) text query → global file search  (3) short text → local dialog filter

const TG_LINK_RE = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([\w.]+)\/(\d+)/i;

function detectSearchMode(value) {
  if (!value || !value.trim()) return null;
  if (TG_LINK_RE.test(value.trim())) return "link";
  if (value.trim().length >= 3) return "file";
  return null;
}

function handleDialogSearch(value) {
  const query = value || "";
  dialogSearch = query;
  clearTimeout(searchTimeout);

  const clearBtn = el("msg-search-clear");
  const hint = el("msg-search-hint");
  const resultsPanel = el("msg-search-results");
  const dialogList = el("messenger-dialog-list");

  // Show/hide clear button
  if (clearBtn) clearBtn.classList.toggle("hidden", !query);

  if (!query.trim()) {
    // Reset: show dialogs, hide search results
    searchMode = null;
    searchResults = [];
    if (hint) { hint.classList.add("hidden"); hint.className = "msg-search-hint hidden"; }
    if (resultsPanel) resultsPanel.classList.add("hidden");
    if (dialogList) dialogList.style.display = "";
    renderDialogs();
    return;
  }

  const mode = detectSearchMode(query);
  searchMode = mode;

  // Update hint
  if (hint) {
    if (mode === "link") {
      hint.className = "msg-search-hint mode-link";
      hint.innerHTML = '<i class="fas fa-link"></i> Telegram link detected — press Enter or wait';
      hint.classList.remove("hidden");
    } else if (mode === "file") {
      hint.className = "msg-search-hint mode-file";
      hint.innerHTML = '<i class="fas fa-file-search"></i> Searching files across all chats...';
      hint.classList.remove("hidden");
    } else {
      hint.classList.add("hidden");
    }
  }

  if (mode === "link") {
    // For links, execute immediately or on debounce
    searchTimeout = setTimeout(() => executeSearch(query), 400);
  } else if (mode === "file") {
    // Debounce file search
    searchTimeout = setTimeout(() => executeSearch(query), 500);
  } else {
    // Short text: filter dialogs locally
    if (resultsPanel) resultsPanel.classList.add("hidden");
    if (dialogList) dialogList.style.display = "";
    renderDialogs();
  }
}

async function executeSearch(query) {
  const client = getClient();
  if (!client) return;

  const resultsPanel = el("msg-search-results");
  const dialogList = el("messenger-dialog-list");

  searchLoading = true;
  searchResults = [];

  // Show results panel, hide dialog list
  if (resultsPanel) {
    resultsPanel.classList.remove("hidden");
    resultsPanel.innerHTML = '<div class="search-result-loading"><div class="spinner"></div> Searching...</div>';
  }
  if (dialogList) dialogList.style.display = "none";

  try {
    if (searchMode === "link") {
      await searchByLink(query);
    } else {
      await searchGlobalFiles(query);
    }
  } catch (e) {
    console.error("Search failed:", e);
    searchResults = [];
  }

  searchLoading = false;
  renderSearchResults();
}

// ── Search by t.me Link ──
async function searchByLink(query) {
  const client = getClient();
  const match = query.trim().match(TG_LINK_RE);
  if (!match) throw new Error("Invalid link");

  const channelUsername = match[1];
  const messageId = parseInt(match[2]);

  // Resolve the channel/chat entity
  let peer;
  try {
    peer = await client.getEntity(channelUsername);
  } catch (e) {
    console.error("Could not resolve entity:", e);
    searchResults = [{ _error: true, text: `Could not find channel "@${channelUsername}". Make sure the channel exists and is accessible.` }];
    return;
  }

  // Fetch the specific message
  try {
    const msgs = await client.getMessages(peer, { ids: [messageId] });
    if (!msgs || !msgs[0]) {
      searchResults = [{ _error: true, text: `Message #${messageId} not found in @${channelUsername}.` }];
      return;
    }
    const msg = msgs[0];
    searchResults = [normalizeSearchResult(msg, peer)];
  } catch (e) {
    console.error("Could not fetch message:", e);
    searchResults = [{ _error: true, text: `Failed to fetch message: ${e.message || e}` }];
  }
}

// ── Global File Search ──
async function searchGlobalFiles(query) {
  const client = getClient();
  const q = query.trim();

  try {
    // Use messages.SearchGlobal to search across all chats
    const result = await client.invoke(new Api.messages.SearchGlobal({
      q: q,
      filter: new Api.InputMessagesFilterDocument(),
      minDate: 0,
      maxDate: 0,
      offsetRate: 0,
      offsetPeer: new Api.InputPeerEmpty(),
      offsetId: 0,
      limit: 30,
    }));

    if (result && result.messages) {
      // Build a peer map from the chats and users returned
      const peerMap = new Map();
      for (const chat of (result.chats || [])) {
        peerMap.set(chat.id?.toString(), chat);
      }
      for (const user of (result.users || [])) {
        peerMap.set(user.id?.toString(), user);
      }

      for (const msg of result.messages) {
        if (!msg || msg.className === "MessageEmpty") continue;
        // Resolve the chat entity for this message
        let chatEntity = null;
        const peerId = msg.peerId;
        if (peerId) {
          const id = peerId.channelId || peerId.chatId || peerId.userId;
          if (id) chatEntity = peerMap.get(id.toString());
        }
        searchResults.push(normalizeSearchResult(msg, chatEntity));
      }
    }
  } catch (e) {
    console.error("Global search failed:", e);
    // Fallback: try searching in individual dialogs
    searchResults = [{ _error: true, text: `Search failed: ${e.message || e}` }];
  }
}

// ── Normalize Search Result ──
function normalizeSearchResult(msg, chatEntity) {
  let fileName = "", fileSize = 0, mime = "", type = "file";
  let hasMedia = false;

  if (msg.media?.document) {
    hasMedia = true;
    const doc = msg.media.document;
    const nameAttr = doc.attributes?.find(a => a.fileName);
    fileName = nameAttr?.fileName || `file_${msg.id}`;
    fileSize = Number(doc.size) || 0;
    mime = doc.mimeType || "";
    type = getFileType(mime, fileName);
  } else if (msg.media?.photo) {
    hasMedia = true;
    fileName = `photo_${msg.id}.jpg`;
    mime = "image/jpeg";
    type = "image";
    for (const s of (msg.media.photo.sizes || [])) {
      if (typeof s.size === "number") fileSize = Math.max(fileSize, s.size);
    }
  }

  // Chat name
  let chatName = "";
  if (chatEntity) {
    chatName = chatEntity.title || [chatEntity.firstName, chatEntity.lastName].filter(Boolean).join(" ") || "Chat";
  }

  // Message text
  const text = msg.message || "";

  return {
    msgId: msg.id,
    fileName: fileName || (text.substring(0, 40) || "Message"),
    fileSize,
    mime,
    type,
    hasMedia,
    text,
    chatName,
    chatEntity,
    date: msg.date ? new Date(msg.date * 1000) : null,
    raw: msg,
  };
}

function getFileType(mime, name) {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.includes("pdf")) return "pdf";
  if (m.includes("zip") || m.includes("archive")) return "archive";
  return "file";
}

// ── Render Search Results ──
function renderSearchResults() {
  const panel = el("msg-search-results");
  if (!panel) return;

  if (searchResults.length === 0) {
    panel.innerHTML = `<div class="search-result-empty"><i class="fas fa-search"></i><span>No results found</span></div>`;
    return;
  }

  // Check for error entries
  if (searchResults.length === 1 && searchResults[0]._error) {
    panel.innerHTML = `<div class="search-result-empty"><i class="fas fa-exclamation-circle"></i><span>${esc(searchResults[0].text)}</span></div>`;
    return;
  }

  const headerText = searchMode === "link" ? "Link Result" : `${searchResults.length} file${searchResults.length !== 1 ? "s" : ""} found`;

  let html = `<div class="search-results-header">${headerText}</div>`;

  html += searchResults.map((r, i) => {
    const icon = r.hasMedia ? fileIconClass(r.mime, r.fileName) : "fas fa-comment";
    const iconClass = searchMode === "link" ? "search-result-icon icon-link" : "search-result-icon";
    const sizeStr = r.fileSize ? fmtBytes(r.fileSize) : "";
    const dateStr = r.date ? fmtDialogTime(r.date) : "";
    const meta = [sizeStr, dateStr].filter(Boolean).join(" · ");

    // For file results show a text preview if available
    let textPreview = "";
    if (r.text && r.text !== r.fileName) {
      textPreview = esc(r.text.substring(0, 60));
    }

    const chatLine = r.chatName ? `<div class="search-result-chat"><i class="fas fa-comments" style="font-size:9px;margin-right:3px"></i>${esc(r.chatName)}</div>` : "";

    const downloadBtn = r.hasMedia
      ? `<button onclick="event.stopPropagation();window.msgSearchDownload(${i})" title="Download"><i class="fas fa-download"></i></button>`
      : "";
    const openBtn = r.chatEntity
      ? `<button onclick="event.stopPropagation();window.msgSearchOpenChat(${i})" title="Open Chat"><i class="fas fa-external-link-alt"></i></button>`
      : "";

    return `<div class="search-result-item" onclick="window.msgSearchOpenChat(${i})">
      <div class="${iconClass}"><i class="${icon}"></i></div>
      <div class="search-result-body">
        <div class="search-result-name">${esc(r.fileName)}</div>
        ${meta ? `<div class="search-result-meta">${meta}</div>` : ""}
        ${textPreview ? `<div class="search-result-meta">${textPreview}</div>` : ""}
        ${chatLine}
      </div>
      <div class="search-result-actions">
        ${downloadBtn}
        ${openBtn}
      </div>
    </div>`;
  }).join("");

  panel.innerHTML = html;
}

// ── Search Actions ──
async function searchDownload(idx) {
  const r = searchResults[idx];
  if (!r || !r.hasMedia) return;

  const client = getClient();
  if (!client) return;

  try {
    // We need the peer to fetch the message
    let peer;
    if (r.chatEntity) {
      peer = r.chatEntity;
    } else {
      // Try from the raw message's peerId
      const peerId = r.raw?.peerId;
      const id = peerId?.channelId || peerId?.chatId || peerId?.userId;
      if (id) peer = await client.getEntity(id);
    }

    if (!peer) throw new Error("Could not resolve chat");

    const msgs = await client.getMessages(peer, { ids: [r.msgId] });
    if (!msgs?.[0]) throw new Error("Message not found");

    await performDownloadMedia(client, msgs[0], r.fileName);

  } catch (e) {
    console.error("Download failed:", e);
    toast("Download failed: " + (e.message || e), "error");
  }
}

async function searchOpenChat(idx) {
  const r = searchResults[idx];
  if (!r) return;

  const client = getClient();
  if (!client) return;

  let peer;
  if (r.chatEntity) {
    peer = r.chatEntity;
  } else {
    const peerId = r.raw?.peerId;
    const id = peerId?.channelId || peerId?.chatId || peerId?.userId;
    if (id) {
      try { peer = await client.getEntity(id); } catch {}
    }
  }

  if (!peer) {
    toast("Could not open this chat", "error");
    return;
  }

  // Create a synthetic dialog-like object and open it
  let title = peer.title || [peer.firstName, peer.lastName].filter(Boolean).join(" ") || "Chat";
  let type = "user";
  if (peer.className === "Channel") type = peer.megagroup ? "group" : "channel";
  else if (peer.className === "Chat") type = "group";
  else if (peer.self) type = "saved";

  activeDialog = {
    _id: peer.id?.toString() || Math.random().toString(),
    title,
    type,
    unreadCount: 0,
    lastMessage: "",
    lastDate: null,
    peerId: peer.id,
    entity: peer,
    inputEntity: peer,
  };

  chatMessages = [];
  chatOffsetId = 0;
  chatHasMore = true;

  // Save the target message ID before clearing search
  const targetMsgId = r.msgId;

  // Clear search and show chat
  clearSearch();

  const screen = el("messenger-screen");
  if (screen) screen.classList.add("chat-open");

  renderChatHeader();
  renderChatMessages();

  // Load messages around the target message and scroll to it
  if (targetMsgId) {
    await loadChatMessagesAround(targetMsgId);
  } else {
    await loadChatMessages(true);
  }
}

function clearSearch() {
  const input = el("msg-dialog-search");
  const clearBtn = el("msg-search-clear");
  const hint = el("msg-search-hint");
  const resultsPanel = el("msg-search-results");
  const dialogList = el("messenger-dialog-list");

  dialogSearch = "";
  searchMode = null;
  searchResults = [];
  clearTimeout(searchTimeout);

  if (input) input.value = "";
  if (clearBtn) clearBtn.classList.add("hidden");
  if (hint) { hint.classList.add("hidden"); hint.className = "msg-search-hint hidden"; }
  if (resultsPanel) { resultsPanel.classList.add("hidden"); resultsPanel.innerHTML = ""; }
  if (dialogList) dialogList.style.display = "";

  renderDialogs();
}

// ── Auto-Resize Textarea ──
function autoResizeInput(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
}

// ── Init (called from app.js when messenger view is opened) ──
function initMessengerEvents() {
  const input = el("msg-chat-input");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener("input", () => autoResizeInput(input));
  }

  const searchInput = el("msg-dialog-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => handleDialogSearch(e.target.value));
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (query && detectSearchMode(query)) {
          executeSearch(query);
        }
      }
      if (e.key === "Escape") {
        clearSearch();
      }
    });
  }
}

// Run init when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  // Delay slightly to ensure HTML is injected
  setTimeout(initMessengerEvents, 100);
});

// ── Expose to Window ──
window.openMessenger = openMessenger;
window.closeMessenger = closeMessenger;
window.msgSelectDialog = selectDialog;
window.msgLoadMoreDialogs = loadMoreDialogs;
window.msgLoadMoreMessages = loadMoreMessages;
window.msgSendMessage = sendMessage;
window.msgDownloadMedia = downloadMedia;
window.msgChatBack = chatBack;
window.chatBack = chatBack;
window.msgHandleDialogSearch = handleDialogSearch;
window.msgClearSearch = clearSearch;
window.msgSearchDownload = searchDownload;
window.msgSearchOpenChat = searchOpenChat;
