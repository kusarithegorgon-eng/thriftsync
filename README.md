# thriftsync

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-bahr8krs)

## Run ThriftSync with MariaDB

The frontend uses a local API connected to MariaDB. It does not connect to
Supabase. Start MariaDB from XAMPP before starting the app.

1. In phpMyAdmin, create a database named `thrifysync`, select it, and import
   [`database/thrifysync.sql`](./database/thrifysync.sql). Import into an empty
   database; the dump creates the marketplace tables and Cebu reference data.
2. Copy `.env.example` to `.env`. Set `MYSQL_PASSWORD` if your MariaDB `root`
   account has a password and replace `AUTH_TOKEN_SECRET` with a private,
   random value of at least 32 characters. Do not commit `.env`.
3. Install Node.js 20 or later, then run `npm install` once to install the app
   and API dependencies.
4. Run `npm run dev:full` from the project folder. This starts the MariaDB API
   and Vite development server. Open the local URL printed by Vite, usually
   `http://localhost:5173`.

The API creates an `app_users` table the first time it starts. Create the first
account through the app's Sign Up page. To grant that account administrator
access, run the following in phpMyAdmin, replacing the email:

```sql
UPDATE profiles
JOIN app_users ON app_users.id = profiles.id
SET profiles.role = 'admin'
WHERE app_users.email = 'your-admin@example.com';
```

The API uses the database specified by `MYSQL_DATABASE` and refuses to start if
the ThriftSync schema has not been imported. The MariaDB server must remain
running while the app is in use.
