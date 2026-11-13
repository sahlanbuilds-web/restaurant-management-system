# Authentication and access setup

## Database migration

- Fresh database: apply `database.sql`.
- Original legacy database: back it up, then apply `database_upgrade.sql` once.
- Database already upgraded to the earlier POS release: apply `database_auth_upgrade.sql` and `database_addons_upgrade.sql` once each. Back up first.

Do not apply an upgrade script to a database that already has the columns and tables it adds.

## Server configuration

Copy `.env.example` to `.env` and set the database credentials. `APP_ORIGINS` must contain the exact frontend origins, comma-separated; include the LAN address staff use to open the POS. The frontend targets the API at the same hostname on port `5000` unless `VITE_API_URL` is set.

For XAMPP, start Apache and MySQL, then start the Node API from the project directory with `npm run start:api`. The API must remain running on port `5000`; Apache does not run the Node backend automatically. Run `npm run build` after frontend changes and open `http://localhost/POS%20new/dist/` (or `http://localhost/POS%20new/`, which redirects there). The local Apache origins `http://localhost` and `http://127.0.0.1` are allowed automatically.

The session cookie is HttpOnly and SameSite Strict. Set `COOKIE_SECURE=true` only when serving the POS over HTTPS. Plain HTTP is suitable only for a trusted local development network, not internet-facing deployment.

Sign-in failures are rate-limited per client IP and email: up to 10 failures for one email from one IP, and up to 30 failures from one IP, within a 15-minute window. Limits are held in server memory and reset when the API process restarts; deployments running multiple API instances should use a shared rate-limit store.

## Staff roles

- `Admin`: menu and cost management, staff data, financial metrics, and all operational screens.
- `Cashier`: orders and payments.
- `Waiter`: orders, payments, and table status.
- `Kitchen`: preparation tickets only.

API endpoints enforce these permissions independently of the navigation visibility. Existing plaintext staff passwords are converted to scrypt hashes the first time each account signs in successfully.
