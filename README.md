# Hotel Management

A hotel website and operations console for accommodation, availability, reservations, guests, and room service requests. It stores data locally in SQLite. It displays room rates and reservation estimates but does not collect payments or manage a financial ledger.

## Requirements

- Node.js 24 or later
- No package installation is needed

## Run locally

```sh
npm start
```

Open `http://localhost:3000`. Visit `/admin` to create the first administrator, then add property details, accommodation types, physical rooms, rates, and guest services. A new database contains no rooms, guests, reservations, or example hotel content.

The default database is `hotel.sqlite` in the project root. Set `PORT` and `DB_PATH` as environment variables to change the listening port and database location. `npm run dev` restarts the server when its code changes. `npm test` runs API integration tests against a temporary database.

## Optional demonstration data

The repository includes a fictional Douala property, **Maison Wouri (Demo)**, for exploring the website and admin console. Its six accommodation categories, twelve physical rooms, six guest services, and XAF rates are illustrative. It is not a real hotel, and no guest, administrator, reservation, token, or payment data is included. The rates cover stays from 2026-09-17 through 2028-09-16; rate end dates are exclusive. Online booking is disabled for the demo until a real property enables it in the admin settings.

Run these commands against the database selected by `DB_PATH` (or the default `hotel.sqlite`):

```sh
npm run seed:apply
npm run seed:remove
```

The apply command initializes a new database if needed and only seeds a property with an empty catalog. It is safe to rerun. The remove command uses a seed manifest to identify the exact records it created. It refuses to delete seeded rooms or services that real reservations, availability blocks, or service requests refer to, and it refuses to discard catalog records that an administrator has edited. It restores the previous site settings only if those settings are still exactly as the seed left them. Back up your database before removing demonstration content.

`npm run seed:snapshot` regenerates the tracked, sanitized [`database/demo.sqlite`](database/demo.sqlite) from an empty temporary database. The normal live database and its WAL files are ignored by Git. The snapshot is useful for a quick preview or deployment template; copy it to a writable location and set `DB_PATH` to that copy before running the app. Keep live databases and uploaded media out of the repository.

## First administrator and deployment

Set `ADMIN_SETUP_KEY` to a long random secret before exposing a new installation publicly. When configured, the initial setup form requires that key. Without it, setup is allowed only from a loopback connection. The key protects first administrator creation; it is not needed for normal sign-in after setup. Keep the SQLite database and any environment files private, and back up the database regularly.

`CORS_ORIGIN` is optional for a separately hosted frontend. The included frontend is served by the same server, so it does not need CORS.

## Data model and booking rules

- Accommodation types describe capacity, beds, amenities, photos, and public visibility.
- Physical rooms determine actual inventory. A type with no active rooms cannot be booked.
- Rates cover date ranges and are used to calculate a display-only stay estimate.
- Blocks remove rooms from online availability for maintenance or private use.
- Reservations assign one physical room in a SQLite write transaction. Overlapping active reservations and blocks are excluded. Check-out is exclusive, so a new guest may arrive on a previous guest's departure day.
- Guests receive a private reservation URL containing an unguessable token. They can view their stay and submit service requests there.
- Administrators manage reservation and request statuses in the console.
- Site settings control property text, brand colors, navigation labels, section headings, and visibility for About and Contact sections.
- Customer records keep reservation history linked while allowing administrators to correct guest contact details.

All stay dates use `YYYY-MM-DD`. Booking check-in cannot be in the past in the property's configured time zone. Date-range end values are exclusive. Reservation estimates are saved at booking time so later rate changes do not rewrite existing reservations.

## API overview

Public routes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/public/site` | Property settings, visible types and services, setup status |
| GET | `/api/public/availability?checkIn=&checkOut=&adults=&children=` | Capacity and estimated prices |
| POST | `/api/public/reservations` | Create a reservation and private token |
| GET | `/api/public/reservations/:token` | View a reservation and its service requests |
| POST | `/api/public/reservations/:token/requests` | Submit a service request |

Administrator routes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/session` | Check current Bearer token and setup state |
| POST | `/api/admin/setup` | Create first administrator |
| POST | `/api/admin/login` | Sign in |
| POST | `/api/admin/logout` | Revoke current token |
| GET | `/api/admin/state` | Load console data and counts |
| PUT | `/api/admin/settings` | Update property and website settings |
| POST | `/api/admin/media` | Upload a property image and receive its public URL |
| GET, POST, PUT, DELETE | `/api/admin/{types,rooms,rates,blocks,services}` | Manage catalog and inventory |
| PUT | `/api/admin/guests/:id` | Correct guest name, email, or phone without losing stay history |
| PUT | `/api/admin/reservations/:id` | Update reservation status |
| PUT | `/api/admin/requests/:id` | Update service request status |
| GET | `/api/admin/audit` | Review recent administrator changes |

Administrator routes after setup require `Authorization: Bearer <token>`. JSON errors use `{ "error": "message" }`. Login, setup, reservations, and service requests have per-IP rate limits and respond with `429` plus `Retry-After` when exceeded.

### Image uploads

Send JSON to `POST /api/admin/media` with `filename`, `mime_type`, and raw `data_base64` (without a data URL prefix). Only PNG, JPEG, and WebP files up to 5 MiB are accepted. The server validates file signatures, stores them with random names under `public/uploads/`, and returns `{ "url": "/uploads/…" }`. Paste or select that URL for a property logo, hero image, or accommodation image. Uploaded files are local data and are excluded from Git; include `public/uploads/` in backups alongside the SQLite database.
