# Backlog — walk-and-wear

Project-scoped backlog for the Walk & Wear app (the PWA, the Pi build, the bedside
enclosure). Created 2026-07-29. Pi *infrastructure* items — the systemd unit, the
tailscale serve mapping, backups — belong in `pi-services/BACKLOG.md` instead.
`/backlog <idea>` appends to the top of **Ideas**.

## Ideas

## Decisions waiting on Josh

- [ ] **Which landscape orientation the phone mounts in** — no longer urgent, and no
  longer irreversible
  - context: this used to be `?bedside=flip`, a URL you could not undo. It is now the
    "Mirror offset" toggle in the admin page's Bedside display section, so it can be
    flipped at any time — including after the enclosure is printed. The CAD fixes the
    4 mm offset relative to the enclosure rather than to which way up the phone goes
    in, so the app still cannot infer it; decide by which way the Lightning port faces
    relative to the Hue keypad, and check it against a paper mask before printing.
    (The `.flip` class that backed the old URL hardcoded the shift at -2.87% and so
    ignored whatever `maskOffset` was actually set to — removed 2026-07-29.)

- [ ] **Create `go/walk`** → `https://pi.tail1d9da7.ts.net/walk`
  - context: golink rejects scripted writes ("invalid XSRF token"), so it has to be
    added in its own UI at <http://go/>. Short `walk`, long the HTTPS URL above — not
    the `:8797` one, which is a plain-HTTP context (see below). Existing links for
    reference: `chat`, `docs`, `energy`.

## Bedside display

- [ ] **Retire the plain-HTTP door once the bedside phone is on `go/walk`**
  - context (2026-07-29): `pi/serve.py` binds the tailnet IP, so the app answers on
    both `http://100.84.97.17:8797` and `https://pi.tail1d9da7.ts.net/walk`. The HTTP
    one is actively harmful, not merely redundant: a browser withholds
    `navigator.serviceWorker` outside a secure context, so a device on the HTTP URL
    silently has no offline cache. Measured on 2026-07-29 — HTTP gave
    `isSecureContext: false` and the API absent entirely; HTTPS gives one registration
    scoped to `/walk/` and a live `walk-and-wear-v89` cache. Once nothing points at
    `:8797`, set `WW_BIND=127.0.0.1` in `pi-services/systemd/walk-and-wear.service` so
    the HTTPS front is the only way in.

- [ ] **The unmasked bedside view has never had a real design pass**
  - context: every `cqh` in the bedside stylesheet resolved to 0 until 2026-07-29,
    because only `?bedside=mask` established a size container — so type, padding, gaps
    and radii were all effectively zero and nobody had seen the layout. It is correct
    now, not designed. Measured at the real aperture (124×58 mm → 796×372 CSS px):
    three tiles are comfortable, four is tight (the walk strip clips and "Air quality"
    wraps to three lines), five clips. Labels sit at 22.8 px, well clear of the 11 pt
    floor, so horizontal room is the constraint, not legibility.

## Design

- [ ] **Widget graphics are hardcoded per widget**
  - context: the walk outlook has ten selectable presentations; the eight small-tile
    graphics have one global switch (`vizStyle`: shaped / bars / off) and no per-widget
    choice. Fine as-is — noted so the asymmetry is deliberate rather than forgotten.

- [ ] **Pollen is offered in the widget list everywhere, but only has data in Europe**
  - context: the tile now hides itself outside the CAMS European domain and admin
    explains why, so this is cosmetic — the widget can still be dragged into a layout
    where it will never render. Consider dropping it from `WIDGETS` when
    `pollenCovered()` is false.

## Done

- [x] **HTTPS on the tailnet** — 2026-07-29. `tailscale serve` maps
  `https://pi.tail1d9da7.ts.net/walk` → `:8797`; recorded in `pi-services/deploy.sh`
  so a reimage restores it. Service worker registers for the first time.
- [x] **`deploy.sh`** — 2026-07-29. Was eight hand-run `rsync` invocations in one
  session, which is the drift that broke go/docs on 2026-07-23.
- [x] **Bedside mode is an admin toggle** — 2026-07-29. Was a query string you had to
  remember, which a home-screen launch dropped anyway: iOS relaunches from the
  manifest's `start_url`, which carries no query. Now a per-device setting; the URL
  still works and sets it.
- [x] **App icon** — 2026-07-29. Built on the Claude Apps handoff geometry
  (`tech-support/Claude Mac App/design-handoff-icon`); paw with a sun, amber field.
  `design/make-icon.py` regenerates every cut.
