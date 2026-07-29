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

  // Batteries
  battThreshold: 20,      // percent at or under which a device counts as low

  // Bedside aperture, in mm. Defaults match build_integrated_frame.py.
  maskW: 124,
  maskH: 58,
  maskOffset: 4,          // toward the keypad
  maskFlip: false,        // true if the phone mounts the other way up
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
];

const LAYOUT_KEY = "dashboard_layout";
const DEFAULT_LAYOUT = {
  portrait: ["wear", "walk", "bring", "protect", "weather"],
  bedside:  ["walk", "weather"],
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
