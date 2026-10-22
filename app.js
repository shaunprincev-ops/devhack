const STORE_KEY = "phc-assist-demo-records-v2";
const pages = ["dashboard", "screening", "records", "safety"];
const pathwayNames = {skin:"Skin image demo", anaemia:"Anaemia CBC model", vitals:"Vitals demo"};
const CBC_INPUTS = ["cbcRbc", "cbcMcv", "cbcMch", "cbcMchc"];
let toastTimer;
let anemiaModel = null;
let modelLoadMessage = "Checking model file…";

function getRecords() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); }
  catch (_) { return []; }
}
function saveRecords(records) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(records)); return true; }
  catch (_) { showToast("Could not save locally. Browser storage may be disabled."); return false; }
}
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
function goTo(page) {
  pages.forEach(name => document.getElementById("page-" + name).classList.toggle("active", name === page));
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.page === page));
  const labels = {dashboard:"Dashboard", screening:"New screening", records:"Demo records", safety:"About & safety"};
  document.getElementById("crumb").textContent = labels[page] || "Dashboard";
  window.scrollTo({top:0, behavior:"smooth"});
  if (page === "records") renderRecords();
}
document.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => goTo(btn.dataset.page)));
document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => goTo(btn.dataset.go)));
document.querySelectorAll("[data-path]").forEach(btn => btn.addEventListener("click", () => {
  document.getElementById("pathway").value = btn.dataset.path;
  updatePathwayFields();
  goTo("screening");
}));

function updateNetwork() {
  const online = navigator.onLine;
  const label = online ? "Online" : "Offline mode";
  document.getElementById("networkText").textContent = label;
  document.getElementById("sideNetwork").textContent = label;
  document.getElementById("sideNetworkSub").textContent = online ? "Offline cache available after setup" : "Using cached app files";
  document.getElementById("statConnection").textContent = label;
  document.getElementById("statConnectionFoot").textContent = online ? "Offline support enabled" : "No internet connection";
  document.getElementById("offlineInfo").textContent = online ? "App shell is ready for offline use after caching." : "You are currently using the app offline.";
  document.querySelectorAll(".status-dot").forEach(dot => dot.classList.toggle("offline", !online));
}
window.addEventListener("online", updateNetwork);
window.addEventListener("offline", updateNetwork);
updateNetwork();

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then(() => { document.getElementById("offlineInfo").textContent = "Offline cache enabled for app files and model."; })
      .catch(() => { document.getElementById("offlineInfo").textContent = "Could not enable offline cache in this browser."; });
  });
} else {
  document.getElementById("offlineInfo").textContent = "Open through localhost or HTTPS to enable offline caching.";
}

const pathway = document.getElementById("pathway");
function updatePathwayFields() {
  const isVitals = pathway.value === "vitals";
  const isAnaemia = pathway.value === "anaemia";
  document.getElementById("vitalsFields").classList.toggle("hidden", !isVitals);
  document.getElementById("anaemiaFields").classList.toggle("hidden", !isAnaemia);
  document.getElementById("imageFields").classList.toggle("hidden", isVitals || isAnaemia);
  CBC_INPUTS.forEach(id => {
    const input = document.getElementById(id);
    input.disabled = !isAnaemia;
    input.required = isAnaemia;
  });
  ["systolic", "pulse", "spo2"].forEach(id => { document.getElementById(id).disabled = !isVitals; });
  document.getElementById("resultPanel").classList.add("hidden");
  document.getElementById("submitScreening").textContent = isAnaemia ? "Run CBC model →" : "Generate demo result →";
}
pathway.addEventListener("change", updatePathwayFields);
document.getElementById("sampleImage").addEventListener("change", event => {
  const file = event.target.files && event.target.files[0];
  document.getElementById("fileName").textContent = file ? file.name : "No file selected";
});

async function loadAnemiaModel() {
  try {
    // The service worker uses network-first for this JSON, so a newly trained model
    // can replace the placeholder while online and then be cached for offline use.
    const response = await fetch("./anemia_model.json", {cache:"no-store"});
    if (!response.ok) throw new Error("Model file not found");
    const model = await response.json();
    if (!model.ready || !Array.isArray(model.coefficients) || model.coefficients.length !== 4) {
      anemiaModel = null;
      modelLoadMessage = "No trained model installed. Follow README.md to train one; no predictions will be generated.";
    } else {
      anemiaModel = model;
      modelLoadMessage = `Trained research model loaded (${model.dataset?.rows_used ?? "unknown"} rows used). Not clinically validated.`;
    }
  } catch (_) {
    anemiaModel = null;
    modelLoadMessage = "Model file unavailable. Train a model and place it at models/anemia_model.json.";
  }
  const status = document.getElementById("modelStatus");
  if (status) status.textContent = modelLoadMessage;
  const readiness = document.getElementById("modelReadiness");
  if (readiness) readiness.textContent = modelLoadMessage;
}
loadAnemiaModel();

function predictCBC(values) {
  if (!anemiaModel) throw new Error("A trained model is not installed. See README.md.");
  const x = values.map((value, i) => {
    if (!Number.isFinite(value)) throw new Error("Enter all four CBC values.");
    const imputed = value;
    const standardized = (imputed - anemiaModel.means[i]) / (anemiaModel.scales[i] || 1);
    return standardized;
  });
  let z = anemiaModel.intercept;
  for (let i = 0; i < x.length; i++) z += x[i] * anemiaModel.coefficients[i];
  // Numerically stable sigmoid.
  const score = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
  return {score, flag: score >= (anemiaModel.decision_boundary ?? 0.5)};
}

document.getElementById("screeningForm").addEventListener("reset", () => {
  setTimeout(() => {
    document.getElementById("fileName").textContent = "No file selected";
    updatePathwayFields();
  }, 0);
});
document.getElementById("screeningForm").addEventListener("submit", async event => {
  event.preventDefault();
  const caseRef = document.getElementById("caseRef").value.trim();
  if (!caseRef) { showToast("Enter a fictional case reference first."); return; }
  const ageRaw = document.getElementById("age").value;
  const type = pathway.value;
  const baseRecord = {
    id: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
    caseRef,
    age: ageRaw === "" ? null : Number(ageRaw),
    pathway: type,
    createdAt: new Date().toISOString()
  };

  if (type === "anaemia") {
    if (!anemiaModel) {
      showToast("No trained model installed. Follow README.md; no prediction was made.");
      await loadAnemiaModel();
      return;
    }
    const values = CBC_INPUTS.map(id => Number(document.getElementById(id).value));
    if (CBC_INPUTS.some(id => document.getElementById(id).value.trim() === "") || values.some(v => !Number.isFinite(v))) {
      showToast("Enter all four CBC values."); return;
    }
    let prediction;
    try { prediction = predictCBC(values); }
    catch (error) { showToast(error.message); return; }
    const record = {
      ...baseRecord,
      outcome: prediction.flag ? "Exploratory model flag" : "Lower model score (not a rule-out)",
      modelScore: prediction.score,
      modelFlag: prediction.flag,
      modelVersion: anemiaModel.model_version,
      simulated: false,
      researchOnly: true
    };
    const records = getRecords();
    records.unshift(record);
    saveRecords(records);
    renderResult(record);
    renderDashboard();
    showToast("Exploratory model output created; not a clinical decision.");
    return;
  }

  // Preserve the other pathways as explicitly simulated UI demonstrations.
  const record = {...baseRecord, outcome:"Demo only — no analysis", simulated:true};
  const records = getRecords();
  records.unshift(record);
  saveRecords(records);
  renderResult(record);
  renderDashboard();
  showToast("Demo result created; no AI analysis was performed.");
});

function renderResult(record) {
  const panel = document.getElementById("resultPanel");
  panel.classList.remove("hidden");
  if (record.pathway === "anaemia" && !record.simulated) {
    const scorePct = (record.modelScore * 100).toFixed(1);
    const title = record.modelFlag ? "Higher model score (exploratory flag)" : "Lower model score (not a rule-out)";
    const metrics = anemiaModel?.held_out_test_metrics;
    const metricLine = metrics ? `Internal held-out test: n=${metrics.test_n}; balanced accuracy=${fmtMetric(metrics.balanced_accuracy)}; sensitivity=${fmtMetric(metrics.sensitivity_recall)}; specificity=${fmtMetric(metrics.specificity)}. These are dataset-specific exploratory metrics, not clinical validation.` : "No held-out evaluation metrics are available in the model file.";
    panel.innerHTML = `
      <span class="result-label">EXPERIMENTAL AI OUTPUT · NOT A DIAGNOSIS</span>
      <h2>${escapeHTML(title)}</h2>
      <p>Case reference: <strong>${escapeHTML(record.caseRef)}</strong>${record.age !== null ? " · Age entered: " + escapeHTML(record.age) : ""}</p>
      <span class="outcome ${record.modelFlag ? "demo-referral" : "demo-review"}">Model score: ${scorePct}%</span>
      <p>This is the output of a trained logistic-regression model using RBC, MCV, MCH and MCHC. The displayed score is not a calibrated probability of disease and does not establish whether anaemia is present.</p>
      <p><strong>Model evaluation:</strong> ${escapeHTML(metricLine)}</p>
      <div class="result-warning"><strong>Safety:</strong> The 0.5 model boundary is an exploratory software threshold, not a clinically justified referral threshold. A lower score does not rule out anaemia. Do not use this output for real patient care. Confirm with appropriate laboratory testing and clinician assessment.</div>
      <div style="margin-top:15px"><button class="btn btn-secondary btn-small" id="resultToRecords">View local research records →</button></div>`;
  } else {
    panel.innerHTML = `
      <span class="result-label">DEMO RESULT · NOT AI ANALYSIS</span>
      <h2>Demo result for ${escapeHTML(record.caseRef)}</h2>
      <p>Pathway: <strong>${escapeHTML(pathwayNames[record.pathway])}</strong>${record.age !== null ? " · Age entered: " + escapeHTML(record.age) : ""}</p>
      <span class="outcome demo-review">Demo only — no analysis</span>
      <p>This result only demonstrates the interface. No uploaded image or vital-sign value was analysed by an AI model.</p>
      <div class="result-warning"><strong>Safety reminder:</strong> Do not use this simulated output for a real patient.</div>
      <div style="margin-top:15px"><button class="btn btn-secondary btn-small" id="resultToRecords">View local demo records →</button></div>`;
  }
  document.getElementById("resultToRecords").addEventListener("click", () => goTo("records"));
  panel.scrollIntoView({behavior:"smooth", block:"start"});
}
function fmtMetric(value) { return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "not available"; }
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleString([], {year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); }
  catch (_) { return iso; }
}
function outcomeClass(outcome) {
  return String(outcome || "").includes("flag") || outcome === "Demo referral" ? "demo-referral" : "demo-review";
}
function outcomeBadge(outcome) {
  return `<span class="outcome ${outcomeClass(outcome)}">${escapeHTML(outcome || "Unknown")}</span>`;
}
function renderDashboard() {
  const records = getRecords();
  document.getElementById("recordCount").textContent = records.length;
  document.getElementById("statTotal").textContent = records.length;
  document.getElementById("statReferral").textContent = records.filter(r => r.modelFlag === true || r.outcome === "Demo referral").length;
  document.getElementById("statConnection").textContent = navigator.onLine ? "Online" : "Offline";
  document.getElementById("statConnectionFoot").textContent = navigator.onLine ? "Offline support enabled" : "No internet connection";
  const tbody = document.getElementById("recentRows");
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No demo records yet. Start a screening to create one.</td></tr>';
    return;
  }
  tbody.innerHTML = records.slice(0,5).map(r => `<tr><td class="case-id">${escapeHTML(r.caseRef)}</td><td>${escapeHTML(pathwayNames[r.pathway] || r.pathway)}</td><td>${escapeHTML(fmtDate(r.createdAt))}</td><td>${outcomeBadge(r.outcome)}</td></tr>`).join("");
}
function renderRecords() {
  const records = getRecords();
  document.getElementById("recordCount").textContent = records.length;
  const tbody = document.getElementById("allRows");
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No demo records yet.</td></tr>';
    return;
  }
  tbody.innerHTML = records.map(r => `<tr><td class="case-id">${escapeHTML(r.caseRef)}</td><td>${escapeHTML(pathwayNames[r.pathway] || r.pathway)}</td><td>${r.age === null ? "—" : escapeHTML(r.age)}</td><td>${escapeHTML(fmtDate(r.createdAt))}</td><td>${outcomeBadge(r.outcome)}</td><td><button class="btn btn-secondary btn-small" data-delete="${escapeHTML(r.id)}">Delete</button></td></tr>`).join("");
  tbody.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => {
    saveRecords(getRecords().filter(r => r.id !== btn.dataset.delete));
    renderRecords(); renderDashboard(); showToast("Record deleted from this browser.");
  }));
}
document.getElementById("clearRecords").addEventListener("click", () => {
  if (!getRecords().length) { showToast("There are no records to clear."); return; }
  if (confirm("Clear all local demo/research records from this browser?")) {
    saveRecords([]); renderRecords(); renderDashboard(); showToast("Local records cleared.");
  }
});
document.getElementById("exportBtn").addEventListener("click", () => {
  const payload = {exportedAt:new Date().toISOString(), note:"Local prototype records only. Research model outputs are unvalidated and are not clinical records.", records:getRecords()};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "phc-assist-local-records.json"; a.click();
  URL.revokeObjectURL(url);
  showToast("Export created.");
});

updatePathwayFields();
renderDashboard();
