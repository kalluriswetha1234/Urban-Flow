let map;
let markerLayer;
let incidentsCache = [];
let toastTimer;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));

function priorityClass(label) {
  return String(label || "Low").toLowerCase();
}
function statusClass(status) {
  return String(status || "").toLowerCase().replace(/\s+/g, "-");
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
function initMap() {
  if (typeof L === "undefined") {
    $("#map").innerHTML = '<div class="empty-state">Map library could not load. Check your internet connection and refresh.</div>';
    return;
  }
  map = L.map("map").setView([15.8281, 78.0373], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}
function renderMap(incidents) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  const mappable = incidents.filter(i => Number.isFinite(Number(i.lat)) && Number.isFinite(Number(i.lng)) && i.lat !== null && i.lng !== null);
  mappable.forEach(i => {
    const color = i.priority_label === "High" ? "#e45757" : i.priority_label === "Medium" ? "#e7a33e" : "#14b8a6";
    const icon = L.divIcon({
      className: "",
      html: `<div class="custom-marker" style="background:${color}"></div>`,
      iconSize: [15, 15],
      iconAnchor: [7, 7]
    });
    const marker = L.marker([Number(i.lat), Number(i.lng)], {icon}).addTo(markerLayer);
    marker.bindPopup(`<div class="popup-title">${escapeHtml(i.title)}</div><div class="popup-meta">${escapeHtml(i.location)}<br>${escapeHtml(i.category)} · ${escapeHtml(i.status)}<br>Priority score: <b>${i.priority_score}/10 (${escapeHtml(i.priority_label)})</b>${i.is_sample ? "<br><em>Sample incident</em>" : ""}</div>`);
  });
  if (mappable.length > 1) {
    const group = L.featureGroup(markerLayer.getLayers());
    try { map.fitBounds(group.getBounds().pad(0.18), {maxZoom: 14}); } catch (_) {}
  } else if (mappable.length === 1) {
    map.setView([Number(mappable[0].lat), Number(mappable[0].lng)], 14);
  }
}
function renderStats(stats) {
  $("#stat-total").textContent = stats.total;
  $("#stat-active").textContent = stats.active;
  $("#stat-high").textContent = stats.high_priority;
  $("#stat-resolved").textContent = stats.resolved;
}
function renderPriority(incidents) {
  const list = $("#priority-list");
  const open = incidents.filter(i => i.status !== "Resolved")
    .sort((a, b) => b.priority_score - a.priority_score || b.id - a.id)
    .slice(0, 5);
  if (!open.length) {
    list.innerHTML = '<div class="empty-state">No active incidents. Nice work!</div>';
    return;
  }
  list.innerHTML = open.map((i, index) => `
    <div class="priority-item">
      <div class="priority-number">${String(index + 1).padStart(2, "0")}</div>
      <div class="priority-item-main"><strong>${escapeHtml(i.title)}</strong><small>${escapeHtml(i.location)} · ${escapeHtml(i.category)}</small></div>
      <span class="score-pill ${priorityClass(i.priority_label)}">${i.priority_score}/10</span>
    </div>`).join("");
}
function renderTasks(incidents) {
  const filter = $("#status-filter").value;
  const filtered = incidents.filter(i => filter === "All" || i.status === filter);
  const tbody = $("#task-table");
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No incidents match this filter.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(i => `
    <tr data-id="${i.id}">
      <td><span class="incident-name">${escapeHtml(i.title)}${i.is_sample ? ' <span title="Sample data">•</span>' : ''}</span><span class="incident-meta">${escapeHtml(i.location)} · ${escapeHtml(i.category)}${i.is_sample ? " · SAMPLE" : ""}</span></td>
      <td><span class="score-pill ${priorityClass(i.priority_label)}">${escapeHtml(i.priority_label)} · ${i.priority_score}/10</span></td>
      <td><input class="worker-input" aria-label="Assigned worker for incident ${i.id}" value="${escapeHtml(i.assigned_to)}" placeholder="Worker name"></td>
      <td><select class="status-select" aria-label="Status for incident ${i.id}">
        ${["Reported", "Assigned", "In Progress", "Resolved"].map(s => `<option ${i.status === s ? "selected" : ""}>${s}</option>`).join("")}
      </select></td>
      <td><button class="save-btn" data-save="${i.id}">Save update</button></td>
    </tr>`).join("");
}
async function loadDashboard() {
  try {
    const response = await fetch("/api/incidents");
    if (!response.ok) throw new Error("Could not load incidents.");
    const data = await response.json();
    incidentsCache = data.incidents;
    renderStats(data.stats);
    renderMap(incidentsCache);
    renderPriority(incidentsCache);
    renderTasks(incidentsCache);
    $("#last-updated").textContent = `Updated ${new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}`;
  } catch (error) {
    showToast("Could not load dashboard. Is Flask running?");
    console.error(error);
  }
}
async function submitIncident(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  $("#submit-btn").disabled = true;
  $("#submit-btn").textContent = "Saving…";
  const message = $("#form-message");
  message.textContent = "";
  message.className = "form-message";
  try {
    const response = await fetch("/api/incidents", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save report.");
    form.reset();
    form.elements.severity.value = "3";
    form.elements.repeat_reports.value = "0";
    form.elements.impact.value = "1";
    message.textContent = `Report #${data.incident.id} saved. Priority score: ${data.incident.priority_score}/10 (${data.incident.priority_label}).`;
    message.className = "form-message success";
    await loadDashboard();
    showToast("Incident report saved successfully.");
    $("#overview").scrollIntoView({behavior: "smooth", block: "start"});
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message error";
  } finally {
    $("#submit-btn").disabled = false;
    $("#submit-btn").innerHTML = 'Submit report <span>→</span>';
  }
}
async function saveTask(button) {
  const row = button.closest("tr");
  const id = button.dataset.save;
  const assigned_to = row.querySelector(".worker-input").value.trim();
  const status = row.querySelector(".status-select").value;
  if (status === "Assigned" && !assigned_to) {
    showToast("Enter a worker name before assigning this task.");
    return;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const response = await fetch(`/api/incidents/${id}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({assigned_to, status})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update task.");
    await loadDashboard();
    showToast(`Incident #${id} updated to ${status}.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save update";
  }
}
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  loadDashboard();
  $("#incident-form").addEventListener("submit", submitIncident);
  $("#status-filter").addEventListener("change", () => renderTasks(incidentsCache));
  $("#task-table").addEventListener("click", event => {
    const button = event.target.closest("[data-save]");
    if (button) saveTask(button);
  });
  document.querySelectorAll("[data-scroll]").forEach(button => {
    button.addEventListener("click", () => {
      document.getElementById(button.dataset.scroll)?.scrollIntoView({behavior: "smooth", block: "start"});
      document.querySelectorAll(".nav-item").forEach(nav => nav.classList.toggle("active", nav.dataset.scroll === button.dataset.scroll));
    });
  });
});
