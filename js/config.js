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

  // Batteries
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
