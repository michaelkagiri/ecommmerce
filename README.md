# Shop POS

Cashier till + manager panel + one Node/Express API (modular monolith) + MongoDB.

## Run it

```sh
cp .env.example .env        # edit JWT_SECRET, ADMIN_PASSWORD
docker compose up -d --build
```
Open http://localhost, sign in with ADMIN_USERNAME / ADMIN_PASSWORD, name the till (e.g. T1).
Create cashiers under Manager → Users. Add products under Manager → Products.

Development without Docker: run MongoDB as a replica set (`mongod --replSet rs0`, then `rs.initiate()` once), then
`cd server && npm i && JWT_SECRET=... ADMIN_USERNAME=admin ADMIN_PASSWORD=... npm run dev` and `cd client && npm i && npm run dev`.

## How the pieces behave

- **Prices are server-side.** The till sends barcodes, quantities and the price it displayed. The server re-prices from its own catalog and stores its prices. A differing price flags the sale `PRICE_MISMATCH`.
- **One transaction per sale.** Receipt, line items, stock decrement and stock-movement records commit together (needs the replica set, already configured in compose).
- **Offline.** A service worker caches the app shell; the catalog is cached in IndexedDB; every sale is written to a local queue first and synced oldest-first. Each sale has a client UUID, so a retried sync is harmless. Receipt numbers are per till (`T1-00042`).
  - Offline sales that sync later can drive stock negative (sale is flagged `NEGATIVE_STOCK`) or be underpaid after a price change (`UNDERPAID`). They are accepted and flagged for a manager, because the sale already happened.
  - A till needs to sign in online once. Sessions last `JWT_EXPIRES` (7d); the till keeps selling after that, and sales wait until someone signs in again. Disabling a user is enforced on the server at the next request.
  - If you clear the browser's site data on a till, unsynced sales and its receipt counter are lost. Do not do that while the till shows sales waiting.
- **Refunds/voids** never delete: they restock, write a Refund record and an audit entry, and are manager-only.
- **Audit log** covers price changes, stock adjustments, refunds, user changes.
- **Reports**: daily summary by payment method with expected drawer cash.
- **M-Pesa** (off by default; step-by-step setup in `docs/MPESA.md`): set `MPESA_ENABLED=1` and the Daraja values. The till requests an STK push, polls for the callback, and the server only accepts a sale referencing a confirmed, unused payment. M-Pesa is disabled on the till while offline. The callback URL is `MPESA_CALLBACK_BASE/api/mpesa/callback/MPESA_CALLBACK_SECRET` and must be public HTTPS. Amounts must be whole shillings.
- **Barcode scanner**: USB scanners type into the focused scan box and press Enter; no driver needed.
- **Receipts** print via the browser (`window.print()`, 72 mm CSS). An ESC/POS bridge can replace that later without touching the API.

## Tests

Integration tests hit the running API (real MongoDB, real transactions). With the stack up:

```sh
docker compose exec -e ADMIN_PASSWORD=<your admin password> api npm test
```
They create their own products and a throwaway cashier, so they are safe to run on a database with data, but run them on a staging copy rather than the live shop. They cover roles, server-side pricing, idempotent and concurrent sync, negative stock, change/underpayment, rollback on a bad barcode, refunds, audit entries, locked-out users and the drawer report.

## Production

- Put HTTPS in front: easiest is Caddy or Certbot on the host proxying to the `web` container, or add TLS to `client/nginx.conf`. Without HTTPS, service workers and `crypto.randomUUID` only work on `localhost`.
- Do not publish MongoDB's port (compose does not).
- Backups: `./scripts/backup.sh` nightly via cron, copy off the server, and test `./scripts/restore.sh` on a spare machine.

## Not built yet

Browser (UI) tests, barcode label printing, product categories/discounts/tax (VAT), supplier purchase orders, multi-till drawer sessions (cash-in/cash-out counts), card terminal integration, and an ESC/POS bridge.
