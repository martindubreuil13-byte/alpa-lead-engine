# Quebec Prospecting Desk

A lightweight lead scraping and prospecting manager for Quebec small business prospecting. Scrape only public directory listings, review leads, and send manual prospecting emails one by one.

## Features
- Supabase Auth + Postgres data storage
- Lead table + kanban views
- Manual email composer with templates
- Follow-up due tracking (7 days after first contact)
- Search-based and directory-based scraping (public listings only)
- Deduplication by email, website, and company + city

## Tech Stack
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui primitives
- Supabase Postgres + Auth
- Nodemailer (SMTP)
- Playwright + Cheerio scraping

## Local Setup
1. Install dependencies
```
npm install
```

2. Create `.env.local` from `.env.example`
```
cp .env.example .env.local
```

3. Add Supabase project keys to `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

4. Apply the database schema
- Open your Supabase SQL editor and run `supabase/schema.sql`.

5. Install Playwright browsers (required for scraping locally)
```
npx playwright install
```

6. Run the app
```
npm run dev
```

App will be available at `http://localhost:3000`.

## Supabase Notes
- Row Level Security is enabled for all tables.
- Data is scoped to the authenticated user by policy.

## SMTP Settings
Go to `/settings` in the app and add SMTP credentials. Emails are sent manually one at a time; no bulk sending or automation is included.

## Scraper Notes
- Only scrape public business directories and public listings.
- Use search-result URLs or directory/category pages as the starting URL.
- Adjust “Listing URL contains” to match the listing URL pattern of your chosen directory.

If a directory is JavaScript-heavy, results may be limited. You can increase `maxPages` or use a simpler public directory.

## Vercel Deployment
1. Push the repo to GitHub.
2. Create a new Vercel project and import the repo.
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `PLAYWRIGHT_BROWSERS_PATH=0`
4. Set Build Command: `npm run build`
5. Set Output: default (Next.js)

Important: Playwright in serverless environments can be heavy. If you hit build issues, deploy scraping as a separate worker or run scrapes locally. The UI and database will continue to work on Vercel.

## Project Structure
```
app/
  (auth)/login
  (app)/dashboard
  (app)/leads
  (app)/kanban
  (app)/scraper
  (app)/templates
  (app)/settings
  api/
components/
  auth/
  layout/
  lead/
  scraper/
  settings/
  templates/
  ui/
lib/
  actions/
  scrape/
  supabase/
  constants.ts
supabase/
  migrations/
  schema.sql
```
<!-- deploy test -->