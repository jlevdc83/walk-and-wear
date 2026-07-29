const VERSION = "v78";
const RETRY_MS = 60 * 1000;      // after a transient failure — not the full refresh interval

// Everything tunable now lives in js/config.js and is edited on admin.html.
const S = loadSettings();
applyMaskVars(S);
const REFRESH_MS = S.refreshMin * 60 * 1000;
const RUN_HOT = S.runHot;

const $ = (id) => document.getElementById(id);
let lastRefreshTime = null;
let refreshTimer = null;
let retryTimer = null;
let minuteTimer = null;
let clockTimer = null;

function round(n){ return Math.round(n); }
function fmtShortTime(date){
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(date);
}
function updateMinutesSince(){
  if (!lastRefreshTime) return;
  const mins = Math.floor((Date.now() - lastRefreshTime) / 60000);
  $("updatedLine").textContent = mins <= 0 ? "Updated just now" : `Updated ${mins} min ago`;
}
function updateClock(){
  $("timeNow").textContent = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date());
}

function renderVersionTag(){
  const el = $("buildMeta");
  if (el) el.textContent = VERSION;
}

// Tickers run from boot, independent of the forecast. Previously these only started
// after a successful load, so a location failure left the clock frozen at "--:--" —
// which is what made a recoverable error look like a hung app.
function startTickers(){
  clearInterval(minuteTimer);
  clearInterval(clockTimer);
  minuteTimer = setInterval(updateMinutesSince, 60000);
  clockTimer = setInterval(updateClock, 30000);
}

function sameHourIndex(timeArr, now){
  const nowMs = now.getTime();
  let idx = 0;
  for (let i = 0; i < timeArr.length; i++) {
    const t = new Date(timeArr[i]).getTime();
    if (t <= nowMs) idx = i;
    else break;
  }
  return idx;
}
function maxNextN(arr, start, n){
  let m = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = arr[start + i];
    if (v == null) continue;
    m = Math.max(m, v);
  }
  return m === -Infinity ? 0 : m;
}
function weatherEmoji(code, isDay){
  if (code === 0) return isDay ? "☀️" : "🌙";
  if ([1,2].includes(code)) return isDay ? "🌤️" : "🌙";
  if (code === 3) return "☁️";
  if ([45,48].includes(code)) return "🌫️";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 95 && code <= 99) return "⛈️";
  return isDay ? "🌤️" : "🌙";
}
function conditionText(code){
  if (code === 0) return "Clear";
  if ([1,2].includes(code)) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if ([45,48].includes(code)) return "Fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 95 && code <= 99) return "Storm";
  return "Cloudy";
}

// Only the browser-chrome colour. The page background itself comes from the phase
// class in CSS — the old version also wrote body.style.backgroundColor, which now
// would override the stylesheet's gradient.
function updateThemeColor(phase, weatherCode){
  const weatherState =
    (weatherCode === 0) ? "clear" :
    ([45,48].includes(weatherCode)) ? "fog" :
    (((weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82) || (weatherCode >= 95 && weatherCode <= 99))) ? "rain" :
    "cloud";

  const colors = {
    "phase-dawn": { clear: "#4a4f78", cloud: "#434c70", fog: "#585f80", rain: "#3e4f72" },
    "phase-day": { clear: "#4c6f93", cloud: "#536b84", fog: "#617287", rain: "#48627c" },
    "phase-dusk": { clear: "#5c3f61", cloud: "#564660", fog: "#655a72", rain: "#4c4b67" },
    "phase-night": { clear: "#0c1730", cloud: "#121b2d", fog: "#1a2436", rain: "#10243e" }
  };
  const color = (colors[phase] && colors[phase][weatherState]) || "#0b0d18";

  // iOS can be stubborn about a mutated theme-color, so replace the tag outright
  // rather than appending a new one on every refresh.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = color;
  document.head.appendChild(meta);
}

function applyScene(now, sunriseIso, sunsetIso, weatherCode){
  const body = document.body;
  body.classList.remove("phase-dawn","phase-day","phase-dusk","phase-night");
  const sunrise = sunriseIso ? new Date(sunriseIso) : null;
  const sunset = sunsetIso ? new Date(sunsetIso) : null;

  let phase = "phase-day";
  if (sunrise && sunset){
    const minsToSunrise = (sunrise - now) / 60000;
    const minsFromSunrise = (now - sunrise) / 60000;
    const minsToSunset = (sunset - now) / 60000;
    if (now < sunrise) phase = minsToSunrise <= 75 ? "phase-dawn" : "phase-night";
    else if (now > sunset) phase = "phase-night";
    else if (minsFromSunrise <= 75) phase = "phase-dawn";
    else if (minsToSunset <= 75) phase = "phase-dusk";
    else phase = "phase-day";
  }
  body.classList.add(phase);
  updateThemeColor(phase, weatherCode);
}

/* --- Location --------------------------------------------------------- */

function geocodeZipQuery(zip){
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(zip)}&count=1&countryCode=US&format=json&t=${Date.now()}`;
}
async function geocodeZip(zip){
  const clean = String(zip || "").trim();
  if (!clean) throw new Error("ZIP_REQUIRED");
  const r = await fetch(geocodeZipQuery(clean), { cache: "no-store" });
  const j = await r.json();
  const hit = j?.results?.[0];
  if (!hit) throw new Error("ZIP_NOT_FOUND");
  // The response already carries the place name. Showing "Anchorage, Alaska" instead of
  // "ZIP 99501" also confirms the code resolved where you expected.
  // admin1 spelled out gives "Washington D.C., District of Columbia", which wrapped
  // the header. Open-Meteo has no short-code field — admin1_id is a numeric geoname
  // id, and using it printed "Washington D.C., 4138106". Drop a long subdivision
  // instead; the city alone is unambiguous enough for a header.
  const region = hit.admin1 && hit.admin1.length <= 14 ? hit.admin1 : "";
  const name = region ? `${hit.name}, ${region}` : (hit.name || "");
  return { lat: hit.latitude, lon: hit.longitude, zip: clean, name };
}
// Open-Meteo's geocoding API has no reverse endpoint — /v1/reverse returns
// {"error":true,"reason":"Not Found"}. The old call was wrapped in a try/catch that
// swallowed the 404 and returned "", so every GPS-located load showed "Location —".
//
// Labelling the source honestly costs nothing and cannot break. If a real city name is
// wanted, BigDataCloud's reverse-geocode-client is free, keyless and CORS-enabled —
// that would be the place to add it.
const DEVICE_LOCATION_LABEL = "Device location";

// BigDataCloud's reverse-geocode-client: no key, CORS-enabled, and unlike Open-Meteo's
// non-existent /v1/reverse it actually exists. Cached, because the answer only changes
// when you move — and it degrades to the honest label rather than to an em-dash.
async function placeName(loc){
  const cached = localStorage.getItem("dashboard_place");
  if (cached) return cached;
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${loc.lat}&longitude=${loc.lon}&localityLanguage=en`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("REVERSE_FAILED");
    const j = await r.json();
    const city = j.city || j.locality || "";
    const region = j.principalSubdivisionCode ? String(j.principalSubdivisionCode).split("-").pop() : "";
    const name = city ? (region ? `${city}, ${region}` : city) : "";
    if (name) localStorage.setItem("dashboard_place", name);
    return name || DEVICE_LOCATION_LABEL;
  } catch {
    return DEVICE_LOCATION_LABEL;
  }
}
function isLikelyLocalFile(){
  return window.location.protocol === "file:";
}
function geolocate(){
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, zip: "" }),
      reject,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  });
}

// Resolution order: device location, then a saved ZIP, then ask. Asking is now a
// card in the page — window.prompt() is suppressed in an iOS standalone PWA, which
// left the app with no reachable way to supply a location at all.
async function resolveLocation(){
  // A saved ZIP is a deliberate choice and outranks the device. Trying GPS first meant
  // a manually set ZIP was silently ignored whenever location happened to work — which
  // made changing location impossible in the one case that matters.
  // "Use my location" clears the ZIP, which is what puts the device back in charge.
  const saved = localStorage.getItem("dashboard_zip") || "";
  if (saved) {
    try {
      return await geocodeZip(saved);
    } catch {
      localStorage.removeItem("dashboard_zip"); // stale or wrong — stop trusting it
    }
  }
  if (!isLikelyLocalFile() && window.isSecureContext && navigator.geolocation) {
    try { return await geolocate(); } catch { /* fall through */ }
  }
  throw new Error("NEEDS_LOCATION");
}

function showLocate(message){
  $("locateCard").classList.remove("hidden");
  $("decisions").classList.add("hidden");
  // Also hide the weather strip: a row of em-dashes reads as broken rather than empty.
  $("weather").classList.add("hidden");
  $("cancelLocate").classList.add("hidden");   // nothing to go back to
  if (message) $("locateNote").textContent = message;
  $("updatedLine").textContent = "Location needed";
  $("zipMeta").textContent = "No location";
}

/// Opened deliberately from the header rather than by a failure. There is still good
/// data underneath, so this one is cancellable and prefilled.
function openLocate(){
  $("locateCard").classList.remove("hidden");
  $("decisions").classList.add("hidden");
  $("weather").classList.add("hidden");
  $("cancelLocate").classList.remove("hidden");
  const saved = localStorage.getItem("dashboard_zip") || "";
  $("zipInput").value = saved;
  $("locateNote").textContent = saved
    ? `Currently using ZIP ${saved}. Enter another, or switch back to your location.`
    : "Enter a ZIP code, or keep using your device location.";
}

function hideLocate(){
  $("locateCard").classList.add("hidden");
  $("decisions").classList.remove("hidden");
  $("weather").classList.remove("hidden");
}

/// A location change invalidates the cached city name and the cached forecast — both
/// describe the old place. Leaving them would show the previous city's weather under
/// the new ZIP until the next refresh landed.
function forgetPlace(){
  localStorage.removeItem("dashboard_place");
  localStorage.removeItem(SNAP_KEY);
}

/* --- Forecast --------------------------------------------------------- */

/* --- Air quality and pollen ---------------------------------------------
   A second free, keyless Open-Meteo endpoint. Fetched only when one of the two
   widgets that need it is switched on, so nobody pays for a call they cannot see.
   Failure is silent: these are nice to know, and a missing pollen count should
   never take the walk verdict down with it. */

let airData = null;

function airWanted(){
  const active = layout[currentContext()] || [];
  return active.includes("pollen") || active.includes("airquality");
}

async function fetchAir(lat, lon){
  if (!airWanted()) { airData = null; return; }
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=pm2_5,us_aqi,ozone,alder_pollen,birch_pollen,grass_pollen,ragweed_pollen` +
      `&timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
    const r = await fetch(url, { cache: "no-store" });
    airData = r.ok ? (await r.json()).current : null;
  } catch {
    airData = null;
  }
}

/// Grains/m³ thresholds. Coarse on purpose — "high" is the actionable word, and a
/// precise count you cannot feel is not worth the space.
function pollenBand(v){
  if (v == null) return null;
  if (v < 1) return "none";
  if (v < 10) return "low";
  if (v < 50) return "moderate";
  if (v < 200) return "high";
  return "very high";
}

async function fetchForecast(lat, lon){
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&timezone=${encodeURIComponent(tz)}` +
    `&temperature_unit=${S.units === "C" ? "celsius" : "fahrenheit"}&windspeed_unit=mph` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,cloudcover,windspeed_10m,uv_index,is_day,weathercode,relative_humidity_2m,dewpoint_2m` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&forecast_days=2&t=${Date.now()}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("FORECAST_FAILED");
  return r.json();
}
function setZipMeta(value){
  const text = String(value || "").trim();
  if (!text) {
    $("zipMeta").textContent = "Location —";
    return;
  }
  $("zipMeta").textContent = /^\d{5}$/.test(text) ? `ZIP ${text}` : text;
}
function setStats(items){
  $("stats").innerHTML = items.map(item => `
    <div class="stat">
      <div class="statLabel">${item.k}</div>
      <div class="statValue">${item.v}</div>
      <div class="statSub">${item.b || ""}</div>
    </div>
  `).join("");
}

/* --- Decision logic (unchanged) --------------------------------------- */

function wearEmojiForJacket(label){
  const t = String(label || "").toLowerCase();
  if (t.includes("rain jacket")) return "☔";
  if (t.includes("windbreaker")) return "🌬️";
  if (t.includes("winter coat")) return "🧥";
  if (t.includes("heavy jacket")) return "🧥";
  if (t.includes("light jacket")) return "🧥";
  if (t.includes("no jacket")) return "👕";
  return "🧥";
}
function bringEmojiForItems(items){
  const joined = (items || []).join(" ").toLowerCase();
  if (joined.includes("umbrella")) return "☔";
  if (joined.includes("windbreaker")) return "🌬️";
  return "";
}
function clothingPlan(tempF, feelsLikeF, windMph, rainingNow){
  const t = feelsLikeF + (RUN_HOT ? 4 : 0);
  let clothes = "";
  let jacket = "No jacket";

  if (t >= 75) clothes = "shorts + short sleeves";
  else if (t >= 60) clothes = "pants + short sleeves";
  else if (t >= 48) clothes = "pants + long sleeves";
  else clothes = "warm layers";

  if (rainingNow) jacket = t <= 50 ? "Rain jacket over layers" : "Rain jacket";
  else if (windMph >= 18 && t <= 62) jacket = "Windbreaker";
  else if (t <= 32) jacket = "Heavy winter coat";
  else if (t <= 42) jacket = "Heavy jacket";
  else if (t <= 52) jacket = "Light jacket";
  else if (t <= 60 && windMph >= 12) jacket = "Light jacket";

  const extras = [];
  if (t <= 40) extras.push("hat");
  if (t <= 32) extras.push("scarf");
  if (t <= 30) extras.push("gloves");

  return { jacket, clothes, sub: extras.length ? extras.join(" • ") : "No extra cold-weather gear" };
}
function sharedDepartureWindow(hourly, idx, now){
  const current = hourly.precipitation_probability[idx] ?? 0;
  let firstRainMins = null;
  let peak90 = current;
  for (let i = 0; i < 3; i++) {
    const p = hourly.precipitation_probability[idx + i];
    if (p == null) continue;
    peak90 = Math.max(peak90, p);
    if (firstRainMins === null && p >= 35) {
      const t = new Date(hourly.time[idx + i]);
      firstRainMins = Math.max(0, Math.round((t - now) / 60000));
    }
  }
  return { currentRain: current, firstRainMins, peak90 };
}
function bringPlan(feelsLikeF, windMph, horizon){
  const items = [];
  const umbrella = horizon.currentRain >= 35 || (horizon.firstRainMins !== null && horizon.firstRainMins <= 90) || horizon.peak90 >= 60;
  if (umbrella) items.push("Umbrella");
  else if (windMph >= 22 && feelsLikeF <= 58) items.push("Windbreaker");
  return items;
}
function protectPlan(uvNow, isDay){
  const items = [];
  if (isDay && uvNow >= 3) items.push("Sunscreen");
  if (isDay && uvNow >= 2) items.push("Sunglasses");
  return items;
}
function rainTimingSummary(horizon){
  const current = horizon.currentRain;
  const peak = horizon.peak90;
  let line1 = current >= 35 ? `${Math.round(current)}% chance now` : `${Math.round(peak)}% chance`;
  let line2 = "Low rain risk soon";
  if (peak < 20 && current < 20) {
    line1 = "Low rain chance";
    line2 = "Nothing soon";
  }
  if (horizon.firstRainMins !== null) {
    const mins = horizon.firstRainMins;
    if (mins <= 5) line2 = "Starting now";
    else if (mins < 60) line2 = `Starting in ${mins}m`;
    else line2 = `Starting in ${Math.round(mins/60)}h`;
  }
  return { line1, line2 };
}
function estimatePawRisk(tempF, isDay, cloud, uv){
  const sunBoost = isDay ? Math.max(0, 18 - (cloud * 0.12)) : 0;
  const uvBoost = isDay ? uv * 3 : 0;
  const surface = tempF + sunBoost + uvBoost;
  if (surface >= 95) return { label: "Hot pavement risk", level: "high" };
  if (surface >= 85) return { label: "Warm pavement", level: "medium" };
  return { label: "Paws okay", level: "low" };
}
function walkDecision(feelsLikeF, pawRisk, rainingNow, windMph, horizon){
  const t = feelsLikeF + (RUN_HOT ? 4 : 0);

  // Only block for real current issues or clearly unsafe conditions
  if (rainingNow) return { label: "⏳ Wait now", cls: "walk-rain-alert" };
  if (pawRisk.level === "high") return { label: "🔥 Wait now", cls: "walk-paw" };
  if (windMph >= 30) return { label: "⏳ Wait now", cls: "walk-cold" };
  if (t >= 95) return { label: "🔥 Wait now", cls: "walk-paw" };
  if (t <= 20) return { label: "⏳ Wait now", cls: "walk-cold" };

  // Future rain should advise, not block — go now, ahead of it.
  if (horizon.firstRainMins !== null && horizon.firstRainMins <= 20 && horizon.peak90 >= 70) {
    return { label: "🚶 Go now", cls: "walk-warm" };
  }
  if (t >= 82) return { label: "🚶 Go soon", cls: "walk-warm" };
  if (t >= 55) return { label: "🐾 Walk now", cls: "walk-ideal" };
  // Anything left is between 20° and 55°: fine, just cold.
  return { label: "🐕 Okay now", cls: "walk-cold" };
}
/* --- Walk outlook ------------------------------------------------------
   Mackenzie goes out several times a day, so "is now good?" is the wrong
   question on its own — the useful answer is when the next good window is.
   The forecast already carries 48 hours; only the current hour was ever read.
   This runs the same tuned verdict across the coming hours. No new data. */

const OUTLOOK_HOURS = S.outlookHours;

/// The verdict for an arbitrary hour, not just the current one.
function walkStateAt(h, i, now){
  const feels = h.apparent_temperature?.[i];
  if (feels == null) return null;

  const temp  = h.temperature_2m?.[i] ?? feels;
  const wind  = h.windspeed_10m?.[i] ?? 0;
  const cloud = h.cloudcover?.[i] ?? 0;
  const uv    = h.uv_index?.[i] ?? 0;
  const isDay = !!h.is_day?.[i];
  const raining = (h.precipitation?.[i] ?? 0) > 0;

  // Horizon measured forward from that hour, not from now.
  const at = new Date(h.time[i]);
  const horizon = sharedDepartureWindow(h, i, at);
  const risk = estimatePawRisk(temp, isDay, cloud, uv);
  const decision = walkDecision(feels, risk, raining, wind, horizon);

  return {
    time: at,
    state: decision.cls,
    label: decision.label,
    walkable: !decision.label.includes("Wait"),
    // Carried so a tapped hour can explain itself rather than just being a colour.
    feels: Math.round(feels),
    rain: Math.round(h.precipitation_probability?.[i] ?? 0),
    paw: risk.label,
  };
}

function walkOutlook(h, idx, now){
  const out = [];
  for (let i = idx; i < idx + OUTLOOK_HOURS; i++) {
    const s = walkStateAt(h, i, now);
    if (s) out.push(s);
  }
  return out;
}

/// Either how long the current good spell lasts, or when the next one starts.
function walkTiming(outlook){
  if (!outlook.length) return null;

  if (outlook[0].walkable) {
    let i = 0;
    while (i < outlook.length && outlook[i].walkable) i++;
    // Ran to the end of what we looked at — don't imply a cliff that isn't there.
    if (i >= outlook.length) return { kind: "open" };
    return { kind: "until", time: outlook[i].time };
  }

  const start = outlook.findIndex(s => s.walkable);
  if (start === -1) return { kind: "none" };

  // How long that window actually lasts. "Better from 5 PM" is misleading if rain
  // closes it again at 6 — and a one-hour gap is exactly what you need to know about
  // when the dog goes out several times a day.
  let end = start;
  while (end < outlook.length && outlook[end].walkable) end++;

  return {
    kind: "next",
    time: outlook[start].time,
    until: end < outlook.length ? outlook[end].time : null,
    hours: end - start,
  };
}

let lastOutlook = [];

function renderOutlook(outlook){
  const el = $("outlook");
  if (!el) return;
  lastOutlook = outlook;
  el.innerHTML = outlook.map((s, i) => {
    const hour = new Intl.DateTimeFormat([], { hour: "numeric" }).format(s.time);
    // Label every third hour; more than that is noise at this width.
    const tick = (i % 3 === 0) ? `<span class="tick">${hour}</span>` : "";
    // A button, not a div: the strip is the densest thing on screen and was the only
    // part that couldn't explain itself. `title` is a desktop tooltip and does nothing
    // under a finger.
    return `<button class="hour ${s.state}" type="button" data-i="${i}"
              aria-label="${hour}, ${s.label}">${tick}</button>`;
  }).join("");
}

/// Tap an hour to have it explain its colour. Bedside mode ignores this — nobody is
/// interrogating a forecast from bed, and the aperture has no room for the answer.
function showHourDetail(i){
  const s = lastOutlook[i];
  const el = $("hourDetail");
  if (!s || !el) return;
  const hour = new Intl.DateTimeFormat([], { hour: "numeric" }).format(s.time);
  el.textContent = `${hour} · ${s.label.replace(/^\S+\s/, "")} · feels ${s.feels}° · ${s.rain}% rain · ${s.paw}`;
  el.classList.remove("hidden");
  document.querySelectorAll("#outlook .hour").forEach((b) =>
    b.classList.toggle("picked", Number(b.dataset.i) === i)
  );
}

function clearHourDetail(){
  $("hourDetail")?.classList.add("hidden");
  document.querySelectorAll("#outlook .hour.picked").forEach((b) => b.classList.remove("picked"));
}

$("outlook").addEventListener("click", (e) => {
  const btn = e.target.closest(".hour");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  if (btn.classList.contains("picked")) clearHourDetail();
  else showHourDetail(i);
});

function nextSunEvent(daily, now){
  const candidates = [];
  for (let i = 0; i < Math.min(2, daily.sunrise.length); i++) {
    const sr = new Date(daily.sunrise[i]);
    const ss = new Date(daily.sunset[i]);
    if (sr > now) candidates.push({ label: "Sunrise", time: sr });
    if (ss > now) candidates.push({ label: "Sunset", time: ss });
  }
  candidates.sort((a,b) => a.time - b.time);
  return candidates[0] || null;
}
function pawWipeNeeded(hourly, idx, horizon){
  const rainNowAmount = hourly.precipitation?.[idx] ?? 0;
  const imminentRain = horizon.firstRainMins !== null && horizon.firstRainMins <= 30 && horizon.peak90 >= 60;
  return rainNowAmount > 0 || imminentRain;
}
function walkAssessment(hourly, idx, now, nextSun, tempF, isDay, cloud, uv, horizon){
  const pawRisk = estimatePawRisk(tempF, isDay, cloud, uv);
  const rainingNow = (hourly.precipitation?.[idx] ?? 0) > 0;
  const windNow = hourly.windspeed_10m?.[idx] ?? 0;
  const decision = walkDecision(hourly.apparent_temperature[idx], pawRisk, rainingNow, windNow, horizon);

  // A "Wait" verdict must never be paired with "Good right now" — the original default
  // said exactly that under a hot-pavement warning, which reads as a contradiction now
  // that the verdict is the headline.
  let secondary = "Good right now";
  if (decision.label.includes("Wait")) {
    secondary =
      rainingNow ? "Raining right now" :
      pawRisk.level === "high" ? "Pavement too hot" :
      windNow >= 30 ? "Too windy out" :
      "Better in a while";
  } else if (horizon.firstRainMins !== null) {
    const mins = horizon.firstRainMins;
    if (mins <= 5) secondary = "Rain starting now";
    else if (mins < 60) secondary = `Rain in ~${mins}m`;
    else secondary = `Rain later • ~${Math.round(mins/60)}h`;
  } else if (nextSun && decision.label.includes("Walk now")) {
    const minutesToSun = Math.round((nextSun.time - now) / 60000);
    if (minutesToSun > 0 && minutesToSun <= 75) secondary = "Great light soon";
  } else if (decision.label.includes("Go soon")) {
    secondary = "Better before it gets warmer";
  }

  // When the verdict is already "wait, pavement's too hot", repeating "Hot pavement risk"
  // underneath says nothing new.
  let tertiary = (decision.label.includes("Wait") && pawRisk.level === "high") ? "" : pawRisk.label;
  if (pawWipeNeeded(hourly, idx, horizon)) tertiary = tertiary ? `${tertiary} • Wipe paws after` : "Wipe paws after";

  let cls = decision.cls;
  if (secondary === "Great light soon" && decision.label.includes("Walk now")) cls = "walk-golden";

  return { primary: decision.label, secondary, tertiary, cls };
}

/* --- Render ----------------------------------------------------------- */

// Pure render: data in, DOM out. Split from refresh() so a cached snapshot can paint
// at launch without waiting on the network — this is a dashboard opened half-awake,
// and a blank screen while a request flies is the wrong first impression.
function render(forecast, loc, now){
    const h = forecast.hourly;
    const d = forecast.daily;
    const idx = sameHourIndex(h.time, now);

    const temp = h.temperature_2m[idx];
    const feels = h.apparent_temperature[idx];
    const rain4h = maxNextN(h.precipitation_probability, idx, 4);
    const rainingNow = (h.precipitation?.[idx] ?? 0) > 0;
    const uvNow = h.uv_index[idx];
    const uv4h = maxNextN(h.uv_index, idx, 4);
    const cloud = h.cloudcover[idx];
    const wind = h.windspeed_10m[idx];
    const isDay = !!h.is_day[idx];
    const weatherCode = h.weathercode[idx];
    const hi = d.temperature_2m_max?.[0];
    const lo = d.temperature_2m_min?.[0];
    const nextSun = nextSunEvent(d, now);
    const horizon = sharedDepartureWindow(h, idx, now);

    applyScene(now, d.sunrise?.[0], d.sunset?.[0], weatherCode);
    updateClock();

    $("tempNow").textContent = `${round(temp)}°`;
    $("feelsNow").textContent = `feels ${round(feels)}°`;
    $("modeBadge").textContent = weatherEmoji(weatherCode, isDay);
    $("conditionLine").textContent = conditionText(weatherCode);
    $("ambientLine").textContent = `${round(wind)} mph wind • ${round(cloud)}% cloud`;

    setStats([
      { k: "UV", v: isDay ? `${round(uvNow)}` : "—", b: isDay ? `max ${round(uv4h)}` : "Night" },
      // Label carries the event so the value is just a time — "Sunset 8:24 PM" was
      // too wide for a quarter column and truncated to "Sunset 8:…".
      { k: nextSun ? nextSun.label : "Next sun", v: nextSun ? fmtShortTime(nextSun.time) : "—", b: `Hi ${round(hi)}° / Lo ${round(lo)}°` },
      // Same window the Bring decision uses. Reporting a 4-hour peak here while the
      // umbrella was decided on a 3-hour one produced "RAIN 74%" with no umbrella
      // advice — two numbers from different windows, reading as a contradiction.
      { k: "Rain", v: `${round(horizon.peak90)}%`, b: "next 3h" },
      { k: "Wind", v: `${round(wind)} mph`, b: "current" }
    ]);

    const wear = clothingPlan(temp, feels, wind, rainingNow);
    const wearEmoji = wearEmojiForJacket(wear.jacket);
    $("jacketValue").textContent = wearEmoji ? `${wearEmoji} ${wear.jacket}` : wear.jacket;
    $("wearValue").textContent = wear.clothes;
    $("wearSub").textContent = wear.sub || "";

    let extraDetail = "";
    if (rainingNow) extraDetail = "Raining now — stay waterproof.";
    else if (wind >= 18) extraDetail = "Wind noticeable — outer layer helps.";
    else if (feels >= 75) extraDetail = "Warm out — breathable fabrics.";
    else if (feels <= 40) extraDetail = "Cold — insulate well.";
    $("wearDetailLine").textContent = extraDetail;

    const bring = bringPlan(feels, wind, horizon);
    $("bringCard").classList.toggle("hidden", bring.length === 0);
    if (bring.length) {
      const bringEmoji = bringEmojiForItems(bring);
      $("bringValue").textContent = bringEmoji ? `${bringEmoji} ${bring.join(" + ")}` : bring.join(" + ");
      if (bring.includes("Umbrella")) {
        const rainInfo = rainTimingSummary(horizon);
        $("bringSub").textContent = `${rainInfo.line1} • ${rainInfo.line2}`;
      } else {
        $("bringSub").textContent = wind >= 22 ? `Wind ${round(wind)} mph` : "Extra shell";
      }
    }

    const protect = protectPlan(uvNow, isDay);
    $("protectCard").classList.toggle("hidden", protect.length === 0);
    if (protect.length) {
      $("protectValue").textContent = protect.join(" + ");
      $("protectSub").textContent = isDay ? `UV ${round(uvNow)} now` : "Night";
    }

    const walk = walkAssessment(h, idx, now, nextSun, temp, isDay, cloud, uvNow, horizon);
    const walkCard = $("walkCard");
    // Only the walk-state class is swapped. Reassigning className wiped the size
    // classes the grid depends on, which silently undid every .w-large rule.
    walkCard.classList.remove("walk-ideal","walk-golden","walk-warm","walk-cold","walk-paw","walk-rain-alert");
    if (walk.cls) walkCard.classList.add(walk.cls);
    $("walkPrimary").textContent = walk.primary;

    // The timing is more actionable than the reason, so it takes the supporting line
    // and the reason moves down. "Wait now" is useless without "until when".
    const outlook = walkOutlook(h, idx, now);
    const phrase = timingPhrase(walkTiming(outlook));
    let support = walk.secondary;
    let aside = walk.tertiary;
    if (phrase) {
      support = phrase;
      if (walk.secondary && walk.secondary !== "Good right now") {
        aside = aside ? `${walk.secondary} • ${aside}` : walk.secondary;
      }
    }
    $("walkSecondary").textContent = support;
    $("walkTertiary").textContent = aside;
    renderOutlook(outlook);
    renderMinis({ h, d, idx, now, nextSun, feels, wind });
}

/* --- Compact widgets ------------------------------------------------------
   Each writes only if its element exists and it is switched on. Anything with no
   data says so plainly rather than showing an em dash, which reads as broken. */

/* --- Indicators -----------------------------------------------------------
   A glyph and a semantic tone per widget, so state reads before the text does.
   Drawn inline rather than pulled from a font: SF Symbols is not licensed for the
   web, and an icon font would be a download for nine shapes. They inherit
   currentColor, so tone drives them without a second set. */

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
};

function icon(name, tone){
  const d = ICONS[name];
  if (!d) return "";
  return `<svg viewBox="0 0 20 20" class="ico ${tone || ""}" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

function setIcon(id, name, tone){
  const el = $(`${id}Icon`);
  if (el) el.innerHTML = icon(name, tone);
}

/// Tones map onto the system colours, so a glance lands before any reading.
function toneFor(kind, value){
  if (kind === "airQuality") {
    const v = String(value || "").toLowerCase();
    if (v.includes("excellent") || v.includes("good")) return "ok";
    if (v.includes("fair")) return "mid";
    if (v.includes("inferior") || v.includes("poor")) return "bad";
    return "";
  }
  if (kind === "aqi") return value == null ? "" : value <= 50 ? "ok" : value <= 100 ? "mid" : "bad";
  if (kind === "lock") return value === "locked" ? "ok" : value === "unlocked" ? "bad" : "mid";
  if (kind === "battery") return value == null ? "" : value <= 20 ? "bad" : value <= 50 ? "mid" : "ok";
  return "";
}

function setMini(id, value, sub){
  const v = $(`${id}Value`), s = $(`${id}Sub`);
  if (v) v.textContent = value;
  if (s) s.textContent = sub || "";
}

function renderMinis({ h, d, idx, now, nextSun }){
  // Outdoor humidity, with the dew point — above about 65°F it is oppressive in a
  // way a percentage never conveys.
  const rh = h.relative_humidity_2m?.[idx];
  const dew = h.dewpoint_2m?.[idx];
  setIcon("hum", "droplet");
  setMini("hum", rh == null ? "—" : `${round(rh)}%`,
    dew == null ? "outdoor" : `dew point ${round(dew)}°${S.units === "C" ? "C" : "F"}`);

  // Sun: whichever comes next, counting down.
  if (nextSun) {
    const mins = Math.max(0, Math.round((nextSun.time - now) / 60000));
    const when = mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 60)}h`;
    setIcon("sun", nextSun.label === "Sunrise" ? "sunrise" : "sunset");
    setMini("sun", fmtShortTime(nextSun.time), `${nextSun.label.toLowerCase()} ${when}`);
  } else setMini("sun", "—", "");

  // Tomorrow, for deciding tonight.
  const thi = d.temperature_2m_max?.[1], tlo = d.temperature_2m_min?.[1];
  setIcon("tom", "calendar");
  setMini("tom", thi == null ? "—" : `${round(thi)}° / ${round(tlo)}°`, "high / low");

  // Pollen: report the worst of the four rather than four numbers nobody reads.
  if (airData) {
    const kinds = [["alder", airData.alder_pollen], ["birch", airData.birch_pollen],
                   ["grass", airData.grass_pollen], ["ragweed", airData.ragweed_pollen]];
    const worst = kinds.filter(([, v]) => v != null).sort((a, b) => b[1] - a[1])[0];
    if (worst) {
      setMini("pollen", pollenBand(worst[1]), `${worst[0]} ${Math.round(worst[1])} grains/m³`);
    } else {
      // Open-Meteo's pollen comes from the CAMS *European* dataset, so every count is
      // null in North America — verified: Berlin returns values, DC returns nulls.
      // Saying so beats a permanently blank widget that looks broken.
      setMini("pollen", "no data", "Europe only — no free US source");
    }

    setIcon("pollen", "leaf");
    const aqi = airData.us_aqi, pm = airData.pm2_5;
    setIcon("aq", "gauge", toneFor("aqi", aqi));
    setMini("aq", aqi == null ? "—" : `AQI ${Math.round(aqi)}`,
      pm == null ? "" : `PM2.5 ${pm.toFixed(1)} µg/m³`);
  } else {
    setMini("pollen", "—", "unavailable");
    setMini("aq", "—", "unavailable");
  }
}

/// The four HOOBS widgets. Driven by the Pi feed, so they say so on the public build
/// rather than sitting empty and looking broken.
function renderHomeMinis(home){
  if (!home || !home.ok) {
    ["lock", "inAir", "inHum", "batt"].forEach((id) => setMini(id, "—", "needs the Pi build"));
    return;
  }
  const lock = (home.locks || [])[0];
  const lockTone = toneFor("lock", lock && lock.state);
  setIcon("lock", lock && lock.state === "unlocked" ? "unlock" : "lock", lockTone);
  setMini("lock", lock ? lock.state : "—", lock ? lock.name : "no lock found");

  // The lock's own battery belongs on the lock, not buried among eighteen others.
  //
  // It must be the Schlage specifically. There are two devices named "Front Door" —
  // the lock and a Ring contact sensor — plus a Ring keypad, and a door sensor's
  // battery says nothing about whether the deadbolt will still throw. Prefer the
  // pinned device, fall back to the only accessory whose HAP type is "lock", and
  // never match on name.
  const batts = home.batteries || [];
  const lockBatt = batts.find((b) => devMatches(b, S.battPrimary) && b.type === "lock")
                || batts.find((b) => b.type === "lock");
  const pill = $("lockBatt");
  if (pill) {
    pill.classList.toggle("hidden", !lockBatt);
    if (lockBatt) {
      const lvl = typeof lockBatt.level === "number" ? Math.round(lockBatt.level) : null;
      pill.className = `pill ${toneFor("battery", lvl)}`;
      pill.title = `${lockBatt.name} (${lockBatt.type})`;   // so it can be checked
      pill.innerHTML = `${icon("battery")}<span>${lvl == null ? "?" : lvl + "%"}</span>`;
    }
  }
  const lockCard = document.querySelector('[data-widget="lock"]');
  if (lockCard) lockCard.classList.toggle("warn", lockTone === "bad");

  // Both are arrays now. Cache the roster so the admin can offer the choice, and
  // honour the chosen sensor rather than whichever HOOBS listed first.
  const airs = home.air || [], hums = home.humidity || [];
  if (airs.length || hums.length) {
    saveSensorRoster({ air: airs.map((x) => x.name), humidity: hums.map((x) => x.name) });
  }
  const pick = (list, name) => list.find((x) => x.name === name) || list[0] || null;

  const air = pick(airs, S.airSensor);
  setIcon("inAir", "air", toneFor("airQuality", air && air.quality));
  setMini("inAir", air ? air.quality : "—",
    air ? (air.pm25 != null ? `${air.name} · PM2.5 ${air.pm25}` : air.name) : "no sensor");

  const hum = pick(hums, S.humiditySensor);
  const target = S.humidityTarget;
  setIcon("inHum", "droplet", hum ? (hum.value < target ? "mid" : "ok") : "");
  setMini("inHum", hum ? `${Math.round(hum.value)}%` : "—",
    hum ? `${hum.value < target ? "below" : "at or above"} the ${target}% target` : "no sensor");

  // Full records, not just names — the admin page cannot show a level it never saw.
  const all = home.batteries || [];
  if (all.length) saveBattRoster(all);

  const watch = loadBattWatch();
  const watched = watch === null ? all : all.filter((b) => watch.some((k) => devMatches(b, k)));
  const isLow = (b) => b.flag || (typeof b.level === "number" && b.level <= S.battThreshold);
  const low = watched.filter(isLow);

  // Levels for everything watched, worst first — a count alone tells you something is
  // wrong without telling you what, and this widget exists to be glanced at.
  const rows = [...watched].sort((x, y) => {
    // Pinned first, then worst-first. Without the pin a full lock never appears.
    const px = devMatches(x, S.battPrimary) ? -1 : 0;
    const py = devMatches(y, S.battPrimary) ? -1 : 0;
    return px !== py ? px - py : (x.level ?? 101) - (y.level ?? 101);
  });
  const shown = rows.slice(0, 4);

  const card = document.querySelector('[data-widget="batteries"]');
  if (card) card.classList.toggle("warn", low.length > 0);
  setIcon("batt", "battery", low.length ? "bad" : "ok");

  setMini("batt",
    low.length ? `${low.length} low` : (watched.length ? "all good" : "none watched"),
    rows.length > 4 ? `+${rows.length - 4} more watched` : `${watched.length} watched`);

  const list = $("battRows");
  if (list) {
    list.className = `battRows mode-${S.battDisplay}`;
    list.innerHTML = renderBatteryBody(S.battDisplay, shown, isLow);
  }
  // The tile takes the size its chosen display actually needs. A one-line summary
  // in a large tile is the whitespace problem this widget was meant to fix.
  if (card) {
    const size = S.battDisplay === "compact" ? "w-small"
      : S.battDisplay === "dials" ? "w-medium"
      : "w-large";
    card.classList.remove("w-small", "w-medium", "w-large");
    card.classList.add(size);
  }

}

function timingPhrase(timing){
  if (!timing) return "";
  switch (timing.kind) {
    case "until": return `Good until ${fmtShortTime(timing.time)}`;
    case "next":
      // A short window gets both ends; a long one only needs its start.
      return (timing.until && timing.hours <= S.shortWindowHours)
        ? `Window ${fmtShortTime(timing.time)}–${fmtShortTime(timing.until)}`
        : `Better from ${fmtShortTime(timing.time)}`;
    case "none":  return `Nothing good for ${OUTLOOK_HOURS}h`;
    default:      return "";   // "open" — good throughout, no cliff to warn about
  }
}

/// Four ways to draw the same data. Dials read fastest for a handful; a list stays
/// legible when many are watched; bars make levels comparable; compact gives it up
/// altogether and just says whether anything needs attention.
function renderBatteryBody(mode, devices, isLow){
  const pct = (b) => (typeof b.level === "number" ? Math.round(b.level) : null);
  const tone = (b) => isLow(b) ? "low" : (pct(b) != null && pct(b) <= 50 ? "mid" : "ok");
  const pin = (b) => devMatches(b, S.battPrimary) ? " pinned" : "";

  if (mode === "compact") {
    const low = devices.filter(isLow);
    const worst = [...devices].sort((x, y) => (pct(x) ?? 101) - (pct(y) ?? 101))[0];
    return `<span class="battCompact${low.length ? " low" : ""}">${
      low.length ? `${low.length} need${low.length === 1 ? "s" : ""} replacing` : "All healthy"
    }${worst ? ` · lowest ${worst.name} ${pct(worst) ?? "?"}%` : ""}</span>`;
  }

  if (mode === "bars") {
    return devices.map((b) => `<span class="battBar ${tone(b)}${pin(b)}">
      <span class="battName">${b.name}</span>
      <span class="battTrack"><span class="battFill" style="width:${pct(b) ?? 0}%"></span></span>
      <span class="battPct">${pct(b) == null ? "?" : pct(b) + "%"}</span>
    </span>`).join("");
  }

  if (mode === "list") {
    return devices.map((b) => `<span class="battLine ${tone(b)}${pin(b)}">
      <span class="battName">${b.name}</span>
      <span class="battPct">${pct(b) == null ? "?" : pct(b) + "%"}</span>
    </span>`).join("");
  }

  // dials
  const R = 26, C = 2 * Math.PI * R;
  return devices.map((b) => {
    const frac = pct(b) == null ? 0 : Math.max(0, Math.min(1, pct(b) / 100));
    return `<span class="battCell ${tone(b)}${pin(b)}" title="${b.name} (${b.type})">
      <svg class="battRing" viewBox="0 0 64 64" aria-hidden="true">
        <circle class="track" cx="32" cy="32" r="${R}"></circle>
        <circle class="fill" cx="32" cy="32" r="${R}" stroke-dasharray="${(C*frac).toFixed(1)} ${C.toFixed(1)}"></circle>
      </svg>
      <span class="battPct">${pct(b) == null ? "?" : pct(b) + "%"}</span>
      <span class="battName">${b.name}</span>
    </span>`;
  }).join("");
}

/* --- Snapshot cache ---------------------------------------------------- */

const SNAP_KEY = "dashboard_snapshot";
const SNAP_MAX_AGE_MS = 12 * 60 * 60 * 1000;   // the forecast covers ~48h; 12h stays safely in range

function saveSnapshot(forecast, loc){
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify({ at: Date.now(), loc, forecast }));
  } catch { /* quota or private mode — the app works fine without it */ }
}

function readSnapshot(){
  try {
    const snap = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
    if (!snap || !snap.forecast || (Date.now() - snap.at) > SNAP_MAX_AGE_MS) return null;
    return snap;
  } catch {
    return null;
  }
}

/* --- Refresh ----------------------------------------------------------- */

async function refresh(){
  clearTimeout(retryTimer);
  try {
    const now = new Date();
    const loc = await resolveLocation();
    hideLocate();
    setZipMeta(loc.name || loc.zip || await placeName(loc));

    const forecast = await fetchForecast(loc.lat, loc.lon);
    await fetchAir(loc.lat, loc.lon);
    saveSnapshot(forecast, loc);
    render(forecast, loc, now);

    lastRefreshTime = Date.now();
    updateMinutesSince();
  } catch (e) {
    console.error(e);
    if (e && e.message === "NEEDS_LOCATION") {
      // Waiting on the user — retrying on a timer would burn battery and change nothing.
      showLocate("Allow location, or enter a ZIP code to continue.");
    } else {
      // Transient: network, or the forecast endpoint. Come back in a minute, not twenty.
      // If a cached reading is already on screen it stays there; "Updated N min ago"
      // is doing the honest work of saying how old it is.
      $("updatedLine").textContent = lastRefreshTime ? "Offline — showing last reading" : "Couldn't load — retrying";
      retryTimer = setTimeout(refresh, RETRY_MS);
    }
  }
}

// Paint the last known reading immediately, before any network call.
function bootFromCache(){
  const snap = readSnapshot();
  if (!snap) return false;
  try {
    render(snap.forecast, snap.loc, new Date());
    setZipMeta(snap.loc?.zip || localStorage.getItem("dashboard_place") || DEVICE_LOCATION_LABEL);
    lastRefreshTime = snap.at;
    updateMinutesSince();
    return true;
  } catch {
    return false;
  }
}

/* --- Boot ------------------------------------------------------------- */

$("locateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const zip = $("zipInput").value.trim();
  if (!/^\d{5}$/.test(zip)) {
    $("locateNote").textContent = "Enter a five-digit ZIP code.";
    return;
  }
  $("locateNote").textContent = "Looking that up…";
  try {
    await geocodeZip(zip);            // validate before storing, so a typo can't stick
    localStorage.setItem("dashboard_zip", zip);
    forgetPlace();
    hideLocate();
    refresh();
  } catch {
    $("locateNote").textContent = `No match for ${zip}. Check the ZIP and try again.`;
  }
});

// Drops the saved ZIP so resolveLocation falls back to the device again.
$("retryLocation").addEventListener("click", () => {
  localStorage.removeItem("dashboard_zip");
  forgetPlace();
  $("locateNote").textContent = "Asking for location…";
  hideLocate();
  refresh();
});

$("cancelLocate").addEventListener("click", () => {
  hideLocate();
  updateMinutesSince();
});

$("zipMeta").addEventListener("click", openLocate);

/* --- Always-on, and dimming when it is -------------------------------------
   Two halves of one feature. Keeping the screen lit only makes sense if the app
   stops being a bright rectangle at 2am, and dimming only matters if the screen
   is staying on in the first place. Neither is much use alone.

   The lesson from measuring Apple's glass applies here too: as luminance drops,
   fine strokes are lost first. So the dim state gets *heavier* type, not thinner —
   the opposite of the usual instinct. */

// Two idle tiers rather than a configured bedtime. A fixed hour is a setting to get
// wrong and a knob to maintain; idleness already carries the signal — if you are still
// looking at it, it stays lit, and if you have gone to sleep it goes dark on its own.
const DIM_AFTER_MS      = S.dimAfterSec * 1000;      // warm amber
const NEAR_OFF_AFTER_MS = S.nearOffAfterSec * 1000;  // as dark as a web page can go

let wakeLock = null;
let dimTimer = null;
let nearOffTimer = null;
let keepAwake = (localStorage.getItem("dashboard_keepAwake") ?? String(S.keepAwakeDefault)) === "true";

function wakeLockSupported(){
  return "wakeLock" in navigator && typeof navigator.wakeLock?.request === "function";
}

async function acquireWakeLock(){
  if (!keepAwake || !wakeLockSupported() || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    // The system drops the lock on backgrounding, minimise, or a call — so it has to be
    // taken again on every return to visible, not just once.
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch {
    // Denied — low battery, or a document the browser doesn't consider user-visible.
    // The preference is kept: it is what the user asked for, and a transient refusal
    // should not silently disable the feature forever. The next visibility change
    // tries again. Dimming keys off the preference, not the lock, so that still works.
    wakeLock = null;
  }
}

async function releaseWakeLock(){
  try { await wakeLock?.release(); } catch { /* already gone */ }
  wakeLock = null;
}

function syncAwakeButton(){
  const btn = $("awakeBtn");
  if (!btn) return;
  btn.classList.toggle("hidden", !wakeLockSupported());
  btn.setAttribute("aria-pressed", String(keepAwake));
  btn.textContent = keepAwake ? "Awake" : "Keep awake";
  document.body.classList.toggle("awake", keepAwake);
  if (!keepAwake) undim();
}

function isNightPhase(){
  return document.body.classList.contains("phase-night");
}

function dim(){
  if (!keepAwake || !isNightPhase()) return;
  document.body.classList.add("dimmed");
}

function nearOff(force = false){
  // The idle path still requires night and keep-awake — that is a screen you left on.
  // The armed path ignores both, because an armed house is a reason on its own.
  if (!force && (!keepAwake || !isNightPhase())) return;
  document.body.classList.add("dimmed", "nearOff");
}

function undim(){
  document.body.classList.remove("dimmed", "nearOff");
  clearTimeout(dimTimer);
  clearTimeout(nearOffTimer);
  if (!keepAwake) return;
  dimTimer = setTimeout(dim, DIM_AFTER_MS);
  nearOffTimer = setTimeout(nearOff, NEAR_OFF_AFTER_MS);
}

/* --- Ring alarm feed (Pi build only) -------------------------------------
   Capability-detected, not a separate build. The Pi-hosted copy serves
   /api/alarm; the public one does not, so this quietly stays off there. Same
   files either way — a fork would drift, and this app has already been bitten
   once by two numbers computed from different windows.

   Armed means the house is set and nobody is using the display, so it goes
   straight to near-off instead of waiting out the idle timer. Disarming brings
   it back. Only meaningful on a dedicated bedside device — on a phone you carry,
   "away" means the screen is in your hand. */

const ALARM_POLL_MS = 15 * 1000;
let hasAlarmFeed = false;
let alarmTimer = null;
let lastAlarmState = null;

async function pollAlarm(){
  try {
    const r = await fetch("api/home", { cache: "no-store" });
    if (!r.ok) throw new Error("NO_FEED");
    const j = await r.json();
    hasAlarmFeed = true;

    // The endpoint answers 200 with ok:false when HOOBS itself is unreachable.
    // Testing only the HTTP status treated that as a live feed reporting "not
    // armed", which called undim() and reset the idle timers — so the bedside
    // display would never dim while HOOBS was down. Leave the timers alone.
    renderHomeMinis(j);
    if (!j.ok) return;

    const state = typeof j.state === "string" ? j.state : "";
    const armed = state.startsWith("armed");
    // Only a display that stays put should go dark because the house is armed.
    // "Armed away" means the phone is in your pocket, so blacking out the app you
    // are holding is exactly backwards — and it also hid the settings gear, which
    // is how this was found. Bedside (or an explicitly kept-awake screen) only.
    const stationary = bedsideParam !== null || keepAwake;
    const wanted = !stationary ? false
      : S.dimOnArmed === "off" ? false
      : S.dimOnArmed === "away" ? state === "armed (away)"
      : armed;

    if (state !== lastAlarmState) {
      lastAlarmState = state;
      // Only act on a change, so a touch can still wake the screen while armed
      // without the next poll immediately blacking it out again.
      if (wanted) nearOff(true);
      else if (!armed) undim();
    }
  } catch {
    hasAlarmFeed = false;   // public build, or the Pi is unreachable — no feature, no error
    renderHomeMinis(null);
  }
}

function startAlarmFeed(){
  clearInterval(alarmTimer);
  pollAlarm().then(() => {
    if (hasAlarmFeed) alarmTimer = setInterval(pollAlarm, ALARM_POLL_MS);
  });
}

$("awakeBtn").addEventListener("click", async () => {
  keepAwake = !keepAwake;
  localStorage.setItem("dashboard_keepAwake", String(keepAwake));
  syncAwakeButton();
  if (keepAwake) { await acquireWakeLock(); undim(); }
  else { await releaseWakeLock(); }
});

// Any touch restores full brightness and restarts the idle countdown.
["pointerdown", "keydown"].forEach((evt) =>
  window.addEventListener(evt, undim, { passive: true })
);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    acquireWakeLock();
    undim();
    updateClock();
    updateMinutesSince();
  }
});

window.clearSavedZip = function(){
  localStorage.removeItem("dashboard_zip");
  localStorage.removeItem("dashboard_place");
  localStorage.removeItem(SNAP_KEY);
  location.reload();
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* http:// or unsupported */ });
  });
}

// Bedside mode: masked to the enclosure aperture, reduced layout. A query param so it
// can be tested from any browser; the Pi build serves it by default. ?bedside=flip
// swaps the 4mm offset for the other landscape mounting.
// Orientation is the context. The bedside phone is fixed landscape in the enclosure,
// so landscape means "read from across the room": masked, glanceable, nothing to touch.
// Portrait means it is in a hand — the full app, with detail on tap. Pick the bedside
// phone up and turn it and you get the app; put it back and it is a clock again.
//
// Gated on ?bedside so rotating a phone you're holding never masks it: only the Pi
// build (and explicit testing) opts in.
const bedsideParam = new URLSearchParams(location.search).get("bedside");
if (bedsideParam === "flip") document.body.classList.add("flip");

/* --- Widgets -------------------------------------------------------------
   What appears, and in what order, per context. Previously this was hardcoded
   in CSS, so changing it meant editing a stylesheet.

   Two contexts, because they are genuinely different products: portrait is a
   phone in a hand, bedside is a 124 x 58 mm slot read from across a room. The
   bedside default is deliberately short — that aperture cannot hold the
   dashboard and stay readable, which is the whole reason bedside mode exists.

   The clock is not a widget. It is the one thing a bedside display must always
   show, and making it optional would only create a way to break it. */

function currentContext(){
  return document.body.classList.contains("bedside") ? "bedside" : "portrait";
}

/// Visibility and order both come from the config. Order uses flex `order` rather than
/// moving nodes, so nothing has to be re-rendered when the arrangement changes.
function applyLayout(){
  const active = layout[currentContext()] || [];
  WIDGETS.forEach((w) => {
    const el = document.querySelector(`[data-widget="${w.id}"]`);
    if (!el) return;
    const i = active.indexOf(w.id);
    el.classList.toggle("widgetOff", i === -1);
    el.style.order = i === -1 ? "" : String(i);
  });
  // The chips row has no meaning if neither chip is in play.
  const chips = $("chips");
  if (chips) {
    const anyChip = active.includes("bring") || active.includes("protect");
    chips.classList.toggle("widgetOff", !anyChip);
    const ci = Math.min(...["bring", "protect"].map((id) => {
      const i = active.indexOf(id); return i === -1 ? Infinity : i;
    }));
    chips.style.order = Number.isFinite(ci) ? String(ci) : "";
  }
}

// Peek: hold to get the full app while the phone is mounted.
//
// The orientation rule assumed you could rotate the device. The bedside one is fixed
// in a cradle, so "turn it to get the app" would mean pulling it out of the enclosure.
// A long press is the way in. Long, not double-tap — a bedside screen gets brushed and
// bumped and tapped to wake, and none of that should drop the clock.
//
// It always reverts. Without that the display quietly stops being a clock and you find
// it in app mode at 3am.
const PEEK_HOLD_MS = 600;
const PEEK_TIMEOUT_MS = S.peekSec * 1000;
let peeking = false;
let peekTimer = null;
let pressTimer = null;

function applyBedsideMode(){
  const landscape = window.innerWidth > window.innerHeight;
  const on = bedsideParam !== null && landscape && !peeking;
  document.body.classList.toggle("bedside", on);
  // The aperture mask is now opt-in with ?bedside=mask. The enclosure is still
  // being decided, so the widget screen should not be built around a hole whose
  // size may change — it lays out at whatever size it is given.
  document.body.classList.toggle("masked", on && bedsideParam === "mask");
  if (on) clearHourDetail();
  applyLayout();   // the two contexts have different widget sets
}

function endPeek(){
  if (!peeking) return;
  peeking = false;
  clearTimeout(peekTimer);
  clearHourDetail();
  applyBedsideMode();
}

function holdPeekOpen(){
  clearTimeout(peekTimer);
  peekTimer = setTimeout(endPeek, PEEK_TIMEOUT_MS);
}

function beginPeek(){
  if (bedsideParam === null || peeking) return;
  if (!document.body.classList.contains("bedside")) return;   // already the full app
  peeking = true;
  applyBedsideMode();
  holdPeekOpen();
}

document.addEventListener("pointerdown", () => {
  clearTimeout(pressTimer);
  if (peeking) { holdPeekOpen(); return; }      // interacting keeps it open
  pressTimer = setTimeout(beginPeek, PEEK_HOLD_MS);
}, { passive: true });

["pointerup", "pointercancel"].forEach((evt) =>
  document.addEventListener(evt, () => clearTimeout(pressTimer), { passive: true })
);

applyBedsideMode();
window.addEventListener("resize", applyBedsideMode);
window.addEventListener("orientationchange", applyBedsideMode);

renderVersionTag();
updateClock();
startTickers();
syncAwakeButton();
startAlarmFeed();
if (keepAwake) { acquireWakeLock(); undim(); }
// Cache first, network second: something readable is on screen before the request
// leaves. If the cache is empty or stale this is a no-op and refresh() fills it in.
bootFromCache();
refresh();
clearInterval(refreshTimer);
refreshTimer = setInterval(refresh, REFRESH_MS);
