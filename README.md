# Ascend Enterprise Onboarding

Multi-step onboarding wizard for new Ascend Travel enterprise clients. Guides account administrators through company setup, traveler registration, contract review, and travel policy configuration.

**Demo:** Runs on GitHub Pages with localStorage — no backend required.

## Pages

### Onboarding Wizard (`index.html`)

Six-step flow for new enterprise accounts:

1. **Company info** — name, industry, size, admin contact
2. **Travelers** — add team members with name, email, phone, travel frequency
3. **Travel profile** — preferred airlines, hotel chains, cabin class, loyalty programs
4. **Contract review** — Ascend Services Agreement with e-signature capture
5. **Payment** — Stripe checkout integration (configurable payment link)
6. **Confirmation** — account summary, next steps, team invitation

### Travel Policy & Preferences (`policy.html`)

Sent to client after contract signing. Team leads configure:

- **Company travel policy** — budget caps, advance booking rules, cabin class by trip type, approval workflows
- **Per-traveler preferences** — seat, meal, loyalty numbers, accessibility needs, emergency contacts
- **Preferences call booking** — Calendly integration for a 1:1 setup call

## Tech Stack

- Vanilla HTML/JavaScript (no framework, no build step)
- Tailwind CSS (CDN)
- Chart.js (ROI projections in wizard)
- localStorage API (demo mode) / REST API (production mode)

## API Endpoints (Production)

The wizard calls a REST API when not in demo mode. Serverless functions in `api/`:

| File | Endpoint | Purpose |
|------|----------|---------|
| `hubspot-owner.js` | `POST /api/hubspot-owner` | Assign HubSpot contact owner on signup |
| `start-discovery-call.js` | `POST /api/start-discovery-call` | Trigger discovery agent outbound call |

## Development

Open `index.html` in a browser — no server needed. Demo mode uses localStorage to simulate the API.

For local server:

```bash
python3 -m http.server 8000
```

## File Structure

```
onboarding/
├── index.html      # Enterprise onboarding wizard (6 steps)
├── policy.html     # Travel policy & preferences form
├── wizard.js       # Wizard logic, localStorage API, step management
├── policy.js       # Policy form logic, per-traveler preferences
├── api/
│   ├── hubspot-owner.js         # HubSpot owner assignment
│   └── start-discovery-call.js  # Discovery call trigger
├── logo-navy.png   # Ascend logo (dark)
└── logo-white.svg  # Ascend logo (light)
```
