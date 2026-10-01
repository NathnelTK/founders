/**
 * Foundry — frontend controller.
 *
 * Security note: every value that originates from the model, the API, or another
 * founder's published pitch is inserted with textContent, never innerHTML. Model
 * output is untrusted input and the community board is user-generated content.
 *
 * BYOK note: a founder's own API key is kept in localStorage and sent per request to
 * this app's own API (same origin, over HTTPS), which proxies the provider call. The key
 * is never written to the DOM after saving and never rendered back into an input field.
 */

import * as Auth from "./auth.js";

const API = ""; // same-origin; CloudFront routes /api/* to the Lambda Function URL

const $ = (id) => document.getElementById(id);

const VAULT_KEY = "founder-arena.vault.v1";
const PROJECT_KEY = "foundry.project.v1";
const SETTINGS_KEY = "foundry.settings.v1";

const TABS = ["pitch", "assumptions", "council", "decision", "battle", "vault", "community"];

/** Current evaluation in view, plus its live investability after Q&A. */
let current = null;
let liveInvestability = null;

/** The active canvas: hypothesis + evaluation + board + council + decision. */
let project = null;

/* ── Utilities ───────────────────────────────────────────────────────────── */

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attrs || {})) node.setAttribute(k, v);
  for (const [k, v] of Object.entries(opts.style || {})) node.style.setProperty(k, v);
  for (const child of [].concat(children)) if (child && child !== false) node.append(child);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function showLoading(text) {
  $("loadingText").textContent = text;
  $("loading").hidden = false;
}
function hideLoading() {
  $("loading").hidden = true;
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { ...Auth.authHeader() };
  if (body) headers["content-type"] = "application/json";

  const res = await fetch(`${API}/api/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON error body */
  }

  if (!res.ok) {
    throw new Error(payload?.error || `Request failed (${res.status})`);
  }
  return payload;
}

/** Severity band for a 0-100 score. Returns a status token, never a series hue. */
function severity(score) {
  if (score >= 75) return { color: "var(--good)", word: "strong" };
  if (score >= 60) return { color: "var(--warning)", word: "workable" };
  if (score >= 45) return { color: "var(--serious)", word: "fragile" };
  return { color: "var(--critical)", word: "weak" };
}

function fmtNumber(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
                             : String(Math.round(v * 100) / 100);
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ── Settings (engine + BYOK) ────────────────────────────────────────────── */

const PROVIDER_LABELS = { anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter" };

function readSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (raw && typeof raw === "object") {
      return {
        mode: raw.mode === "byok" ? "byok" : "default",
        provider: PROVIDER_LABELS[raw.provider] ? raw.provider : "anthropic",
        key: typeof raw.key === "string" ? raw.key : "",
        model: typeof raw.model === "string" ? raw.model : ""
      };
    }
  } catch {
    /* corrupt settings — fall back to defaults */
  }
  return { mode: "default", provider: "anthropic", key: "", model: "" };
}

function writeSettings(next) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage disabled — settings are best-effort */
  }
  renderCouncilControls();
}

/** The BYOK payload for a request, or null when the default engine is selected. */
function byokPayload() {
  const s = readSettings();
  if (s.mode !== "byok" || !s.key.trim()) return null;
  return { provider: s.provider, key: s.key.trim(), model: s.model.trim() };
}

/* ── Project state ───────────────────────────────────────────────────────── */

function readProject() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROJECT_KEY) || "null");
    if (raw && typeof raw === "object" && Array.isArray(raw.assumptions)) return raw;
  } catch {
    /* corrupt project — start fresh */
  }
  return null;
}

function persistProject() {
  if (!project) return;
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  } catch {
    /* quota or storage disabled */
  }
  updateBoardBadge();
}

function updateBoardBadge() {
  const open = (project?.assumptions || []).filter((a) => a.status === "unvalidated" || a.status === "testing").length;
  $("navBoardCount").textContent = String(open);
}

/* ── Health / engine pill ────────────────────────────────────────────────── */

async function refreshHealth() {
  const pill = $("enginePill");
  const label = $("engineLabel");
  try {
    const health = await api("health");
    if (health.engine === "bedrock") {
      pill.dataset.state = "bedrock";
      label.textContent = "Claude on Bedrock";
      pill.title = `Live: ${health.model} in ${health.region}`;
    } else {
      pill.dataset.state = "heuristics";
      label.textContent = "Deterministic engine";
      pill.title = health.bedrock?.reason
        ? `Bedrock unavailable — ${health.bedrock.reason}`
        : "Bedrock unavailable; scoring locally";
    }
    const storage = $("storageMode");
    if (storage) storage.textContent = `Storage: ${health.storage}`;
  } catch {
    pill.dataset.state = "down";
    label.textContent = "API unreachable";
  }
}

/* ── Navigation ──────────────────────────────────────────────────────────── */

/* ── Navigation & topbar switching ──────────────────────────────────────── */

function enterApp() {
  // Switch from landing topbar to app topbar
  const landing = $("landingTopbar");
  const appBar  = $("appTopbar");
  if (landing) landing.hidden = true;
  if (appBar)  appBar.hidden  = false;

  $("hero").hidden = true;
  $("app").hidden  = false;
}

function returnToLanding() {
  // Switch back to landing (if needed in future)
  const landing = $("landingTopbar");
  const appBar  = $("appTopbar");
  if (landing) landing.hidden = false;
  if (appBar)  appBar.hidden  = true;

  $("hero").hidden = false;
  $("app").hidden  = true;
}

function selectTab(name) {
  const target = TABS.includes(name) ? name : "pitch";
  for (const t of TABS) {
    const panel = $(`panel-${t}`);
    const active = t === target;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  }
  for (const link of document.querySelectorAll("#mainNav .navlink")) {
    const active = link.dataset.tab === target;
    link.classList.toggle("is-active", active);
    link.setAttribute("aria-current", active ? "page" : "false");
  }

  enterApp();

  if (target === "assumptions") renderBoard();
  if (target === "council") renderCouncil();
  if (target === "decision") renderDecision();
  if (target === "battle") populateBattleSelects();
  if (target === "vault") renderVault();
  if (target === "community") loadCommunity();
}

/* ── Vault (localStorage) ────────────────────────────────────────────────── */

function readVault() {
  try {
    const raw = JSON.parse(localStorage.getItem(VAULT_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeVault(items) {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(items.slice(0, 60)));
  } catch {
    /* quota exceeded or storage disabled — vault is best-effort */
  }
  $("vaultCount").textContent = String(items.length);
}

function renderVault() {
  const list = $("vaultList");
  clear(list);
  const items = readVault();
  $("vaultCount").textContent = String(items.length);

  if (!items.length) {
    list.append(el("p", { class: "empty", text: "Nothing saved yet. Build a board, then save it here." }));
    return;
  }

  for (const item of items) {
    const verdict = item.decision?.verdict;
    const card = el("article", { class: "vault-item" }, [
      el("h3", { text: item.name || "Unnamed concept" }),
      el("div", { class: "vault-meta" }, [
        el("span", { text: item.sector || "—" }),
        el("span", { text: "·" }),
        el("span", { text: item.market || "—" })
      ]),
      el("p", { class: "vault-roast", text: item.roast || "" }),
      el("div", { class: "vault-scores" }, [
        el("span", { text: "Global" }, [el("b", { text: String(item.scores?.global ?? "—") })]),
        el("span", { text: "Investability" }, [el("b", { text: String(item.scores?.investability ?? "—") })]),
        verdict ? el("span", { text: "Call" }, [el("b", { text: verdict })]) : null
      ])
    ]);

    const openBtn = el("button", { class: "btn-ghost btn-sm", text: "Open" });
    openBtn.addEventListener("click", () => {
      if (Array.isArray(item.assumptions) && item.assumptions.length) {
        project = {
          ...item,
          council: item.council || [],
          decision: item.decision || null,
          updatedAt: new Date().toISOString()
        };
        persistProject();
        hydrateForm(item);
        renderResults(item);
        renderBoard();
        renderCouncil();
        renderDecision();
      } else {
        renderResults(item);
      }
      selectTab("pitch");
    });

    const delBtn = el("button", { class: "btn-ghost btn-sm", text: "Delete" });
    delBtn.addEventListener("click", () => {
      writeVault(readVault().filter((x) => x.savedAt !== item.savedAt));
      renderVault();
      populateBattleSelects();
    });

    card.append(el("div", { class: "vault-actions" }, [openBtn, delBtn]));
    list.append(card);
  }
}

/* ── Results rendering ───────────────────────────────────────────────────── */

function statTile({ label, value, unit, caption, score }) {
  const sev = severity(score);
  return el("div", { class: "kpi", style: { "--meter-color": sev.color } }, [
    el("div", { class: "kpi-label", text: label }),
    el("div", { class: "kpi-value", text: String(value) }, unit ? [el("span", { class: "unit", text: unit })] : []),
    el("div", { class: "meter" }, [
      el("div", { class: "meter-fill", style: { width: `${Math.max(0, Math.min(100, score))}%` } })
    ]),
    el("div", { class: "kpi-caption", text: caption })
  ]);
}

function renderKpis(data) {
  const row = $("kpiRow");
  clear(row);

  const global = data.scores?.global ?? 0;
  const invest = liveInvestability ?? data.scores?.investability ?? 0;
  const conf = data.confidence ?? 0;

  row.append(
    statTile({
      label: "Global rating",
      value: global,
      unit: "/100",
      caption: `Concept strength — ${severity(global).word}`,
      score: global
    }),
    statTile({
      label: "Investability",
      value: invest,
      unit: "/100",
      caption:
        liveInvestability !== null && liveInvestability !== data.scores?.investability
          ? `Adjusted from ${data.scores.investability} by your Q&A answer`
          : `Would an investor write a cheque today — ${severity(invest).word}`,
      score: invest
    }),
    statTile({
      label: "Assessment confidence",
      value: conf,
      unit: "/100",
      caption: conf >= 65 ? "Enough detail to judge" : "Thin input — add specifics",
      score: conf
    })
  );
}

function renderEconomics(econ) {
  const card = $("econCard");
  const figures = $("econFigures");
  const note = $("econNote");
  clear(figures);

  if (!econ || econ.contribution === null || econ.contribution === undefined) {
    card.style.setProperty("--meter-color", "var(--text-muted)");
    note.textContent = econ?.note || "No unit economics supplied.";
    return;
  }

  const marginPct = Number(econ.marginPct) || 0;
  const sev = marginPct >= 40 ? severity(80) : marginPct >= 25 ? severity(65) : marginPct > 0 ? severity(50) : severity(20);
  card.style.setProperty("--meter-color", sev.color);

  const figure = (label, value) =>
    el("dl", { class: "econ-figure" }, [el("dt", { text: label }), el("dd", { text: value })]);

  figures.append(
    figure("Contribution per unit", fmtNumber(econ.contribution)),
    figure("Contribution margin", `${marginPct.toFixed(1)}%`),
    figure("CAC payback", econ.paybackUnits ? `${Number(econ.paybackUnits).toFixed(1)} units` : "—")
  );

  note.textContent = econ.note || "";
}

function renderList(nodeId, items) {
  const node = $(nodeId);
  clear(node);
  for (const item of items || []) node.append(el("li", { text: String(item) }));
  if (!items?.length) node.append(el("li", { text: "—" }));
}

function renderResults(data) {
  current = data;
  liveInvestability = null;

  $("resultName").textContent = data.name || "Your concept";

  const engineTag = $("resultEngine");
  const engine = data.engine || "heuristics";
  if (engine === "bedrock") {
    engineTag.textContent = `Claude on Bedrock · ${data.model || ""}`.trim();
    engineTag.title = "Evaluated by Claude via the Amazon Bedrock Converse API";
  } else {
    engineTag.textContent = "Deterministic engine";
    engineTag.title = data.fallbackReason
      ? `Bedrock unavailable — ${data.fallbackReason}`
      : "Deterministic local scoring";
  }

  $("roast").textContent = data.roast || "";
  $("vcTakeaway").textContent = data.vcTakeaway || "—";
  $("marketPotential").textContent = data.marketPotential || "—";
  $("monetization").textContent = data.monetization || "—";
  $("crowded").textContent = data.crowded || "—";
  $("opportunity").textContent = data.opportunity || "—";
  $("regionalAnalysis").textContent = data.regionalAnalysis || "—";

  renderKpis(data);
  renderEconomics(data.economics);
  renderList("risks", data.risks);
  renderList("suggestions", data.suggestions);
  renderList("missingSkills", data.missingSkills?.length ? data.missingSkills : ["No critical gaps identified."]);

  const roadmap = $("roadmap");
  clear(roadmap);
  for (const step of data.roadmap || []) {
    roadmap.append(
      el("li", {}, [
        el("span", { class: "wk", text: step.week || "" }),
        el("span", { class: "wk-item", text: step.item || "" })
      ])
    );
  }

  $("investorQuestion").textContent = data.investorQuestion || "—";
  $("investorAnswer").value = "";
  $("critique").hidden = true;
  $("actionNote").textContent = "";

  $("results").hidden = false;
}

/* ── Form helpers ────────────────────────────────────────────────────────── */

function collectPitch() {
  const skills = [...document.querySelectorAll("#skillChips input:checked")].map((i) => i.value);
  const num = (id) => {
    const v = $(id).value.trim();
    return v === "" ? undefined : Number(v);
  };
  return {
    name: $("f-name").value.trim(),
    sector: $("f-sector").value.trim(),
    market: $("f-market").value.trim(),
    pitch: $("f-pitch").value.trim(),
    skills,
    price: num("f-price"),
    cogs: num("f-cogs"),
    cac: num("f-cac")
  };
}

function hydrateForm(p) {
  $("f-name").value = p.name || "";
  $("f-sector").value = p.sector || "";
  $("f-market").value = p.market || "";
  $("f-pitch").value = p.pitch || "";
  $("f-price").value = p.price ?? "";
  $("f-cogs").value = p.cogs ?? "";
  $("f-cac").value = p.cac ?? "";
  const skills = Array.isArray(p.skills) ? p.skills : [];
  for (const input of document.querySelectorAll("#skillChips input")) input.checked = skills.includes(input.value);
  updatePitchCount();
}

/* ── Pitch submission ────────────────────────────────────────────────────── */

async function onSubmit(event) {
  event.preventDefault();
  const error = $("formError");
  error.hidden = true;

  const pitch = collectPitch();

  if (!pitch.name || !pitch.sector || !pitch.market) {
    error.textContent = "Name, sector, and target audience are all required.";
    error.hidden = false;
    return;
  }
  if (pitch.pitch.length < 20) {
    error.textContent = "The hypothesis needs at least 20 characters — give the engine something to work with.";
    error.hidden = false;
    return;
  }

  $("analyzeBtn").disabled = true;
  showLoading("Building the assumption board…");

  try {
    const result = await api("evaluate", { method: "POST", body: pitch });

    project = {
      ...pitch,
      evaluation: result,
      assumptions: result.assumptions || [],
      council: result.council || [],
      councilEngine: result.engine || "heuristics",
      decision: result.decision || null,
      engine: result.engine,
      updatedAt: new Date().toISOString()
    };
    persistProject();

    renderResults({ ...result, pitch: pitch.pitch });
    renderBoard();
    renderCouncil();
    renderDecision();
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
    refreshHealth();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    hideLoading();
    $("analyzeBtn").disabled = false;
  }
}

/* ── Assumption Board ────────────────────────────────────────────────────── */

const STATUS_LABELS = {
  unvalidated: "Unvalidated",
  testing: "In-Testing",
  validated: "Validated",
  invalidated: "Invalidated"
};

const STATUS_ORDER = ["unvalidated", "testing", "validated", "invalidated"];

const CATEGORY_ORDER = ["Desirability", "Viability", "Feasibility"];

function categoryBlurb(category) {
  if (category === "Desirability") return "Do they want it?";
  if (category === "Viability") return "Can it become a business?";
  return "Can this team build and run it?";
}

function ensureIds() {
  let changed = false;
  for (const a of project?.assumptions || []) {
    if (!a.status) {
      a.status = "unvalidated";
      changed = true;
    }
    if (a.evidence === undefined) {
      a.evidence = "";
      changed = true;
    }
    if (a.evidenceUrl === undefined) {
      a.evidenceUrl = "";
      changed = true;
    }
  }
  if (changed) persistProject();
}

function renderBoard() {
  const columns = $("boardColumns");
  const empty = $("boardEmpty");
  const summary = $("boardSummary");
  clear(columns);

  const assumptions = project?.assumptions || [];
  if (!assumptions.length) {
    empty.hidden = false;
    summary.hidden = true;
    updateBoardBadge();
    return;
  }
  empty.hidden = true;
  ensureIds();

  // Summary strip
  clear(summary);
  summary.hidden = false;
  const counts = STATUS_ORDER.map((s) => ({ s, n: assumptions.filter((a) => a.status === s).length }));
  const highRisk = assumptions.filter((a) => a.risk === "High").length;
  summary.append(
    el("div", { class: "summary-row" }, [
      ...counts.map(({ s, n }) =>
        el("span", { class: `summary-chip status-${s}` }, [
          el("b", { text: String(n) }),
          el("span", { text: STATUS_LABELS[s] })
        ])
      ),
      el("span", { class: "summary-chip" }, [el("b", { text: String(highRisk) }), el("span", { text: "High risk total" })])
    ])
  );
  $("boardHint").textContent = `${assumptions.length} assumptions across desirability, viability, and feasibility. Test the highest-risk ones first.`;

  for (const category of CATEGORY_ORDER) {
    const items = assumptions.filter((a) => a.category === category);
    if (!items.length) continue;

    const column = el("div", { class: "board-column" }, [
      el("div", { class: "board-column-head" }, [
        el("h3", { text: category }),
        el("span", { class: "board-column-blurb", text: categoryBlurb(category) })
      ]),
      el("div", { class: "board-column-body" }, items.map(renderAssumptionCard))
    ]);
    columns.append(column);
  }

  updateBoardBadge();
}

function renderAssumptionCard(a) {
  const idLabel = String(a.id || "").toUpperCase();

  const statusRow = el("div", { class: "status-row", attrs: { role: "group", "aria-label": `Status for ${idLabel}` } });
  for (const status of STATUS_ORDER) {
    const btn = el("button", {
      class: `status-btn status-${status}${a.status === status ? " is-active" : ""}`,
      text: STATUS_LABELS[status],
      attrs: { type: "button", "data-status": status, "aria-pressed": String(a.status === status) }
    });
    statusRow.append(btn);
  }

  const evidenceNote = a.evidence ? `${a.evidence}${a.evidenceUrl ? ` · ${a.evidenceUrl}` : ""}` : a.evidenceHint || "";

  const details = el("details", { class: "evidence" }, [
    el("summary", { text: a.evidence ? "Evidence recorded" : "Attach evidence" }),
    el("label", { class: "field" }, [
      el("span", { text: "What happened" }),
      el("textarea", { attrs: { rows: "3", maxlength: "600", "data-evidence": "", placeholder: a.evidenceHint || "Result, number, or quote." } })
    ]),
    el("label", { class: "field" }, [
      el("span", { text: "Metric or link" }),
      el("input", { attrs: { type: "url", maxlength: "300", "data-evidence-url": "", placeholder: "https://…" } })
    ]),
    el("div", { class: "form-actions" }, [
      el("button", { class: "btn-ghost btn-sm", text: "Save evidence", attrs: { type: "button", "data-save-evidence": "" } })
    ]),
    el("p", { class: "form-hint evidence-hint", text: evidenceNote })
  ]);
  // Prefill without ever echoing the API key pattern — this is founder-authored text.
  details.querySelector("[data-evidence]").value = a.evidence || "";
  details.querySelector("[data-evidence-url]").value = a.evidenceUrl || "";

  return el("article", { class: `assumption-card risk-${String(a.risk || "medium").toLowerCase()}`, attrs: { "data-id": a.id } }, [
    el("header", { class: "assumption-head" }, [
      el("span", { class: "assumption-id", text: idLabel }),
      el("span", { class: `risk-badge risk-${String(a.risk || "medium").toLowerCase()}`, text: `${a.risk} risk` })
    ]),
    el("p", { class: "assumption-claim", text: a.claim }),
    el("div", { class: "assumption-experiment" }, [
      el("span", { class: "experiment-label", text: "Test" }),
      el("p", { text: a.experiment })
    ]),
    statusRow,
    details
  ]);
}

function findAssumption(id) {
  return (project?.assumptions || []).find((a) => a.id === id) || null;
}

async function setStatus(id, status) {
  const a = findAssumption(id);
  if (!a || a.status === status) return;
  a.status = status;
  persistProject();
  renderBoard();
  refreshDecision();
}

function saveEvidence(id) {
  const a = findAssumption(id);
  if (!a) return;
  const card = document.querySelector(`.assumption-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  a.evidence = card.querySelector("[data-evidence]").value.trim().slice(0, 600);
  a.evidenceUrl = card.querySelector("[data-evidence-url]").value.trim().slice(0, 300);
  persistProject();
  renderBoard();
  refreshDecision();
}

function resetBoardEvidence() {
  if (!project?.assumptions?.length) return;
  for (const a of project.assumptions) {
    a.status = "unvalidated";
    a.evidence = "";
    a.evidenceUrl = "";
  }
  persistProject();
  renderBoard();
  refreshDecision();
}

async function refreshDecision() {
  if (!project?.assumptions?.length) return;
  try {
    const result = await api("decision", { method: "POST", body: { assumptions: project.assumptions } });
    project.decision = result;
    persistProject();
    renderDecision();
  } catch {
    /* the board stays usable; the decision panel keeps its last value */
  }
}

/* ── Founder Council ─────────────────────────────────────────────────────── */

const STANCE_LABEL = { supportive: "Supportive", cautious: "Cautious", critical: "Critical" };

function renderCouncil() {
  const grid = $("councilGrid");
  const empty = $("councilEmpty");
  clear(grid);

  const council = project?.council || [];
  if (!council.length) {
    empty.hidden = false;
    $("councilEngine").textContent = "";
    $("councilNote").textContent = "";
    renderCouncilControls();
    return;
  }
  empty.hidden = true;

  for (const seat of council) {
    grid.append(
      el("article", { class: `council-card stance-${seat.stance || "cautious"}` }, [
        el("div", { class: "council-head" }, [
          el("span", { class: "council-avatar", text: String(seat.role || "?").slice(0, 2).toUpperCase() }),
          el("div", {}, [
            el("h3", { text: seat.role }),
            el("span", { class: "council-focus", text: seat.focus || "" })
          ]),
          el("span", { class: `stance-badge stance-${seat.stance || "cautious"}`, text: STANCE_LABEL[seat.stance] || "Cautious" })
        ]),
        el("p", { class: "council-headline", text: seat.headline }),
        el("p", { class: "council-critique", text: seat.critique }),
        el("blockquote", { class: "council-question", text: seat.question })
      ])
    );
  }

  const engine = project?.councilEngine || "heuristics";
  $("councilEngine").textContent =
    engine === "heuristics" ? "Deterministic engine" : engine === "bedrock" ? "Claude on Bedrock" : `BYOK · ${String(engine).replace("byok:", "")}`;
  $("councilNote").textContent = project?.councilFallbackReason
    ? `Your key could not be used (${project.councilFallbackReason}) — the deterministic council is shown instead.`
    : "";
}

/** Keeps the council button label honest about which engine will run. */
function renderCouncilControls() {
  const btn = $("councilRefreshBtn");
  if (!btn) return;
  const s = readSettings();
  if (s.mode === "byok" && s.key.trim()) {
    btn.textContent = `Re-run with ${PROVIDER_LABELS[s.provider] || s.provider}`;
  } else {
    btn.textContent = "Re-run council";
  }
}

async function refreshCouncil() {
  if (!project?.evaluation) return;
  const btn = $("councilRefreshBtn");
  btn.disabled = true;
  const byok = byokPayload();
  showLoading(byok ? `Consulting ${PROVIDER_LABELS[byok.provider]}…` : "Re-running the council…");

  try {
    const result = await api("council", {
      method: "POST",
      body: {
        pitch: collectPitch(),
        evaluation: project.evaluation,
        assumptions: project.assumptions,
        byok
      }
    });
    project.council = result.council || project.council;
    project.councilEngine = result.engine || "heuristics";
    project.councilFallbackReason = result.fallbackReason || "";
    persistProject();
    renderCouncil();
  } catch (err) {
    $("councilNote").textContent = `Could not re-run the council — ${err.message}`;
  } finally {
    hideLoading();
    btn.disabled = false;
  }
}

/* ── Decision ────────────────────────────────────────────────────────────── */

function renderDecision() {
  const hero = $("decisionHero");
  const empty = $("decisionEmpty");
  clear(hero);

  const decision = project?.decision;
  const assumptions = project?.assumptions || [];

  if (!assumptions.length || !decision) {
    empty.hidden = false;
    hero.hidden = true;
    clear($("decisionDrivers"));
    clear($("decisionSteps"));
    return;
  }
  empty.hidden = true;
  hero.hidden = false;

  const verdict = decision.verdict || "PIVOT";
  const score = Number(decision.evidenceScore) || 0;
  const sev = severity(score);

  hero.dataset.verdict = verdict;
  hero.append(
    el("div", { class: "decision-top" }, [
      el("div", {}, [
        el("span", { class: "decision-kicker", text: "The call" }),
        el("div", { class: `verdict-pill verdict-${verdict}`, text: verdict })
      ]),
      el("span", { class: "engine-tag", text: `Confidence: ${decision.confidence || "low"}` })
    ]),
    el("p", { class: "decision-rationale", text: decision.rationale || "" })
  );

  const metric = (label, value, meter, color) =>
    el("div", { class: "decision-metric" }, [
      el("div", { class: "metric-label", text: label }),
      el("div", { class: "metric-value", text: value }),
      meter !== undefined
        ? el("div", { class: "meter", style: { "--meter-color": color } }, [
            el("div", { class: "meter-fill", style: { width: `${meter}%` } })
          ])
        : null
    ]);

  hero.append(
    el("div", { class: "decision-metrics" }, [
      metric("Evidence score", String(score), Math.max(0, Math.min(100, score)), sev.color),
      metric("Board resolved", `${Number(decision.coverage) || 0}%`, Number(decision.coverage) || 0, "var(--series-1)")
    ])
  );

  const drivers = $("decisionDrivers");
  clear(drivers);
  for (const d of decision.drivers || []) {
    drivers.append(el("li", { class: `driver-${d.tone || "neutral"}`, text: d.text }));
  }
  if (!decision.drivers?.length) drivers.append(el("li", { text: "No drivers yet." }));

  const steps = $("decisionSteps");
  clear(steps);
  for (const step of decision.nextSteps || []) {
    steps.append(
      el("li", {}, [
        el("strong", { text: step.title }),
        el("span", { class: "step-detail", text: step.detail || "" })
      ])
    );
  }
  if (!decision.nextSteps?.length) steps.append(el("li", {}, [el("span", { text: "Run the next experiment." })]));
}

/* ── Investor Q&A ────────────────────────────────────────────────────────── */

async function onAnswer() {
  if (!current) return;
  const answer = $("investorAnswer").value.trim();
  if (!answer) return;

  $("answerBtn").disabled = true;
  showLoading("The investor is reading your answer…");

  try {
    const result = await api("investor-answer", {
      method: "POST",
      body: { question: current.investorQuestion, answer, pitchName: current.name }
    });

    const base = current.scores?.investability ?? 50;
    liveInvestability = Math.max(0, Math.min(100, base + (result.delta || 0)));
    renderKpis(current);

    const dir = result.delta > 0 ? "up" : result.delta < 0 ? "down" : "flat";
    const icon = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
    const sign = result.delta > 0 ? "+" : "";

    const box = $("critique");
    clear(box);
    box.append(
      el("div", { class: "critique-head" }, [
        // Icon + label + color: direction never rides on color alone.
        el("span", { class: "delta", text: `${icon} ${sign}${result.delta}`, attrs: { "data-dir": dir } }),
        el("span", {
          class: "form-hint",
          text: dir === "up" ? "Investability rose" : dir === "down" ? "Investability fell" : "No change"
        })
      ]),
      el("p", { text: result.critique || "" })
    );
    box.hidden = false;
  } catch (err) {
    const box = $("critique");
    clear(box);
    box.append(el("p", { class: "form-error", text: err.message }));
    box.hidden = false;
  } finally {
    hideLoading();
    $("answerBtn").disabled = false;
  }
}

/* ── Battle ──────────────────────────────────────────────────────────────── */

function populateBattleSelects() {
  const items = readVault();
  for (const id of ["battleA", "battleB"]) {
    const sel = $(id);
    if (!sel) continue;
    clear(sel);
    if (!items.length) {
      sel.append(el("option", { text: "— save concepts to the vault first —", attrs: { value: "" } }));
      continue;
    }
    items.forEach((item, i) => {
      sel.append(el("option", { text: item.name || `Concept ${i + 1}`, attrs: { value: String(i) } }));
    });
    if (id === "battleB" && items.length > 1) sel.selectedIndex = 1;
  }
}

function renderBattle(result, a, b) {
  const host = $("battleResult");
  clear(host);

  const card = el("div", { class: "card" });

  card.append(
    el("div", { class: "winner-banner" }, [
      el("span", { class: "trophy", text: "🏆", attrs: { "aria-hidden": "true" } }),
      el("div", {}, [
        el("h3", { text: `${result.winner} takes it` }),
        el("p", { class: "form-hint", text: result.engine === "bedrock" ? "Judged by Claude on Bedrock" : "Judged locally" })
      ])
    ]),
    el("p", { text: result.rationale || "" })
  );

  card.append(
    el("div", { class: "legend" }, [
      el("span", { class: "legend-item" }, [
        el("span", { class: "legend-swatch", style: { background: "var(--series-1)" }, attrs: { "aria-hidden": "true" } }),
        el("span", { text: a.name || "Concept A" })
      ]),
      el("span", { class: "legend-item" }, [
        el("span", { class: "legend-swatch", style: { background: "var(--series-2)" }, attrs: { "aria-hidden": "true" } }),
        el("span", { text: b.name || "Concept B" })
      ])
    ])
  );

  const axes = el("div", { class: "axes" });
  for (const axis of result.axes || []) {
    const row = el("div", { class: "axis-row" }, [el("div", { class: "axis-label", text: axis.label })]);
    const bars = el("div", { class: "axis-bars" });

    for (const [key, value, name] of [["a", axis.a, a.name], ["b", axis.b, b.name]]) {
      const pct = Math.max(0, Math.min(100, Number(value) || 0));
      bars.append(
        el("div", {
          class: "bar-track",
          attrs: { title: `${name || key.toUpperCase()} — ${axis.label}: ${pct}` }
        }, [
          el("div", { class: "bar-fill", attrs: { "data-series": key }, style: { width: `${pct}%` } }),
          el("span", { class: "bar-value", text: String(pct), style: { left: `${pct}%` } })
        ])
      );
    }
    row.append(bars);
    axes.append(row);
  }
  card.append(axes);

  // Table view so values are never gated behind color or hover.
  const table = el("table", { class: "axis-table" });
  const thead = el("thead", {}, [
    el("tr", {}, [el("th", { text: "Axis" }), el("th", { text: a.name || "A" }), el("th", { text: b.name || "B" })])
  ]);
  const tbody = el("tbody");
  for (const axis of result.axes || []) {
    tbody.append(el("tr", {}, [el("td", { text: axis.label }), el("td", { text: String(axis.a) }), el("td", { text: String(axis.b) })]));
  }
  table.append(thead, tbody);

  card.append(el("details", { class: "econ" }, [el("summary", { text: "Table view" }), table]));

  host.append(card);
  host.hidden = false;
}

async function onBattle() {
  const error = $("battleError");
  error.hidden = true;

  const items = readVault();
  const ai = Number($("battleA").value);
  const bi = Number($("battleB").value);

  if (!items.length || Number.isNaN(ai) || Number.isNaN(bi)) {
    error.textContent = "Save at least two concepts to the Vault first.";
    error.hidden = false;
    return;
  }
  if (ai === bi) {
    error.textContent = "Pick two different concepts.";
    error.hidden = false;
    return;
  }

  const a = items[ai];
  const b = items[bi];

  $("battleBtn").disabled = true;
  showLoading("Running the head-to-head…");

  try {
    const result = await api("battle", { method: "POST", body: { a, b } });
    renderBattle(result, a, b);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    hideLoading();
    $("battleBtn").disabled = false;
  }
}

/* ── Community ───────────────────────────────────────────────────────────── */

async function loadCommunity() {
  const list = $("communityList");
  clear(list);
  list.append(el("p", { class: "empty", text: "Loading…" }));

  try {
    const { items, storage } = await api("community");
    clear(list);
    const storageNode = $("storageMode");
    if (storageNode) storageNode.textContent = `Storage: ${storage}`;

    if (!items.length) {
      list.append(el("p", { class: "empty", text: "No published pitches yet. Be the first." }));
      return;
    }

    for (const item of items) {
      list.append(
        el("article", { class: "vault-item" }, [
          el("h3", { text: item.name }),
          el("div", { class: "vault-meta" }, [
            el("span", { text: item.sector || "—" }),
            el("span", { text: "·" }),
            el("span", { text: item.market || "—" }),
            el("span", { text: "·" }),
            el("span", { text: new Date(item.createdAt).toLocaleDateString() }),
            item.founder ? el("span", { text: "·" }) : null,
            item.founder ? el("span", { text: item.founder }) : null
          ]),
          el("p", { class: "vault-roast", text: item.roast || "" }),
          el("div", { class: "vault-scores" }, [
            el("span", { text: "Global" }, [el("b", { text: String(item.scores?.global ?? "—") })]),
            el("span", { text: "Investability" }, [el("b", { text: String(item.scores?.investability ?? "—") })])
          ])
        ])
      );
    }
  } catch (err) {
    clear(list);
    list.append(el("p", { class: "empty", text: `Could not load the board — ${err.message}` }));
  }
}

/* ── Save / publish / download ───────────────────────────────────────────── */

function onSaveVault() {
  if (!current) return;
  const items = readVault();
  const record = {
    ...current,
    ...(project?.assumptions?.length
      ? {
          assumptions: project.assumptions,
          council: project.council,
          councilEngine: project.councilEngine,
          decision: project.decision
        }
      : {}),
    scores: {
      global: current.scores?.global ?? 0,
      investability: liveInvestability ?? current.scores?.investability ?? 0
    },
    savedAt: new Date().toISOString()
  };
  items.unshift(record);
  writeVault(items);
  $("actionNote").textContent = "Saved to your Vault (this browser only).";
  populateBattleSelects();
}

async function onPublish() {
  if (!current) return;
  $("publishBtn").disabled = true;
  try {
    await api("community", {
      method: "POST",
      body: {
        name: current.name,
        sector: current.sector,
        market: current.market,
        pitch: $("f-pitch").value.trim() || current.pitch || "Published from Foundry.",
        roast: current.roast,
        scores: { global: current.scores?.global, investability: liveInvestability ?? current.scores?.investability },
        engine: current.engine
      }
    });
    const user = Auth.getState().user;
    $("actionNote").textContent = user
      ? `Published to the community board as ${user.name}.`
      : "Published to the community board as an anonymous founder.";
  } catch (err) {
    $("actionNote").textContent = `Could not publish — ${err.message}`;
  } finally {
    $("publishBtn").disabled = false;
  }
}

function onDownload() {
  if (!current) return;
  const payload = project?.assumptions?.length ? { ...current, ...project } : current;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { attrs: { href: url, download: `${(current.name || "evaluation").replace(/\W+/g, "-").toLowerCase()}.json` } });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── Authentication UI ───────────────────────────────────────────────────── */

function renderAuthArea(state) {
  // Render into both the landing topbar auth slot and the app topbar auth slot
  for (const areaId of ["authArea", "authAreaLanding"]) {
    const area = $(areaId);
    if (!area) continue;
    clear(area);

    if (state.signedIn) {
      const label = state.user?.name || "Founder";
      area.append(
        el("span", {
          class: "user-chip",
          text: label,
          attrs: { title: state.user?.email ? `${state.user.email} (${state.mode})` : state.mode }
        })
      );
      const out = el("button", { class: "btn-ghost btn-sm", text: "Sign out", attrs: { type: "button" } });
      out.addEventListener("click", () => Auth.signOut());
      area.append(out);
      continue;
    }

    const btn = el("button", { class: "btn-primary btn-sm", text: "Sign in", attrs: { type: "button" } });
    btn.addEventListener("click", () => openAuthDialog(state));
    area.append(btn);
  }
}

function openAuthDialog(state) {
  const dialog = $("authDialog");
  const intro = $("authIntro");
  const cognitoBlock = $("cognitoBlock");
  const guestFields = $("guestFields");
  const guestContinue = $("guestContinue");

  if (state.configured) {
    intro.textContent = `Sign in with your AWS account (${state.provider}), or continue as a guest. Ideas stay in this browser either way.`;
    cognitoBlock.hidden = false;
    guestFields.hidden = true;
    guestContinue.hidden = true;
  } else {
    intro.textContent =
      "This deployment has no Cognito pool configured, so guest mode is available. Guest sessions are local to this browser — no account, no password, nothing sent anywhere.";
    cognitoBlock.hidden = true;
    guestFields.hidden = false;
    guestContinue.hidden = false;
  }
  dialog.showModal();
}

function initAuth() {
  Auth.subscribe(renderAuthArea);
  $("cognitoSignInBtn").addEventListener("click", () => {
    $("authDialog").close();
    Auth.signIn();
  });
  $("guestContinue").addEventListener("click", () => {
    Auth.signInAsGuest($("guestName").value, $("guestEmail").value);
    $("authDialog").close();
  });
  $("authCancel").addEventListener("click", () => $("authDialog").close());

  renderAuthArea(Auth.getState());
}

/* ── Settings UI ─────────────────────────────────────────────────────────── */

function syncSettingsForm() {
  const s = readSettings();
  for (const input of document.querySelectorAll('#modeChips input[name="engineMode"]')) {
    input.checked = input.value === s.mode;
  }
  $("byokFields").hidden = s.mode !== "byok";
  $("byokProvider").value = s.provider;
  // Never write a stored key back into the DOM: show that one exists, let them type to replace.
  $("byokKey").value = "";
  $("byokKey").placeholder = s.key ? "key saved — type to replace" : "paste your key";
  $("byokModel").value = s.model;
  $("settingsStatus").textContent = s.mode === "byok" && s.key ? "A key is saved. It stays in this browser." : "";
}

function onSettingsSave() {
  const mode = document.querySelector('#modeChips input[name="engineMode"]:checked')?.value === "byok" ? "byok" : "default";
  const previous = readSettings();
  const typedKey = $("byokKey").value.trim();
  // A blank field means "keep the stored key", not "erase it".
  const key = typedKey || previous.key;

  if (mode === "byok" && key.length < 8) {
    $("settingsStatus").textContent = "That key looks too short. Leave the default engine on if you do not have one.";
    return;
  }

  writeSettings({ mode, provider: $("byokProvider").value, key, model: $("byokModel").value.trim() });
  $("byokKey").value = "";
  $("byokKey").placeholder = key ? "key saved — type to replace" : "paste your key";
  $("settingsStatus").textContent = mode === "byok" ? "Saved. The council will use your key." : "Using the AWS Bedrock / deterministic engine.";
  renderCouncilControls();
}

function onSettingsClear() {
  writeSettings({ mode: "default", provider: "anthropic", key: "", model: "" });
  syncSettingsForm();
  $("settingsStatus").textContent = "Keys cleared. Back on the default engine.";
}

function initSettings() {
  const dialog = $("settingsDialog");
  $("settingsBtn").addEventListener("click", () => {
    syncSettingsForm();
    dialog.showModal();
  });
  $("settingsClose").addEventListener("click", () => dialog.close());
  $("settingsSave").addEventListener("click", onSettingsSave);
  $("settingsClear").addEventListener("click", onSettingsClear);
  for (const input of document.querySelectorAll('#modeChips input[name="engineMode"]')) {
    input.addEventListener("change", () => {
      $("byokFields").hidden = input.value !== "byok" || !input.checked;
    });
  }
  renderCouncilControls();
}

/* ── Sample hypotheses ───────────────────────────────────────────────────── */

const SAMPLE = {
  name: "CornerCart",
  sector: "SaaS",
  market: "Independent neighborhood grocery stores",
  pitch:
    "Independent grocery stores spend hours comparing supplier price lists and rebuilding orders by hand, and they lose sales whenever stock runs out. CornerCart brings inventory and supplier catalogs into one workspace, flags cheaper substitutions, and prepares a purchase order the owner can approve. " +
    "We charge a monthly subscription, collected by mobile money, starting with 20 stores in one metro area, and will only add automated ordering after owners use the recommendations for four consecutive weeks.",
  skills: ["engineering", "domain"],
  price: 99,
  cogs: 25,
  cac: 120
};

/** Additional demo hypotheses — rotate through on each "See a live demo" click. */
const DEMO_SAMPLES = [
  SAMPLE,
  {
    name: "Shewa Logistics",
    sector: "Logistics",
    market: "Small e-commerce sellers in Addis Ababa who ship 5–50 parcels per day",
    pitch:
      "Small online sellers in Addis Ababa drop off parcels at three different couriers each day because no single courier covers the whole city reliably. Shewa aggregates all couriers under one API: sellers book, track, and reconcile from one dashboard, and pay per successful delivery via Telebirr. " +
      "We take a 6% take rate on each transaction and target the 800 sellers on Telegram and Instagram who already complain about courier no-shows daily.",
    skills: ["engineering", "domain", "growth"],
    price: 85,
    cogs: 12,
    cac: 200
  },
  {
    name: "MediPrepare",
    sector: "Healthtech",
    market: "Parents of children under 5 in tier-2 Nigerian cities",
    pitch:
      "Parents in tier-2 Nigerian cities often arrive at clinics with incomplete immunisation cards and miss booster windows because reminders come only from overloaded community health workers. MediPrepare sends WhatsApp reminders keyed to the child's actual birth date and last recorded jab, and lets parents upload photos of the card to a shared record accessible at any partnering clinic. " +
      "We charge clinics a flat NGN 8,000/month to be listed as a verified partner, not parents. Starting in Ibadan, partnering with two private clinics who already use paper scheduling.",
    skills: ["product", "domain", "growth"],
    price: 8000,
    cogs: 400,
    cac: 1500
  },
  {
    name: "BuildLedger",
    sector: "Fintech",
    market: "Residential construction contractors with 5-50 employees in East Africa",
    pitch:
      "Residential contractors in Nairobi and Kampala invoice clients in large milestones but pay labourers and buy materials daily. The mismatch means they're constantly cash-short mid-project even on profitable contracts. BuildLedger tracks project costs in real time, models the daily cash gap, and helps contractors negotiate payment schedules that match their float. " +
      "Revenue: 1.5% of the invoice value processed through our Mpesa-integrated collection link. No subscription, no setup fee — we only earn when cash flows.",
    skills: ["finance", "engineering"],
    price: null,
    cogs: null,
    cac: 350
  },
  {
    name: "ClassPulse",
    sector: "Edtech",
    market: "Private K-12 schools in West Africa with 200-1000 students",
    pitch:
      "School administrators at private K-12 schools spend 3-4 hours every Friday manually compiling teacher attendance, homework submission rates, and parent communication logs into a weekly report for the proprietor. ClassPulse auto-generates this report from WhatsApp group activity, a lightweight attendance app, and a parent SMS confirmation receipt. " +
      "We charge NGN 45,000 / term per school, billed in advance via bank transfer, starting with 10 schools in Lagos whose proprietors are active in the Association of Private School Owners.",
    skills: ["engineering", "domain", "product"],
    price: 45000,
    cogs: 3000,
    cac: 8000
  }
];

let demoIndex = 0;

function loadSample() {
  const sample = DEMO_SAMPLES[demoIndex % DEMO_SAMPLES.length];
  demoIndex++;
  hydrateForm(sample);
  selectTab("pitch");
  $("pitchForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── Dictation (Web Speech API, progressive enhancement) ─────────────────── */

function setupDictation() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;

  const btn = $("dictateBtn");
  btn.hidden = false;
  let recognition = null;
  let listening = false;

  btn.addEventListener("click", () => {
    if (listening && recognition) {
      recognition.stop();
      return;
    }
    recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = true;

    recognition.addEventListener("result", (event) => {
      const box = $("investorAnswer");
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          box.value = `${box.value} ${event.results[i][0].transcript}`.trim();
        }
      }
    });
    recognition.addEventListener("end", () => {
      listening = false;
      btn.textContent = "🎤 Dictate";
    });
    recognition.addEventListener("error", () => {
      listening = false;
      btn.textContent = "🎤 Dictate";
    });

    recognition.start();
    listening = true;
    btn.textContent = "■ Stop";
  });
}

/* ── Misc wiring ─────────────────────────────────────────────────────────── */

function updatePitchCount() {
  $("pitchCount").textContent = `${$("f-pitch").value.length} / 4000`;
}

function init() {
  $("startBtn").addEventListener("click", () => {
    selectTab("pitch");
    $("f-name").focus();
  });
  // Second CTA at the bottom of the landing page
  const startBtn2 = $("startBtn2");
  if (startBtn2) startBtn2.addEventListener("click", () => { selectTab("pitch"); $("f-name").focus(); });

  $("sampleBtn").addEventListener("click", loadSample);

  // Landing-page About button (separate from the app About button)
  const aboutBtnLanding = $("aboutBtnLanding");
  if (aboutBtnLanding) aboutBtnLanding.addEventListener("click", () => $("aboutDialog").showModal());

  for (const link of document.querySelectorAll("#mainNav .navlink")) {
    link.addEventListener("click", () => selectTab(link.dataset.tab));
  }

  $("pitchForm").addEventListener("submit", onSubmit);
  $("f-pitch").addEventListener("input", updatePitchCount);
  $("resetBtn").addEventListener("click", () => {
    setTimeout(() => {
      updatePitchCount();
      $("formError").hidden = true;
      $("results").hidden = true;
    }, 0);
  });

  $("answerBtn").addEventListener("click", onAnswer);
  $("battleBtn").addEventListener("click", onBattle);
  $("saveVaultBtn").addEventListener("click", onSaveVault);
  $("publishBtn").addEventListener("click", onPublish);
  $("downloadBtn").addEventListener("click", onDownload);
  $("refreshCommunityBtn").addEventListener("click", loadCommunity);

  // Board interactions (event delegation: cards are re-rendered frequently).
  $("boardColumns").addEventListener("click", (event) => {
    const card = event.target.closest(".assumption-card");
    if (!card) return;
    const id = card.dataset.id;

    const statusBtn = event.target.closest("[data-status]");
    if (statusBtn) {
      setStatus(id, statusBtn.dataset.status);
      return;
    }
    if (event.target.closest("[data-save-evidence]")) saveEvidence(id);
  });

  $("boardResetBtn").addEventListener("click", resetBoardEvidence);
  $("boardReanalyseBtn").addEventListener("click", () => {
    selectTab("pitch");
    $("pitchForm").requestSubmit();
  });
  $("boardToWorkspace").addEventListener("click", () => selectTab("pitch"));

  $("councilRefreshBtn").addEventListener("click", refreshCouncil);
  $("councilToWorkspace").addEventListener("click", () => selectTab("pitch"));
  $("decisionToBoard").addEventListener("click", () => selectTab("assumptions"));

  $("gotoBoardBtn").addEventListener("click", () => selectTab("assumptions"));
  $("gotoCouncilBtn").addEventListener("click", () => selectTab("council"));
  $("gotoDecisionBtn").addEventListener("click", () => selectTab("decision"));

  const dialog = $("aboutDialog");
  $("aboutBtn").addEventListener("click", () => dialog.showModal());
  $("aboutClose").addEventListener("click", () => dialog.close());

  initAuth();
  initSettings();
  setupDictation();

  // Restore the last canvas so a refresh does not lose the demo.
  project = readProject();
  if (project?.assumptions?.length) {
    hydrateForm(project);
    renderResults(project.evaluation ? { ...project.evaluation, ...project } : project);
    renderBoard();
    renderCouncil();
    renderDecision();
  } else {
    updateBoardBadge();
    renderCouncil();
    renderDecision();
  }

  $("vaultCount").textContent = String(readVault().length);
  refreshHealth();

  Auth.init().then((state) => {
    renderAuthArea(state);
    if (state.signedIn && state.mode === "cognito") {
      api("auth/me").catch(() => {});
    }
  });
}

init();
