import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { CustomFile } from "telegram/client/uploads";
import { computeCheck } from "telegram/Password";
import { Buffer } from "buffer";

let client = null;
let targetPeer = "me";
let currentUser = null;
let currentFolder = "root";
let currentView = "files";
let viewMode = "grid";
let selectedItems = new Set();
let sortBy = "name";
let sortOrder = "asc";
let currentFiles = [];
let currentFolders = [];
let allFiles = [];

let fileDatabase = {
  files: [],
  folders: [
    { id: "root", name: "My Drive", parentId: null, createdDate: new Date().toISOString(), color: "#0088cc" }
  ]
};
let dbMessageId = null;

const FOLDER_COLORS = ["#ffab00","#ff4466","#e91e63","#9c27b0","#673ab7","#3f51b5","#2196f3","#0088cc","#009688","#00d68f","#8bc34a","#ff9800","#795548","#607d8b"];
let selectedFolderColor = "#ffab00";

let searchTimeout = null;
let dragCounter = 0;
let confirmResolve = null;
let renameTarget = null;
let moveTargetId = "root";
let moveItems = [];
let previewFileId = null;
let previewIndex = -1;
let previewableFiles = [];

const objectUrlCache = new Map();
const fetchingPromises = new Map();

// ==================== INIT ====================
document.addEventListener("DOMContentLoaded", () => {
  addLoadingParticles();
  initCredentialsUI();
  checkAuth();
  setupDragDrop();
  setupKeys();
  setupRipples();
  document.addEventListener("click", e => {
    if (!document.getElementById("context-menu").contains(e.target)) hideContext();
  });
});

// ==================== API CREDENTIALS HELPERS ====================
function getApiCredentials() {
  const envId = import.meta.env.VITE_TELEGRAM_API_ID;
  const envHash = import.meta.env.VITE_TELEGRAM_API_HASH;
  
  if (envId && envHash) {
    return { apiId: parseInt(envId), apiHash: envHash, preconfigured: true };
  }
  
  const localId = localStorage.getItem("tgDriveApiId");
  const localHash = localStorage.getItem("tgDriveApiHash");
  return { apiId: localId ? parseInt(localId) : null, apiHash: localHash, preconfigured: false };
}

function initCredentialsUI() {
  const creds = getApiCredentials();
  if (creds.preconfigured) {
    hide("api-credentials-group");
  } else {
    show("api-credentials-group");
    if (creds.apiId) el("api-id-input").value = creds.apiId;
    if (creds.apiHash) el("api-hash-input").value = creds.apiHash;
  }
  
  const savedBotToken = localStorage.getItem("tgDriveBotToken");
  const savedChannelId = localStorage.getItem("tgDriveChannelId");
  if (savedBotToken) el("bot-token-input").value = savedBotToken;
  if (savedChannelId) el("channel-id-input").value = savedChannelId;
}

function setLoginMethod(method) {
  const tabUser = document.getElementById("tab-user");
  const tabBot = document.getElementById("tab-bot");
  const userFields = document.getElementById("user-login-fields");
  const botFields = document.getElementById("bot-login-fields");
  
  if (method === "user") {
    tabUser.classList.add("active");
    tabBot.classList.remove("active");
    userFields.style.display = "flex";
    botFields.style.display = "none";
  } else {
    tabUser.classList.remove("active");
    tabBot.classList.add("active");
    userFields.style.display = "none";
    botFields.style.display = "flex";
  }
}

function parseChannelId(id) {
  if (!id) return null;
  const clean = id.trim();
  if (/^-?\d+$/.test(clean)) {
    try {
      return BigInt(clean);
    } catch (e) {
      return clean;
    }
  }
  return clean;
}

async function resolveTargetPeer() {
  const sessionType = localStorage.getItem("tgDriveSessionType") || "user";
  if (sessionType === "bot") {
    const channelId = localStorage.getItem("tgDriveChannelId");
    if (channelId) {
      try {
        const parsedId = parseChannelId(channelId);
        targetPeer = await client.getEntity(parsedId);
        console.log("Resolved target channel peer:", targetPeer);
        return;
      } catch (e) {
        console.error("Could not resolve target channel peer:", e);
        toast("Could not access storage channel", "error");
      }
    }
  }
  targetPeer = "me";
}

async function loginAsBot() {
  const botToken = el("bot-token-input").value.trim();
  const channelId = el("channel-id-input").value.trim();
  if (!botToken || !channelId) {
    return showErr("Bot Token and Channel ID are required");
  }
  
  const creds = getApiCredentials();
  let apiId = creds.apiId;
  let apiHash = creds.apiHash;
  
  if (!creds.preconfigured) {
    const idInput = el("api-id-input").value.trim();
    const hashInput = el("api-hash-input").value.trim();
    if (!idInput || !hashInput) {
      return showErr("Please enter your Telegram API ID and API Hash");
    }
    apiId = parseInt(idInput);
    apiHash = hashInput;
    
    localStorage.setItem("tgDriveApiId", idInput);
    localStorage.setItem("tgDriveApiHash", hashInput);
  }
  
  const btn = el("bot-login-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Authenticating...';
  
  try {
    client = new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true
    });
    await client.start({
      botAuthToken: botToken
    });
    
    try {
      const parsedId = parseChannelId(channelId);
      await client.getEntity(parsedId);
    } catch (err) {
      throw new Error("Could not access the Channel. Make sure the Channel ID is correct and the Bot is added as an administrator with posting rights.");
    }
    
    const me = await client.getMe();
    const sessionString = client.session.save();
    localStorage.setItem("tgDriveSession", sessionString);
    localStorage.setItem("tgDriveSessionType", "bot");
    localStorage.setItem("tgDriveBotToken", botToken);
    localStorage.setItem("tgDriveChannelId", channelId);
    
    currentUser = {
      id: me.id.toString(),
      name: me.firstName + (me.lastName ? " " + me.lastName : "") + " (Bot)",
      phone: "Channel Storage"
    };
    
    toast("Authenticated as Bot successfully", "success");
    showApp();
    await resolveTargetPeer();
    await loadDBFromTelegram();
    loadFiles();
  } catch (e) {
    console.error(e);
    showErr(e.message || "Bot login failed");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-robot"></i> Login as Bot';
}

// ==================== DATABASE ON TELEGRAM SYNC ====================
async function loadDBFromTelegram() {
  try {
    let dbMsg = null;
    let pinnedMsgId = null;

    // 1. Try to find the database message via the pinned message in a channel (crucial for Bots since they cannot read channel history)
    if (targetPeer !== "me") {
      try {
        const fullChannel = await client.invoke(
          new Api.channels.GetFullChannel({
            channel: targetPeer
          })
        );
        pinnedMsgId = fullChannel.fullChat?.pinnedMsgId;
        console.log("Fetched pinned message ID from channel:", pinnedMsgId);
      } catch (err) {
        console.log("Could not get channel pinned message ID:", err);
      }
    }

    if (pinnedMsgId) {
      try {
        const msgs = await client.getMessages(targetPeer, { ids: [pinnedMsgId] });
        if (msgs?.[0] && msgs[0].message && msgs[0].message.includes("#TelegramDriveDatabase")) {
          dbMsg = msgs[0];
          console.log("Found database in pinned message:", dbMsg.id);
        }
      } catch (err) {
        console.warn("Could not retrieve pinned message content:", err);
      }
    }

    // 2. Fall back to searching history (works for User sessions)
    if (!dbMsg) {
      try {
        const messages = await client.getMessages(targetPeer, { limit: 50 });
        dbMsg = messages.find(m => m.message && m.message.includes("#TelegramDriveDatabase"));
        if (dbMsg) {
          console.log("Found database in history search. Message ID:", dbMsg.id);
        }
      } catch (err) {
        console.warn("Could not fetch messages history (expected for Bots in channels):", err);
      }
    }

    if (dbMsg) {
      dbMessageId = dbMsg.id;
      const buffer = await client.downloadMedia(dbMsg, {});
      if (buffer) {
        const jsonText = new TextDecoder().decode(buffer);
        fileDatabase = JSON.parse(jsonText);
        console.log("Database loaded from Telegram:", fileDatabase);
      } else {
        throw new Error("Could not download database media");
      }
    } else {
      console.log("No database message found. Initializing new database...");
      fileDatabase = {
        files: [],
        folders: [{ id: "root", name: "My Drive", parentId: null, createdDate: new Date().toISOString(), color: "#0088cc" }]
      };
      await saveDBToTelegram();
    }
  } catch (e) {
    console.error("Error loading database:", e);
    toast("Error loading file database", "error");
  }
}

async function saveDBToTelegram() {
  if (!client) return;
  try {
    const jsonStr = JSON.stringify(fileDatabase, null, 2);
    const uint8Array = new TextEncoder().encode(jsonStr);
    const buffer = Buffer.from(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
    const dbFile = new CustomFile("filedb.json", buffer.length, "", buffer);
    
    const result = await client.sendFile(targetPeer, {
      file: dbFile,
      caption: `#TelegramDriveDatabase\nThis message stores your Telegram Drive database. Do not delete it.`,
      forceDocument: true
    });
    
    const oldId = dbMessageId;
    dbMessageId = result.id;
    
    // Pin the new database message in the channel (essential for bots to find it)
    if (targetPeer !== "me") {
      try {
        await client.pinMessage(targetPeer, result.id, { notify: false });
        console.log("Pinned new database message:", result.id);
      } catch (err) {
        console.warn("Could not pin database message:", err);
      }
    }
    
    if (oldId) {
      try {
        await client.deleteMessages(targetPeer, [oldId], { revoke: true });
      } catch (err) {
        console.warn("Could not delete old database message:", err);
      }
    }
  } catch (e) {
    console.error("Error saving database to Telegram:", e);
    toast("Error saving changes", "error");
  }
}

function getMimeType(name, defaultMime = "application/octet-stream") {
  const ext = name.split(".").pop().toLowerCase();
  const mimeMap = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
    mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo",
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4", opus: "audio/opus",
    txt: "text/plain", md: "text/markdown", json: "application/json",
    js: "text/javascript", ts: "text/typescript", py: "text/x-python",
    html: "text/html", css: "text/css", xml: "text/xml", yml: "text/yaml",
    yaml: "text/yaml", sql: "text/x-sql", sh: "text/x-shellscript",
    java: "text/x-java", c: "text/x-c", cpp: "text/x-c++", h: "text/x-c",
    cs: "text/x-csharp", go: "text/x-go", rb: "text/x-ruby", php: "text/x-php",
    rs: "text/x-rust", kt: "text/x-kotlin", swift: "text/x-swift",
    dart: "text/x-dart", r: "text/x-r", lua: "text/x-lua", pdf: "application/pdf"
  };
  if (mimeMap[ext]) return mimeMap[ext];
  if (defaultMime && defaultMime !== "application/octet-stream") return defaultMime;
  return "application/octet-stream";
}

// ==================== ASYNC MEDIA DOWNLOAD CACHE ====================
async function getFileObjectUrl(fileId, forThumbnail = false) {
  const cacheKey = `${fileId}_${forThumbnail ? 'thumb' : 'full'}`;
  if (objectUrlCache.has(cacheKey)) return objectUrlCache.get(cacheKey);
  
  if (fetchingPromises.has(cacheKey)) return fetchingPromises.get(cacheKey);

  const p = (async () => {
    const file = allFiles.find(f => f.id === fileId);
    if (!file) return null;

    try {
      const messages = await client.getMessages(targetPeer, { ids: [file.messageId] });
      if (!messages?.[0]) throw new Error("Message not found on Telegram");

      const message = messages[0];
      let buffer;
      if (forThumbnail && message.media?.document?.thumbs?.length) {
        buffer = await client.downloadMedia(message.media.document, { thumb: 0 });
      } else {
        buffer = await client.downloadMedia(message, {});
      }

      if (!buffer) throw new Error("Download failed");
      
      const mime = getMimeType(file.name, file.mimeType);
      const rawUint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const blob = new Blob([rawUint8], { type: mime });
      const url = URL.createObjectURL(blob);
      objectUrlCache.set(cacheKey, url);
      return url;
    } catch (e) {
      console.error(`Error downloading file media for ${file.name}:`, e);
      return null;
    } finally {
      fetchingPromises.delete(cacheKey);
    }
  })();

  fetchingPromises.set(cacheKey, p);
  return p;
}

// ==================== LOADING PARTICLES ====================
function addLoadingParticles() {
  const screen = el("loading-screen");
  if (!screen) return;
  for (let i = 0; i < 20; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    p.style.left = Math.random() * 100 + "%";
    p.style.animationDuration = (6 + Math.random() * 10) + "s";
    p.style.animationDelay = (Math.random() * 8) + "s";
    p.style.width = p.style.height = (2 + Math.random() * 4) + "px";
    screen.appendChild(p);
  }
}

// ==================== RIPPLE EFFECT ====================
function setupRipples() {
  document.addEventListener("click", e => {
    const btn = e.target.closest(".btn, .btn-icon, .nav-item");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
    ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
    btn.style.position = btn.style.position || "relative";
    btn.style.overflow = "hidden";
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
}

// ==================== AUTH ====================
async function checkAuth() {
  const savedSession = localStorage.getItem("tgDriveSession");
  const creds = getApiCredentials();
  
  if (savedSession && creds.apiId && creds.apiHash) {
    showLoad();
    try {
      client = new TelegramClient(new StringSession(savedSession), creds.apiId, creds.apiHash, {
        connectionRetries: 5,
        useWSS: true
      });
      await client.connect();
      const me = await client.getMe();
      if (me) {
        const isBot = localStorage.getItem("tgDriveSessionType") === "bot";
        currentUser = {
          id: me.id.toString(),
          name: me.firstName + (me.lastName ? " " + me.lastName : "") + (isBot ? " (Bot)" : ""),
          phone: isBot ? "Channel Storage" : (me.phone ? "+" + me.phone : "")
        };
        showApp();
        await resolveTargetPeer();
        await loadDBFromTelegram();
        loadFiles();
        toast(`Welcome back, ${currentUser.name}!`, "success");
        return;
      }
    } catch (e) {
      console.error("Session restore failed:", e);
      localStorage.removeItem("tgDriveSession");
    }
  }
  showAuthScreen();
}

function showLoad() {
  document.body.classList.remove("auth-mode");
  document.body.classList.remove("drawer-open");
  show("loading-screen");
  hide("auth-screen");
  hide("app-screen");
  hide("help-trigger-btn");
  el("help-drawer").classList.remove("open");
}
function showAuthScreen() {
  document.body.classList.add("auth-mode");
  document.body.classList.remove("drawer-open");
  el("help-drawer").classList.remove("open");
  hide("loading-screen");
  show("auth-screen");
  hide("app-screen");
  show("help-trigger-btn");
}
function showApp() {
  document.body.classList.remove("auth-mode");
  document.body.classList.remove("drawer-open");
  hide("loading-screen");
  hide("auth-screen");
  show("app-screen");
  hide("help-trigger-btn");
  el("help-drawer").classList.remove("open");
  if (currentUser) {
    el("user-name").textContent = currentUser.name;
    el("user-phone").textContent = currentUser.phone;
    el("user-avatar").textContent = currentUser.name[0].toUpperCase();
  }
}

async function sendCode() {
  const phone = "+" + el("phone-input").value.replace(/\D/g, "");
  if (phone.length < 8) return showErr("Enter valid phone number");
  
  const creds = getApiCredentials();
  let apiId = creds.apiId;
  let apiHash = creds.apiHash;
  
  if (!creds.preconfigured) {
    const idInput = el("api-id-input").value.trim();
    const hashInput = el("api-hash-input").value.trim();
    if (!idInput || !hashInput) {
      return showErr("Please enter your Telegram API ID and API Hash");
    }
    apiId = parseInt(idInput);
    apiHash = hashInput;
    
    localStorage.setItem("tgDriveApiId", idInput);
    localStorage.setItem("tgDriveApiHash", hashInput);
  }
  
  const btn = el("send-code-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Sending...';
  
  try {
    client = new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true
    });
    await client.connect();
    
    const result = await client.sendCode(
      { apiId, apiHash },
      phone
    );
    
    window._phoneCodeHash = result.phoneCodeHash;
    window._phoneNumber = phone;
    window._apiId = apiId;
    window._apiHash = apiHash;
    
    hide("phone-step");
    show("code-step");
    el("code-input").focus();
    toast("Code sent!", "success");
  } catch (e) {
    console.error(e);
    showErr(e.message || "Connection error");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Code';
}

async function verifyCode() {
  const code = el("code-input").value.trim();
  const pw = el("password-input").value;
  if (!code) return showErr("Enter code");
  
  const btn = el("verify-code-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Verifying...';
  
  try {
    try {
      await client.invoke(new Api.auth.SignIn({
        phoneNumber: window._phoneNumber,
        phoneCodeHash: window._phoneCodeHash,
        phoneCode: code
      }));
    } catch (err) {
      if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
        if (!pw) {
          show("password-group");
          el("password-input").focus();
          showErr("2FA password required");
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-check"></i> Verify';
          return;
        }
        const pwd = await client.invoke(new Api.account.GetPassword());
        await client.invoke(new Api.auth.CheckPassword({
          password: await computeCheck(pwd, pw)
        }));
      } else if (err.errorMessage === "PHONE_CODE_INVALID") {
        showErr("Invalid code");
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Verify';
        return;
      } else {
        throw err;
      }
    }
    
    const me = await client.getMe();
    const sessionString = client.session.save();
    localStorage.setItem("tgDriveSession", sessionString);
    localStorage.setItem("tgDriveSessionType", "user");
    localStorage.removeItem("tgDriveBotToken");
    localStorage.removeItem("tgDriveChannelId");
    
    currentUser = {
      id: me.id.toString(),
      name: me.firstName + (me.lastName ? " " + me.lastName : ""),
      phone: me.phone ? "+" + me.phone : window._phoneNumber
    };
    
    toast(`Welcome, ${currentUser.name}!`, "success");
    showApp();
    await resolveTargetPeer();
    await loadDBFromTelegram();
    loadFiles();
  } catch (e) {
    console.error(e);
    if (e.errorMessage === "SESSION_PASSWORD_NEEDED" || e.message?.includes("password")) {
      show("password-group");
      el("password-input").focus();
      showErr("2FA password required");
    } else {
      showErr(e.message || "Verification failed");
    }
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-check"></i> Verify';
}

function backToPhone() { show("phone-step"); hide("code-step"); hide("password-group"); hide("auth-error"); }
function showErr(msg) { const e = el("auth-error"); e.textContent = msg; show("auth-error"); }

async function logout() {
  const ok = await customConfirm("Log Out", "Are you sure you want to log out of Telegram Drive?", "Log Out", "warning");
  if (!ok) return;
  try {
    if (client) {
      await client.disconnect();
    }
  } catch (e) {}
  localStorage.removeItem("tgDriveSession");
  localStorage.removeItem("tgDriveSessionType");
  localStorage.removeItem("tgDriveBotToken");
  localStorage.removeItem("tgDriveChannelId");
  currentUser = null;
  client = null;
  showAuthScreen();
  toast("Logged out", "info");
}

// ==================== CUSTOM CONFIRM ====================
function customConfirm(title, message, okText = "Confirm", type = "danger") {
  return new Promise(resolve => {
    confirmResolve = resolve;
    el("confirm-title").textContent = title;
    el("confirm-message").textContent = message;
    el("confirm-ok-btn").textContent = okText;
    el("confirm-ok-btn").className = `btn ${type === "danger" ? "btn-danger" : "btn-primary"}`;
    const icon = el("confirm-icon");
    icon.className = `confirm-icon ${type}`;
    icon.innerHTML = type === "danger" ? '<i class="fas fa-exclamation-triangle"></i>' : '<i class="fas fa-question-circle"></i>';
    show("confirm-modal");
  });
}
function okConfirm() { hide("confirm-modal"); if (confirmResolve) { confirmResolve(true); confirmResolve = null; } }
function cancelConfirm() { hide("confirm-modal"); if (confirmResolve) { confirmResolve(false); confirmResolve = null; } }

// ==================== SHORTCUTS MODAL ====================
function showShortcutsModal() { show("shortcuts-modal"); }

// ==================== FILES ====================
async function loadFiles(folderId) {
  if (folderId !== undefined) currentFolder = folderId;
  clearSelection();

  const content = el("content-area");
  content.classList.remove("fading");
  void content.offsetWidth;
  content.classList.add("fading");

  try {
    const searchQuery = el("search-input")?.value?.trim().toLowerCase();
    let folders = [];
    let files = [];

    if (searchQuery) {
      folders = [];
      files = fileDatabase.files.filter(f => !f.trashed && f.name.toLowerCase().includes(searchQuery));
    } else {
      folders = fileDatabase.folders.filter(f => f.parentId === currentFolder);
      if (currentView === "trash") {
        files = fileDatabase.files.filter(f => f.trashed);
      } else if (currentView === "starred") {
        files = fileDatabase.files.filter(f => !f.trashed && f.starred);
      } else if (["images", "videos", "audio", "documents"].includes(currentView)) {
        const typeMap = { images: "image", videos: "video", audio: "audio", documents: "document" };
        files = fileDatabase.files.filter(f => !f.trashed && f.type === typeMap[currentView]);
      } else {
        files = fileDatabase.files.filter(f => !f.trashed && f.folderId === currentFolder);
      }
    }

    files.sort((a, b) => {
      let valA, valB;
      switch (sortBy) {
        case "name": valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
        case "size": valA = a.size || 0; valB = b.size || 0; break;
        case "date": valA = new Date(a.uploadDate); valB = new Date(b.uploadDate); break;
        case "type": valA = a.type; valB = b.type; break;
        default: valA = a.name.toLowerCase(); valB = b.name.toLowerCase();
      }
      if (sortOrder === "desc") return valA > valB ? -1 : 1;
      return valA > valB ? 1 : -1;
    });

    folders.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    const totalSize = fileDatabase.files.filter(f => !f.trashed).reduce((s, f) => s + (f.size || 0), 0);
    currentFiles = files;
    currentFolders = folders;
    allFiles = fileDatabase.files;

    const breadcrumb = [];
    let current = fileDatabase.folders.find(f => f.id === currentFolder);
    while (current) {
      breadcrumb.unshift({ id: current.id, name: current.name });
      current = current.parentId ? fileDatabase.folders.find(f => f.id === current.parentId) : null;
    }
    if (breadcrumb.length === 0) breadcrumb.push({ id: "root", name: "My Drive" });

    renderBreadcrumb(breadcrumb);
    renderFolders(folders);
    renderFiles(files);
    updateStorage(totalSize);

    const hasContent = folders.length > 0 || files.length > 0;
    toggle("empty-state", !hasContent);
    toggle("folders-section", folders.length > 0 && currentView === "files");
    toggle("topbar-new-folder", folders.length === 0 && currentView === "files");
    toggle("files-section", files.length > 0);
    toggle("trash-bar", currentView === "trash" && files.length > 0);

    const trashedCount = fileDatabase.files.filter(f => f.trashed).length;
    if (trashedCount > 0) { el("trash-badge").textContent = trashedCount; show("trash-badge"); }
    else hide("trash-badge");
  } catch (e) { console.error(e); toast("Failed to load files", "error"); }
}

function renderBreadcrumb(bc) {
  if (!bc) bc = [{ id: "root", name: "My Drive" }];
  const viewNames = { files: "My Drive", recent: "Recent", starred: "Starred", images: "Images", videos: "Videos", audio: "Audio", documents: "Documents", trash: "Trash" };
  if (currentView !== "files") {
    el("breadcrumb").innerHTML = `<a href="#" onclick="window.switchView('${currentView}')">${viewNames[currentView] || currentView}</a>`;
    return;
  }
  el("breadcrumb").innerHTML = bc.map((f, i) =>
    `${i > 0 ? '<span class="sep"><i class="fas fa-chevron-right"></i></span>' : ''}<a href="#" onclick="window.navFolder('${f.id}')">${esc(f.name)}</a>`
  ).join("");
}

function renderFolders(folders) {
  const g = el("folders-grid");
  g.className = `file-grid ${viewMode === "list" ? "list-view" : ""}`;
  g.innerHTML = folders.map(f => {
    const color = f.color || "#ffab00";
    return `<div class="file-card${selectedItems.has(f.id) ? ' selected' : ''}" ondblclick="window.navFolder('${f.id}')" onclick="window.handleCardClick(event,'${f.id}','folder')" oncontextmenu="window.showContext(event,'folder','${f.id}')">
      <div class="card-checkbox" onclick="event.stopPropagation();window.toggleSelect('${f.id}','folder')"><i class="fas fa-check"></i></div>
      <div class="file-icon folder" style="background:${color}18;color:${color}"><i class="fas fa-folder"></i></div>
      ${viewMode === "list" ? `<div class="file-info"><div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">Folder</div><div class="file-date">${fmtDate(f.createdDate)}</div></div>` : `<div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">Folder</div>`}
      <div class="card-actions"><button onclick="event.stopPropagation();window.showContext(event,'folder','${f.id}')" title="More"><i class="fas fa-ellipsis-v"></i></button></div>
    </div>`;
  }).join("");
}

function renderFiles(files) {
  const g = el("files-grid");
  g.className = `file-grid ${viewMode === "list" ? "list-view" : ""}`;
  el("file-count").textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
  g.innerHTML = files.map(f => {
    const starred = f.starred ? 'active' : '';
    const isImage = f.type === "image";
    const thumbHtml = isImage && viewMode !== "list" ? `<div class="file-thumb" id="thumb-${f.id}"><div class="spinner-sm"></div></div>` : '';
    const iconHtml = (!isImage || viewMode === "list") ? `<div class="file-icon ${f.type}"><i class="${fileIcon(f.type)}"></i></div>` : '';
    
    if (isImage && viewMode !== "list") {
      setTimeout(async () => {
        const url = await getFileObjectUrl(f.id, true);
        const container = document.getElementById(`thumb-${f.id}`);
        if (container) {
          if (url) {
            container.innerHTML = `<img src="${url}" alt="${esc(f.name)}" loading="lazy" onerror="this.parentElement.style.display='none'">`;
          } else {
            container.innerHTML = `<div class="file-icon image"><i class="${fileIcon('image')}"></i></div>`;
          }
        }
      }, 0);
    }
    
    return `<div class="file-card${selectedItems.has(f.id) ? ' selected' : ''}" onclick="window.handleCardClick(event,'${f.id}','file')" ondblclick="window.previewFile('${f.id}')" oncontextmenu="window.showContext(event,'file','${f.id}')">
      <div class="card-checkbox" onclick="event.stopPropagation();window.toggleSelect('${f.id}','file')"><i class="fas fa-check"></i></div>
      <div class="file-star ${starred}" onclick="event.stopPropagation();window.toggleStar('${f.id}')" title="Star"><i class="fas fa-star"></i></div>
      ${thumbHtml}${iconHtml}
      ${viewMode === "list" ? `<div class="file-info"><div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">${fmtBytes(f.size)}</div><div class="file-date">${fmtDate(f.uploadDate)}</div></div>` : `<div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">${fmtBytes(f.size)} · ${fmtDate(f.uploadDate)}</div>`}
      <div class="card-actions"><button onclick="event.stopPropagation();window.downloadFile('${f.id}')" title="Download"><i class="fas fa-download"></i></button><button onclick="event.stopPropagation();window.showContext(event,'file','${f.id}')" title="More"><i class="fas fa-ellipsis-v"></i></button></div>
    </div>`;
  }).join("");
}

// ==================== UPLOAD ====================
async function handleUpload(event) {
  const files = event.target.files; if (!files?.length) return;
  const panel = el("upload-panel"), list = el("upload-list");
  show("upload-panel");
  list.innerHTML = "";

  const items = [];
  for (const f of files) {
    const item = document.createElement("div");
    item.className = "upload-item";
    item.innerHTML = `<div class="upload-item-icon"><i class="${fileIcon(fileTypeFromMime(f.type, f.name))}"></i></div><div class="upload-item-info"><div class="upload-item-name">${esc(f.name)}</div><div class="upload-progress"><div class="upload-progress-bar" style="width:0%"></div></div><div class="upload-status">Preparing...</div></div>`;
    list.appendChild(item);
    items.push({ file: f, progressBar: item.querySelector(".upload-progress-bar"), statusLabel: item.querySelector(".upload-status") });
  }

  for (const item of items) {
    const f = item.file;
    try {
      item.statusLabel.textContent = "Uploading... 0%";
      const arrayBuffer = await f.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const customFile = new CustomFile(f.name, f.size, "", buffer);
      
      const result = await client.sendFile(targetPeer, {
        file: customFile,
        caption: `🗂 TG-Drive | ${f.name}`,
        forceDocument: true,
        progressCallback: (progress) => {
          const pct = Math.round(progress * 100);
          item.progressBar.style.width = pct + "%";
          item.statusLabel.textContent = `Uploading... ${pct}%`;
        }
      });
      
      const fileEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
        name: f.name,
        size: f.size,
        mimeType: f.type || "application/octet-stream",
        folderId: currentFolder,
        messageId: result.id,
        chatId: targetPeer === "me" ? "me" : targetPeer.id.toString(),
        uploadDate: new Date().toISOString(),
        starred: false,
        trashed: false,
        type: fileTypeFromMime(f.type, f.name)
      };
      
      fileDatabase.files.push(fileEntry);
      
      item.statusLabel.textContent = "✓ Complete";
      item.statusLabel.className = "upload-status success";
      item.progressBar.style.width = "100%";
      item.progressBar.style.background = "var(--success)";
      
    } catch (e) {
      console.error(e);
      item.statusLabel.textContent = "✗ " + e.message;
      item.statusLabel.className = "upload-status error";
      toast(`Upload failed for ${f.name}`, "error");
    }
  }

  await saveDBToTelegram();
  loadFiles();
  event.target.value = "";
  setTimeout(() => { hide("upload-panel"); list.innerHTML = ""; }, 5000);
}

// ==================== DOWNLOAD ====================
async function downloadFile(id, name) {
  const file = fileDatabase.files.find(f => f.id === id);
  const finalName = name || file?.name || "download";
  toast(`Downloading "${finalName}"...`, "info");
  try {
    const url = await getFileObjectUrl(id, false);
    if (!url) throw new Error("Could not download file");
    
    const a = document.createElement("a");
    a.href = url;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`"${finalName}" downloaded`, "success");
  } catch (e) {
    toast("Download failed: " + e.message, "error");
  }
}

// ==================== PREVIEW ====================
async function previewFile(id) {
  previewableFiles = currentFiles;
  previewIndex = previewableFiles.findIndex(f => f.id === id);
  if (previewIndex === -1) return;
  previewFileId = id;
  show("preview-modal");
  await loadPreview(previewableFiles[previewIndex]);
}

async function loadPreview(file) {
  const body = el("preview-body"), info = el("preview-info");
  el("preview-name").textContent = file.name;
  body.innerHTML = '<div class="preview-loading"><div class="spinner-lg"></div><p>Loading preview...</p></div>';
  info.innerHTML = `<span>${esc(file.name)}</span><span>${fmtBytes(file.size)}</span><span>${file.type}</span><span>${fmtDate(file.uploadDate)}</span>`;

  const type = file.type && file.type !== "file" ? file.type : fileTypeFromMime(file.mimeType, file.name);
  const ext = file.name.split(".").pop().toLowerCase();

  try {
    const url = await getFileObjectUrl(file.id, false);
    if (!url) throw new Error("Could not fetch preview data");

    if (type === "image") {
      body.innerHTML = `<img src="${url}" alt="${esc(file.name)}" onclick="this.classList.toggle('zoomed')">`;
    } else if (type === "video") {
      body.innerHTML = `<video controls autoplay><source src="${url}">Your browser does not support video.</video>`;
    } else if (type === "audio") {
      body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:24px;padding:48px"><i class="fas fa-music" style="font-size:72px;color:var(--primary);opacity:.4;filter:drop-shadow(0 0 12px var(--primary-glow))"></i><audio controls autoplay style="width:80%;max-width:500px"><source src="${url}"></audio></div>`;
    } else if (type === "pdf") {
      body.innerHTML = `<iframe src="${url}#toolbar=1" title="PDF Preview"></iframe>`;
    } else if (type === "text" || isCodeFile(ext)) {
      const response = await fetch(url);
      const text = await response.text();
      const lang = getLanguage(ext);
      body.innerHTML = `<div class="code-wrapper"><pre><code class="${lang}">${escCode(text)}</code></pre></div>`;
    } else {
      body.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-2)"><i class="fas ${fileIcon(type)}" style="font-size:72px;margin-bottom:20px;opacity:.2"></i><h3 style="margin-bottom:8px">Preview not available</h3><p style="margin:8px 0;font-size:13px">${esc(file.name)}</p><p style="color:var(--text-3);margin-bottom:20px">${fmtBytes(file.size)}</p><button class="btn btn-primary" onclick="window.downloadFile('${file.id}')"><i class="fas fa-download"></i> Download</button></div>`;
    }
  } catch (e) {
    body.innerHTML = `<div style="text-align:center;padding:48px;color:var(--danger)"><i class="fas fa-exclamation-circle" style="font-size:52px;margin-bottom:16px;opacity:.6"></i><p>Preview failed: ${e.message}</p></div>`;
  }
}

function previewNav(dir) {
  previewIndex += dir;
  if (previewIndex < 0) previewIndex = previewableFiles.length - 1;
  if (previewIndex >= previewableFiles.length) previewIndex = 0;
  previewFileId = previewableFiles[previewIndex].id;
  loadPreview(previewableFiles[previewIndex]);
}

function closePreview() { hide("preview-modal"); el("preview-body").innerHTML = ""; }
function downloadCurrentPreview() { const f = previewableFiles[previewIndex]; if (f) downloadFile(f.id, f.name); }

function isCodeFile(ext) {
  return ["txt","md","json","xml","html","css","js","ts","py","java","c","cpp","h","cs","go","rb","php","sql","yml","yaml","ini","cfg","log","sh","bat","ps1","jsx","tsx","vue","svelte","rs","kt","swift","dart","r","lua","toml","env","gitignore","dockerfile","makefile","csv","tsv"].includes(ext);
}

function getLanguage(ext) {
  const map = { js: "javascript", ts: "typescript", py: "python", rb: "ruby", java: "java", cs: "csharp", go: "go", rs: "rust", c: "c", cpp: "cpp", html: "html", css: "css", json: "json", xml: "xml", sql: "sql", sh: "bash", yml: "yaml", yaml: "yaml", md: "markdown", php: "php", kt: "kotlin", swift: "swift", dart: "dart" };
  return map[ext] || "plaintext";
}

// ==================== CONTEXT MENU ====================
function showContext(e, type, id) {
  e.preventDefault(); e.stopPropagation();
  const menu = el("context-menu");
  let html = "";

  if (currentView === "trash") {
    html = `<button class="ctx-item" onclick="window.restoreFile('${id}')"><i class="fas fa-undo"></i>Restore</button>
            <button class="ctx-item danger" onclick="window.permDelete('${id}')"><i class="fas fa-trash"></i>Delete Forever</button>`;
  } else if (type === "file") {
    html = `<button class="ctx-item" onclick="window.previewFile('${id}')"><i class="fas fa-eye"></i>Preview</button>
            <button class="ctx-item" onclick="window.downloadFile('${id}','')"><i class="fas fa-download"></i>Download</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item" onclick="window.showRename('file','${id}')"><i class="fas fa-edit"></i>Rename<span class="shortcut">F2</span></button>
            <button class="ctx-item" onclick="window.showMoveModal(['${id}'],'file')"><i class="fas fa-arrows-alt"></i>Move to</button>
            <button class="ctx-item" onclick="window.copyFile('${id}')"><i class="fas fa-copy"></i>Make a copy</button>
            <button class="ctx-item" onclick="window.toggleStar('${id}')"><i class="fas fa-star"></i>Star</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item" onclick="window.showInfo('${id}')"><i class="fas fa-info-circle"></i>Details</button>
            <button class="ctx-item danger" onclick="window.trashFile('${id}')"><i class="fas fa-trash"></i>Move to Trash<span class="shortcut">Del</span></button>`;
  } else if (type === "folder") {
    html = `<button class="ctx-item" onclick="window.navFolder('${id}')"><i class="fas fa-folder-open"></i>Open</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item" onclick="window.showRename('folder','${id}')"><i class="fas fa-edit"></i>Rename</button>
            <button class="ctx-item" onclick="window.showMoveModal(['${id}'],'folder')"><i class="fas fa-arrows-alt"></i>Move to</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item danger" onclick="window.deleteFolder('${id}')"><i class="fas fa-trash"></i>Delete</button>`;
  }

  menu.innerHTML = html;
  show("context-menu");

  let x = e.clientX, y = e.clientY;
  const mw = menu.offsetWidth || 200, mh = menu.offsetHeight || 200;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = x + "px"; menu.style.top = y + "px";
}

function hideContext() { hide("context-menu"); }

// ==================== SELECTION ====================
function handleCardClick(e, id, type) {
  if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); toggleSelect(id); return; }
}

function toggleSelect(id) {
  if (selectedItems.has(id)) selectedItems.delete(id); else selectedItems.add(id);
  updateSelectionUI();
}

function clearSelection() { selectedItems.clear(); updateSelectionUI(); }

function updateSelectionUI() {
  document.querySelectorAll(".file-card").forEach(c => {
    const id = c.getAttribute("onclick")?.match(/'([^']+)'/)?.[1];
    if (id) c.classList.toggle("selected", selectedItems.has(id));
  });
  if (selectedItems.size > 0) { show("selection-bar"); el("selection-count").textContent = selectedItems.size; }
  else hide("selection-bar");
  renderFolders(currentFolders); renderFiles(currentFiles);
}

async function bulkAction(action) {
  const ids = [...selectedItems];
  if (!ids.length) return;
  if (action === "move") { showMoveModal(ids, "mixed"); return; }
  
  for (const id of ids) {
    const file = fileDatabase.files.find(f => f.id === id);
    if (file) {
      switch (action) {
        case "trash":
          file.trashed = true;
          file.trashedDate = new Date().toISOString();
          file.originalFolderId = file.folderId;
          break;
        case "restore":
          file.trashed = false;
          file.folderId = fileDatabase.folders.some(fo => fo.id === file.originalFolderId) ? file.originalFolderId : "root";
          break;
        case "star":
          file.starred = true;
          break;
        case "unstar":
          file.starred = false;
          break;
        case "delete":
          const isSharedDel = fileDatabase.files.filter(f => f.messageId === file.messageId).length > 1;
          if (!isSharedDel) {
            try {
              await client.deleteMessages(targetPeer, [file.messageId], { revoke: true });
            } catch (e) {}
          }
          fileDatabase.files = fileDatabase.files.filter(f => f.id !== id);
          break;
      }
    }
    
    const folder = fileDatabase.folders.find(f => f.id === id);
    if (folder && folder.id !== "root") {
      switch (action) {
        case "trash":
          const subIds = getAllSubFolderIds(folder.id);
          fileDatabase.files.filter(f => subIds.includes(f.folderId)).forEach(f => {
            f.trashed = true;
            f.originalFolderId = f.folderId;
          });
          fileDatabase.folders = fileDatabase.folders.filter(f => !subIds.includes(f.id) || f.id === "root");
          break;
      }
    }
  }
  
  await saveDBToTelegram();
  toast(`Items updated`, "success");
  clearSelection();
  loadFiles();
}

// ==================== FILE OPERATIONS ====================
async function trashFile(id) {
  const file = fileDatabase.files.find(f => f.id === id);
  if (file) {
    file.trashed = true;
    file.trashedDate = new Date().toISOString();
    file.originalFolderId = file.folderId;
    await saveDBToTelegram();
    toast("Moved to trash", "success");
    loadFiles();
  }
  hideContext();
}

async function restoreFile(id) {
  const file = fileDatabase.files.find(f => f.id === id);
  if (file) {
    file.trashed = false;
    file.folderId = fileDatabase.folders.some(fo => fo.id === file.originalFolderId) ? file.originalFolderId : "root";
    delete file.trashedDate;
    delete file.originalFolderId;
    await saveDBToTelegram();
    toast("File restored", "success");
    loadFiles();
  }
  hideContext();
}

async function permDelete(id) {
  const ok = await customConfirm("Delete Forever", "This file will be permanently deleted. This action cannot be undone.", "Delete Forever");
  if (!ok) return;
  const file = fileDatabase.files.find(f => f.id === id);
  if (file) {
    const isShared = fileDatabase.files.filter(f => f.messageId === file.messageId).length > 1;
    if (!isShared) {
      try {
        await client.deleteMessages(targetPeer, [file.messageId], { revoke: true });
      } catch (e) {
        console.error(e);
      }
    }
    fileDatabase.files = fileDatabase.files.filter(f => f.id !== id);
    await saveDBToTelegram();
    toast("Permanently deleted", "success");
    loadFiles();
  }
  hideContext();
}

async function emptyTrash() {
  const ok = await customConfirm("Empty Trash", "All items in trash will be permanently deleted. This cannot be undone.", "Empty Trash");
  if (!ok) return;
  
  const trashedFiles = fileDatabase.files.filter(f => f.trashed);
  for (const file of trashedFiles) {
    const isShared = fileDatabase.files.filter(f => f.messageId === file.messageId).length > 1;
    if (!isShared) {
      try {
        await client.deleteMessages(targetPeer, [file.messageId], { revoke: true });
      } catch (e) {}
    }
  }
  fileDatabase.files = fileDatabase.files.filter(f => !f.trashed);
  await saveDBToTelegram();
  toast(`${trashedFiles.length} items deleted`, "success");
  loadFiles();
}

async function toggleStar(id) {
  const file = fileDatabase.files.find(f => f.id === id);
  if (file) {
    file.starred = !file.starred;
    await saveDBToTelegram();
    loadFiles();
  }
  hideContext();
}

async function copyFile(id) {
  const file = fileDatabase.files.find(f => f.id === id);
  if (file) {
    const copy = {
      ...file,
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
      name: "Copy of " + file.name,
      folderId: file.folderId,
      uploadDate: new Date().toISOString(),
      starred: false
    };
    fileDatabase.files.push(copy);
    await saveDBToTelegram();
    toast("Copy created", "success");
    loadFiles();
  }
  hideContext();
}

async function showInfo(id) {
  const file = fileDatabase.files.find(f => f.id === id);
  if (file) {
    const folder = fileDatabase.folders.find(fo => fo.id === file.folderId);
    el("info-content").innerHTML = `
      <div style="display:grid;grid-template-columns:110px 1fr;gap:10px;font-size:13px">
        <span style="color:var(--text-2);font-weight:500">Name</span><span style="font-weight:600">${esc(file.name)}</span>
        <span style="color:var(--text-2);font-weight:500">Size</span><span>${fmtBytes(file.size)}</span>
        <span style="color:var(--text-2);font-weight:500">Type</span><span>${file.mimeType || file.type}</span>
        <span style="color:var(--text-2);font-weight:500">Uploaded</span><span>${new Date(file.uploadDate).toLocaleString()}</span>
        <span style="color:var(--text-2);font-weight:500">Location</span><span>${folder?.name || "Root"}</span>
        <span style="color:var(--text-2);font-weight:500">Starred</span><span>${file.starred ? "⭐ Yes" : "No"}</span>
      </div>`;
    show("info-modal");
  }
  hideContext();
}

// ==================== FOLDERS ====================
function showNewFolder() {
  closeModal("folder-modal"); show("folder-modal");
  el("folder-name").value = ""; el("folder-name").focus();
  el("folder-color-picker").innerHTML = FOLDER_COLORS.map(c =>
    `<div class="color-dot${c === selectedFolderColor ? ' active' : ''}" style="background:${c}" onclick="window.selectFolderColor('${c}',this)"></div>`
  ).join("");
}

function selectFolderColor(c, dot) {
  selectedFolderColor = c;
  document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("active"));
  dot.classList.add("active");
}

async function createFolder() {
  const name = el("folder-name").value.trim();
  if (!name) return toast("Enter folder name", "warning");
  
  const dup = fileDatabase.folders.find(f => f.name.toLowerCase() === name.toLowerCase() && f.parentId === currentFolder);
  if (dup) return toast("Folder already exists", "error");
  
  const folder = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    name,
    parentId: currentFolder,
    createdDate: new Date().toISOString(),
    color: selectedFolderColor
  };
  
  fileDatabase.folders.push(folder);
  await saveDBToTelegram();
  closeModal("folder-modal");
  toast(`Folder "${name}" created`, "success");
  loadFiles();
}

function navFolder(id) { currentView = "files"; updateNav("files"); currentFolder = id; loadFiles(id); }

function getAllSubFolderIds(parentId) {
  const ids = [parentId];
  fileDatabase.folders.filter(f => f.parentId === parentId).forEach(f => ids.push(...getAllSubFolderIds(f.id)));
  return ids;
}

async function deleteFolder(id) {
  const ok = await customConfirm("Delete Folder", "This folder and all its contents will be permanently deleted.", "Delete Folder");
  if (!ok) return;
  
  const subIds = getAllSubFolderIds(id);
  const filesToDelete = fileDatabase.files.filter(f => subIds.includes(f.folderId));
  for (const file of filesToDelete) {
    const isShared = fileDatabase.files.filter(f => f.messageId === file.messageId).length > 1;
    if (!isShared) {
      try {
        await client.deleteMessages(targetPeer, [file.messageId], { revoke: true });
      } catch (e) {}
    }
  }
  
  fileDatabase.files = fileDatabase.files.filter(f => !subIds.includes(f.folderId));
  fileDatabase.folders = fileDatabase.folders.filter(f => !subIds.includes(f.id));
  
  await saveDBToTelegram();
  toast("Folder deleted", "success");
  loadFiles();
  hideContext();
}

// ==================== RENAME ====================
function showRename(type, id) {
  hideContext();
  renameTarget = { type, id };

  let currentName = "";
  if (type === "file") {
    const file = currentFiles.find(f => f.id === id);
    if (file) currentName = file.name;
  } else {
    const folder = currentFolders.find(f => f.id === id);
    if (folder) currentName = folder.name;
  }

  const input = el("rename-input");
  input.value = currentName;
  input.placeholder = type === "folder" ? "New folder name" : "New file name";
  show("rename-modal");

  setTimeout(() => {
    input.focus();
    if (type === "file" && currentName.includes(".")) {
      const dotIndex = currentName.lastIndexOf(".");
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }
  }, 100);
}

async function doRename() {
  const name = el("rename-input").value.trim();
  if (!name || !renameTarget) return;
  
  if (renameTarget.type === "folder") {
    const folder = fileDatabase.folders.find(f => f.id === renameTarget.id);
    if (folder) folder.name = name;
  } else {
    const file = fileDatabase.files.find(f => f.id === renameTarget.id);
    if (file) file.name = name;
  }
  
  await saveDBToTelegram();
  closeModal("rename-modal");
  toast("Renamed successfully", "success");
  loadFiles();
}

// ==================== MOVE ====================
async function showMoveModal(ids, type) {
  hideContext();
  moveItems = ids;
  moveTargetId = "root";
  const tree = el("folder-tree");
  
  function renderTree(folders, parentId, depth = 0) {
    return folders.filter(f => f.parentId === parentId).map(f =>
      `<div class="${depth > 0 ? 'tree-indent' : ''}"><div class="tree-item${f.id === moveTargetId ? ' active' : ''}" onclick="window.selectMoveTarget('${f.id}',this)"><i class="fas fa-folder" style="color:${f.color || '#ffab00'}"></i>${esc(f.name)}</div>${renderTree(folders, f.id, depth + 1)}</div>`
    ).join("");
  }
  
  tree.innerHTML = `<div class="tree-item${moveTargetId === 'root' ? ' active' : ''}" onclick="window.selectMoveTarget('root',this)"><i class="fas fa-hard-drive" style="color:var(--primary)"></i>My Drive</div>${renderTree(fileDatabase.folders, "root")}`;
  show("move-modal");
}

function selectMoveTarget(id, elem) {
  moveTargetId = id;
  document.querySelectorAll(".tree-item").forEach(t => t.classList.remove("active"));
  elem.classList.add("active");
}

async function doMove() {
  try {
    for (const id of moveItems) {
      const file = fileDatabase.files.find(f => f.id === id);
      if (file) {
        file.folderId = moveTargetId;
      }
      
      const folder = fileDatabase.folders.find(f => f.id === id);
      if (folder) {
        const subIds = getAllSubFolderIds(folder.id);
        if (subIds.includes(moveTargetId)) {
          toast("Cannot move folder into itself", "error");
          closeModal("move-modal");
          return;
        }
        folder.parentId = moveTargetId;
      }
    }
    
    await saveDBToTelegram();
    closeModal("move-modal");
    clearSelection();
    toast("Moved successfully", "success");
    loadFiles();
  } catch (e) {
    toast("Move failed", "error");
  }
}

// ==================== SEARCH & FILTER ====================
function handleSearch(q) {
  clearTimeout(searchTimeout);
  el("search-clear").classList.toggle("hidden", !q);
  searchTimeout = setTimeout(() => {
    loadFiles();
  }, 300);
}

function clearSearch() { el("search-input").value = ""; el("search-clear").classList.add("hidden"); loadFiles(); }

function handleSort(val) {
  const [s, o] = val.split("-"); sortBy = s; sortOrder = o;
  loadFiles();
}

function switchView(view) {
  currentView = view; updateNav(view);
  if (view === "files") { currentFolder = "root"; loadFiles(); }
  else if (view === "recent" || view === "starred" || view === "trash") loadFiles();
  else loadFilteredView(view);
}

function updateNav(view) {
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === view));
}

async function loadFilteredView(type) {
  try {
    const typeMap = { images: "image", videos: "video", audio: "audio", documents: "document" };
    const results = fileDatabase.files.filter(f => !f.trashed && f.type === typeMap[type]);
    currentFiles = results; currentFolders = [];
    renderBreadcrumb(); hide("folders-section"); renderFiles(results);
    toggle("files-section", results.length > 0); toggle("empty-state", results.length === 0);
    hide("trash-bar");
  } catch (e) {}
}

function toggleView() {
  viewMode = viewMode === "grid" ? "list" : "grid";
  el("view-toggle").innerHTML = viewMode === "grid" ? '<i class="fas fa-th-large"></i>' : '<i class="fas fa-list"></i>';
  renderFolders(currentFolders); renderFiles(currentFiles);
}

function refreshFiles() {
  const btn = event?.target?.closest?.(".btn-icon");
  if (btn) { btn.style.transform = "rotate(360deg)"; btn.style.transition = "transform .5s ease"; setTimeout(() => { btn.style.transform = ""; }, 500); }
  loadFiles(); toast("Refreshed", "info");
}

// ==================== DRAG & DROP ====================
function setupDragDrop() {
  const dz = el("drop-zone");
  document.addEventListener("dragenter", e => { e.preventDefault(); dragCounter++; dz.classList.add("active"); });
  document.addEventListener("dragleave", e => { e.preventDefault(); dragCounter--; if (!dragCounter) dz.classList.remove("active"); });
  document.addEventListener("dragover", e => e.preventDefault());
  document.addEventListener("drop", e => {
    e.preventDefault(); dragCounter = 0; dz.classList.remove("active");
    if (e.dataTransfer.files.length) { const inp = el("file-upload"); inp.files = e.dataTransfer.files; handleUpload({ target: inp }); }
  });
}

// ==================== KEYBOARD ====================
function setupKeys() {
  document.addEventListener("keydown", e => {
    const tag = e.target.tagName;
    const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "Escape") {
      closePreview(); closeModal("folder-modal"); closeModal("rename-modal"); closeModal("move-modal"); closeModal("info-modal"); closeModal("shortcuts-modal"); cancelConfirm(); hideContext(); clearSelection();
    }

    if (isInput) return;

    if ((e.ctrlKey || e.metaKey) && e.key === "u") { e.preventDefault(); el("file-upload").click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); el("search-input").focus(); }
    if (e.key === "Delete" && selectedItems.size) bulkAction("trash");
    if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); showShortcutsModal(); }

    if (el("preview-modal") && !el("preview-modal").classList.contains("hidden")) {
      if (e.key === "ArrowRight") previewNav(1);
      if (e.key === "ArrowLeft") previewNav(-1);
    }
  });
}

// ==================== UTILS ====================
function el(id) { return document.getElementById(id); }
function show(id) { el(id)?.classList.remove("hidden"); }
function hide(id) { el(id)?.classList.add("hidden"); }
function toggle(id, show) { show ? el(id)?.classList.remove("hidden") : el(id)?.classList.add("hidden"); }
function closeModal(id) { hide(id); }
function toggleSidebar() { el("sidebar").classList.toggle("open"); }
function toggleUploadPanel() { el("upload-panel").classList.toggle("hidden"); }
function esc(s) { if (!s) return ""; const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function escCode(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function fmtBytes(b) {
  if (!b) return "0 B"; const k = 1024, s = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

function fmtDate(d) {
  if (!d) return ""; const dt = new Date(d), now = new Date(), diff = now - dt;
  const days = Math.floor(diff / 864e5);
  if (days === 0) return "Today"; if (days === 1) return "Yesterday";
  if (days < 7) return days + "d ago";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: dt.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function fileIcon(t) {
  const m = { folder: "fa-folder", image: "fa-image", video: "fa-video", audio: "fa-music", pdf: "fa-file-pdf", document: "fa-file-alt", archive: "fa-file-archive", text: "fa-file-code", file: "fa-file" };
  return "fas " + (m[t] || m.file);
}

function fileTypeFromMime(m, n) {
  const mime = (m || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("archive")) return "archive";
  if (mime.includes("text") || mime.includes("json") || mime.includes("javascript")) return "text";

  if (n) {
    const ext = n.split(".").pop().toLowerCase();
    const map = {
      image: ["jpg","jpeg","png","gif","bmp","webp","svg","ico","tiff"],
      video: ["mp4","mkv","avi","mov","wmv","flv","webm","m4v","3gp"],
      audio: ["mp3","wav","flac","aac","ogg","m4a","wma","opus"],
      pdf: ["pdf"],
      archive: ["zip","rar","7z","tar","gz","bz2","xz"],
      text: ["txt","md","json","xml","html","css","js","ts","py","java","c","cpp","h","cs","go","rb","php","sql","yml","yaml","ini","cfg","log","sh","bat","ps1","jsx","tsx","vue","svelte","rs","kt","swift","dart","r","lua","toml","env","gitignore","dockerfile","makefile","csv","tsv"]
    };
    for (const [type, exts] of Object.entries(map)) {
      if (exts.includes(ext)) return type;
    }
  }
  return "file";
}

function updateStorage(bytes) {
  el("storage-used").textContent = fmtBytes(bytes);
  el("storage-fill").style.width = Math.min(bytes / 1073741824 * 10, 95) + "%";
}

function toast(msg, type = "info") {
  const c = el("toast-container"), icons = { success: "fa-check-circle", error: "fa-exclamation-circle", warning: "fa-exclamation-triangle", info: "fa-info-circle" };
  const t = document.createElement("div"); t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type]}"></i><span>${msg}</span><button class="toast-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button><div class="toast-progress" style="color:${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : type === 'warning' ? 'var(--warning)' : 'var(--primary)'}"></div>`;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = "toast-out .3s forwards"; setTimeout(() => t.remove(), 300); }, 3500);
}

// ==================== EXPOSE GLOBAL CALLBACKS ====================
window.setLoginMethod = setLoginMethod;
window.loginAsBot = loginAsBot;
window.sendCode = sendCode;
window.verifyCode = verifyCode;
window.backToPhone = backToPhone;
window.logout = logout;
window.switchView = switchView;
window.handleUpload = handleUpload;
window.downloadFile = downloadFile;
window.previewFile = previewFile;
window.loadPreview = loadPreview;
window.previewNav = previewNav;
window.closePreview = closePreview;
window.downloadCurrentPreview = downloadCurrentPreview;
window.showContext = showContext;
window.hideContext = hideContext;
window.handleCardClick = handleCardClick;
window.toggleSelect = toggleSelect;
window.clearSelection = clearSelection;
window.bulkAction = bulkAction;
window.trashFile = trashFile;
window.restoreFile = restoreFile;
window.permDelete = permDelete;
window.emptyTrash = emptyTrash;
window.toggleStar = toggleStar;
window.copyFile = copyFile;
window.showInfo = showInfo;
window.showNewFolder = showNewFolder;
window.selectFolderColor = selectFolderColor;
window.createFolder = createFolder;
window.navFolder = navFolder;
window.deleteFolder = deleteFolder;
window.showRename = showRename;
window.doRename = doRename;
window.showMoveModal = showMoveModal;
window.selectMoveTarget = selectMoveTarget;
window.doMove = doMove;
window.handleSearch = handleSearch;
window.clearSearch = clearSearch;
window.handleSort = handleSort;
window.toggleView = toggleView;
window.refreshFiles = refreshFiles;
window.okConfirm = okConfirm;
window.cancelConfirm = cancelConfirm;
window.showShortcutsModal = showShortcutsModal;
window.closeModal = closeModal;
window.toggleSidebar = toggleSidebar;

// ==================== LOGIN GUIDE CAROUSEL ====================
let guideIndex = 0;
function setGuide(idx) {
  const slides = document.querySelector(".guide-slides");
  const dots = document.querySelectorAll(".guide-dot");
  const steps = document.querySelectorAll(".step-item");
  if (!slides) return;
  
  guideIndex = idx;
  if (guideIndex < 0) guideIndex = 6;
  if (guideIndex > 6) guideIndex = 0;
  
  slides.style.transform = `translateX(-${guideIndex * 100}%)`;
  
  if (dots.length) {
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === guideIndex);
    });
  }
  
  if (steps.length) {
    steps.forEach((step, i) => {
      step.classList.toggle("active", i === guideIndex);
    });
  }
}

function moveGuide(dir) {
  setGuide(guideIndex + dir);
}



function toggleHelpDrawer() {
  const drawer = el("help-drawer");
  drawer.classList.toggle("open");
  document.body.classList.toggle("drawer-open", drawer.classList.contains("open"));
}

window.setGuide = setGuide;
window.moveGuide = moveGuide;
window.toggleHelpDrawer = toggleHelpDrawer;
window.toggleUploadPanel = toggleUploadPanel;