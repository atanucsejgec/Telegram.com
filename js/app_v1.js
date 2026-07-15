const API = "/api";
let currentUser = null, currentFolder = "root", currentView = "files";
let viewMode = "grid", selectedItems = new Set(), sortBy = "name", sortOrder = "asc";
let currentFiles = [], currentFolders = [], allFiles = [];
let previewFileId = null, previewIndex = -1, previewableFiles = [];
let moveTargetId = "root", moveItems = [], renameTarget = null;
let searchTimeout = null, dragCounter = 0;

const FOLDER_COLORS = ["#ffab00","#f44336","#e91e63","#9c27b0","#673ab7","#3f51b5","#2196f3","#0088cc","#009688","#4caf50","#8bc34a","#ff9800","#795548","#607d8b"];
let selectedFolderColor = "#ffab00";

// ==================== INIT ====================
document.addEventListener("DOMContentLoaded", () => { checkAuth(); setupDragDrop(); setupKeys(); document.addEventListener("click", e => { if (!document.getElementById("context-menu").contains(e.target)) hideContext(); }); });

// ==================== AUTH ====================
function saveAuth(user, session) { localStorage.setItem("tgDrive", JSON.stringify({ user, session, at: Date.now() })); }
function getAuth() { try { const d = JSON.parse(localStorage.getItem("tgDrive")); if (d && Date.now() - d.at < 2592e6) return d; } catch (e) {} localStorage.removeItem("tgDrive"); return null; }
function clearAuth() { localStorage.removeItem("tgDrive"); }

async function checkAuth() {
  try {
    const r = await fetch(`${API}/auth/status`, { credentials: "include" });
    const d = await r.json();
    if (d.authenticated) { currentUser = d.user; showApp(); loadFiles(); return; }
    const saved = getAuth();
    if (saved?.session) {
      showLoad();
      const r2 = await fetch(`${API}/auth/restore-session`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telegramSession: saved.session }) });
      const d2 = await r2.json();
      if (d2.success) { currentUser = d2.user; saveAuth(d2.user, saved.session); showApp(); loadFiles(); toast(`Welcome back, ${d2.user.name}!`, "success"); return; }
      clearAuth();
    }
    showAuthScreen();
  } catch (e) { showAuthScreen(); }
}

function showLoad() { show("loading-screen"); hide("auth-screen"); hide("app-screen"); }
function showAuthScreen() { hide("loading-screen"); show("auth-screen"); hide("app-screen"); }
function showApp() {
  hide("loading-screen"); hide("auth-screen"); show("app-screen");
  if (currentUser) {
    el("user-name").textContent = currentUser.name;
    el("user-phone").textContent = currentUser.phone;
    el("user-avatar").textContent = currentUser.name[0].toUpperCase();
  }
}

async function sendCode() {
  const phone = "+" + el("phone-input").value.replace(/\D/g, "");
  if (phone.length < 8) return showErr("Enter valid phone number");
  const btn = event.target; btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Sending...';
  try {
    const r = await fetch(`${API}/auth/send-code`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phoneNumber: phone }) });
    const d = await r.json();
    if (d.success) { window._authSid = d.sessionId; hide("phone-step"); show("code-step"); el("code-input").focus(); toast("Code sent!", "success"); }
    else showErr(d.error);
  } catch (e) { showErr("Connection error"); }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Code';
}

async function verifyCode() {
  const code = el("code-input").value.trim(), pw = el("password-input").value;
  if (!code) return showErr("Enter code");
  const btn = event.target; btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Verifying...';
  try {
    const r = await fetch(`${API}/auth/verify-code`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: window._authSid, code, password: pw || undefined }) });
    const d = await r.json();
    if (d.success) { currentUser = d.user; saveAuth(d.user, d.telegramSession); toast(`Welcome, ${d.user.name}!`, "success"); showApp(); loadFiles(); }
    else if (d.needPassword) { show("password-group"); el("password-input").focus(); showErr("2FA password required"); }
    else showErr(d.error);
  } catch (e) { showErr("Connection error"); }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Verify';
}

function backToPhone() { show("phone-step"); hide("code-step"); hide("password-group"); hide("auth-error"); }
function showErr(msg) { const e = el("auth-error"); e.textContent = msg; show("auth-error"); }
async function logout() { try { await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }); } catch (e) {} clearAuth(); currentUser = null; showAuthScreen(); toast("Logged out", "info"); }

// ==================== FILES ====================
async function loadFiles(folderId) {
  if (folderId !== undefined) currentFolder = folderId;
  clearSelection();
  try {
    const params = new URLSearchParams({ folderId: currentFolder, sortBy, sortOrder });
    if (currentView === "trash") params.set("trashed", "true");
    if (currentView === "starred") params.set("starred", "true");
    const r = await fetch(`${API}/files/list?${params}`, { credentials: "include" });
    const d = await r.json();
    if (!d.success) return;

    currentFiles = d.files; currentFolders = d.folders;
    renderBreadcrumb(d.breadcrumb);
    renderFolders(d.folders); renderFiles(d.files);
    updateStorage(d.storageUsed);

    const hasContent = d.folders.length > 0 || d.files.length > 0;
    toggle("empty-state", !hasContent); toggle("folders-section", d.folders.length > 0); toggle("files-section", d.files.length > 0);
    toggle("trash-bar", currentView === "trash" && d.files.length > 0);

    // Update trash badge
    if (d.trashedCount > 0) { el("trash-badge").textContent = d.trashedCount; show("trash-badge"); }
    else hide("trash-badge");
  } catch (e) { console.error(e); toast("Failed to load files", "error"); }
}

function renderBreadcrumb(bc) {
  if (!bc) bc = [{ id: "root", name: "My Drive" }];
  const viewNames = { files: "My Drive", recent: "Recent", starred: "Starred", images: "Images", videos: "Videos", audio: "Audio", documents: "Documents", trash: "Trash" };
  if (currentView !== "files") {
    el("breadcrumb").innerHTML = `<a href="#" onclick="switchView('${currentView}')">${viewNames[currentView] || currentView}</a>`;
    return;
  }
  el("breadcrumb").innerHTML = bc.map((f, i) =>
    `${i > 0 ? '<span class="sep"><i class="fas fa-chevron-right"></i></span>' : ''}<a href="#" onclick="navFolder('${f.id}')">${esc(f.name)}</a>`
  ).join("");
}

function renderFolders(folders) {
  const g = el("folders-grid");
  g.className = `file-grid ${viewMode === "list" ? "list-view" : ""}`;
  g.innerHTML = folders.map(f => {
    const color = f.color || "#ffab00";
    return `<div class="file-card${selectedItems.has(f.id) ? ' selected' : ''}" ondblclick="navFolder('${f.id}')" onclick="handleCardClick(event,'${f.id}','folder')" oncontextmenu="showContext(event,'folder','${f.id}')">
      <div class="card-checkbox" onclick="event.stopPropagation();toggleSelect('${f.id}','folder')"><i class="fas fa-check"></i></div>
      <div class="file-icon folder" style="background:${color}20;color:${color}"><i class="fas fa-folder"></i></div>
      ${viewMode === "list" ? `<div class="file-info"><div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">Folder</div><div class="file-date">${fmtDate(f.createdDate)}</div></div>` : `<div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">Folder</div>`}
      <div class="card-actions"><button onclick="event.stopPropagation();showContext(event,'folder','${f.id}')" title="More"><i class="fas fa-ellipsis-v"></i></button></div>
    </div>`;
  }).join("");
}

function renderFiles(files) {
  const g = el("files-grid");
  g.className = `file-grid ${viewMode === "list" ? "list-view" : ""}`;
  el("file-count").textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
  g.innerHTML = files.map(f => {
    const starred = f.starred ? 'active' : '';
    return `<div class="file-card${selectedItems.has(f.id) ? ' selected' : ''}" onclick="handleCardClick(event,'${f.id}','file')" ondblclick="previewFile('${f.id}')" oncontextmenu="showContext(event,'file','${f.id}')">
      <div class="card-checkbox" onclick="event.stopPropagation();toggleSelect('${f.id}','file')"><i class="fas fa-check"></i></div>
      <div class="file-star ${starred}" onclick="event.stopPropagation();toggleStar('${f.id}')" title="Star"><i class="fas fa-star"></i></div>
      <div class="file-icon ${f.type}"><i class="${fileIcon(f.type)}"></i></div>
      ${viewMode === "list" ? `<div class="file-info"><div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">${fmtBytes(f.size)}</div><div class="file-date">${fmtDate(f.uploadDate)}</div></div>` : `<div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">${fmtBytes(f.size)} ┬╖ ${fmtDate(f.uploadDate)}</div>`}
      <div class="card-actions"><button onclick="event.stopPropagation();downloadFile('${f.id}','${esc(f.name)}')" title="Download"><i class="fas fa-download"></i></button><button onclick="event.stopPropagation();showContext(event,'file','${f.id}')" title="More"><i class="fas fa-ellipsis-v"></i></button></div>
    </div>`;
  }).join("");
}

// ==================== UPLOAD ====================
async function handleUpload(event) {
  const files = event.target.files; if (!files?.length) return;
  const panel = el("upload-panel"), list = el("upload-list");
  show("upload-panel");

  const formData = new FormData();
  for (const f of files) formData.append("files", f);
  formData.append("folderId", currentFolder);

  // Show items in upload list
  list.innerHTML = "";
  for (const f of files) {
    const item = document.createElement("div");
    item.className = "upload-item";
    item.innerHTML = `<div class="upload-item-icon"><i class="${fileIcon(fileTypeFromMime(f.type, f.name))}"></i></div><div class="upload-item-info"><div class="upload-item-name">${esc(f.name)}</div><div class="upload-progress"><div class="upload-progress-bar" style="width:0%"></div></div><div class="upload-status">Waiting...</div></div>`;
    list.appendChild(item);
  }

  try {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        list.querySelectorAll(".upload-progress-bar").forEach(b => b.style.width = pct + "%");
        list.querySelectorAll(".upload-status").forEach(s => s.textContent = `Uploading... ${pct}%`);
      }
    };
    await new Promise((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status === 200) {
          const d = JSON.parse(xhr.responseText);
          list.querySelectorAll(".upload-status").forEach(s => { s.textContent = "Γ£ô Done"; s.className = "upload-status success"; });
          list.querySelectorAll(".upload-progress-bar").forEach(b => { b.style.width = "100%"; b.style.background = "var(--success)"; });
          toast(`${d.files?.length || 0} file(s) uploaded`, "success");
          resolve();
        } else reject(new Error("Upload failed"));
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.open("POST", `${API}/files/upload`);
      xhr.withCredentials = true;
      xhr.send(formData);
    });
  } catch (e) {
    list.querySelectorAll(".upload-status").forEach(s => { s.textContent = "Γ£ù " + e.message; s.className = "upload-status error"; });
    toast("Upload failed", "error");
  }

  loadFiles(); event.target.value = "";
  setTimeout(() => { hide("upload-panel"); list.innerHTML = ""; }, 4000);
}

// ==================== DOWNLOAD ====================
async function downloadFile(id, name) {
  toast(`Downloading "${name}"...`, "info");
  try {
    const r = await fetch(`${API}/files/download/${id}`, { credentials: "include" });
    if (!r.ok) throw new Error("Download failed");
    const blob = await r.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
    toast(`"${name}" downloaded`, "success");
  } catch (e) { toast("Download failed: " + e.message, "error"); }
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

  const url = `${API}/files/preview/${file.id}`;
  const type = file.type;
  const ext = file.name.split(".").pop().toLowerCase();

  try {
    if (type === "image") {
      body.innerHTML = `<img src="${url}" alt="${esc(file.name)}" onclick="event.stopPropagation()">`;
    } else if (type === "video") {
      body.innerHTML = `<video controls autoplay><source src="${url}">Your browser does not support video.</video>`;
    } else if (type === "audio") {
      body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:20px;padding:40px"><i class="fas fa-music" style="font-size:64px;color:var(--primary);opacity:.5"></i><audio controls autoplay style="width:80%;max-width:500px"><source src="${url}"></audio></div>`;
    } else if (type === "pdf") {
      body.innerHTML = `<iframe src="${url}#toolbar=1" title="PDF Preview"></iframe>`;
    } else if (type === "text" || isCodeFile(ext)) {
      const r = await fetch(url, { credentials: "include" });
      const text = await r.text();
      const lang = getLanguage(ext);
      body.innerHTML = `<div class="code-wrapper"><pre><code class="${lang}">${escCode(text)}</code></pre></div>`;
    } else {
      body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-2)"><i class="fas ${fileIcon(type)}" style="font-size:64px;margin-bottom:16px;opacity:.3"></i><h3>Preview not available</h3><p style="margin:8px 0">${esc(file.name)}</p><p>${fmtBytes(file.size)}</p><button class="btn btn-primary" onclick="downloadFile('${file.id}','${esc(file.name)}')"><i class="fas fa-download"></i> Download</button></div>`;
    }
  } catch (e) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger)"><i class="fas fa-exclamation-circle" style="font-size:48px;margin-bottom:12px"></i><p>Preview failed: ${e.message}</p></div>`;
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
    html = `<button class="ctx-item" onclick="restoreFile('${id}')"><i class="fas fa-undo"></i>Restore</button>
            <button class="ctx-item danger" onclick="permDelete('${id}')"><i class="fas fa-trash"></i>Delete Forever</button>`;
  } else if (type === "file") {
    html = `<button class="ctx-item" onclick="previewFile('${id}')"><i class="fas fa-eye"></i>Preview</button>
            <button class="ctx-item" onclick="downloadFile('${id}','')"><i class="fas fa-download"></i>Download</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item" onclick="showRename('file','${id}')"><i class="fas fa-edit"></i>Rename</button>
            <button class="ctx-item" onclick="showMoveModal(['${id}'],'file')"><i class="fas fa-arrows-alt"></i>Move to</button>
            <button class="ctx-item" onclick="copyFile('${id}')"><i class="fas fa-copy"></i>Make a copy</button>
            <button class="ctx-item" onclick="toggleStar('${id}')"><i class="fas fa-star"></i>Star</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item" onclick="showInfo('${id}')"><i class="fas fa-info-circle"></i>Details</button>
            <button class="ctx-item danger" onclick="trashFile('${id}')"><i class="fas fa-trash"></i>Move to Trash</button>`;
  } else if (type === "folder") {
    html = `<button class="ctx-item" onclick="navFolder('${id}')"><i class="fas fa-folder-open"></i>Open</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item" onclick="showRename('folder','${id}')"><i class="fas fa-edit"></i>Rename</button>
            <button class="ctx-item" onclick="showMoveModal(['${id}'],'folder')"><i class="fas fa-arrows-alt"></i>Move to</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item danger" onclick="deleteFolder('${id}')"><i class="fas fa-trash"></i>Delete</button>`;
  }

  menu.innerHTML = html;
  show("context-menu");

  let x = e.clientX, y = e.clientY;
  const mw = menu.offsetWidth || 180, mh = menu.offsetHeight || 200;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = x + "px"; menu.style.top = y + "px";
}

function hideContext() { hide("context-menu"); }

// ==================== SELECTION ====================
function handleCardClick(e, id, type) {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); toggleSelect(id, type); return; }
  if (e.shiftKey) { e.preventDefault(); toggleSelect(id, type); return; }
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
  // Re-render to update checkboxes
  renderFolders(currentFolders); renderFiles(currentFiles);
}

async function bulkAction(action) {
  const ids = [...selectedItems];
  if (!ids.length) return;
  if (action === "move") { showMoveModal(ids, "mixed"); return; }
  try {
    const r = await fetch(`${API}/files/bulk`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids }) });
    const d = await r.json();
    if (d.success) { toast(`${d.affected} items updated`, "success"); clearSelection(); loadFiles(); }
  } catch (e) { toast("Operation failed", "error"); }
}

// ==================== FILE OPERATIONS ====================
async function trashFile(id) {
  try {
    const r = await fetch(`${API}/files/${id}`, { method: "DELETE", credentials: "include" });
    if ((await r.json()).success) { toast("Moved to trash", "success"); loadFiles(); }
  } catch (e) { toast("Failed", "error"); }
  hideContext();
}

async function restoreFile(id) {
  try {
    const r = await fetch(`${API}/files/${id}/restore`, { method: "POST", credentials: "include" });
    if ((await r.json()).success) { toast("File restored", "success"); loadFiles(); }
  } catch (e) { toast("Restore failed", "error"); }
  hideContext();
}

async function permDelete(id) {
  if (!confirm("Delete forever? This cannot be undone.")) return;
  try {
    const r = await fetch(`${API}/files/${id}?permanent=true`, { method: "DELETE", credentials: "include" });
    if ((await r.json()).success) { toast("Permanently deleted", "success"); loadFiles(); }
  } catch (e) { toast("Delete failed", "error"); }
  hideContext();
}

async function emptyTrash() {
  if (!confirm("Empty trash? All items will be permanently deleted.")) return;
  try {
    const r = await fetch(`${API}/files/empty-trash`, { method: "POST", credentials: "include" });
    const d = await r.json();
    if (d.success) { toast(`${d.deleted} items deleted`, "success"); loadFiles(); }
  } catch (e) { toast("Failed", "error"); }
}

async function toggleStar(id) {
  try {
    const r = await fetch(`${API}/files/${id}/star`, { method: "PUT", credentials: "include" });
    if ((await r.json()).success) loadFiles();
  } catch (e) {}
  hideContext();
}

async function copyFile(id) {
  try {
    const r = await fetch(`${API}/files/${id}/copy`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId: currentFolder }) });
    if ((await r.json()).success) { toast("Copy created", "success"); loadFiles(); }
  } catch (e) { toast("Copy failed", "error"); }
  hideContext();
}

async function showInfo(id) {
  try {
    const r = await fetch(`${API}/files/${id}/info`, { credentials: "include" });
    const d = await r.json();
    if (d.success) {
      const f = d.file;
      el("info-content").innerHTML = `
        <div style="display:grid;grid-template-columns:100px 1fr;gap:8px;font-size:13px">
          <span style="color:var(--text-2)">Name</span><span>${esc(f.name)}</span>
          <span style="color:var(--text-2)">Size</span><span>${fmtBytes(f.size)}</span>
          <span style="color:var(--text-2)">Type</span><span>${f.mimeType || f.type}</span>
          <span style="color:var(--text-2)">Uploaded</span><span>${new Date(f.uploadDate).toLocaleString()}</span>
          <span style="color:var(--text-2)">Location</span><span>${d.folder?.name || "Root"}</span>
          <span style="color:var(--text-2)">Starred</span><span>${f.starred ? "Yes" : "No"}</span>
        </div>`;
      show("info-modal");
    }
  } catch (e) {}
  hideContext();
}

// ==================== FOLDERS ====================
function showNewFolder() {
  closeModal("folder-modal"); show("folder-modal");
  el("folder-name").value = ""; el("folder-name").focus();
  // Render color picker
  el("folder-color-picker").innerHTML = FOLDER_COLORS.map(c =>
    `<div class="color-dot${c === selectedFolderColor ? ' active' : ''}" style="background:${c}" onclick="selectFolderColor('${c}',this)"></div>`
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
  try {
    const r = await fetch(`${API}/folders/create`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parentId: currentFolder, color: selectedFolderColor }) });
    const d = await r.json();
    if (d.success) { closeModal("folder-modal"); toast(`Folder "${name}" created`, "success"); loadFiles(); }
    else toast(d.error, "error");
  } catch (e) { toast("Failed", "error"); }
}

function navFolder(id) { currentView = "files"; updateNav("files"); currentFolder = id; loadFiles(id); }

async function deleteFolder(id) {
  if (!confirm("Delete folder and all contents?")) return;
  try {
    const r = await fetch(`${API}/folders/${id}`, { method: "DELETE", credentials: "include" });
    if ((await r.json()).success) { toast("Folder deleted", "success"); loadFiles(); }
  } catch (e) { toast("Failed", "error"); }
  hideContext();
}

// ==================== RENAME ====================
function showRename(type, id) {
  hideContext();
  renameTarget = { type, id };
  el("rename-input").value = "";
  el("rename-input").placeholder = type === "folder" ? "New folder name" : "New file name";
  show("rename-modal");
  el("rename-input").focus();
}

async function doRename() {
  const name = el("rename-input").value.trim();
  if (!name || !renameTarget) return;
  const url = renameTarget.type === "folder" ? `${API}/folders/${renameTarget.id}/rename` : `${API}/files/${renameTarget.id}/rename`;
  try {
    const r = await fetch(url, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if ((await r.json()).success) { closeModal("rename-modal"); toast("Renamed", "success"); loadFiles(); }
  } catch (e) { toast("Rename failed", "error"); }
}

// ==================== MOVE ====================
async function showMoveModal(ids, type) {
  hideContext();
  moveItems = ids;
  try {
    const r = await fetch(`${API}/folders/all`, { credentials: "include" });
    const d = await r.json();
    if (!d.success) return;

    moveTargetId = "root";
    const tree = el("folder-tree");
    function renderTree(folders, parentId, depth = 0) {
      return folders.filter(f => f.parentId === parentId).map(f =>
        `<div class="${depth > 0 ? 'tree-indent' : ''}"><div class="tree-item${f.id === moveTargetId ? ' active' : ''}" onclick="selectMoveTarget('${f.id}',this)"><i class="fas fa-folder" style="color:${f.color || '#ffab00'}"></i>${esc(f.name)}</div>${renderTree(folders, f.id, depth + 1)}</div>`
      ).join("");
    }
    tree.innerHTML = `<div class="tree-item${moveTargetId === 'root' ? ' active' : ''}" onclick="selectMoveTarget('root',this)"><i class="fas fa-hard-drive" style="color:var(--primary)"></i>My Drive</div>${renderTree(d.folders, "root")}`;
    show("move-modal");
  } catch (e) { toast("Failed to load folders", "error"); }
}

function selectMoveTarget(id, elem) {
  moveTargetId = id;
  document.querySelectorAll(".tree-item").forEach(t => t.classList.remove("active"));
  elem.classList.add("active");
}

async function doMove() {
  try {
    // Move files
    const r = await fetch(`${API}/files/bulk`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "move", ids: moveItems, folderId: moveTargetId }) });
    // Also try moving folders
    for (const id of moveItems) {
      try {
        await fetch(`${API}/folders/${id}/move`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId: moveTargetId }) });
      } catch (e) {}
    }
    closeModal("move-modal"); clearSelection(); toast("Moved successfully", "success"); loadFiles();
  } catch (e) { toast("Move failed", "error"); }
}

// ==================== SEARCH & FILTER ====================
function handleSearch(q) {
  clearTimeout(searchTimeout);
  el("search-clear").classList.toggle("hidden", !q);
  if (!q.trim()) { loadFiles(); return; }
  searchTimeout = setTimeout(async () => {
    try {
      const r = await fetch(`${API}/files/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
      const d = await r.json();
      if (d.success) {
        currentFiles = d.files; currentFolders = [];
        hide("folders-section"); renderFiles(d.files);
        toggle("files-section", d.files.length > 0); toggle("empty-state", d.files.length === 0);
      }
    } catch (e) {}
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
    const r = await fetch(`${API}/files/search?type=${typeMap[type] || ""}`, { credentials: "include" });
    const d = await r.json();
    if (d.success) {
      currentFiles = d.files; currentFolders = [];
      renderBreadcrumb(); hide("folders-section"); renderFiles(d.files);
      toggle("files-section", d.files.length > 0); toggle("empty-state", d.files.length === 0);
      hide("trash-bar");
    }
  } catch (e) {}
}

function toggleView() {
  viewMode = viewMode === "grid" ? "list" : "grid";
  el("view-toggle").innerHTML = viewMode === "grid" ? '<i class="fas fa-th-large"></i>' : '<i class="fas fa-list"></i>';
  renderFolders(currentFolders); renderFiles(currentFiles);
}

function refreshFiles() { loadFiles(); toast("Refreshed", "info"); }

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
    if (e.key === "Escape") { closePreview(); closeModal("folder-modal"); closeModal("rename-modal"); closeModal("move-modal"); closeModal("info-modal"); hideContext(); clearSelection(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "u") { e.preventDefault(); el("file-upload").click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); el("search-input").focus(); }
    if (e.key === "Delete" && selectedItems.size) bulkAction("trash");
    // Preview navigation
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
  if (!m) return "file";
  if (m.startsWith("image/")) return "image"; if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio"; if (m.includes("pdf")) return "pdf";
  if (m.includes("zip") || m.includes("rar") || m.includes("archive")) return "archive";
  if (m.includes("text") || m.includes("json") || m.includes("javascript")) return "text";
  return "file";
}

function updateStorage(bytes) {
  el("storage-used").textContent = fmtBytes(bytes);
  el("storage-fill").style.width = Math.min(bytes / 1073741824 * 10, 95) + "%";
}

function toast(msg, type = "info") {
  const c = el("toast-container"), icons = { success: "fa-check-circle", error: "fa-exclamation-circle", warning: "fa-exclamation-triangle", info: "fa-info-circle" };
  const t = document.createElement("div"); t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type]}"></i><span>${msg}</span><button class="toast-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = "slideOut .3s forwards"; setTimeout(() => t.remove(), 300); }, 3500);
}
