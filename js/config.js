/* Shared settings, read by the app and written by the admin page.
 *
 * Same origin, so both see the same localStorage. Loaded before app.js and before
 * admin.js; deliberately not a module, because the app has no build step and adding
 * one to read a config object would be a poor trade.
 *
 * Defaults are the values the app shipped with — every one of them was arrived at by
 * use, not derived, so "reset" means "back to what was actually working".
 */

const SETTINGS_KEY = "ww_settings";

const SETTING_DEFAULTS = {
  // Personal
  runHot: true,           // adds 4°F to every felt temperature
  units: "F",             // "F" | "C"

  // Walk
  outlookHours: 10,       // how far the hourly strip looks ahead
  shortWindowHours: 2,    // at or below this, a window reports both ends

  // Display
  refreshMin: 20,
  dimAfterSec: 60,        // night + keep-awake: warm amber
  nearOffAfterSec: 300,   // night + keep-awake: black, clock only
  peekSec: 30,            // how long a long-press reveal lasts
  keepAwakeDefault: false,

  // Which sensor feeds each indoor widget. Empty means "whichever is first", which
  // is only safe while there is exactly one of each.
  airSensor: "",
  humiditySensor: "",
  humidityTarget: 60,     // Josh's stated target; the widget says which side of it you are on

  // Ring. "any" | "away" | "off" — which armed states send the display dark.
  // Independent of keep-awake and of the hour: if the house is armed, the reason to
  // go dark has nothing to do with what time it is.
  dimOnArmed: "any",

  // How the hourly walk outlook draws itself. Every one runs the same verdict for
  // the same hours; they differ only in what encodes it. Several avoid colour
  // entirely, because a colour key is something you have to remember.
  //   icons  glyph per hour        height  taller means better
  //   line   walkability curve     windows only the good spans, with times
  //   labels GO / WAIT per hour    radial  a clock dial
  //   spark  line with markers     text    a plain sentence
  //   density solid vs faint       ladder  a vertical list of hours
  walkDisplay: "icons",
  vizStyle: "auto",

  // Batteries
  // Devices excluded regardless of the watch list — hardware that exists in HOOBS
  // but is not actually in service, so its level is noise rather than a warning.
  // Patio Gate reads 0% because the sensor is not in use, not because it is dying.
  battIgnore: ["Patio Gate|sensor"],
  battThreshold: 20,
  // Always shown first, whatever its level. A healthy lock sorts last under
  // worst-first, which is exactly backwards for the one battery whose death locks
  // you out. Keyed name|type, because names are NOT unique — there is a "Front Door"
  // lock and a "Front Door" contact sensor, and pinning by name matched both.
  battPrimary: "Front Door|lock",
  // How the battery widget draws itself:
  //   dials   — ring gauges, one per device (iOS-like, best for a few)
  //   list    — name and level per row, most legible, scales to many
  //   bars    — horizontal meters, compact and comparable at a glance
  //   compact — a single line: how many are low and which is worst
  battDisplay: "dials",      // percent at or under which a device counts as low

  // Packages
  // How the tile draws itself: compact is one line, list is the rows, full adds the
  // chevrons and the two buttons. Only full can be acted on — see app.js.
  parcelDisplay: "list",     // "compact" | "list" | "full"
  parcelDays: 21,            // anything older than this stops being news
  parcelShowReturns: true,
  parcelShowGrocery: true,   // off if a minutes-long grocery lifecycle buries real packages
  // The alert table, as numbers rather than constants — every one of them is a guess
  // about how long a stall is normal, and guesses belong in settings.
  parcelRefundDays: 14,      // received by the retailer, no refund: the classic lost return
  parcelLabelDays: 3,        // a return label this close to expiry, still unsent
  parcelExceptionHours: 0,   // failed delivery attempt. 0 = say so at once
  parcelScanDays: 7,         // sent back, never scanned as received — watch, not alert
  parcelSettleDays: 10,      // refunded, money still not posted
  parcelGroceryHours: 2,     // how long a delivered grocery order stays on the tile

  // Bedside aperture, in mm. Defaults match build_integrated_frame.py.
  maskW: 124,
  maskH: 58,
  maskOffset: 4,          // toward the keypad
  maskFlip: false,        // true if the phone mounts the other way up
  // Which face this device shows. Set in the admin page rather than by a query
  // string — a URL you have to remember is not a setting, and a phone pinned to
  // the home screen relaunches without one anyway.
  bedsideMode: "off",     // "off" | "on" | "mask"
};

// iPhone 11 active display, landscape. Locked — see the handoff's rule about not
// re-deriving manufacturer dimensions from photographs.
const DISPLAY_MM = { w: 139.62, h: 64.51 };

// Which battery devices to watch. Three states, not two: absent means "all", which
// is what you want before anything has been chosen, and an empty array means "none".
// Collapsing those two onto `[]` left no way to say none — "watch none" then reported
// "watching 1 of 7", because it was storing a sentinel.
const BATT_WATCH_KEY = "ww_battWatch";
const BATT_ROSTER_KEY = "ww_battRoster";

/// Identity for a battery device. Name alone collides: the Schlage and the Ring
/// contact on the same door are both called "Front Door".
function devKey(d){
  if (typeof d === "string") return d;                 // legacy name-only entry
  return `${d.name}|${d.type || ""}`;
}
/// Tolerates the old name-only stored values by falling back to a name match.
function devMatches(d, stored){
  return stored.includes("|") ? devKey(d) === stored : d.name === stored;
}
const SENSOR_ROSTER_KEY = "ww_sensorRoster";

function loadSensorRoster(){
  try { return JSON.parse(localStorage.getItem(SENSOR_ROSTER_KEY) || '{"air":[],"humidity":[]}'); }
  catch { return { air: [], humidity: [] }; }
}
function saveSensorRoster(r){
  try { localStorage.setItem(SENSOR_ROSTER_KEY, JSON.stringify(r)); } catch { /* private mode */ }
}

function loadBattWatch(){
  const raw = localStorage.getItem(BATT_WATCH_KEY);
  if (raw === null) return null;                     // absent = watch all
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
}
function saveBattWatch(list){
  try {
    if (list === null) localStorage.removeItem(BATT_WATCH_KEY);
    else localStorage.setItem(BATT_WATCH_KEY, JSON.stringify(list));
  } catch { /* private mode */ }
}
// Cached on every successful Pi poll, so the admin page can offer the list even when
// it is being read from GitHub Pages, where /api/home does not exist.
function loadBattRoster(){
  try { return JSON.parse(localStorage.getItem(BATT_ROSTER_KEY) || "[]"); } catch { return []; }
}
function saveBattRoster(list){
  try { localStorage.setItem(BATT_ROSTER_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

function loadSettings(){
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || {};
    // Merge over defaults so a setting added later cannot leave an old save short.
    const out = { ...SETTING_DEFAULTS };
    for (const k of Object.keys(SETTING_DEFAULTS)) {
      if (saved[k] !== undefined && typeof saved[k] === typeof SETTING_DEFAULTS[k]) {
        out[k] = saved[k];
      }
    }
    return out;
  } catch {
    return { ...SETTING_DEFAULTS };
  }
}

function saveSettings(s){
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

/// Aperture as percentages of the display, which is what the CSS needs.
function maskMetrics(s){
  const wPct = (s.maskW / DISPLAY_MM.w) * 100;
  const hPct = (s.maskH / DISPLAY_MM.h) * 100;
  const shift = (s.maskOffset / DISPLAY_MM.w) * 100 * (s.maskFlip ? -1 : 1);
  return { wPct, hPct, shift };
}

/// Written onto :root so bedside CSS picks the aperture up without a rebuild.
function applyMaskVars(s, root = document.documentElement){
  const m = maskMetrics(s);
  root.style.setProperty("--mask-w", `${m.wPct.toFixed(2)}%`);
  root.style.setProperty("--mask-h", `${m.hPct.toFixed(2)}%`);
  root.style.setProperty("--mask-shift", `${m.shift.toFixed(2)}%`);
}

/* --- Widgets: which appear where, shared by the app and admin ----------- */

const WIDGETS = [
  { id: "walk",    label: "Dog walk",  note: "Verdict, timing, and the hourly strip" },
  { id: "wear",    label: "Wear",      note: "Jacket and clothing" },
  { id: "bring",   label: "Bring",     note: "Umbrella or shell — only when needed" },
  { id: "protect", label: "Protect",   note: "Sunscreen and sunglasses — only when needed" },
  { id: "weather", label: "Weather",   note: "Temperature and the stats strip" },

  // Compact widgets. The four marked (Pi) need the Pi build — the public one has no
  // way to read HOOBS without shipping a credential in client JavaScript.
  { id: "pollen",     label: "Pollen",          note: "Europe only — Open-Meteo has no US pollen data" },
  { id: "airquality", label: "Air quality",     note: "Outdoor PM2.5 and US AQI" },
  { id: "humidity",   label: "Humidity",        note: "Outdoor, with the dew point" },
  { id: "sun",        label: "Sun",             note: "Next sunrise or sunset, counting down" },
  { id: "tomorrow",   label: "Tomorrow",        note: "High, low and conditions" },
  { id: "lock",       label: "Front door (Pi)", note: "Lock state — the bedtime check" },
  { id: "indoorair",  label: "Indoor air (Pi)", note: "The Levoit's reading" },
  { id: "indoorhum",  label: "Indoor humidity (Pi)", note: "Against the 60% target" },
  { id: "batteries",  label: "Batteries (Pi)",  note: "Anything low or flat — 18 devices report" },
  { id: "parcels",    label: "Packages (Pi)",   note: "Deliveries, returns and refunds, from order email" },
];

/// Open-Meteo's pollen is the CAMS *European* dataset, so every count is null
/// outside its domain — verified: Berlin returns values, Washington returns nulls.
/// Roughly the published CAMS Europe grid. Used to drop the widget where it can
/// never say anything, rather than leaving a tile that reads as broken forever.
function pollenCovered(lat, lon){
  if (typeof lat !== "number" || typeof lon !== "number") return true;  // unknown: don't hide
  return lat >= 30 && lat <= 72 && lon >= -25 && lon <= 45;
}

/// Cached so the admin page can explain the absence without a network call.
const POLLEN_KEY = "ww_pollen_covered";

const LAYOUT_KEY = "dashboard_layout";
const DEFAULT_LAYOUT = {
  // Packages is in the hand-held default and deliberately not in the bedside one:
  // four tiles is already tight in that aperture, and a fifth clips. It is still
  // draggable into bedside from the admin page — just not there by default.
  portrait: ["wear", "walk", "bring", "protect", "weather", "parcels"],
  bedside:  ["walk", "weather", "lock", "batteries"],
};

function loadLayout(){
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null");
    if (!saved) return structuredClone(DEFAULT_LAYOUT);
    // Drop ids that no longer exist, so a removed widget cannot wedge the layout.
    const known = new Set(WIDGETS.map((w) => w.id));
    return {
      portrait: (saved.portrait || DEFAULT_LAYOUT.portrait).filter((id) => known.has(id)),
      bedside: (saved.bedside || DEFAULT_LAYOUT.bedside).filter((id) => known.has(id)),
    };
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

let layout = loadLayout();

function saveLayout(){
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* private mode */ }
}


/* --- Icons ----------------------------------------------------------------
   Shared by the app and the admin page. Drawn inline rather than pulled from a
   font: SF Symbols is not licensed for the web, and an icon font would be a
   download for a dozen shapes. They inherit currentColor, so a tone class colours
   them without needing a second set. */

const ICONS = {
  lock:    '<path d="M6 10V7a4 4 0 0 1 8 0v3M4.5 10h11v8.5h-11z"/>',
  unlock:  '<path d="M6 10V7a4 4 0 0 1 7.7-1.5M4.5 10h11v8.5h-11z"/>',
  air:     '<path d="M3 8h9a2.6 2.6 0 1 0-2.6-2.6M3 12h12a2.6 2.6 0 1 1-2.6 2.6M3 16h6"/>',
  droplet: '<path d="M10 3.5c3 3.6 5 6.1 5 8.4a5 5 0 0 1-10 0c0-2.3 2-4.8 5-8.4z"/>',
  sunrise: '<path d="M10 3v4M4.6 9.2 7 10M15.4 9.2 13 10M2.5 16h15M6 16a4 4 0 0 1 8 0"/>',
  sunset:  '<path d="M10 9V5M4.6 7.2 7 8M15.4 7.2 13 8M2.5 16h15M6 16a4 4 0 0 1 8 0"/>',
  calendar:'<path d="M3.5 5.5h13V17h-13zM3.5 9h13M7 3.5v3M13 3.5v3"/>',
  battery: '<path d="M2.5 7h12v6h-12zM16.5 9.5v1"/>',
  leaf:    '<path d="M4 16C4 9 9 5 17 4c0 8-4 12-11 12zM4 16c2-3 5-5 8-6"/>',
  gauge:   '<path d="M4 15a6.5 6.5 0 1 1 12 0M10 15l3.5-4"/>',

  // Packages. A box is the thing, a truck is the thing moving, the U-turn is a
  // return, and the triangle is the one that costs money if it is ignored.
  box:     '<path d="M10 3.2 3.2 6.6v6.8L10 16.8l6.8-3.4V6.6zM3.2 6.6 10 10l6.8-3.4M10 10v6.8"/>',
  truck:   '<path d="M2.5 4.5h9v8.5h-9zM11.5 7.5h3.2l2.8 2.6v2.9h-6"/><circle cx="6" cy="15.2" r="1.6"/><circle cx="14" cy="15.2" r="1.6"/>',
  returnArrow: '<path d="M7 5 3.5 8.5 7 12M3.5 8.5h8a4 4 0 0 1 0 8H7.5"/>',
  alert:   '<path d="M10 3.4 17.8 17H2.2zM10 8.6v3.6M10 14.3v.2"/>',

  // Device types, for the battery list.
  camera:  '<path d="M2.5 6.5h9l1.5 2h4.5v8h-15zM7 12.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0z"/>',
  door:    '<path d="M5 3.5h10v14H5zM12 10.5v1"/>',
  window:  '<path d="M3.5 3.5h13v13h-13zM10 3.5v13M3.5 10h13"/>',
  motion:  '<path d="M10 4.5a1.2 1.2 0 1 0 0-.1zM10 7v5M7.5 9h5M8 17l2-4 2 4"/>',
  smoke:   '<path d="M10 2.5c1.5 2.5.5 3.5 0 4.5-1 2 .5 3.5 2 2.5M6 17a4 4 0 0 1 8 0z"/>',
  gate:    '<path d="M2.5 6.5h15v11h-15zM6 6.5v11M10 6.5v11M14 6.5v11M2.5 11h15"/>',
  sensor:  '<circle cx="10" cy="10" r="2.2"/><path d="M5.5 5.5a6.4 6.4 0 0 0 0 9M14.5 5.5a6.4 6.4 0 0 1 0 9"/>',
};

function icon(name, tone){
  const d = ICONS[name];
  if (!d) return "";
  return `<svg viewBox="0 0 20 20" class="ico ${tone || ""}" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

/// A glyph for a battery-bearing accessory. HAP only reports "sensor" for most of
/// them, so the name is used to tell a smoke alarm from a window contact — which is
/// the difference between "replace it this month" and "replace it today".
function deviceIcon(dev){
  const type = (dev.type || "").toLowerCase();
  const name = (dev.name || "").toLowerCase();
  if (type === "lock") return "lock";
  if (type === "camera") return "camera";
  if (/smoke|carbon|co\b|alarm/.test(name)) return "smoke";
  if (/motion/.test(name)) return "motion";
  if (/glass/.test(name)) return "window";
  if (/window/.test(name)) return "window";
  if (/gate|gar(a|)ge/.test(name)) return "gate";
  if (/door|patio|entry/.test(name)) return "door";
  return "sensor";
}


/* --- Walk outlook rendering ------------------------------------------------
   Ten presentations of one thing. The verdict logic is untouched — each hour is
   still walkable or not for exactly the same reasons — so these differ only in
   how that is shown. Most are legible without a colour key, which was the point:
   a legend is a thing to memorise.

   `score` exists only for the shapes that need a magnitude (height, line, spark).
   It is derived from the verdict, never a second opinion about the weather. */

const WALK_SCORE = { "walk-ideal": 100, "walk-golden": 100, "walk-warm": 70,
                     "walk-cold": 60, "walk-paw": 15, "walk-rain-alert": 15 };
const WALK_GLYPH = { "walk-ideal": "🐾", "walk-golden": "🐾", "walk-warm": "🚶",
                     "walk-cold": "🧥", "walk-paw": "🔥", "walk-rain-alert": "🌧" };

function walkScore(s){ return WALK_SCORE[s.state] ?? 50; }
function hourLabel(d){ return new Intl.DateTimeFormat([], { hour: "numeric" }).format(d); }

/// Collapse the hours into contiguous good / not-good spans.
function walkSpans(outlook){
  const spans = [];
  for (const s of outlook) {
    const last = spans[spans.length - 1];
    if (last && last.walkable === s.walkable) last.end = s.time;
    else spans.push({ walkable: s.walkable, start: s.time, end: s.time, state: s.state });
  }
  return spans;
}

function renderWalkOutlook(mode, outlook){
  if (!outlook.length) return "";
  const tick = (i) => (i % 3 === 0) ? `<span class="tick">${hourLabel(outlook[i].time)}</span>` : "";
  const btn = (s, i, inner, cls = "") =>
    `<button class="hour ${s.state} ${cls}" type="button" data-i="${i}"
      aria-label="${hourLabel(s.time)}, ${s.label}">${inner}</button>`;

  switch (mode) {
    // A glyph per hour. Nothing to memorise: a paw means go, a flame means wait.
    case "icons":
      return outlook.map((s, i) => btn(s, i,
        `<span class="hGlyph">${WALK_GLYPH[s.state] || "•"}</span>${tick(i)}`, "asIcon")).join("");

    // Height carries the meaning, so it survives being read in greyscale.
    case "height":
      return outlook.map((s, i) => btn(s, i,
        `<span class="hFill" style="height:${walkScore(s)}%"></span>${tick(i)}`, "asHeight")).join("");

    // GO / WAIT in words — the least ambiguous version there is.
    case "labels":
      return outlook.map((s, i) => btn(s, i,
        `<span class="hWord">${s.walkable ? "Go" : "Wait"}</span>${tick(i)}`, "asLabel")).join("");

    // Solid means go, faint means wait. One hue, no key.
    case "density":
      return outlook.map((s, i) => btn(s, i, tick(i),
        s.walkable ? "asDensity on" : "asDensity off")).join("");

    // Only the good windows are drawn, with their times. Absence is the signal.
    case "windows": {
      const good = walkSpans(outlook).filter((x) => x.walkable);
      if (!good.length) return `<span class="wNone">Nothing good in the next ${outlook.length}h</span>`;
      return good.map((x) => `<span class="wSpan">
        <span class="wBar"></span>
        <span class="wTime">${hourLabel(x.start)}–${hourLabel(new Date(x.end.getTime() + 36e5))}</span>
      </span>`).join("");
    }

    // A sentence. Zero legend, and it reads aloud correctly for VoiceOver.
    case "text": {
      const spans = walkSpans(outlook);
      return `<span class="wText">${spans.map((x) => {
        const from = hourLabel(x.start), to = hourLabel(new Date(x.end.getTime() + 36e5));
        return `${x.walkable ? "Good" : "Wait"} ${from}–${to}`;
      }).join(" · ")}</span>`;
    }

    // A vertical list — the most readable when there is room for it.
    case "ladder":
      return outlook.map((s, i) => `<button class="wRow ${s.state}" type="button" data-i="${i}">
        <span class="wRowGlyph">${WALK_GLYPH[s.state] || "•"}</span>
        <span class="wRowTime">${hourLabel(s.time)}</span>
        <span class="wRowVerdict">${s.label.replace(/^\S+\s/, "")}</span>
      </button>`).join("");

    case "line":
    case "spark": {
      const w = 100, h = mode === "spark" ? 22 : 34, n = outlook.length;
      const pts = outlook.map((s, i) => [ (i / (n - 1)) * w, h - (walkScore(s) / 100) * (h - 4) - 2 ]);
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      const area = `${d} L${w},${h} L0,${h} Z`;
      const dots = outlook.map((s, i) => s.walkable
        ? `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="1.7" class="wDot"/>` : "").join("");
      return `<svg class="wChart ${mode}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        ${mode === "line" ? `<path class="wArea" d="${area}"/>` : ""}
        <path class="wLine" d="${d}"/>${dots}
      </svg>
      <span class="wAxis"><span>${hourLabel(outlook[0].time)}</span><span>${hourLabel(outlook[n-1].time)}</span></span>`;
    }

    // A dial: the hours laid out the way a clock lays them out.
    case "radial": {
      const R = 42, C = 50, n = outlook.length;
      const arc = outlook.map((s, i) => {
        const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 0.86) / n) * Math.PI * 2 - Math.PI / 2;
        const p = (a, r) => `${(C + Math.cos(a) * r).toFixed(1)},${(C + Math.sin(a) * r).toFixed(1)}`;
        const rIn = s.walkable ? 26 : 34;
        return `<path class="wArc ${s.state}" d="M${p(a0, rIn)} L${p(a0, R)} A${R},${R} 0 0 1 ${p(a1, R)} L${p(a1, rIn)} Z"/>`;
      }).join("");
      const first = outlook.find((s) => s.walkable);
      return `<svg class="wDial" viewBox="0 0 100 100" aria-hidden="true">${arc}</svg>
        <span class="wDialNote">${first ? `next good ${hourLabel(first.time)}` : "nothing good"}</span>`;
    }

    default:
      return renderWalkOutlook("icons", outlook);
  }
}


/* --- Small-widget visuals -------------------------------------------------
   The four that read well — wear, walk, weather, batteries — all carry a graphic
   matched to their data. The rest were label, value, subtitle in a square: the
   same shape nine times, with the bottom half empty. These give each one a form
   that suits what it actually measures, and fills the space with meaning rather
   than padding. */

/// A banded meter with a marker — for a value on a known scale, like AQI.
function vizMeter(value, bands){
  const max = bands[bands.length - 1].to;
  const pos = value == null ? null : Math.max(0, Math.min(1, value / max)) * 100;
  const stops = bands.map((b) => `${b.color} ${(b.from / max) * 100}% ${(b.to / max) * 100}%`).join(", ");
  return `<span class="viz vizMeter">
    <span class="vizTrack" style="background:linear-gradient(90deg, ${stops})"></span>
    ${pos == null ? "" : `<span class="vizPin" style="left:${pos.toFixed(1)}%"></span>`}
  </span>`;
}

/// First letter up, the rest left alone. Not CSS `capitalize`, which would render
/// "very high" as "Very High" — sentence case raises the first word only.
function sentence(text){
  const t = String(text == null ? "" : text);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/// Everything else on the dashboard was written by Open-Meteo or by HOOBS. Package
/// titles and mail subjects were written by whoever sent the email, so they are
/// escaped before they reach innerHTML. Shared, because the admin page shows them too.
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/// A stepped scale — for ordered categories where the number means little.
function vizSteps(labels, activeIndex, tone){
  return `<span class="viz vizSteps ${tone || ""}">${labels.map((l, i) =>
    `<span class="vizStep${i <= activeIndex && activeIndex >= 0 ? " on" : ""}" title="${l}"></span>`
  ).join("")}<span class="vizStepLabel">${activeIndex >= 0 ? sentence(labels[activeIndex]) : "No reading"}</span></span>`;
}

/// A breadcrumb — for a ladder whose stages are named and only move forward. Dots
/// would say how far along; angled segments say which way it is going, which is the
/// part that matters when the question is whether a refund is still moving.
///
/// `opts.reversed` draws the last segment as the retrocharge branch: red, terminal,
/// and pointing back the way it came. `opts.label` overrides the caption, because
/// "Refunded" is the wrong word for money that was taken again.
function vizChevron(stages, activeIndex, tone, opts){
  const o = opts || {};
  const rev = !!o.reversed;
  const caption = o.label || (activeIndex >= 0 ? sentence(stages[activeIndex]) : "Not started");
  const last = stages.length - 1;
  return `<span class="viz vizChevron ${tone || ""}${rev ? " reversed" : ""}">${stages.map((s, i) =>
    `<span class="vizChev${i < activeIndex ? " done" : ""}${i === activeIndex ? " on" : ""}${
      rev && i === last ? " branch" : ""}" title="${s}"></span>`
  ).join("")}<span class="vizChevLabel">${caption}</span></span>`;
}

/// A dial — for a percentage that has a target worth seeing the distance to.
function vizGauge(value, target, tone){
  const R = 30, C = Math.PI * R;                       // half circumference
  const f = value == null ? 0 : Math.max(0, Math.min(1, value / 100));
  const t = target == null ? null : Math.max(0, Math.min(1, target / 100));
  const ang = (x) => Math.PI * (1 - x);
  const pt = (x, r) => `${(36 + Math.cos(ang(x)) * r).toFixed(1)},${(34 - Math.sin(ang(x)) * r).toFixed(1)}`;
  return `<svg class="viz vizGauge ${tone || ""}" viewBox="0 0 72 40" aria-hidden="true">
    <path class="gTrack" d="M6,34 A${R},${R} 0 0 1 66,34"/>
    <path class="gFill" d="M6,34 A${R},${R} 0 0 1 66,34" stroke-dasharray="${(C*f).toFixed(1)} ${C.toFixed(1)}"/>
    ${t == null ? "" : `<line class="gTarget" x1="${pt(t,23).split(",")[0]}" y1="${pt(t,23).split(",")[1]}" x2="${pt(t,37).split(",")[0]}" y2="${pt(t,37).split(",")[1]}"/>`}
  </svg>`;
}

/// The sun's place between sunrise and sunset, with the horizon drawn.
function vizSunArc(sunrise, sunset, now){
  const span = sunset - sunrise;
  const f = span > 0 ? Math.max(0, Math.min(1, (now - sunrise) / span)) : 0;
  const up = now >= sunrise && now <= sunset;
  const x = 6 + f * 60, y = 34 - Math.sin(Math.PI * f) * 26;
  const arc = Math.PI * 30;   // the semicircle's length, for the progress dash
  return `<svg class="viz vizSun" viewBox="0 0 72 42" aria-hidden="true">
    <path class="sArc" d="M6,34 A30,30 0 0 1 66,34"/>
    <path class="sDone" d="M6,34 A30,30 0 0 1 66,34"
          stroke-dasharray="${(arc * f).toFixed(1)} ${arc.toFixed(1)}"/>
    <line class="sHorizon" x1="2" y1="34" x2="70" y2="34"/>
    <circle class="sDot ${up ? "up" : "down"}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>
  </svg>`;
}

/// A temperature range on a shared scale, with today drawn faintly behind it — the
/// question the widget answers is "warmer or colder than today", and a bare pair of
/// numbers makes you do that subtraction yourself.
function vizRange(lo, hi, refLo, refHi){
  if (lo == null || hi == null) return "";
  const all = [lo, hi, refLo, refHi].filter((x) => x != null);
  const pad = 3;
  const sLo = Math.min(...all) - pad, sHi = Math.max(...all) + pad;
  const span = Math.max(1, sHi - sLo);
  const at = (x) => ((x - sLo) / span) * 100;
  const ref = refLo == null || refHi == null ? "" :
    `<span class="rRef" style="left:${at(refLo).toFixed(1)}%;right:${(100 - at(refHi)).toFixed(1)}%"></span>`;
  return `<span class="viz vizRange">
    <span class="rTrack">${ref}<span class="rFill" style="left:${at(lo).toFixed(1)}%;right:${(100 - at(hi)).toFixed(1)}%"></span></span>
    <span class="rEnds"><span>${Math.round(lo)}°</span><span class="rRefTag">${refLo == null ? "" : "today " + Math.round(refLo) + "–" + Math.round(refHi) + "°"}</span><span>${Math.round(hi)}°</span></span>
  </span>`;
}

/// One large glyph, for a widget whose whole content is a binary state.
function vizGlyph(name, tone){
  return `<span class="viz vizGlyph ${tone || ""}">${icon(name, tone)}</span>`;
}

const AQI_BANDS = [
  { from: 0,   to: 50,  color: "#34C759" },
  { from: 50,  to: 100, color: "#FFCC00" },
  { from: 100, to: 150, color: "#FF8D28" },
  { from: 150, to: 200, color: "#FF383C" },
  { from: 200, to: 300, color: "#AF52DE" },
];
const AIR_STEPS = ["poor", "inferior", "fair", "good", "excellent"];
const POLLEN_STEPS = ["none", "low", "moderate", "high", "very high"];


/// A plain bar, for the `bars` widget-graphic style: every scalar rendered the same
/// way, which stays legible at heights where a dial's arc collapses — the bedside
/// slot in particular.
function vizBar(frac, tone, marker){
  const f = frac == null ? null : Math.max(0, Math.min(1, frac));
  const m = marker == null ? null : Math.max(0, Math.min(1, marker));
  return `<span class="viz vizBarWrap ${tone || ""}">
    <span class="bTrack">
      ${f == null ? "" : `<span class="bFill" style="width:${(f * 100).toFixed(1)}%"></span>`}
      ${m == null ? "" : `<span class="bMark" style="left:${(m * 100).toFixed(1)}%"></span>`}
    </span>
  </span>`;
}

/// Route a widget's graphic through the chosen style. `auto` gives each the shape
/// that suits its data; `bars` makes them uniform and short; `off` drops them.
function vizPick(style, shapes){
  if (style === "off") return "";
  if (style === "bars" && shapes.bars !== undefined) return shapes.bars;
  return shapes.auto;
}
