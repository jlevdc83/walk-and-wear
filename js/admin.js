/* Admin page. Reads and writes the same localStorage the app does — same origin,
 * so nothing has to be passed between them.
 *
 * Everything saves on change. There is no Save button because there is nothing to
 * lose by saving immediately, and a Save button is a thing to forget to press.
 */

let S = loadSettings();

/* --- Settings fields ------------------------------------------------------ */

function bindFields(){
  document.querySelectorAll("[data-set]").forEach((el) => {
    const key = el.dataset.set;
    const val = S[key];
    if (el.type === "checkbox") el.checked = !!val;
    else el.value = val;

    el.addEventListener("change", () => {
      if (el.type === "checkbox") S[key] = el.checked;
      else if (el.type === "number") {
        const n = Number(el.value);
        // Refuse a value the field's own bounds reject rather than storing NaN.
        if (!Number.isFinite(n)) { el.value = S[key]; return; }
        S[key] = Math.min(Math.max(n, Number(el.min)), Number(el.max));
        el.value = S[key];
      } else S[key] = el.value;

      saveSettings(S);
      applyMaskVars(S);
      renderMask();
      flash();
    });
  });
}

let flashTimer = null;
function flash(msg = "Saved"){
  const el = document.getElementById("savedNote");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    el.classList.remove("on");
    el.textContent = "Changes save as you make them.";
  }, 1400);
}

/* --- Aperture preview ----------------------------------------------------- */

function renderMask(){
  const m = maskMetrics(S);
  const win = document.getElementById("maskWindow");
  win.style.width = `${m.wPct}%`;
  win.style.height = `${m.hPct}%`;
  win.style.transform = `translate(calc(-50% + ${m.shift}%), -50%)`;

  const hiddenNotch = (DISPLAY_MM.w - S.maskW) / 2 + Math.abs(S.maskOffset);
  const hiddenFar = (DISPLAY_MM.w - S.maskW) / 2 - Math.abs(S.maskOffset);
  const hiddenY = (DISPLAY_MM.h - S.maskH) / 2;
  document.getElementById("maskPreview").classList.toggle("flip", S.maskFlip);
  document.getElementById("maskReadout").textContent =
    `${S.maskW} × ${S.maskH} mm of ${DISPLAY_MM.w} × ${DISPLAY_MM.h} — ` +
    `hides ${hiddenNotch.toFixed(1)} mm notch side, ${hiddenFar.toFixed(1)} mm far side, ` +
    `${hiddenY.toFixed(1)} mm top and bottom` +
    (hiddenNotch < 6 ? "  ⚠ the notch needs about 6 mm of cover" : "");
}

/* --- Widgets: drag to reorder, arrows as the fallback --------------------- */

function renderList(context){
  const ul = document.getElementById(context === "portrait" ? "listPortrait" : "listBedside");
  const active = layout[context] || [];
  const rows = [
    ...active.map((id) => WIDGETS.find((w) => w.id === id)).filter(Boolean),
    ...WIDGETS.filter((w) => !active.includes(w.id)),
  ];
  ul.innerHTML = rows.map((w) => {
    const i = active.indexOf(w.id);
    const on = i !== -1;
    return `<li class="widgetRow${on ? "" : " off"}" data-id="${w.id}" data-ctx="${context}">
      ${on ? '<span class="dragHandle" aria-hidden="true">⠿</span>' : '<span class="dragHandle blank"></span>'}
      <label class="widgetPick">
        <input type="checkbox" ${on ? "checked" : ""} data-ctx="${context}" data-id="${w.id}">
        <span class="widgetName">${w.label}</span>
        <span class="widgetNote">${w.note}</span>
      </label>
      <span class="widgetMove">
        <button type="button" data-move="up" data-ctx="${context}" data-id="${w.id}"
                aria-label="Move ${w.label} up" ${on && i > 0 ? "" : "disabled"}>↑</button>
        <button type="button" data-move="down" data-ctx="${context}" data-id="${w.id}"
                aria-label="Move ${w.label} down" ${on && i < active.length - 1 ? "" : "disabled"}>↓</button>
      </span>
    </li>`;
  }).join("");
}

function renderLists(){ renderList("portrait"); renderList("bedside"); }

function move(ctx, id, delta){
  const list = layout[ctx];
  const i = list.indexOf(id);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveLayout(); renderLists(); flash();
}

document.addEventListener("change", (e) => {
  const cb = e.target.closest(".widgetList input[type=checkbox]");
  if (!cb) return;
  const { ctx, id } = cb.dataset;
  if (cb.checked) { if (!layout[ctx].includes(id)) layout[ctx].push(id); }
  else layout[ctx] = layout[ctx].filter((x) => x !== id);
  saveLayout(); renderLists(); flash();
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-move]");
  if (!btn) return;
  move(btn.dataset.ctx, btn.dataset.id, btn.dataset.move === "up" ? -1 : 1);
});

/* Pointer-based drag, not the HTML5 drag API — that one does nothing on touch,
   and this page gets used on the phone as much as the Mac. The handle is the grab
   target rather than the whole row, so tapping the checkbox still just toggles. */

let drag = null;

function rowsIn(ctx){
  return [...document.querySelectorAll(`.widgetList li[data-ctx="${ctx}"]:not(.off)`)];
}

document.addEventListener("pointerdown", (e) => {
  const handle = e.target.closest(".dragHandle:not(.blank)");
  if (!handle) return;
  const li = handle.closest("li");
  drag = { ctx: li.dataset.ctx, id: li.dataset.id, el: li };
  li.classList.add("dragging");
  handle.setPointerCapture(e.pointerId);
  e.preventDefault();
});

document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const rows = rowsIn(drag.ctx);
  const from = layout[drag.ctx].indexOf(drag.id);

  // Swap as soon as the pointer passes a neighbour's midpoint — steadier than tracking
  // an offset, and it reads the same to the hand.
  //
  // The node is moved rather than the list re-rendered. Re-rendering mid-drag destroys
  // the handle, which drops the pointer capture and kills the drag on its first swap.
  for (const row of rows) {
    if (row === drag.el) continue;
    const r = row.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const to = layout[drag.ctx].indexOf(row.dataset.id);
    if ((to > from && e.clientY > mid) || (to < from && e.clientY < mid)) {
      const list = layout[drag.ctx];
      list.splice(to, 0, list.splice(from, 1)[0]);
      row.parentNode.insertBefore(drag.el, to > from ? row.nextSibling : row);
      break;
    }
  }
});

["pointerup", "pointercancel"].forEach((evt) =>
  document.addEventListener(evt, () => {
    if (!drag) return;
    drag.el?.classList.remove("dragging");
    drag = null;
    saveLayout(); renderLists(); flash();
  })
);

/* --- Home / Ring ---------------------------------------------------------
   Shows the live alarm state so it is obvious whether the Pi feed is actually
   wired up. A setting whose effect you cannot observe is a setting you cannot trust. */

async function renderHome(){
  const note = document.getElementById("homeNote");
  try {
    const r = await fetch("api/home", { cache: "no-store" });
    if (!r.ok) throw new Error("no feed");
    const j = await r.json();
    note.textContent = j.ok
      ? `Connected. Alarm is “${j.state}”.`
      : `Pi reachable but HOOBS is not: ${j.error || "unknown error"}`;
  } catch {
    note.textContent = "Not the Pi build — open this from the Pi URL to use Ring state.";
  }
}

/* --- Indoor sensors ------------------------------------------------------- */

function renderSensors(){
  const roster = loadSensorRoster();
  const note = document.getElementById("sensorNote");
  const total = roster.air.length + roster.humidity.length;
  note.textContent = total
    ? `${roster.air.length} air, ${roster.humidity.length} humidity. There is no indoor temperature — nothing in HOOBS reports one.`
    : "No sensor list yet. Open the app on the Pi build once and it will appear here.";

  const fill = (el, names, chosen) => {
    el.innerHTML = ['<option value="">First available</option>']
      .concat(names.map((n) => `<option value="${n.replace(/"/g, "&quot;")}"${n === chosen ? " selected" : ""}>${n}</option>`))
      .join("");
    el.disabled = names.length === 0;
  };
  fill(document.getElementById("airSensorPick"), roster.air, S.airSensor);
  fill(document.getElementById("humSensorPick"), roster.humidity, S.humiditySensor);
}

[["airSensorPick", "airSensor"], ["humSensorPick", "humiditySensor"]].forEach(([elId, key]) => {
  document.getElementById(elId).addEventListener("change", (e) => {
    S[key] = e.target.value;
    saveSettings(S); flash();
  });
});

/* --- Batteries ------------------------------------------------------------
   The roster is whatever the app last saw from the Pi. Offering the choice from a
   cached list means it works on the public admin page too, where /api/home is a 404. */

function renderBatteries(){
  const roster = loadBattRoster();
  const watch = loadBattWatch();
  const note = document.getElementById("battNote");
  const ul = document.getElementById("battList");

  if (!roster.length) {
    note.textContent = "No device list yet. Open the app on the Pi build once and it will appear here.";
    ul.innerHTML = "";
    return;
  }
  note.textContent =
    watch === null ? `Watching all ${roster.length}. Untick any you don't care about.`
    : watch.length === 0 ? `Watching none — the widget will stay quiet.`
    : `Watching ${watch.length} of ${roster.length}.`;

  const pick = document.getElementById("battPrimaryPick");
  if (pick) {
    // Labelled with the type, since two devices share the name "Front Door".
    pick.innerHTML = ['<option value="">None</option>'].concat(roster.map((d) => {
      const dev = typeof d === "string" ? { name: d } : d;
      const key = devKey(dev);
      const label = dev.type ? `${dev.name} (${dev.type})` : dev.name;
      return `<option value="${key.replace(/"/g, "&quot;")}"${key === S.battPrimary ? " selected" : ""}>${label}</option>`;
    })).join("");
  }

  ul.innerHTML = roster.map((d) => {
    // Tolerate the old name-only roster from a previous version.
    const dev = typeof d === "string" ? { name: d } : d;
    const ignored = (S.battIgnore || []).some((k) => devMatches(dev, k));
    const on = !ignored && (watch === null || watch.some((s) => devMatches(dev, s)));
    const lvl = dev.level == null ? null : Math.round(dev.level);
    const low = dev.flag || (lvl != null && lvl <= S.battThreshold);
    const meta = [dev.type, lvl == null ? null : `${lvl}%`].filter(Boolean).join(" · ");
    const tone = low ? "bad" : (lvl != null && lvl <= 50 ? "mid" : "ok");
    return `<li class="widgetRow battPickRow${on ? "" : " off"}${low ? " lowBatt" : ""}">
      <label class="widgetPick">
        <input type="checkbox" ${on ? "checked" : ""} data-batt="${devKey(dev).replace(/"/g, "&quot;")}">
        <span class="devIcon">${icon(deviceIcon(dev), tone)}</span>
        <span class="widgetName">${dev.name}</span>
        <span class="widgetNote">${meta || "no level reported"}${
          ignored ? " — not in service" : low ? " — low" : ""}</span>
      </label>
    </li>`;
  }).join("");
}

document.addEventListener("change", (e) => {
  const cb = e.target.closest("input[data-batt]");
  if (!cb) return;
  const roster = loadBattRoster();
  // An empty watch list means "all", so the first unticked box has to be expanded
  // into an explicit list or it would read as "watch nothing".
  let watch = loadBattWatch();
  if (watch === null) watch = roster.map(devKey);   // expand "all" before removing one from it
  const key = cb.dataset.batt;
  // Re-enabling something excluded as out-of-service has to clear that too, or the
  // checkbox would tick and nothing would change.
  if (cb.checked && (S.battIgnore || []).some((k) => k === key)) {
    S.battIgnore = S.battIgnore.filter((k) => k !== key);
    saveSettings(S);
  } else if (!cb.checked) {
    S.battIgnore = [...new Set([...(S.battIgnore || []), key])];
    saveSettings(S);
  }
  watch = cb.checked ? [...new Set([...watch, key])] : watch.filter((n) => n !== key);
  saveBattWatch(watch);
  renderBatteries(); flash();
});

document.getElementById("battPrimaryPick").addEventListener("change", (e) => {
  S.battPrimary = e.target.value;
  saveSettings(S); renderBatteries(); flash();
});

document.getElementById("battAll").addEventListener("click", () => {
  saveBattWatch(null); renderBatteries(); flash("Watching all");
});
document.getElementById("battNone").addEventListener("click", () => {
  saveBattWatch([]); renderBatteries(); flash("Watching none");
});

/* --- Data ----------------------------------------------------------------- */

function describeData(){
  const snap = localStorage.getItem("dashboard_snapshot");
  const place = localStorage.getItem("dashboard_place");
  const zip = localStorage.getItem("dashboard_zip");
  let age = "no cached forecast";
  if (snap) {
    try {
      const mins = Math.round((Date.now() - JSON.parse(snap).at) / 60000);
      age = `cached forecast ${mins} min old`;
    } catch { age = "cached forecast unreadable"; }
  }
  document.getElementById("dataNote").textContent =
    `${age} · location: ${zip ? `ZIP ${zip}` : place || "device"}`;
}

/// Explain a missing pollen tile instead of letting it look like a bug. The app
/// records coverage on its last refresh, so this needs no network call of its own.
function describePollen(){
  const note = document.getElementById("pollenNote");
  if (!note) return;
  const covered = localStorage.getItem(POLLEN_KEY);
  const off = covered === "0";
  note.hidden = !off;
  if (off) {
    note.textContent = "Pollen is hidden here: Open-Meteo's counts come from the CAMS "
      + "European dataset, which returns nothing for this location. It reappears on its "
      + "own inside the covered area.";
  }
}
describePollen();

document.getElementById("clearCache").addEventListener("click", () => {
  localStorage.removeItem("dashboard_snapshot");
  describeData(); flash("Cache cleared");
});

document.getElementById("clearLocation").addEventListener("click", () => {
  ["dashboard_zip", "dashboard_place", "dashboard_snapshot", "dashboard_pin"]
    .forEach((k) => localStorage.removeItem(k));
  describeData(); flash("Location forgotten");
});

document.getElementById("resetAll").addEventListener("click", () => {
  if (!confirm("Reset every setting, the widget layout, and the saved location?")) return;
  [SETTINGS_KEY, LAYOUT_KEY, BATT_WATCH_KEY, "dashboard_zip", "dashboard_place",
   "dashboard_snapshot", "dashboard_keepAwake"].forEach((k) => localStorage.removeItem(k));
  S = loadSettings();
  layout = loadLayout();
  bindFields(); renderLists(); applyMaskVars(S); renderMask(); describeData(); renderBatteries(); renderSensors(); renderHome();
  flash("Reset");
});

bindFields();
renderLists();
applyMaskVars(S);
renderMask();
describeData();
renderBatteries();
renderSensors();
renderHome();
// Materialise the current layout on open. Until something is changed it exists only
// as defaults in memory, so nothing has actually been written down — which makes the
// stored state a surprise rather than a record.
saveLayout();
