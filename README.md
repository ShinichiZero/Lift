# LiftGlass Pro

LiftGlass Pro is a production-ready, local-first workout planner and progressive overload tracker for strength training and hypertrophy.

## What it does
- Build workout templates (Push/Pull/Legs, Upper/Lower, Full Body, Custom)
- Create and manage exercises with movement metadata
- Start sessions from templates and log sets quickly with one-handed controls
- Duplicate previous set, one-tap weight/reps changes, built-in rest timer with vibration fallback
- Get transparent next-session progression suggestions
- Track analytics: load history, estimated 1RM trend, weekly volume by muscle, consistency, plateaus, streaks, PRs
- Save data locally in IndexedDB
- Export/import local JSON data with validation and sanitation
- Install as a PWA with offline shell support

## Architecture (short)
- **Static client app**: `index.html` + `styles.css` + `app.js`
- **Persistence**: IndexedDB (`app-state` object store)
- **PWA**: `manifest.webmanifest`, `service-worker.js`, app icons
- **Security posture**:
  - Strict Content Security Policy in `index.html`
  - No remote scripts, no trackers, no eval
  - User input sanitized before storage/render
  - Import JSON schema validation with guards for malformed payloads

## Run locally
Any static server works.

```bash
cd /home/runner/work/Lift/Lift
python -m http.server 4173
```

Then open: `http://localhost:4173`

## Install (PWA)
1. Open app in Safari/Chrome/Edge after first load.
2. Use browser install flow / iOS **Add to Home Screen**.
3. Launch from home screen in standalone mode.

## Deploy as static hosting
Deploy repository files as-is to any static host (GitHub Pages, Netlify, Vercel static output, Cloudflare Pages, S3+CloudFront).

## Test checklist
- [x] Create exercises and templates
- [x] Add exercises to template day with targets
- [x] Start session and log sets with one-tap controls
- [x] Duplicate prior set
- [x] Observe progression suggestion + rationale
- [x] Validate analytics render after session completion
- [x] Export JSON and import valid JSON
- [x] Confirm malformed import is rejected
- [x] Verify responsive layout on iPhone, iPad, desktop widths
- [x] Verify service worker registration and offline shell fallback

## Security checklist (OWASP Top 10 2025-oriented)
- [x] Input sanitization for user-provided fields (exercise names, notes, template labels)
- [x] Safe rendering via `textContent`/DOM APIs (no HTML injection)
- [x] Strict CSP, no inline scripts, no external script injection
- [x] No authentication surface added (local-only app)
- [x] Import validation and size guard for untrusted JSON
- [x] No secrets or API keys in client code
- [x] No third-party analytics/tracking

## Tradeoffs
- Chose framework-free architecture for low bundle size, quick startup, and easy static deployment.
- Charts use lightweight Canvas rendering (no chart dependency).
- Weekly grouping logic is intentionally simple and deterministic for local analytics.
