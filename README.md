# Walk & Wear

What to wear, what to bring, and when to walk the dog. Weather in, decisions out.

**Live:** https://jlevdc83.github.io/walk-and-wear/

No backend, no build step, no dependencies. Open-Meteo for forecast and geocoding,
BigDataCloud for reverse geocoding. Both keyless.

## The premise

You cannot act on "86°". You can act on "no jacket" and "wait until 8 PM". So the
decisions are the headline and the weather is the evidence underneath — the reverse
of most weather apps.

Mackenzie goes out several times a day, so the walk card answers **when**, not just
whether. The hourly strip runs the same tuned verdict across the next ten hours: the
text gives the next opportunity, the strip shows the best one.

## Three contexts, one codebase

| | |
|---|---|
| **Main phone, portrait** | Full app. Tap any hour in the strip to ask why it is that colour. |
| **Bedside, landscape** | Masked to the enclosure aperture. Clock, verdict, strip. Nothing to touch. |
| **Bedside, held** | Long-press for the full app; reverts on its own. |

Orientation is the signal — landscape means "read from across the room", portrait means
"in a hand". Gated on `?bedside` so rotating a phone you are carrying never masks it.

### Gestures

- **Tap** — wake from dim, or pick an hour in the strip
- **Long-press (600 ms)** — in bedside mode, reveal the full app. Reverts after 30s idle.
  The bedside phone is fixed in a cradle, so rotating it is not an option; this is the
  way in. Long rather than double-tap because a bedside screen gets brushed and bumped,
  and none of that should drop the clock.

### Query parameters

- `?bedside` — mask to the 124 × 58 mm enclosure aperture (landscape only)
- `?bedside=flip` — same, with the 4 mm offset mirrored for the other landscape mounting

## Tuning

`RUN_HOT = true` adds 4°F to every felt temperature, because Josh does. The walk bands,
paw-risk surface estimate and rain horizon were arrived at by use, not derived. Change
them here and nowhere else.

Everything that reads a rain figure uses the **same three-hour window**. Two numbers
computed from different windows once produced "RAIN 74%" alongside no umbrella advice.

## Offline

A service worker caches the shell; the last good forecast is stored and painted before
any request leaves. Weather calls always go to the network — a stale forecast served as
if fresh is worse than none. When offline the status line says so rather than lying
about its age.

## The Pi build

`pi/serve.py` serves these same files from the Pi for the bedside device, plus one
endpoint the public build cannot have:

    GET /api/alarm  ->  {"state": "armed (home)" | "disarmed" | ...}

Same origin, so the server reads HOOBS itself and the browser never sees a credential.
When armed, the display goes straight to near-off instead of waiting out the idle timer.

The app probes for it — capability detection, not a second build. On GitHub Pages it
404s and the feature is simply absent.

Systemd unit lives in `pi-services/systemd/walk-and-wear.service`; the code is owned
here, same split as docs-hub/doc-review.

## Screen states

Keep-awake is off by default — a lit screen has a battery cost. With it on, at night:

- **60s idle** → warm amber, verdicts still legible
- **5 min idle** → black, dim red clock only

Type gets *heavier* as it dims, not thinner. Fine strokes are the first thing lost at
low luminance, so the usual instinct is backwards. That is measured from Apple's own
`.glassEffect()` material, not taste.

Note that no app can turn an iPhone's screen off — not web, not native. On OLED true
black means the pixels are off; on the iPhone 11's LCD the backlight stays lit
regardless. To drop an LCD backlight, use the Shortcuts **Set Brightness** action in a
Home scene.
