const VERSION = "v61";
const REFRESH_MS = 20 * 60 * 1000;
const RETRY_MS = 60 * 1000;      // after a transient failure — not the full refresh interval
const RUN_HOT = true;

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
  const name = hit.admin1 ? `${hit.name}, ${hit.admin1}` : (hit.name || "");
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

async function fetchForecast(lat, lon){
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&timezone=${encodeURIComponent(tz)}` +
    `&temperature_unit=fahrenheit&windspeed_unit=mph` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,cloudcover,windspeed_10m,uv_index,is_day,weathercode,relative_humidity_2m` +
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

const OUTLOOK_HOURS = 10;

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

function renderOutlook(outlook){
  const el = $("outlook");
  if (!el) return;
  el.innerHTML = outlook.map((s, i) => {
    const hour = new Intl.DateTimeFormat([], { hour: "numeric" }).format(s.time);
    // Label every third hour; more than that is noise at this width.
    const tick = (i % 3 === 0) ? `<span class="tick">${hour}</span>` : "";
    return `<div class="hour ${s.state}" title="${hour} — ${s.label}">${tick}</div>`;
  }).join("");
}

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
    walkCard.className = "card glass decision walk";
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
}

function timingPhrase(timing){
  if (!timing) return "";
  switch (timing.kind) {
    case "until": return `Good until ${fmtShortTime(timing.time)}`;
    case "next":
      // A short window gets both ends; a long one only needs its start.
      return (timing.until && timing.hours <= 2)
        ? `Window ${fmtShortTime(timing.time)}–${fmtShortTime(timing.until)}`
        : `Better from ${fmtShortTime(timing.time)}`;
    case "none":  return `Nothing good for ${OUTLOOK_HOURS}h`;
    default:      return "";   // "open" — good throughout, no cliff to warn about
  }
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
const DIM_AFTER_MS      = 60 * 1000;        // warm amber
const NEAR_OFF_AFTER_MS = 5 * 60 * 1000;    // as dark as a web page can go

let wakeLock = null;
let dimTimer = null;
let nearOffTimer = null;
let keepAwake = localStorage.getItem("dashboard_keepAwake") === "true";

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

function nearOff(){
  if (!keepAwake || !isNightPhase()) return;
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

renderVersionTag();
updateClock();
startTickers();
syncAwakeButton();
if (keepAwake) { acquireWakeLock(); undim(); }
// Cache first, network second: something readable is on screen before the request
// leaves. If the cache is empty or stale this is a no-op and refresh() fills it in.
bootFromCache();
refresh();
clearInterval(refreshTimer);
refreshTimer = setInterval(refresh, REFRESH_MS);
