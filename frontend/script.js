// Civic Sentinel frontend. Keep this file next to index.html.
const $ = (id) => document.getElementById(id);

const fileInput = $("fileInput");
const chooseFile = $("chooseFile");
const changeImage = $("changeImage");
const dropArea = $("dropArea");
const uploadContent = $("uploadContent");
const previewContainer = $("previewContainer");
const previewImage = $("previewImage");
const fileName = $("fileName");
const removeImage = $("removeImage");
const locationInput = $("location");
const descriptionInput = $("description");
const gpsButton = $("gpsButton");
const gpsInfo = $("gpsInfo");
const analyzeButton = $("analyzeButton");
const statusMessage = $("statusMessage");
const resultCard = $("resultCard");
const priorityBadge = $("priorityBadge");

const API_BASE = window.CIVIC_API_BASE || "http://127.0.0.1:8000";
const apiFetch = (...args) => window.CivicAuth.request(...args);
const API_URL = `${API_BASE}/analyze`;
let pendingIncident = null;
let pendingPhoto = null;
let incidentMap = null;
let mapMarkers = null;
let savedIncidents = [];
let firstMapLoad = true;
const incidentMarkers = new Map();
const priorityColors = { HIGH: "#ef4444", MEDIUM: "#f59e0b", LOW: "#10b981" };
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const originalButtonHTML = analyzeButton.innerHTML;
const originalGPSHTML = gpsButton.innerHTML;
let analysisVersion = 0;
let gpsRequestVersion = 0;
let selectedFile = null;
let previewURL = null;
let gpsLocation = null;

function showStatus(message, type = "normal") {
  const colors = {
    normal: "text-slate-400",
    success: "text-emerald-400",
    error: "text-red-400",
    loading: "text-blue-400"
  };
  statusMessage.textContent = message;
  statusMessage.className =
    `text-center text-sm mt-4 min-h-5 ${colors[type] || colors.normal}`;
}

function validateImage(file) {
  if (!file) {
    showStatus("Please choose an image.", "error");
    return false;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    showStatus("Only JPG, PNG and WebP images are supported.", "error");
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    showStatus("Image cannot exceed 10 MB.", "error");
    return false;
  }
  if (file.size === 0) {
    showStatus("The image is empty.", "error");
    return false;
  }
  return true;
}

function showPreview(file) {
  if (!validateImage(file)) return;
  analysisVersion++;
  pendingIncident = null;
  $("retrySave").classList.add("hidden");
  pendingPhoto = null;
  $("retryPhoto").classList.add("hidden");
  selectedFile = file;
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = URL.createObjectURL(file);
  previewImage.src = previewURL;
  fileName.textContent = file.name;
  uploadContent.classList.add("hidden");
  previewContainer.classList.remove("hidden");
  resultCard.classList.add("hidden");
  showStatus("Image ready for analysis!", "success");
}

chooseFile.addEventListener("click", () => fileInput.click());
changeImage.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) showPreview(fileInput.files[0]);
  fileInput.value = ""; // Allow choosing the same file again.
});

dropArea.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropArea.classList.add("dragging");
});
dropArea.addEventListener("dragleave", (event) => {
  if (!dropArea.contains(event.relatedTarget)) dropArea.classList.remove("dragging");
});
dropArea.addEventListener("drop", (event) => {
  event.preventDefault();
  dropArea.classList.remove("dragging");
  if (event.dataTransfer.files[0]) showPreview(event.dataTransfer.files[0]);
});

removeImage.addEventListener("click", () => {
  analysisVersion++; pendingIncident = null; pendingPhoto = null;
  $("retrySave").classList.add("hidden"); $("retryPhoto").classList.add("hidden");
  selectedFile = null;
  fileInput.value = "";
  previewImage.removeAttribute("src");
  fileName.textContent = "";
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null;
  previewContainer.classList.add("hidden");
  uploadContent.classList.remove("hidden");
  resultCard.classList.add("hidden");
  showStatus("Image removed.");
});

gpsButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showStatus("GPS is not supported. Please select a sector.", "error");
    return;
  }
  const gpsSessionEpoch = window.CivicAuth.epoch;
  const gpsRequest = ++gpsRequestVersion;
  gpsButton.disabled = true;
  gpsButton.textContent = "Detecting your location...";
  gpsInfo.textContent = "Waiting for location permission...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (gpsSessionEpoch !== window.CivicAuth.epoch || gpsRequest !== gpsRequestVersion) return;
      gpsLocation = {
        latitude: position.coords.latitude.toFixed(6),
        longitude: position.coords.longitude.toFixed(6)
      };
      locationInput.value = "";
      gpsButton.textContent = "✓ GPS Location Detected";
      gpsInfo.textContent = `${gpsLocation.latitude}, ${gpsLocation.longitude}`;
      gpsButton.disabled = false;
      showStatus("GPS coordinates captured!", "success");
    },
    (error) => {
      if (gpsSessionEpoch !== window.CivicAuth.epoch || gpsRequest !== gpsRequestVersion) return;
      console.error("GPS error:", error.message);
      gpsButton.disabled = false;
      gpsButton.innerHTML = originalGPSHTML;
      gpsInfo.textContent = "GPS unavailable. Please select a sector.";
      showStatus("Could not detect GPS location.", "error");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
});

locationInput.addEventListener("change", () => {
  if (!locationInput.value) return;
  gpsRequestVersion++; gpsButton.disabled = false;
  gpsLocation = null;
  gpsButton.innerHTML = originalGPSHTML;
  gpsInfo.textContent = "Manual location selected.";
});

function updatePriorityBadge(priority) {
  const styles = {
    HIGH: "text-red-400 bg-red-500/10 border border-red-500/30",
    MEDIUM: "text-amber-400 bg-amber-500/10 border border-amber-500/30",
    LOW: "text-emerald-400 bg-emerald-500/10 border border-emerald-500/30"
  };
  priorityBadge.className = `text-xs font-bold px-4 py-2 rounded-full ${styles[priority] || "text-slate-300 bg-slate-800"}`;
  priorityBadge.textContent = priority || "UNKNOWN";
}

analyzeButton.addEventListener("click", async () => {
  if (!selectedFile) {
    showStatus("Please upload an image first.", "error");
    return;
  }
  const location = locationInput.value ||
    (gpsLocation ? `${gpsLocation.latitude}, ${gpsLocation.longitude}` : "");
  if (!location) {
    showStatus("Select a sector or use GPS.", "error");
    return;
  }

  if (descriptionInput.value.trim().length > 5000) { showStatus("Description must be 5,000 characters or fewer.", "error"); return; }
  const requestVersion = ++analysisVersion;
  const analyzedFile = selectedFile;
  const formData = new FormData();
  formData.append("image", selectedFile);
  formData.append("location", location);
  const description = descriptionInput.value.trim();
  const coordinates = gpsLocation ? { latitude: Number(gpsLocation.latitude), longitude: Number(gpsLocation.longitude) } : { latitude: null, longitude: null };
  formData.append("description", description);
  if (coordinates.latitude !== null) {
    formData.append("latitude", coordinates.latitude);
    formData.append("longitude", coordinates.longitude);
  }
  pendingIncident = null;
  $("retrySave").classList.add("hidden");
  analyzeButton.disabled = true;
  analyzeButton.innerHTML = `
    <span class="inline-flex items-center gap-3">
      <span class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
      Analyzing with Gemini...
    </span>`;
  resultCard.classList.add("hidden");
  showStatus("Sending your image to Civic Sentinel AI...", "loading");

  try {
    const response = await apiFetch(API_URL, { method: "POST", body: formData });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("The backend returned an unreadable response."); }

    if (!response.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : "Analysis failed.");
    }
    if (!data.success || !data.analysis) throw new Error("Invalid AI response.");

    if (requestVersion !== analysisVersion) { if (data.saved) loadReports(); return; }
    const analysis = data.analysis;
    // textContent prevents server-returned text from being executed as HTML.
    $("resultProblem").textContent = analysis.problem || "Not identified";
    $("resultCategory").textContent = analysis.category || "OTHER";
    $("resultLocation").textContent = data.location || location;
    $("resultEvidence").textContent = analysis.visible_evidence || "Not available";
    $("resultAction").textContent = analysis.suggested_action || "Needs human review";
    updatePriorityBadge(analysis.priority);
    renderDuplicateInfo($("duplicateResult"), data);
    pendingPhoto = { id: data.incident_id, file: analyzedFile };
    showPhotoResult(data.photo, data.saved ? data.photo_error : "Photo will be linked when the report is saved.");
    $("retryPhoto").classList.toggle("hidden", !data.saved || Boolean(data.photo));
    if (data.photo) pendingPhoto = null;
    resultCard.classList.remove("hidden");
    pendingIncident = data.saved ? null : { id: data.incident_id, body: { analysis, location, description, ...coordinates } };
    $("saveStatus").textContent = data.saved ? "Saved to Firestore." : `Analysis complete; report not saved. ${data.save_error || "Please retry saving."}`;
    $("retrySave").classList.toggle("hidden", Boolean(data.saved));
    showStatus("Analysis completed successfully!", "success");
    if (data.saved) loadReports();
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    if (requestVersion !== analysisVersion) return;
    console.error("Civic Sentinel error:", error);
    showStatus(`Error: ${error.message}`, "error");
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.innerHTML = originalButtonHTML;
  }
});

let reportLoadVersion = 0;
async function loadReports() {
  if (!window.CivicAuth.session) return;
  const version = ++reportLoadVersion;
  const includeDemo = $("showDemoReports").checked;
  loadDashboardSummary();
  $("refreshReports").disabled = true;
  $("reportsStatus").textContent = "Loading saved reports...";
  try {
    const response = await apiFetch(`${API_BASE}/incidents?include_demo=${includeDemo}`);
    const data = await response.json();
    if (version !== reportLoadVersion) return;
    if (!response.ok) throw new Error(data.detail || "Unable to load reports.");
    savedIncidents = data.incidents;
    renderIncidentMap();
    $("reportsList").replaceChildren();
    for (const incident of data.incidents) {
      const card = document.createElement("article");
      card.className = "bg-slate-950/70 border border-slate-700 rounded-xl p-5";
      card.dataset.incidentId = incident.id;
      const evidence = document.createElement("img");
      evidence.alt = "Evidence for this civic report";
      evidence.className = "w-full max-h-64 object-contain rounded-lg mb-4 bg-slate-900";
      if (incident.photo) {
        loadProtectedPhoto(evidence, incident.photo);
        evidence.loading = "lazy";
        evidence.addEventListener("error", () => {
          evidence.hidden = true;
          const missing = document.createElement("p");
          missing.className = "text-xs text-amber-400 mb-3";
          missing.textContent = "Photo unavailable on this computer. You can attach it again.";
          card.prepend(missing);
        }, { once: true });
        card.append(evidence);
      }
      const addPhoto = document.createElement("button");
      addPhoto.type = "button";
      addPhoto.className = "mt-3 px-3 py-2 text-sm bg-slate-800 rounded-lg";
      addPhoto.textContent = incident.photo ? "Replace evidence photo" : "Add evidence photo";
      const photoInput = document.createElement("input");
      photoInput.type = "file"; photoInput.accept = "image/jpeg,image/png,image/webp"; photoInput.hidden = true;
      addPhoto.addEventListener("click", () => photoInput.click());
      photoInput.addEventListener("change", async () => {
        const file = photoInput.files[0];
        if (!file || !validateImage(file)) return;
        addPhoto.disabled = true; addPhoto.textContent = "Saving photo...";
        try { await uploadPhoto(incident.id, file); await loadReports(); }
        catch (error) { addPhoto.textContent = `Retry photo upload: ${error.message}`; }
        finally { addPhoto.disabled = false; photoInput.value = ""; }
      });
      const fields = [incident.analysis.problem, `${incident.analysis.category} · ${incident.analysis.priority} · ${incident.status}`, incident.location,
        incident.analysis.visible_evidence, incident.analysis.suggested_action,
        incident.created_at ? new Date(incident.created_at).toLocaleString() : ""];
      let statusLine;
      fields.forEach((value, index) => {
        const element = document.createElement(index === 0 ? "h4" : "p");
        element.className = index === 0 ? "font-bold" : "text-sm text-slate-400 mt-3";
        element.textContent = value;
        if (index === 1) { statusLine = element; element.textContent = `${incident.analysis.category} · ${incident.analysis.priority} · ${statusLabel(incident.status)}`; }
        card.append(element);
      });
      const duplicateInfo = document.createElement("div");
      duplicateInfo.className = "mt-4 border border-amber-500/30 rounded-lg p-3";
      renderDuplicateInfo(duplicateInfo, incident);
      card.append(duplicateInfo);
      if (hasCoordinates(incident) && incidentMap) {
        const viewButton = document.createElement("button");
        viewButton.type = "button";
        viewButton.className = "mt-4 px-3 py-2 text-sm text-blue-400 bg-blue-500/10 rounded-lg";
        viewButton.textContent = "View on map";
        viewButton.addEventListener("click", () => {
          $("mapPriority").value = "ALL";
          renderIncidentMap(false);
          $("mapSection").scrollIntoView({ behavior: "smooth", block: "start" });
          incidentMap.setView([incident.latitude, incident.longitude], 16);
          incidentMarkers.get(incident.id)?.openPopup();
        });
        card.append(viewButton);
      }
      if (incident.can_edit) card.append(addPhoto, photoInput);
      const controls = document.createElement("div");
      controls.className = "mt-5 pt-4 border-t border-slate-800 flex items-center gap-3 flex-wrap";
      const select = document.createElement("select");
      select.className = "bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-sm";
      select.setAttribute("aria-label", `Status for ${incident.analysis.problem}`);
      for (const value of ["OPEN", "IN_PROGRESS", "RESOLVED"]) {
        const option = document.createElement("option");
        option.value = value; option.textContent = statusLabel(value); select.append(option);
      }
      select.value = incident.status || "OPEN";
      const save = document.createElement("button");
      save.type = "button"; save.textContent = "Save status";
      save.className = "bg-blue-600 px-3 py-2 rounded-lg text-sm disabled:opacity-50";
      save.disabled = true;
      const feedback = document.createElement("p");
      feedback.className = "w-full text-xs text-slate-400";
      feedback.setAttribute("role", "status");
      select.addEventListener("change", () => { save.disabled = select.value === incident.status; feedback.textContent = ""; });
      save.addEventListener("click", async () => {
        const desired = select.value;
        save.disabled = true; select.disabled = true; feedback.textContent = "Saving status...";
        try {
          const response = await apiFetch(`${API_BASE}/incidents/${incident.id}/status`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: desired })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not save status.");
          incident.status = data.status;
          incident.updated_at = data.updated_at;
          incident.resolved_at = data.resolved_at;
          statusLine.textContent = `${incident.analysis.category} · ${incident.analysis.priority} · ${statusLabel(incident.status)}`;
          renderIncidentMap(false);
          loadDashboardSummary();
          feedback.textContent = `Saved: ${statusLabel(data.status)}.`;
        } catch (error) {
          feedback.textContent = error.message;
        } finally { select.disabled = false; save.disabled = select.value === incident.status; }
      });
      controls.append(select, save, feedback);
      if (incident.can_edit) card.append(controls);
      else { feedback.textContent = "Updates are available to the report creator or an administrator."; card.append(feedback); }
      $("reportsList").append(card);
    }
    $("reportsStatus").textContent = data.incidents.length ? `Showing ${data.incidents.length} most recent report${data.incidents.length === 1 ? "" : "s"}.` : "No saved reports yet. Analyze an image to create the first report.";
  } catch (error) {
    if (version !== reportLoadVersion) return;
    $("mapStatus").textContent = "Could not refresh saved locations. Any visible markers are from the previous load.";
    $("reportsStatus").textContent = error.message === "Failed to fetch" ? "Start the backend to load saved reports." : error.message;
  } finally { if (version === reportLoadVersion) $("refreshReports").disabled = false; }
}
$("refreshReports").addEventListener("click", loadReports);
$("retrySave").addEventListener("click", async () => {
  if (!pendingIncident) return;
  const current = pendingIncident;
  $("retrySave").disabled = true;
  try {
    const response = await apiFetch(`${API_BASE}/incidents/${current.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(current.body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not save report.");
    if (pendingIncident === current) {
      pendingIncident = null;
      $("retrySave").classList.add("hidden");
      $("saveStatus").textContent = "Saved to Firestore.";
      renderDuplicateInfo($("duplicateResult"), data);
      showPhotoResult(data.photo);
      $("retryPhoto").classList.toggle("hidden", Boolean(data.photo) || !pendingPhoto);
      if (data.photo) pendingPhoto = null;
    }
    loadReports();
  } catch (error) { if (pendingIncident === current) $("saveStatus").textContent = error.message; }
  finally { $("retrySave").disabled = false; }
});
function renderDuplicateInfo(container, incident) {
  container.replaceChildren();
  const matches = incident.duplicate_matches || [];
  container.classList.toggle("hidden", !matches.length && incident.duplicate_check !== "UNAVAILABLE");
  if (!matches.length) {
    if (incident.duplicate_check === "UNAVAILABLE") container.textContent = "Report saved; duplicate check was unavailable.";
    return;
  }
  const heading = document.createElement("p");
  heading.className = "text-amber-400 font-semibold text-sm";
  heading.textContent = "Possible duplicate — needs review";
  container.append(heading);
  for (const match of matches) {
    const details = document.createElement("details");
    details.className = "mt-3 text-sm text-slate-400";
    const summary = document.createElement("summary");
    summary.className = "cursor-pointer text-slate-300";
    summary.textContent = `Related report: ${match.problem}`;
    const reason = document.createElement("p");
    reason.className = "mt-2";
    reason.textContent = `${match.location}. ${match.reason}.`;
    const reference = document.createElement("p");
    reference.className = "mt-2 text-xs break-all";
    reference.textContent = `Report ID: ${match.id}. Both reports have been kept.`;
    details.append(summary, reason, reference);
    container.append(details);
  }
}

function hasCoordinates(incident) {
  return Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude) &&
    incident.latitude >= -90 && incident.latitude <= 90 &&
    incident.longitude >= -180 && incident.longitude <= 180;
}

function initializeIncidentMap() {
  if (!window.L) {
    $("mapStatus").textContent = "Map library could not load. Check your internet connection and reload; Saved Reports still works.";
    $("mapProjectStatus").textContent = "Unavailable";
    $("mapPriority").disabled = true;
    $("fitMap").disabled = true;
    return;
  }
  incidentMap = L.map("incidentMap", { scrollWheelZoom: false }).setView([30.7333, 76.7794], 12);
  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(incidentMap);
  tiles.on("tileerror", () => {
    $("mapTileStatus").textContent = "Some map tiles could not load. Report markers are still available; check your internet connection.";
  });
  mapMarkers = L.featureGroup().addTo(incidentMap);
  $("mapProjectStatus").textContent = "Ready";
  $("mapPriority").addEventListener("change", () => renderIncidentMap(true));
  $("fitMap").addEventListener("click", fitIncidentMap);
}

function fitIncidentMap() {
  if (!incidentMap) return;
  if (mapMarkers.getLayers().length) {
    incidentMap.fitBounds(mapMarkers.getBounds(), { padding: [35, 35], maxZoom: 16 });
  } else {
    incidentMap.setView([30.7333, 76.7794], 12);
  }
}

function renderIncidentMap(fit = firstMapLoad) {
  if (!incidentMap) return;
  mapMarkers.clearLayers();
  incidentMarkers.clear();
  const located = savedIncidents.filter(hasCoordinates);
  const selectedPriority = $("mapPriority").value;
  const visible = located.filter(incident => selectedPriority === "ALL" || incident.analysis.priority === selectedPriority);
  for (const incident of visible) {
    const priority = incident.analysis.priority;
    // Report text is inserted as text, never interpreted as popup HTML.
    const popup = document.createElement("div");
    popup.className = "incident-popup";
    const title = document.createElement("strong");
    title.textContent = incident.analysis.problem;
    popup.append(title);
    if (incident.photo) {
      const photo = document.createElement("img");
      loadProtectedPhoto(photo, incident.photo);
      photo.alt = "Incident evidence";
      photo.style.cssText = "width:100%;max-height:150px;object-fit:contain;margin-top:8px;border-radius:6px";
      photo.addEventListener("error", () => { photo.hidden = true; }, { once: true });
      popup.append(photo);
    }
    for (const text of [ `${incident.analysis.category} · ${priority} · ${statusLabel(incident.status)}`, incident.location,
      incident.analysis.suggested_action ]) {
      const line = document.createElement("p");
      line.textContent = text;
      popup.append(line);
    }
    const icon = L.divIcon({ className: "incident-pin", iconSize: [22, 22], iconAnchor: [11, 11],
      html: `<span style="display:block;width:100%;height:100%;border-radius:50%;background:${priorityColors[priority] || "#64748b"}"></span>` });
    const marker = L.marker([incident.latitude, incident.longitude], {
      icon, title: `${priority}: ${incident.analysis.problem}`, alt: "Civic incident marker"
    }).bindPopup(popup, { maxHeight: 280 }).addTo(mapMarkers);
    incidentMarkers.set(incident.id, marker);
  }
  const unlocated = savedIncidents.length - located.length;
  $("mapStatus").textContent = `${visible.length} mapped report${visible.length === 1 ? "" : "s"}${selectedPriority === "ALL" ? "" : ` at ${selectedPriority.toLowerCase()} priority`}. ${unlocated} report${unlocated === 1 ? "" : "s"} without exact coordinates.`;
  if (fit) fitIncidentMap();
  firstMapLoad = false;
}

function statusLabel(status) {
  return { OPEN: "Open", IN_PROGRESS: "In Progress", RESOLVED: "Resolved" }[status] || status;
}

function photoURL(photo) {
  // Only allow our backend photo endpoint, never a server-provided external URL.
  return /^\/incidents\/[0-9a-f-]{36}\/photo$/.test(photo?.url || "") ? `${API_BASE}${photo.url}` : "";
}

function showPhotoResult(photo, error = null) {
  $("resultPhoto").classList.toggle("hidden", !photo);
  if (photo) loadProtectedPhoto($("resultPhoto"), photo);
  else $("resultPhoto").removeAttribute("src");
  $("photoStatus").textContent = photo ? "Evidence photo saved on this computer." : error || "Evidence photo not saved yet.";
}

async function uploadPhoto(id, file) {
  const form = new FormData();
  form.append("image", file);
  const response = await apiFetch(`${API_BASE}/incidents/${id}/photo`, { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not save photo.");
  clearPhotoCache();
  return data;
}

$("retryPhoto").addEventListener("click", async () => {
  if (!pendingPhoto) return;
  const current = pendingPhoto;
  $("retryPhoto").disabled = true;
  try {
    const data = await uploadPhoto(current.id, current.file);
    if (pendingPhoto === current) {
      pendingPhoto = null;
      showPhotoResult(data.photo);
      $("retryPhoto").classList.add("hidden");
    }
    loadReports();
  } catch (error) { if (pendingPhoto === current) $("photoStatus").textContent = error.message; }
  finally { $("retryPhoto").disabled = false; }
});

function renderSummaryBars(container, counts, total, priority = false) {
  container.replaceChildren();
  for (const [label, count] of Object.entries(counts)) {
    if (!count) continue;
    const row = document.createElement("div");
    const heading = document.createElement("div");
    heading.className = "flex justify-between text-sm mb-1 gap-3";
    const name = document.createElement("span");
    name.className = "text-slate-300";
    name.textContent = label === "UNKNOWN" ? "Unspecified" : label.toLowerCase().replaceAll("_", " ").replace(/^./, character => character.toUpperCase());
    const number = document.createElement("span");
    number.className = "font-semibold"; number.textContent = count;
    heading.append(name, number);
    const track = document.createElement("div");
    track.className = "h-2 bg-slate-800 rounded-full overflow-hidden";
    track.setAttribute("role", "img"); track.setAttribute("aria-label", `${name.textContent}: ${count} of ${total} reports`);
    const bar = document.createElement("div");
    bar.style.width = `${total ? count / total * 100 : 0}%`;
    bar.style.height = "100%";
    bar.style.backgroundColor = priority ? priorityColors[label] || "#64748b" : "#3b82f6";
    track.append(bar); row.append(heading, track); container.append(row);
  }
  if (!total) { const empty = document.createElement("p"); empty.className = "text-sm text-slate-500"; empty.textContent = "No reports yet."; container.append(empty); }
}

let dashboardLoading = false;
let dashboardRefreshPending = false;
async function loadDashboardSummary() {
  if (!window.CivicAuth.session) return;
  const sessionEpoch = window.CivicAuth.epoch;
  if (dashboardLoading) { dashboardRefreshPending = true; return; }
  const includeDemo = $("showDemoReports").checked;
  dashboardLoading = true;
  $("refreshSummary").disabled = true;
  $("dashboardStatus").textContent = "Loading overview...";
  try {
    const response = await apiFetch(`${API_BASE}/dashboard/summary?include_demo=${includeDemo}`);
    const data = await response.json();
    if (sessionEpoch !== window.CivicAuth.epoch) return;
    if (includeDemo !== $("showDemoReports").checked) { dashboardRefreshPending = true; return; }
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not load overview.");
    $("countTotal").textContent = data.total;
    $("countOpen").textContent = data.by_status.OPEN;
    $("countProgress").textContent = data.by_status.IN_PROGRESS;
    $("countResolved").textContent = data.by_status.RESOLVED;
    renderSummaryBars($("categorySummary"), data.by_category, data.total);
    renderSummaryBars($("prioritySummary"), data.by_priority, data.total, true);
    $("duplicateSummary").textContent = `${data.possible_duplicates} report${data.possible_duplicates === 1 ? "" : "s"} flagged as possible duplicates.`;
    $("dashboardStatus").textContent = `Updated ${new Date(data.generated_at).toLocaleTimeString()}${data.hidden_demo_count ? ` · ${data.hidden_demo_count} demo reports hidden` : ""}${data.by_status.UNKNOWN ? ` · ${data.by_status.UNKNOWN} with unspecified status` : ""}`;
  } catch (error) {
    if (sessionEpoch !== window.CivicAuth.epoch) return;
    $("dashboardStatus").textContent = `${error.message} Any displayed totals are from the previous successful refresh.`;
  } finally {
    dashboardLoading = false; $("refreshSummary").disabled = false;
    if (dashboardRefreshPending) { dashboardRefreshPending = false; loadDashboardSummary(); }
  }
}
$("refreshSummary").addEventListener("click", loadDashboardSummary);
$("showDemoReports").addEventListener("change", () => {
  $("overviewScope").textContent = $("showDemoReports").checked ? "All saved reports, including labeled demo records." : "Saved civic reports. Demo records are hidden.";
  loadReports();
});
const protectedPhotos = new Map();
function clearPhotoCache() {
  for (const value of protectedPhotos.values()) value.then(url => { if (url) URL.revokeObjectURL(url); }).catch(() => {});
  protectedPhotos.clear();
}
async function loadProtectedPhoto(element, photo) {
  const url = photoURL(photo); const started = window.CivicAuth.epoch;
  if (!url) { element.hidden = true; return; }
  if (!protectedPhotos.has(url)) protectedPhotos.set(url, (async () => {
    const response = await apiFetch(url);
    if (!response.ok) throw new Error("Evidence photo unavailable.");
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  })());
  const entry = protectedPhotos.get(url);
  try {
    const objectURL = await entry;
    if (started === window.CivicAuth.epoch && protectedPhotos.get(url) === entry) {
      element.hidden = false; element.src = objectURL;
    }
  } catch {
    if (protectedPhotos.get(url) === entry) protectedPhotos.delete(url);
    if (started === window.CivicAuth.epoch) { element.hidden = true; element.dispatchEvent(new Event("error")); }
  }
}
function resetPrivateView() {
  reportLoadVersion++; gpsRequestVersion++; clearPhotoCache();
  savedIncidents = []; pendingIncident = null; pendingPhoto = null;
  $("reportsList").replaceChildren();
  mapMarkers?.clearLayers(); incidentMarkers.clear(); firstMapLoad = true;
  removeImage.click(); showStatus(""); locationInput.value = ""; descriptionInput.value = ""; gpsLocation = null;
  gpsInfo.textContent = ""; gpsButton.disabled = false; gpsButton.innerHTML = originalGPSHTML;
  $("resultPhoto").removeAttribute("src");
  for (const id of ["resultProblem", "resultCategory", "resultLocation", "resultEvidence", "resultAction", "saveStatus", "photoStatus", "duplicateResult", "categorySummary", "prioritySummary", "duplicateSummary"]) $(id).replaceChildren();
  for (const id of ["countTotal", "countOpen", "countProgress", "countResolved"]) $(id).textContent = "—";
  dashboardRefreshPending = false;
}
window.addEventListener("civic-auth-changed", () => {
  resetPrivateView();
  if (window.CivicAuth.session) { loadReports(); setTimeout(() => incidentMap?.invalidateSize(), 0); }
});
initializeIncidentMap();
window.CivicAuth.ready.then(() => { if (window.CivicAuth.session && !savedIncidents.length) loadReports(); });


