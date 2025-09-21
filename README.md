# Secure Invoice Platform — Prototype

This workspace contains a frontend prototype (`frontend/`) and a small backend mock (`server/`) used for demonstrating features like AI risk checks and blockchain-style anchoring of invoices.

## Running the frontend

1. Install dependencies and start dev server

```bash
cd "/Users/amansingh/Desktop/Hackathon/project 8/frontend"
npm install
npm run dev
```

Open the Vite URL printed (usually `http://localhost:5173` or `http://localhost:5174`).

Routes:
- `/` — Landing
- `/auth` — Auth mock
- `/dashboard` — Dashboard (fetches anchors from backend if available)
- `/invoice/new` — Create an invoice (will call backend `/api/anchor` when "Immutable" toggled)
- `/payments` — Send / Receive mock (calls risk API before creating payment link)

## Running the backend mock

The backend mock provides simple endpoints for risk scoring, anchoring invoices, and creating payments.

1. Install and start the backend server:

```bash
cd "/Users/amansingh/Desktop/Hackathon/project 8/server"
npm install
npm start
```

The backend listens on port `4001` by default.

Available endpoints
- `GET /api/health` — returns `{ ok: true }`.
- `POST /api/risk` — body `{ to, amount, escrow }` returns `{ score, label, reasons, suggestedAction }`.
- `POST /api/anchor` — body `{ invoice }` returns `{ ok: true, hash, record }`.
- `GET /api/anchors` — returns list of anchored invoices (in-memory).
- `POST /api/pay` — create a mock payment record.
- `GET /api/payments` — list payments (in-memory).

Notes
- Anchors and payments are stored in-memory; restarting the backend will clear them. For persistence, integrate a database (SQLite/Postgres) or a file store.
- The frontend will try to call the backend at `http://localhost:4001`; if unavailable, some flows fall back to localStorage.

## Quick tests

Risk test:
```bash
curl -X POST http://localhost:4001/api/risk -H 'Content-Type: application/json' -d '{"to":"alice@example.com","amount":1200,"escrow":false}'
```

Anchor test:
```bash
curl -X POST http://localhost:4001/api/anchor -H 'Content-Type: application/json' -d '{"invoice":{"client":"Alice","items":[{"desc":"Work","qty":1,"price":1200}]}}'
```

## Next steps (suggested)
- Persist anchors/payments to a DB.
- Integrate a real wallet (MetaMask/WalletConnect) and blockchain anchoring.
- Replace risk mock with a real AI/risk service or a server-side ML model.
