# YieldGuard

Solar system monitoring and service provider marketplace built with **Next.js**, **Supabase**, and **Tailwind CSS**.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 16 (App Router) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Styling | Tailwind CSS v4 |
| Hosting | Vercel |

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A [Supabase](https://supabase.com) account (free tier works)

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd YieldGuard
npm install
```

### 2. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Once the project is ready, go to **Settings → API** and copy:
   - **Project URL** (e.g. `https://abc123.supabase.co`)
   - **anon public key**
3. Create a `.env.local` file in the project root (use `.env.local.example` as a template):

```bash
cp .env.local.example .env.local
```

4. Fill in your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Run the Database Migration

In the Supabase Dashboard, go to **SQL Editor** and run the contents of:

```
supabase/migrations/00001_create_profiles.sql
```

This creates the `profiles` table with Row-Level Security policies.

### 4. Configure Supabase Auth

In the Supabase Dashboard, go to **Authentication → URL Configuration** and add:
- **Site URL**: `http://localhost:3000` (for local development)
- **Redirect URLs**: `http://localhost:3000/**`

### 5. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deploying to Vercel

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) and click **"Add New" → "Project"**.
3. Import your GitHub repository.
4. In the Vercel project settings, add the environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Click **Deploy**.
6. After deployment, copy your Vercel production URL (e.g. `https://yieldguard.vercel.app`).
7. In the Supabase Dashboard, go to **Authentication → URL Configuration** and add your production URL:
   - **Site URL**: `https://yieldguard.vercel.app`
   - **Redirect URLs**: `https://yieldguard.vercel.app/**`

Every subsequent `git push` to `main` will trigger an automatic redeployment.

## Project Structure

```
src/
├── app/
│   ├── auth/signout/route.ts   # Sign-out API route
│   ├── dashboard/page.tsx      # Protected, role-aware dashboard
│   ├── login/page.tsx          # Login form
│   ├── signup/page.tsx         # Sign-up form with role picker
│   ├── globals.css             # Global styles
│   ├── layout.tsx              # Root layout with Navbar
│   └── page.tsx                # Public landing page
├── components/
│   └── Navbar.tsx              # Auth-aware navigation bar
├── lib/supabase/
│   ├── client.ts               # Browser Supabase client
│   └── server.ts               # Server-side Supabase client
└── middleware.ts                # Auth guard for protected routes
supabase/
└── migrations/
    └── 00001_create_profiles.sql
```

## User Roles

| Role | Description |
|------|-------------|
| `owner` | Solar system owner (home or small business) |
| `provider` | Service provider (cleaning, maintenance, etc.) |
| `admin` | Platform administrator (set manually in Supabase) |

> **Note**: The `admin` role cannot be selected during sign-up. To make a user an admin, update their `role` directly in the Supabase `profiles` table.
