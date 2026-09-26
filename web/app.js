"use strict";

const ROWS = "ABCDEFGH", COLS = 12, LAYOUT_VERSION = 2;
const state = {
  imported: null,
  layout: { version: LAYOUT_VERSION, annotations: {}, curves: {}, settings: {} },
  selected: new Set(),
  history: [],
  preview: null,
  result: null,
  activeTab: "tab-plate",
  plateViewMode: "conc" // "conc" or "od"
};

const $ = id => document.getElementById(id);

function coordinate(w) {
  return [ROWS.indexOf(w[0]), Number(w.slice(1)) - 1];
}

function rect(a, b) {
  const [r1, c1] = coordinate(a), [r2, c2] = coordinate(b), v = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      v.push(ROWS[r] + (c + 1));
    }
  }
  return v;
}

function sortedWells(set) {
  return [...set].sort((a, b) => {
    const [ar, ac] = coordinate(a), [br, bc] = coordinate(b);
    return ar - br || ac - bc;
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[c]);
}

function fmt(x, d = 4) {
  return x === null || x === undefined ? "—" : typeof x === "number" ? Number(x).toPrecision(d) : escapeHtml(x);
}

function saveHistory() {
  state.history.push(structuredClone(state.layout));
  if (state.history.length > 30) state.history.shift();
}

function currentReading(well) {
  return state.imported?.wells.find(w => w.well === well);
}

function assignedStandardCurveIds() {
  const assigned = new Set(
    Object.values(state.layout.annotations)
      .filter(a => a.role === "standard" && a.include)
      .map(a => a.curve_id)
  );
  return Object.keys(state.layout.curves).filter(id => assigned.has(id));
}

async function api(path, payload, blob = false) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    let msg;
    try { msg = (await r.json()).error; } catch { msg = r.statusText; }
    throw new Error(msg || `HTTP ${r.status}`);
  }
  return blob ? await r.blob() : await r.json();
}

function showMessage(id, text, kind = "error") {
  const el = $(id);
  if (!el) return;
  el.style.display = text ? "block" : "none";
  el.innerHTML = text ? `<div class="${kind}">${escapeHtml(text)}</div>` : "";
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* 96-WELL PLATE RENDERING & INTERACTION */
function renderPlate() {
  const grid = $("plate");
  if (!grid) return;
  grid.innerHTML = "";

  // Column Headers (1–12) with Quick Column Selection
  const corner = document.createElement("div");
  corner.className = "plate-head";
  corner.textContent = "";
  grid.append(corner);

  for (let c = 1; c <= 12; c++) {
    const colHead = document.createElement("div");
    colHead.className = "plate-head interactive-head";
    colHead.textContent = String(c);
    colHead.title = `Click to select Column ${c}`;
    colHead.addEventListener("click", e => {
      e.stopPropagation();
      const colWells = ROWS.split("").map(r => r + c);
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        const allIn = colWells.every(w => state.selected.has(w));
        colWells.forEach(w => allIn ? state.selected.delete(w) : state.selected.add(w));
      } else {
        state.selected = new Set(colWells);
      }
      updateSelection();
      renderEditor();
    });
    grid.append(colHead);
  }

  // Row Headers (A–H) with Quick Row Selection & Microplate Wells
  for (const row of ROWS) {
    const rowHead = document.createElement("div");
    rowHead.className = "plate-head interactive-head";
    rowHead.textContent = row;
    rowHead.title = `Click to select Row ${row}`;
    rowHead.addEventListener("click", e => {
      e.stopPropagation();
      const rowWells = Array.from({ length: 12 }, (_, i) => row + (i + 1));
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        const allIn = rowWells.every(w => state.selected.has(w));
        rowWells.forEach(w => allIn ? state.selected.delete(w) : state.selected.add(w));
      } else {
        state.selected = new Set(rowWells);
      }
      updateSelection();
      renderEditor();
    });
    grid.append(rowHead);

    for (let c = 1; c <= 12; c++) {
      const well = row + c;
      const reading = state.imported?.wells.find(w => w.well === well);
      const annotation = state.layout.annotations[well];
      const d = document.createElement("div");

      d.className = "well " + (reading?.measurement_status || "empty") +
        (annotation && annotation.role !== "ignore" ? " " + annotation.role : "") +
        (annotation && annotation.role === "ignore" ? " ignore" : "") +
        (state.selected.has(well) ? " selected" : "");

      d.dataset.well = well;
      d.setAttribute("role", "gridcell");
      d.setAttribute("aria-label", `${well} ${reading?.measurement_status || "empty"} ${reading?.raw_value ?? ""}`);

      d.innerHTML = `<b>${well}</b><small>${escapeHtml(reading?.raw_value ?? "—")}</small>`;

      const roleDesc = annotation ? ` • Role: ${annotation.role.toUpperCase()} (${annotation.curve_id || annotation.sample_id || ""})` : " • Unassigned";
      d.title = `${well} [OD: ${reading?.raw_value ?? "empty"} - Status: ${reading?.measurement_status || "empty"}]${roleDesc}`;
      grid.append(d);
    }
  }

  updateSelection();
}

function updateSelection() {
  document.querySelectorAll(".well").forEach(d => {
    d.classList.toggle("selected", state.selected.has(d.dataset.well));
  });

  const countEl = $("selection-count");
  if (countEl) {
    countEl.textContent = `${state.selected.size} well${state.selected.size === 1 ? "" : "s"} selected`;
  }

  const listEl = $("selection-list");
  if (listEl) {
    const sorted = sortedWells(state.selected);
    listEl.textContent = sorted.length > 0 ? "Selected: " + sorted.join(", ") : "";
  }
}

// Robust Pointer Drag Selection
let drag = null;

function wellAt(e) {
  return document.elementFromPoint(e.clientX, e.clientY)?.closest(".well")?.dataset.well;
}

$("plate").addEventListener("pointerdown", e => {
  const w = wellAt(e);
  if (!w) return;
  e.preventDefault();
  drag = {
    start: w,
    base: e.ctrlKey || e.metaKey ? new Set(state.selected) : new Set(),
    pointer: e.pointerId
  };
  $("plate").setPointerCapture(e.pointerId);
  state.selected = new Set([...drag.base, ...rect(w, w)]);
  updateSelection();
});

$("plate").addEventListener("pointermove", e => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const w = wellAt(e);
  if (!w) return;
  state.selected = new Set([...drag.base, ...rect(drag.start, w)]);
  updateSelection();
});

function endDrag(e) {
  if (drag && e.pointerId === drag.pointer) {
    drag = null;
    renderEditor();
  }
}

$("plate").addEventListener("pointerup", endDrag);
$("plate").addEventListener("pointercancel", endDrag);

// Selection Toolbar Handlers
$("clear-selection").onclick = () => {
  state.selected.clear();
  updateSelection();
  renderEditor();
};

const selectAllBtn = $("select-all");
if (selectAllBtn) {
  selectAllBtn.onclick = () => {
    const all = [];
    for (const r of ROWS) for (let c = 1; c <= 12; c++) all.push(r + c);
    state.selected = new Set(all);
    updateSelection();
    renderEditor();
  };
}

const invertBtn = $("invert-selection");
if (invertBtn) {
  invertBtn.onclick = () => {
    const inverted = new Set();
    for (const r of ROWS) {
      for (let c = 1; c <= 12; c++) {
        const w = r + c;
        if (!state.selected.has(w)) inverted.add(w);
      }
    }
    state.selected = inverted;
    updateSelection();
    renderEditor();
  };
}

$("undo").onclick = () => {
  if (!state.history.length) return;
  state.layout = state.history.pop();
  state.result = null;
  state.preview = null;
  renderPlate();
  renderEditor();
  renderAnalysis();
};

/* FORM CONTROLS & HELPERS */
function optionField(label, id, options, value) {
  return `<label class="field">
    <span>${escapeHtml(label)}</span>
    <select id="${id}">
      ${options.map(([v, t]) => `<option value="${escapeHtml(v)}" ${v === value ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
    </select>
  </label>`;
}

function inputField(label, id, value = "", type = "text", extra = "") {
  return `<label class="field">
    <span>${escapeHtml(label)}</span>
    <input id="${id}" type="${type}" value="${escapeHtml(value)}" ${extra}>
  </label>`;
}

function qcField(label, id, control, help) {
  const helpId = `help-${id}`;
  const helpControl = help ? `
    <span class="qc-help">
      <button type="button" class="qc-help-button" aria-label="Help for ${escapeHtml(label)}" aria-describedby="${helpId}">?</button>
      <span class="qc-help-popup" id="${helpId}" role="tooltip">${escapeHtml(help)}</span>
    </span>` : "";
  return `<div class="qc-field">
    <div class="qc-label-row">
      <label for="${id}">${escapeHtml(label)}</label>
      ${helpControl}
    </div>
    ${control}
  </div>`;
}

function qcOptionField(label, id, options, value, help) {
  return qcField(label, id, `
    <select id="${id}">
      ${options.map(([v, t]) => `<option value="${escapeHtml(v)}" ${v === value ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}
    </select>`, help);
}

function qcNumberField(label, id, value, help) {
  return qcField(label, id, `<input id="${id}" type="number" value="${escapeHtml(value)}" min="0" step="any">`, help);
}

function positionQcHelp(button) {
  const popup = button.nextElementSibling, anchor = button.getBoundingClientRect(), box = popup.getBoundingClientRect();
  const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - 12));
  popup.style.left = `${left - anchor.left}px`;
  popup.style.transform = "none";
  if (window.innerHeight - anchor.bottom < box.height + 12 && anchor.top > box.height + 12) {
    popup.style.top = "auto";
    popup.style.bottom = "calc(100% + 7px)";
  } else {
    popup.style.top = "calc(100% + 7px)";
    popup.style.bottom = "auto";
  }
}

/* STEP 2: WELL ANNOTATION & EDITOR */
function renderEditor() {
  const root = $("editor-root");
  if (!root) return;

  if (!state.imported) {
    root.innerHTML = "<p class='hint'>Import a workbook in Step 1 to begin plate mapping and well annotation.</p>";
    return;
  }

  const selected = sortedWells(state.selected);
  const one = selected.length === 1 ? state.layout.annotations[selected[0]] : null;

  root.innerHTML = `
    <!-- Macaron Scientific Legend -->
    <div class="legend-card">
      <span class="legend-item"><span class="legend-dot legend-std"></span> Standard (Calibrator)</span>
      <span class="legend-item"><span class="legend-dot legend-unk"></span> Unknown Sample</span>
      <span class="legend-item"><span class="legend-dot legend-blk"></span> Blank</span>
      <span class="legend-item"><span class="legend-dot legend-ign"></span> Ignored</span>
      <span class="legend-item"><span class="legend-dot legend-ovr"></span> Detector Overflow</span>
      <span class="legend-item"><span class="legend-dot legend-sel"></span> Selected Wells</span>
    </div>

    ${assignedStandardCurveIds().length ? "" : `
      <div id="standards-first-note" class="setup-note" role="status">
        <div>
          <strong>Start by defining standard calibrators.</strong> Select calibrator wells, choose <strong>Standard</strong>, specify concentrations, and assign them. Unknown samples can then be assigned to the standard curve.
        </div>
      </div>
    `}

    <div class="assignment-card">
      <h3 class="assignment-heading">Assign Selected Wells (${selected.length} Selected)</h3>
      <div class="assignment-toolbar">
        ${optionField("Role", "role", [
          ["standard", "Standard (Calibrator)"],
          ["unknown", "Unknown Sample"],
          ["blank", "Blank"],
          ["ignore", "Ignored"]
        ], one?.role || "standard")}

        <div class="assignment-actions">
          <button id="assign-button" class="primary" ${selected.length ? "" : "disabled"}>Assign Selected Wells</button>
          <button id="preview-button" ${selected.length ? "" : "disabled"}>Preview Assignment</button>
          <button id="edit-wells" ${selected.length ? "" : "disabled"}>Edit Wells in Table</button>
          ${selected.length === 1 ? `<button id="clear-well-assignment" ${one ? "" : "disabled"}>Clear ${selected[0]} Assignment</button>` : ""}
        </div>
      </div>

      <div id="role-fields"></div>
      <div id="editor-message"></div>
      <div id="assignment-preview"></div>
    </div>

    <div class="assignment-card" style="margin-top: 20px;">
      <h3 class="assignment-heading">Standard Curves & Layout Synchronization</h3>
      <p class="hint">A standard curve is automatically registered when standard wells are assigned. Edit concentration units below as needed.</p>
      <div id="curve-list"></div>
      <div class="row" style="margin-top: 14px;">
        <label class="file-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Load Layout JSON
          <input id="layout-file" type="file" accept=".json">
        </label>
        <button id="download-layout" ${state.imported ? "" : "disabled"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Export Layout JSON
        </button>
        <button id="clear-layout">Clear Current Layout</button>
      </div>
      <div id="layout-preview"></div>
    </div>
  `;

  $("role").onchange = renderRoleFields;
  renderRoleFields();
  renderCurveList();

  $("assign-button").onclick = () => {
    if (previewAssignment()) commitAssignment();
  };
  $("preview-button").onclick = previewAssignment;
  $("edit-wells").onclick = () => {
    state.preview = {
      draft: selected.map(well => ({
        well,
        reading: currentReading(well),
        annotation: structuredClone(state.layout.annotations[well] || {
          role: "unassigned",
          include: false,
          exclusion_reason: "",
          curve_id: "",
          nominal_concentration: null,
          sample_id: "",
          replicate_group: "",
          dilution_factor: null
        })
      })),
      curve: null,
      editing: true
    };
    showMessage("editor-message", "");
    renderAssignmentPreview();
  };

  if ($("clear-well-assignment")) {
    $("clear-well-assignment").onclick = () => {
      const well = selected[0];
      if (!state.layout.annotations[well]) return;
      saveHistory();
      delete state.layout.annotations[well];
      state.preview = null;
      state.result = null;
      renderPlate();
      renderEditor();
      renderAnalysis();
      showMessage("editor-message", `${well} assignment cleared; its OD reading remains preserved on the plate.`, "success");
    };
  }

  $("layout-file").onchange = loadLayoutFile;
  $("download-layout").onclick = downloadLayout;
  $("clear-layout").onclick = () => {
    saveHistory();
    state.layout = { version: LAYOUT_VERSION, annotations: {}, curves: {}, settings: {} };
    state.selected.clear();
    state.preview = null;
    state.pendingLayout = null;
    state.result = null;
    renderPlate();
    renderEditor();
    renderAnalysis();
  };
}

function renderRoleFields() {
  const role = $("role").value;
  const selected = sortedWells(state.selected);
  const one = selected.length === 1 ? state.layout.annotations[selected[0]] : null;

  if ($("standards-first-note")) {
    $("standards-first-note").hidden = role === "unknown";
  }

  let html = "";
  if (role === "standard") {
    html = `<div class="field-grid">
      ${inputField("Standard Curve ID", "a-curve", one?.curve_id || "standard1")}
      ${inputField("Concentration Units", "a-units", state.layout.curves[one?.curve_id]?.units || "ng/mL")}
      ${inputField("Concentrations (comma-separated)", "a-series", one?.nominal_concentration ?? "0")}
      ${inputField("Replicates per Level", "a-reps", "1", "number", "min='1' step='1'")}
      ${optionField("Replicate Direction", "a-direction", [["row", "Across Rows (→)"], ["column", "Down Columns (↓)"]], "row")}
    </div>`;
  } else if (role === "unknown") {
    const ids = assignedStandardCurveIds();
    const chosen = ids.includes(one?.curve_id) ? one.curve_id : ids[0] || "";
    const curveField = ids.length ? optionField("Assigned Standard Curve", "a-curve", ids.map(id => [id, id]), chosen) : "";
    html = `
      ${ids.length ? "" : `<div class="setup-note" role="status">
        <div><strong>Waiting for standard calibrators.</strong> Assign standard calibrator wells and concentrations first.</div>
        <button id="switch-to-standard" type="button" class="btn-sm">Switch to Standard</button>
      </div>`}
      <div class="field-grid">
        ${curveField}
        ${inputField("Sample Name / Prefix", "a-sample", one?.sample_id || "Sample")}
        ${inputField("Replicates per Sample", "a-reps", Math.max(1, selected.length), "number", "min='1' step='1'")}
        ${inputField("Dilution Factor", "a-dilution", one?.dilution_factor ?? 1, "number", "min='0.000001' step='any'")}
        ${optionField("Replicate Direction", "a-direction", [["row", "Across Rows (→)"], ["column", "Down Columns (↓)"]], "row")}
      </div>`;
  } else if (role === "blank") {
    html = `<p class="hint">Blank wells: All included blank wells form one plate-wide background baseline.</p>`;
  } else {
    html = `<p class="hint">Ignored wells: Kept in audit trail and omitted from calibration and quantification.</p>`;
  }

  $("role-fields").innerHTML = html;
  const canAssign = selected.length > 0 && (role !== "unknown" || assignedStandardCurveIds().length > 0);
  $("assign-button").disabled = !canAssign;
  $("preview-button").disabled = !canAssign;

  if ($("switch-to-standard")) {
    $("switch-to-standard").onclick = () => {
      $("role").value = "standard";
      renderRoleFields();
    };
  }

  if (role === "standard") {
    $("a-curve").onchange = () => {
      const existing = state.layout.curves[$("a-curve").value.trim()];
      if (existing) {
        $("a-units").value = existing.units;
        $("a-units").disabled = true;
      } else {
        $("a-units").disabled = false;
      }
    };
    $("a-curve").onchange();
  }
}

function selectedInOrder(direction) {
  const wells = sortedWells(state.selected);
  return direction === "column"
    ? wells.sort((a, b) => {
        const [ar, ac] = coordinate(a), [br, bc] = coordinate(b);
        return ac - bc || ar - br;
      })
    : wells;
}

function previewAssignment() {
  try {
    const role = $("role").value;
    const direction = $("a-direction")?.value || "row";
    const wells = selectedInOrder(direction);
    if (!wells.length) throw Error("Select wells first.");

    const draft = [];
    let series = [], reps = 1;

    if (role === "standard") {
      const parts = $("a-series").value.split(",").map(s => s.trim());
      series = parts.map(Number);
      reps = Number($("a-reps").value);
      if (!parts.length || parts.some(s => s === "") || series.some(x => !Number.isFinite(x) || x < 0)) {
        throw Error("Enter finite nonnegative concentrations separated by commas.");
      }
      if (!Number.isInteger(reps) || reps < 1) {
        throw Error("Replicates per level must be a positive integer.");
      }
      if (series.length === 1) {
        reps = wells.length;
      } else if (series.length * reps < wells.length || series.length * reps >= wells.length + reps) {
        throw Error(`${series.length} levels × ${reps} replicates does not match ${wells.length} selected wells. A partial final level is allowed.`);
      }
    }

    if (role === "unknown") {
      if (!assignedStandardCurveIds().length) throw Error("Assign standard wells and their concentrations before unknown wells.");
      reps = Number($("a-reps").value);
      if (!Number.isInteger(reps) || reps < 1) throw Error("Replicates per sample must be a positive integer.");
      if (!Number.isFinite(Number($("a-dilution").value)) || Number($("a-dilution").value) <= 0) {
        throw Error("Dilution factor must be positive.");
      }
      if (!$("a-sample").value.trim()) throw Error("Enter a sample name or prefix.");
    }

    for (let i = 0; i < wells.length; i++) {
      const well = wells[i];
      const annotation = {
        role,
        include: role !== "ignore",
        exclusion_reason: "",
        curve_id: "",
        nominal_concentration: null,
        sample_id: "",
        replicate_group: "",
        dilution_factor: null
      };

      if (role === "standard") {
        annotation.curve_id = $("a-curve").value.trim();
        annotation.nominal_concentration = series[Math.floor(i / reps)];
        annotation.replicate_group = `${annotation.curve_id}_level_${Math.floor(i / reps) + 1}`;
      }
      if (role === "unknown") {
        annotation.curve_id = $("a-curve").value.trim();
        const group = Math.floor(i / reps) + 1;
        const totalGroups = Math.ceil(wells.length / reps);
        const name = $("a-sample").value.trim();
        annotation.sample_id = totalGroups === 1 ? name : `${name}${group}`;
        annotation.replicate_group = annotation.sample_id;
        annotation.dilution_factor = Number($("a-dilution").value);
      }
      draft.push({ well, reading: currentReading(well), annotation });
    }

    if (role === "standard" || role === "unknown") {
      if (!$("a-curve").value.trim()) throw Error("Choose or enter a standard curve ID.");
    }

    const curveId = role === "standard" ? $("a-curve").value.trim() : null;
    state.preview = {
      draft,
      curve: curveId && !state.layout.curves[curveId]
        ? { id: curveId, units: $("a-units").value.trim() || "concentration units" }
        : null
    };

    showMessage("editor-message", "");
    renderAssignmentPreview();
    return true;
  } catch (e) {
    showMessage("editor-message", e.message);
    return false;
  }
}

function previewCurveControl(a) {
  if (a.role !== "unknown") return `<input data-key="curve_id" value="${escapeHtml(a.curve_id)}">`;
  const ids = assignedStandardCurveIds();
  return `<select data-key="curve_id">${ids.map(id => `<option value="${escapeHtml(id)}" ${id === a.curve_id ? "selected" : ""}>${escapeHtml(id)}</option>`).join("")}</select>`;
}

function renderAssignmentPreview() {
  const p = state.preview;
  if (!p) return;
  const warnings = p.draft
    .filter(x => x.annotation.role !== "unassigned" && x.annotation.role !== "ignore" && x.annotation.include && x.reading?.measurement_status !== "numeric")
    .map(x => `${x.well} is ${x.reading?.measurement_status || "empty"}`);

  $("assignment-preview").innerHTML = `
    <div class="preview">
      <h3>${p.editing ? "Edit Selected Wells" : "Review Assignment Before Commit"}</h3>
      ${warnings.length ? `<div class="error">Non-numeric selected wells: ${escapeHtml(warnings.join(", "))}. They will be flagged and never used as ordinary numeric measurements.</div>` : ""}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Well</th>
              <th>Reading</th>
              <th>Role</th>
              <th>Include</th>
              <th>Standard Curve</th>
              <th>Concentration</th>
              <th>Sample</th>
              <th>Replicate Group</th>
              <th>Dilution</th>
              <th>Exclusion Reason</th>
            </tr>
          </thead>
          <tbody>
            ${p.draft.map((x, i) => {
              const a = x.annotation;
              return `<tr data-i="${i}">
                <td><strong>${x.well}</strong></td>
                <td>${escapeHtml(x.reading?.raw_value ?? "empty")} (${x.reading?.measurement_status || "empty"})</td>
                <td><select data-key="role">${["standard", "unknown", "blank", "ignore", "unassigned"].map(v => `<option ${a.role === v ? "selected" : ""}>${v}</option>`).join("")}</select></td>
                <td><input data-key="include" type="checkbox" ${a.include ? "checked" : ""}></td>
                <td>${previewCurveControl(a)}</td>
                <td><input data-key="nominal_concentration" type="number" step="any" value="${a.nominal_concentration ?? ""}"></td>
                <td><input data-key="sample_id" value="${escapeHtml(a.sample_id)}"></td>
                <td><input data-key="replicate_group" value="${escapeHtml(a.replicate_group)}"></td>
                <td><input data-key="dilution_factor" type="number" step="any" value="${a.dilution_factor ?? ""}"></td>
                <td><input data-key="exclusion_reason" value="${escapeHtml(a.exclusion_reason)}"></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="row" style="margin-top: 14px;">
        <button id="commit-assignment" class="primary">Save Selected Wells</button>
        <button id="cancel-assignment">Cancel</button>
      </div>
    </div>`;

  document.querySelectorAll('#assignment-preview tbody select[data-key="role"]').forEach(select => {
    select.onchange = () => {
      const row = select.closest("tr");
      const curveControl = row.querySelector('[data-key="curve_id"]');
      const include = row.querySelector('[data-key="include"]');
      if (select.value === "unassigned" || select.value === "ignore") {
        include.checked = false;
      } else if (!include.checked && !row.querySelector('[data-key="exclusion_reason"]').value.trim()) {
        include.checked = true;
      }
      const curveId = curveControl.value || Object.keys(state.layout.curves)[0] || "";
      curveControl.closest("td").innerHTML = previewCurveControl({ role: select.value, curve_id: curveId });
    };
  });

  $("commit-assignment").onclick = commitAssignment;
  $("cancel-assignment").onclick = () => {
    state.preview = null;
    $("assignment-preview").innerHTML = "";
  };
}

function commitAssignment() {
  const rows = [...document.querySelectorAll("#assignment-preview tbody tr")];
  const draft = { ...state.layout.annotations };
  const errors = [], nonNumeric = [];

  for (const tr of rows) {
    const item = state.preview.draft[Number(tr.dataset.i)], a = {};
    for (const input of tr.querySelectorAll("[data-key]")) {
      const key = input.dataset.key;
      a[key] = input.type === "checkbox" ? input.checked : input.value.trim();
    }
    if (a.role === "unassigned") {
      delete draft[item.well];
      continue;
    }
    if (a.role === "standard" && a.nominal_concentration !== "") {
      const n = Number(a.nominal_concentration);
      if (!Number.isFinite(n) || n < 0) errors.push(`${item.well}: invalid concentration`);
      a.nominal_concentration = n;
    } else {
      a.nominal_concentration = null;
    }

    if (a.role === "unknown" && a.dilution_factor !== "") {
      const n = Number(a.dilution_factor);
      if (!Number.isFinite(n) || n <= 0) errors.push(`${item.well}: invalid dilution`);
      a.dilution_factor = n;
    } else {
      a.dilution_factor = null;
    }

    if (a.role !== "ignore" && !a.include && !a.exclusion_reason) errors.push(`${item.well}: exclusion reason required`);
    if (a.role === "standard" && (!a.curve_id || a.nominal_concentration === null)) errors.push(`${item.well}: standard needs a standard curve and concentration`);
    if (a.role === "standard" && a.curve_id && !state.layout.curves[a.curve_id] && state.preview.curve?.id !== a.curve_id) {
      errors.push(`${item.well}: create the standard curve using Assign selected wells first`);
    }
    if (a.role === "unknown" && (!a.curve_id || !a.sample_id || a.dilution_factor === null)) {
      errors.push(`${item.well}: unknown needs a standard curve, sample and dilution`);
    }

    if (a.role === "standard") {
      a.sample_id = "";
      a.dilution_factor = null;
      if (item.annotation.role !== "standard" && a.replicate_group === item.annotation.replicate_group) a.replicate_group = "";
    } else if (a.role === "unknown") {
      a.nominal_concentration = null;
      if (item.annotation.role !== "unknown" && a.replicate_group === item.annotation.replicate_group) a.replicate_group = a.sample_id;
    } else {
      a.curve_id = "";
      a.nominal_concentration = null;
      a.sample_id = "";
      a.replicate_group = "";
      a.dilution_factor = null;
    }

    if (a.role === "ignore") a.include = false;
    if (a.include && item.reading?.measurement_status !== "numeric" && a.role !== "ignore") nonNumeric.push(item.well);
    draft[item.well] = a;
  }

  const curvesWithStandards = new Set(Object.values(draft).filter(a => a.role === "standard" && a.include).map(a => a.curve_id));
  for (const tr of rows) {
    const item = state.preview.draft[Number(tr.dataset.i)], a = draft[item.well];
    if (a?.role === "unknown" && (!curvesWithStandards.has(a.curve_id) || (!state.layout.curves[a.curve_id] && state.preview.curve?.id !== a.curve_id))) {
      errors.push(`${item.well}: choose a standard curve with assigned standard wells`);
    }
  }

  if (errors.length) return showMessage("editor-message", errors.join("; "));

  saveHistory();
  state.layout.annotations = draft;
  if (state.preview.curve && curvesWithStandards.has(state.preview.curve.id)) {
    const c = state.preview.curve;
    state.layout.curves[c.id] = { units: c.units };
  }

  state.result = null;
  state.preview = null;
  renderPlate();
  renderEditor();
  renderAnalysis();
  showMessage("editor-message", `${rows.length} well${rows.length === 1 ? "" : "s"} updated.${nonNumeric.length ? ` Check non-numeric wells: ${nonNumeric.join(", ")}.` : ""}`, nonNumeric.length ? "notice" : "success");
}

function renderCurveList() {
  const curves = Object.entries(state.layout.curves), counts = {};
  for (const a of Object.values(state.layout.annotations)) {
    if (a.role === "standard" && a.include) counts[a.curve_id] = (counts[a.curve_id] || 0) + 1;
  }

  $("curve-list").innerHTML = curves.length ? `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Standard Curve ID</th>
            <th>Assigned Standard Wells</th>
            <th>Concentration Units</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${curves.map(([id, c]) => `
            <tr>
              <td><strong>${escapeHtml(id)}</strong></td>
              <td>${counts[id] || 0} ${counts[id] ? "wells" : "— assign standards first"}</td>
              <td><input data-curve-units="${escapeHtml(id)}" value="${escapeHtml(c.units)}" style="width:140px;"></td>
              <td><button data-save-curve="${escapeHtml(id)}" class="btn-sm">Save Units</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>` : "<p class='hint'>No standard curves assigned yet.</p>";

  document.querySelectorAll("[data-save-curve]").forEach(b => {
    b.onclick = () => {
      const id = b.dataset.saveCurve;
      saveHistory();
      state.layout.curves[id] = { units: document.querySelector(`[data-curve-units="${CSS.escape(id)}"]`).value.trim() || "concentration units" };
      state.result = null;
      renderAnalysis();
      showMessage("editor-message", `Standard curve ${id} saved.`, "success");
    };
  });
}

/* LAYOUT JSON LOAD & EXPORT */
async function loadLayoutFile(e) {
  try {
    const file = e.target.files[0];
    if (!file) return;
    const raw = JSON.parse(await file.text());
    const checked = await api("/api/validate-layout", { imported: state.imported, layout: raw });
    if (checked.errors.length) throw Error(checked.errors.join("; "));
    state.pendingLayout = checked.layout;

    const annotations = Object.entries(checked.layout.annotations);
    const oldMethod = raw.settings?.primary_method || "B";
    const migration = (raw.version ?? 1) === 1
      ? `<div class="notice">Legacy Layout V1: Method ${escapeHtml(oldMethod)} is mapped to Method ${checked.layout.settings.primary_method}. Numerical results remain identical.</div>`
      : "";

    $("layout-preview").innerHTML = `
      <div class="preview">
        <h3>Review Layout File Before Applying</h3>
        <p>${annotations.length} well annotations, ${Object.keys(checked.layout.curves).length} standard curves.</p>
        ${migration}
        ${checked.warnings.length
          ? `<div class="error">Measurement status changed: ${escapeHtml(checked.warnings.join("; "))}</div>`
          : "<div class='success'>Annotated well statuses match this reader export.</div>"
        }
        <p class="hint">Assignments and settings will replace the current map. OD readings from the loaded workbook stay unchanged.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Well</th><th>Role</th><th>Curve</th><th>Concentration</th><th>Sample</th><th>Dilution</th></tr></thead>
            <tbody>
              ${annotations.map(([well, a]) => `<tr><td><strong>${well}</strong></td><td>${a.role}</td><td>${escapeHtml(a.curve_id)}</td><td>${a.nominal_concentration ?? ""}</td><td>${escapeHtml(a.sample_id)}</td><td>${a.dilution_factor ?? ""}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="row">
          <button id="apply-layout" class="primary">Apply Saved Layout</button>
          <button id="cancel-layout">Cancel</button>
        </div>
      </div>`;

    $("apply-layout").onclick = () => {
      saveHistory();
      state.layout = state.pendingLayout;
      state.pendingLayout = null;
      state.result = null;
      renderPlate();
      renderEditor();
      renderAnalysis();
    };
    $("cancel-layout").onclick = () => {
      $("layout-preview").innerHTML = "";
      state.pendingLayout = null;
    };
  } catch (err) {
    $("layout-preview").innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

async function downloadLayout() {
  try {
    const layout = await api("/api/layout", { imported: state.imported, layout: state.layout });
    downloadBlob(new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" }), "elisa_layout.json");
  } catch (e) {
    showMessage("editor-message", e.message);
  }
}

/* STEP 3: ANALYSIS & REPORTING */
function renderAnalysis() {
  const root = $("analysis-root");
  if (!root) return;

  if (!state.imported) {
    root.innerHTML = `
      <div class="panel-header">
        <h2 class="panel-title"><span class="step-pill">Step 3</span> Analyze & Export</h2>
      </div>
      <p class='hint'>Import a plate reader workbook and assign wells to run calibration analysis.</p>`;
    return;
  }

  const s = {
    blank_policy: "none",
    primary_method: "A",
    cv_warning_pct: 20,
    recovery_min_pct: 80,
    recovery_max_pct: 120,
    max_rmse_od: 0.15,
    min_response_span_od: 0.05,
    ...state.layout.settings
  };

  root.innerHTML = `
    <div class="panel-header">
      <h2 class="panel-title"><span class="step-pill">Step 3</span> Calibration Analysis & Report</h2>
    </div>

    <!-- Scientific Model Readout Banner (Auditor Amendment) -->
    <div class="model-readout-card">
      <div>
        <div class="model-readout-title">Nonlinear Standard Curve Fitting Model: Automatic (3PL / 4PL)</div>
        <div class="model-readout-desc">Curves with exactly 3 unique standard levels fit 3PL (bottom parameter constrained to 0 after blank correction). Curves with ≥4 unique levels fit full 4PL.</div>
      </div>
      <span class="badge" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;">Algorithm Governed</span>
    </div>

    <!-- QC Parameters -->
    <div class="qc-fields">
      ${qcOptionField("Blank Subtraction Policy", "s-blank", [
        ["none", "None (Raw OD)"],
        ["pooled", "Subtract Global Plate Blank Mean"]
      ], s.blank_policy, "Choose whether to subtract the mean of all included blank wells from all standard and unknown wells prior to curve fitting.")}

      ${qcOptionField("Primary Quantification Method", "s-method", [
        ["A", "Method A · Average individual well concentrations"],
        ["B", "Method B · Invert mean replicate OD"]
      ], s.primary_method, "Method A calculates a concentration for each valid replicate well, then averages those concentrations. Method B averages replicate OD first, then converts that mean to a concentration.")}

      ${qcNumberField("Replicate CV% Warning Limit", "s-cv", s.cv_warning_pct, "Replicate coefficient of variation: standard deviation divided by mean × 100. Flags standard and unknown replicates with high variation; does not discard data.")}

      ${qcNumberField("Standard Recovery Min %", "s-rmin", s.recovery_min_pct, "For each positive standard well, recovery is (fitted concentration / nominal concentration) × 100. Values below this threshold fail curve QC.")}

      ${qcNumberField("Standard Recovery Max %", "s-rmax", s.recovery_max_pct, "For each positive standard well, recovery is (fitted concentration / nominal concentration) × 100. Values above this threshold fail curve QC.")}

      ${qcNumberField("Max Fit RMSE Limit (OD)", "s-rmse", s.max_rmse_od, "Root mean square error between standard well OD readings and fitted model OD. Exceeding this threshold fails standard curve QC.")}

      ${qcNumberField("Min Standard OD Spread", "s-span", s.min_response_span_od, "Highest minus lowest corrected OD across usable standard wells for a curve. Spread below this minimum fails standard curve QC.")}
    </div>

    <div class="row" style="margin-top: 18px;">
      <button id="run-analysis" class="primary">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Run Analysis & Curve Fitting
      </button>
      <button id="download-report" ${state.result ? "" : "disabled"}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        Download Analysis Workbook (.xlsx)
      </button>
    </div>

    <div id="analysis-message"></div>
    <div id="results"></div>
  `;

  root.querySelectorAll(".qc-help-button").forEach(button => {
    button.addEventListener("pointerenter", () => positionQcHelp(button));
    button.addEventListener("focus", () => positionQcHelp(button));
  });

  $("run-analysis").onclick = runAnalysis;
  $("download-report").onclick = downloadReport;

  if (state.result) renderResults();
}

function collectSettings() {
  const s = {
    blank_policy: $("s-blank").value,
    primary_method: $("s-method").value,
    cv_warning_pct: Number($("s-cv").value),
    recovery_min_pct: Number($("s-rmin").value),
    recovery_max_pct: Number($("s-rmax").value),
    max_rmse_od: Number($("s-rmse").value),
    min_response_span_od: Number($("s-span").value)
  };
  if (Object.entries(s).some(([k, v]) => typeof v === "number" && (!Number.isFinite(v) || v < 0))) {
    throw Error("QC thresholds must be finite nonnegative numbers.");
  }
  return s;
}

async function runAnalysis() {
  try {
    state.layout.settings = collectSettings();
    $("run-analysis").disabled = true;
    showMessage("analysis-message", "Computing non-linear regression fits and sample concentrations…", "success");
    state.result = await api("/api/analyze", { imported: state.imported, layout: state.layout });
    showMessage("analysis-message", "");
    renderAnalysis();
  } catch (e) {
    showMessage("analysis-message", e.message);
  } finally {
    if ($("run-analysis")) $("run-analysis").disabled = false;
  }
}

async function downloadReport() {
  try {
    const blob = await api("/api/report", { imported: state.imported, layout: state.layout }, true);
    downloadBlob(blob, "elisa_analysis.xlsx");
  } catch (e) {
    showMessage("analysis-message", e.message);
  }
}

function resultCell(w, viewMode) {
  if (!w || w.role === "ignore") return "—";
  if (w.role === "blank") return viewMode === "od" ? fmt(w.corrected_od, 4) : "BLANK";
  if (w.role === "standard") {
    if (viewMode === "od") return fmt(w.corrected_od, 4);
    return `REF ${Number(w.nominal_concentration)}${w.measurement_status === "overflow" ? " OVRFLW" : ""}`;
  }
  if (viewMode === "od") {
    return fmt(w.corrected_od, 4);
  }
  if (w.well_adjusted_concentration !== null) return fmt(w.well_adjusted_concentration, 6);
  if (w.result_status.startsWith("below_")) return "0";
  if (w.measurement_status === "overflow") return "OVRFLW";
  return (w.result_status === "no_fit" || w.result_status === "invalid_curve") ? "NO FIT" : "—";
}

function table(headers, rows) {
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.map(row => `<tr>${row.map(v => `<td>${v ?? "—"}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

function renderResults() {
  const r = state.result;
  const root = $("results");
  if (!r || !root) return;

  const byWell = Object.fromEntries(r.well_results.map(w => [w.well, w]));
  const byCurve = Object.fromEntries(r.curves.map(c => [c.curve_id, c]));

  // Calculate QC Summary Metrics (Auditor Amendment)
  const failedCurves = r.curves.filter(c => c.status !== "valid" || c.qc_status === "fail");
  const flaggedSamples = r.unknown_results.filter(x => x.status !== "quantified" || x.flags.length > 0);
  const totalErrors = r.errors.length + failedCurves.length + flaggedSamples.length;

  let qcBannerHtml = "";
  if (totalErrors === 0) {
    qcBannerHtml = `
      <div class="global-qc-banner pass">
        <div><strong>Assay QC Passed:</strong> All standard curves fitted successfully, recoveries are within tolerance, and samples were quantified without flags.</div>
        <span class="badge" style="background:#bbf7d0;color:#14532d;">QC PASS</span>
      </div>`;
  } else {
    qcBannerHtml = `
      <div class="global-qc-banner fail">
        <div>
          <strong>QC Attention Needed:</strong>
          ${r.errors.length ? `${r.errors.join("; ")} • ` : ""}
          ${failedCurves.length ? `${failedCurves.length} standard curve(s) failed QC or fit criteria • ` : ""}
          ${flaggedSamples.length ? `${flaggedSamples.length} sample(s) flagged or out-of-range.` : ""}
        </div>
        <span class="badge" style="background:#fecdd3;color:#9f1239;">QC REVIEW REQUIRED</span>
      </div>`;
  }

  // Result Tabs (Auditor Amendment)
  const tabs = [
    { id: "tab-plate", label: "Concentration Plate", badge: null },
    { id: "tab-curves", label: "Standard Curves", badge: failedCurves.length ? `${failedCurves.length} Fail` : "Pass", badgeClass: failedCurves.length ? "badge-fail" : "badge-pass" },
    { id: "tab-samples", label: "Unknown Samples", badge: flaggedSamples.length ? `${flaggedSamples.length} Flags` : `${r.unknown_results.length}`, badgeClass: flaggedSamples.length ? "badge-fail" : "" },
    { id: "tab-standards", label: "Calibrator Recovery & Levels", badge: `${r.standards_qc.length} Levels` },
    { id: "tab-wells", label: "96-Well Full Audit", badge: "96 Wells" }
  ];

  let html = qcBannerHtml;
  html += `<div class="results-tabs">
    ${tabs.map(t => `
      <button type="button" class="tab-btn ${state.activeTab === t.id ? "active" : ""}" data-tab="${t.id}">
        ${escapeHtml(t.label)}
        ${t.badge ? `<span class="tab-badge ${t.badgeClass || ""}">${escapeHtml(t.badge)}</span>` : ""}
      </button>
    `).join("")}
  </div>`;

  // TAB 1: CONCENTRATION PLATE
  if (state.activeTab === "tab-plate") {
    html += `
      <div class="row" style="justify-content:space-between; margin-bottom: 8px;">
        <p class='hint' style="margin:0;">
          <strong>Dilution-adjusted concentration</strong> by well. <code>0</code> indicates below lowest positive standard.
        </p>
        <button id="toggle-plate-mode" class="btn-sm">
          ${state.plateViewMode === "conc" ? "Switch to Blank-Corrected OD View" : "Switch to Adjusted Concentration View"}
        </button>
      </div>
      <div class="table-wrap concentration-table">
        <table>
          <thead>
            <tr><th>Row</th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${ROWS.split("").map(row => `
              <tr>
                <th>${row}</th>
                ${Array.from({ length: 12 }, (_, i) => {
                  const well = row + (i + 1);
                  const w = byWell[well];
                  const label = resultCell(w, state.plateViewMode);
                  const curve = byCurve[w?.curve_id];
                  const curveQc = curve?.qc_status;
                  const curveStatus = curve?.status;
                  const curveWarning = curveQc === "fail" || (curveStatus && curveStatus !== "valid");
                  const isFlagged = w?.role === "unknown" && (curveWarning || w?.result_status !== "ok" || (w?.flags && w.flags.length > 0));
                  return `<td class="${isFlagged ? "result-flag" : ""}" title="${escapeHtml(`${well} · ${w?.sample_id || w?.role || "unassigned"} · status: ${w?.result_status || ""} · curve QC: ${curveQc || "—"} · dilution: ${w?.dilution_factor ?? "—"}${w?.flags?.length ? " · flags: " + w.flags.join("; ") : ""}`)}">${label}</td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
  }

  // TAB 2: STANDARD CURVES & FITS
  else if (state.activeTab === "tab-curves") {
    html += `<div style="margin: 12px 0;">`;
    for (const c of r.curves) {
      const plot = r.plots?.[c.curve_id];
      html += `
        <div class="curve-card">
          <div class="curve-card-header">
            <h4>Standard Curve: ${escapeHtml(c.curve_id)}</h4>
            <div class="row" style="margin:0;">
              <span class="status-chip ${c.status === "valid" ? "chip-pass" : "chip-fail"}">${c.status === "valid" ? "FIT OK" : "NO FIT"}</span>
              <span class="status-chip ${c.qc_status === "pass" ? "chip-pass" : "chip-fail"}">QC ${escapeHtml(c.qc_status.toUpperCase())}</span>
              <span class="badge" style="background:#eef2ff;color:#4338ca;">Model: ${escapeHtml(c.model_type || "N/A")}</span>
            </div>
          </div>

          <p class="hint">Fitted Equation: <code>${escapeHtml(c.fitted_equation || "Equation unavailable")}</code></p>

          <div class="curve-metrics-grid">
            <div class="curve-metric"><div class="curve-metric-label">Bottom</div><div class="curve-metric-val">${fmt(c.parameters?.bottom)}</div></div>
            <div class="curve-metric"><div class="curve-metric-label">Top</div><div class="curve-metric-val">${fmt(c.parameters?.top)}</div></div>
            <div class="curve-metric"><div class="curve-metric-label">EC50</div><div class="curve-metric-val">${fmt(c.parameters?.ec50)}</div></div>
            <div class="curve-metric"><div class="curve-metric-label">Hill Slope</div><div class="curve-metric-val">${fmt(c.parameters?.slope)}</div></div>
            <div class="curve-metric"><div class="curve-metric-label">Fit RMSE</div><div class="curve-metric-val">${fmt(c.rmse_od)} OD</div></div>
            <div class="curve-metric"><div class="curve-metric-label">R² Coefficient</div><div class="curve-metric-val">${fmt(c.r_squared)}</div></div>
            <div class="curve-metric"><div class="curve-metric-label">Tested Range</div><div class="curve-metric-val">${fmt(c.range_low)}–${fmt(c.range_high)} ${escapeHtml(c.units)}</div></div>
          </div>

          ${c.flags.length ? `<div class="${c.qc_status === "fail" || c.status !== "valid" ? "error" : "notice"}">${escapeHtml(c.flags.join("; "))}</div>` : ""}

          <!-- Inline Matplotlib SVG Rendering (Auditor Amendment) -->
          ${plot ? `<div class="curve-svg-wrap">${plot}</div>` : ""}
        </div>`;
    }
    html += `</div>`;
  }

  // TAB 3: UNKNOWN SAMPLES
  else if (state.activeTab === "tab-samples") {
    html += `
      <div style="margin: 12px 0;">
        <p class="hint">Method A calculates concentrations per replicate and averages. Method B converts mean replicate OD.</p>
        ${table(
          ["Sample ID", "Standard Curve", "Dilution Factor", "Replicates (Valid/Included)", "Primary Measured", "Dilution-Adjusted", "Status & QC Flags"],
          r.unknown_results.map(x => [
            `<strong>${escapeHtml(x.sample_id)}</strong>`,
            escapeHtml(x.curve_id),
            fmt(x.dilution_factor),
            `${x.n_valid}/${x.n}`,
            fmt(x.primary_measured_concentration),
            `<strong>${fmt(x.dilution_adjusted_concentration)}</strong>`,
            `<span class="${x.status === "quantified" ? "good" : (x.status === "quantified_qc_warning" ? "warn" : "bad")}">${escapeHtml(x.status)}</span> ${escapeHtml(x.flags.join("; "))}`
          ])
        )}
      </div>`;
  }

  // TAB 4: CALIBRATOR RECOVERY & LEVELS
  else if (state.activeTab === "tab-standards") {
    html += `
      <div style="margin: 12px 0;">
        <p class="hint">Recovery % calculates back-calculated concentration vs assigned nominal concentration (standard acceptance range: 80–120%).</p>
        ${table(
          ["Standard Curve", "Nominal Conc", "Usable / Assigned", "Wells", "Readings & Status", "Mean Corrected OD", "OD SD", "Replicate CV %", "Back-Calculated Conc", "Recovery %", "Residual OD", "Flags"],
          r.standards_qc.map(x => [
            `<strong>${escapeHtml(x.curve_id)}</strong>`,
            fmt(x.nominal_concentration),
            `${x.n_usable}/${x.n_assigned}`,
            escapeHtml(x.wells),
            escapeHtml(x.readings + " · " + x.statuses),
            fmt(x.mean_corrected_od),
            fmt(x.sd_corrected_od),
            fmt(x.cv_pct),
            escapeHtml(x.back_calculated),
            `<span class="${x.flags.includes("recovery") ? "bad" : "good"}">${escapeHtml(x.recovery_pct)}</span>`,
            escapeHtml(x.residual_od),
            escapeHtml(x.flags)
          ])
        )}
      </div>`;
  }

  // TAB 5: 96-WELL AUDIT
  else if (state.activeTab === "tab-wells") {
    html += `
      <div style="margin: 12px 0;">
        <p class="hint">Comprehensive row-by-row audit trail for all 96 wells on the microplate.</p>
        ${table(
          ["Well", "Raw OD", "Role", "Standard Curve", "Sample ID", "Corrected OD", "Well Conc", "Dilution-Adjusted", "Result Status", "Flags"],
          r.well_results.map(x => [
            `<strong>${x.well}</strong>`,
            escapeHtml(x.raw_value ?? "empty"),
            x.role,
            escapeHtml(x.curve_id),
            escapeHtml(x.sample_id),
            fmt(x.corrected_od),
            fmt(x.well_concentration),
            fmt(x.well_adjusted_concentration),
            escapeHtml(x.result_status),
            escapeHtml(x.flags.join("; "))
          ])
        )}
      </div>`;
  }

  root.innerHTML = html;

  // Tab Switching Handlers
  root.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      state.activeTab = btn.dataset.tab;
      renderResults();
    };
  });

  const toggleModeBtn = $("toggle-plate-mode");
  if (toggleModeBtn) {
    toggleModeBtn.onclick = () => {
      state.plateViewMode = state.plateViewMode === "conc" ? "od" : "conc";
      renderResults();
    };
  }
}

/* STEP 1: IMPORT LOGIC */
async function finishImport(payload, sheetName) {
  const imported = await api("/api/import", { ...payload, ...(sheetName ? { sheet_name: sheetName } : {}) });
  if (imported.requires_sheet_selection) {
    $("sheet-choice").innerHTML = `
      <label class="field">
        <span>Select OD Reading Sheet:</span>
        <select id="od-sheet">
          ${imported.candidate_sheets.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
        </select>
      </label>
      <button id="select-sheet" class="primary">Import Selected Sheet</button>
    `;
    $("select-sheet").onclick = async () => {
      try {
        showMessage("import-warnings", "Importing selected sheet…", "success");
        await finishImport(payload, $("od-sheet").value);
      } catch (error) {
        showMessage("import-warnings", error.message);
      }
    };
    showMessage("import-warnings", "This workbook contains multiple plate-formatted sheets. Select the sheet containing raw OD readings.", "notice");
    return;
  }

  state.imported = imported;
  state.layout = { version: LAYOUT_VERSION, annotations: {}, curves: {}, settings: {} };
  state.selected.clear();
  state.history = [];
  state.result = null;
  $("sheet-choice").innerHTML = "";

  const fileInfo = $("file-info");
  if (fileInfo) {
    fileInfo.textContent = `${imported.filename} • Sheet: ${imported.sheet} • Columns: ${imported.plate_columns?.join(", ") || "1–12"}`;
  }

  const warnEl = $("import-warnings");
  if (warnEl) {
    if (imported.warnings && imported.warnings.length) {
      warnEl.style.display = "block";
      warnEl.textContent = imported.warnings.join(" ");
    } else {
      warnEl.style.display = "none";
      warnEl.textContent = "";
    }
  }

  renderPlate();
  renderEditor();
  renderAnalysis();
}

$("file").onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    showMessage("import-warnings", "Importing reader workbook…", "success");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await finishImport({ filename: file.name, data_base64: btoa(binary) });
  } catch (err) {
    state.imported = null;
    showMessage("import-warnings", err.message);
    renderPlate();
    renderEditor();
    renderAnalysis();
  }
};

// Initial Render
renderPlate();
renderEditor();
renderAnalysis();
window.ELISA_APP_READY = true;
