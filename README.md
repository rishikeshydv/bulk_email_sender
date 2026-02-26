# Gmail Bulk Email Sender Agent

Next.js app (UI + API routes) for sending Gmail emails individually to selected recipients stored in Postgres.

## Features

- Next.js UI to manage recipients, select specific emails or select all filtered
- Subject + body composer
- Sends one email per recipient (sequentially) via Gmail using Nodemailer
- Postgres storage for recipients, campaigns, and per-recipient delivery logs
- Next.js API routes (`src/pages/api/*`)
- Railway-ready config (`railway.json`)

## Environment Variables

Create `.env.local` for local dev (and set the same variables in Railway):

```bash
DATABASE_URL="postgresql://..."
GMAIL_USER="you@gmail.com"
GMAIL_APP_PASSWORD="google-app-password"
GMAIL_FROM_NAME="Your Name"
GMAIL_REPLY_TO="you@gmail.com"
```

Notes:

- `GMAIL_APP_PASSWORD` requires Google 2FA + an App Password (recommended for this setup).
- Gmail send limits still apply.

## Local Development

```bash
npm install
npm run db:push
npm run dev
```

Open `http://localhost:3000`.

## Railway Deployment (High-level)

1. Create a Railway project and add a Postgres service.
2. Deploy this app service.
3. Set env vars (`DATABASE_URL`, Gmail variables) in the app service.
4. Run `npm run db:push` once (or rely on the `start` script which runs it before `next start`).

## API Routes

- `GET/POST/DELETE /api/recipients`
- `GET /api/campaigns`
- `POST /api/send`
