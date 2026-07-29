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

  // Bedside aperture, in mm. Defaults match build_integrated_frame.py.
  maskW: 124,
  maskH: 58,
  maskOffset: 4,          // toward the keypad
  maskFlip: false,        // true if the phone mounts the other way up
};

// iPhone 11 active display, landscape. Locked — see the handoff's rule about not
// re-deriving manufacturer dimensions from photographs.
const DISPLAY_MM = { w: 139.62, h: 64.51 };

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
