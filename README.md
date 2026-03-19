# YieldGuard

Solar system monitoring, analytics, and service provider marketplace.

## Tech Stack

| Layer       | Technology                                    |
|-------------|-----------------------------------------------|
| Frontend    | Next.js 16 (App Router), React 19, Tailwind v4 |
| Backend     | Next.js API Routes + FastAPI (Python)         |
| Database    | Supabase (PostgreSQL, Auth, RLS)              |
| Hosting     | Vercel                                        |
| i18n        | next-intl (EN, HE with RTL)                  |

## Prerequisites

- **Node.js** 20+
- **Python** 3.11+
- **Git**

**For Option A (local database — recommended):**
- **Docker Desktop** — [download](https://www.docker.com/products/docker-desktop/)
- **Supabase CLI**:
  ```bash
  brew install supabase/tap/supabase   # macOS
  ```

**For Option B (cloud database):**
- A [Supabase](https://supabase.com) account (free tier is fine)

---

## Developer Setup

### Step 1: Clone and install dependencies

```bash
git clone https://github.com/azarian/YieldGuard.git
cd YieldGuard
npm install
```

Set up the Python virtual environment:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### Step 2: Set up the database

Choose **one** of the two options below.

#### Option A: Local Supabase (recommended)

Each developer gets a fully isolated local database via Docker. No shared state with other developers or production.

```bash
supabase start
```

This will:
- Start PostgreSQL, GoTrue (Auth), PostgREST (API), and Studio via Docker
- Apply all migrations from `supabase/migrations/`
- Seed the database with test data from `supabase/seed.sql`

When it finishes, it prints the local credentials. You'll need the `API URL` and `anon key`.

**Pre-seeded test user:**

| Field    | Value                    |
|----------|--------------------------|
| Email    | `dev@yieldguard.local`   |
| Password | `password123`            |

#### Option B: Cloud Supabase

If you prefer not to use Docker, create a cloud Supabase project:

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. In **Settings → API**, copy the `Project URL` and `anon public` key.
3. In the **SQL Editor**, run each migration file from `supabase/migrations/` in order (`00001_...`, `00002_...`, etc.).
4. In **Authentication → URL Configuration**, add `http://localhost:3000` to "Redirect URLs".
5. Optionally disable email confirmation: **Authentication → Providers → Email → Confirm email** → off.

### Step 3: Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
# ─── Option A (local Supabase) ───────────────────────────────────
# These defaults work out of the box with `supabase start`:
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0

# ─── Option B (cloud Supabase) ───────────────────────────────────
# Replace with your project credentials from Settings → API:
# NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# ─── Encryption (required for both options) ──────────────────────
# Generate with: openssl rand -hex 32
PORTAL_ENCRYPTION_KEY=<paste-your-64-char-hex-key-here>
```

Generate the encryption key:

```bash
openssl rand -hex 32
```

### Step 4: Start development servers

Run both in separate terminals:

```bash
# Terminal 1: Next.js (frontend + API routes)
npm run dev

# Terminal 2: Python FastAPI (analytics + portal sync)
npm run dev:py
```

Or run both at once (Python runs in background):

```bash
npm run dev:all
```

### Step 5: Open the app

| Service          | URL                         |
|------------------|-----------------------------|
| App              | http://localhost:3000        |
| Supabase Studio  | http://localhost:54323       |
| FastAPI docs     | http://127.0.0.1:8000/docs  |
| Inbucket (email) | http://localhost:54324       |

Sign in with the seeded test user (`dev@yieldguard.local` / `password123`) or create a new account via the signup page.

### Step 6: Stop services when done

```bash
# Stop Supabase (preserves data between sessions)
supabase stop

# Or wipe everything for a fresh start
supabase stop --no-backup
```

---

## Development Workflow

### Branching Strategy

We use **GitHub Flow**:

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/my-feature
   ```
2. Develop and commit your changes.
3. Open a Pull Request to `main`.
4. Vercel automatically creates a **preview deployment** for the PR.
5. After code review, merge to `main` — Vercel deploys to production.

### Database Migrations

All schema changes go through SQL migration files in `supabase/migrations/`. Never modify the database manually in production.

**Creating a new migration:**

```bash
supabase migration new my_feature_name
```

This creates a timestamped file like `supabase/migrations/20260302120000_my_feature_name.sql`. Write your DDL/DML SQL in it.

**Testing your migration locally:**

```bash
# Re-apply all migrations + seed from scratch
supabase db reset
```

**Applying migrations to production** (after merging to `main`):

```bash
supabase link --project-ref <project-id>
supabase db push
```

If you use **Option B** (cloud Supabase), run your new migration SQL manually in the Supabase SQL Editor.

### Adding Translations

The app supports English and Hebrew (RTL). All user-facing strings live in:

- `messages/en.json`
- `messages/he.json`

When adding new features, add keys to **both** files. Use `useTranslations("namespace")` in components.

### Python Service

The FastAPI service in `api/py/` handles analytics computations and SolarEdge portal integration. In production it runs as a Vercel Python serverless function; locally it runs as a uvicorn dev server.

- Add dependencies to `requirements.txt`
- The server auto-reloads on file changes (`--reload` flag)
- API docs are available at http://127.0.0.1:8000/docs

---

## Google OAuth Setup (Optional)

To enable "Sign in with Google" locally:

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create an OAuth 2.0 Client ID (Web application).
3. Add **Authorized JavaScript origins**: `http://localhost:3000`
4. Add **Authorized redirect URIs**: `http://localhost:54321/auth/v1/callback` (local) or `https://<your-project>.supabase.co/auth/v1/callback` (cloud).
5. In Supabase dashboard: **Authentication → Providers → Google** — enable and paste the Client ID and Secret.

For local Supabase, configure Google in `supabase/config.toml` under `[auth.external.google]`.

---

## SolarEdge Integration

The app integrates with SolarEdge in two ways:

### Public API (inverter data)

Users need a **Site ID** and **API Key** from SolarEdge:

1. Log in to [monitoring.solaredge.com](https://monitoring.solaredge.com).
2. Go to **Admin → Site Access → API Access**.
3. Accept the T&C and copy the **API Key**.
4. The **Site ID** is the number in the URL: `monitoring.solaredge.com/solaredge-web/p/site/`**1353684**`/...`

### Portal API (per-optimizer data)

For per-panel/optimizer telemetry, users can optionally provide their SolarEdge portal username and password in **My System → Enhanced Monitoring**. This uses the unofficial portal API documented in `docs/solaredge-api-findings.md`.

---

## Ports Reference

| Port  | Service                   |
|-------|---------------------------|
| 3000  | Next.js dev server        |
| 8000  | Python FastAPI dev server |
| 54321 | Supabase API (PostgREST)  |
| 54322 | Supabase PostgreSQL       |
| 54323 | Supabase Studio (UI)      |
| 54324 | Inbucket (email testing)  |
| 54325 | Inbucket SMTP             |

---

## Environment Variables

| Variable                       | Required | Description                                                   |
|--------------------------------|----------|---------------------------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`     | Yes      | Supabase API URL. Local: `http://127.0.0.1:54321`            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| Yes      | Supabase anonymous/public key                                 |
| `PORTAL_ENCRYPTION_KEY`        | Yes      | 64-char hex key for AES-256-GCM encryption of portal creds   |

---

## Project Structure

```
├── api/py/                    # Python FastAPI service
│   ├── index.py               # Main app: analytics, portal sync endpoints
│   └── solaredge_client.py    # SolarEdge portal API client
├── docs/
│   └── solaredge-api-findings.md  # SolarEdge API research notes
├── messages/                  # i18n translation files (en, he)
├── solaredge-optimizer-telemetry/ # Reference: standalone portal client + docs
├── src/
│   ├── app/
│   │   ├── [locale]/          # Locale-prefixed pages
│   │   │   ├── dashboard/     # Dashboard (analytics), sync, system pages
│   │   │   ├── login/
│   │   │   └── signup/
│   │   └── api/               # Next.js API routes
│   │       └── solar/
│   │           ├── sync/      # Inverter & optimizer data sync
│   │           └── system/    # System registration & portal credentials
│   ├── components/            # Shared UI components (SolarEdgeLogo, etc.)
│   ├── i18n/                  # next-intl configuration
│   └── lib/
│       ├── crypto.ts          # AES-256-GCM encrypt/decrypt
│       └── supabase/          # Supabase client helpers (server, client, middleware)
├── supabase/
│   ├── config.toml            # Supabase CLI local dev config
│   ├── migrations/            # SQL migrations (source of truth for schema)
│   └── seed.sql               # Test data for local development
├── requirements.txt           # Python dependencies
└── .env.local.example         # Environment variable template
```

---

## Production Deployment

Production deploys automatically when code is merged to `main` via Vercel.

**Checklist for production:**

1. Vercel environment variables are set (Supabase production URL, anon key, encryption key).
2. Database migrations are applied: `supabase link && supabase db push`.
3. Supabase Auth redirect URLs include the production domain.
4. Google OAuth redirect URI includes the production Supabase callback URL.

---

## Troubleshooting

**`supabase start` fails:**
- Make sure Docker Desktop is running.
- Try `supabase stop --no-backup` then `supabase start` for a fresh start.

**Port already in use:**
- Kill the process: `lsof -i :<port> | grep LISTEN` then `kill <pid>`.
- Or use different ports via environment/config.

**"MISSING_MESSAGE" errors in the UI:**
- You added a translation key in code but not in `messages/en.json` or `messages/he.json`. Add it to both files.

**Sync fails with "check your API key":**
- The Next.js middleware might be intercepting `/api/` routes. Verify `src/middleware.ts` skips `/api/` paths.

**Python server 502 errors:**
- Check the Python terminal for tracebacks.
- Ensure `requests` is installed: `.venv/bin/pip install -r requirements.txt`.
