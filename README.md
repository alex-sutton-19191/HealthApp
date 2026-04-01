# BLUBR

**EAT. TRACK. REPEAT.**

BLUBR is a retro-neon calorie and macro tracker built as a lightweight single-page web app. No frameworks, no build tools, no `npm install` — just vanilla HTML, CSS, and JavaScript served straight from GitHub Pages.

It syncs across devices via Supabase, supports AI-powered meal scanning and coaching via the Claude API, and can be installed as a PWA on iOS and Android for a native app-like experience.

---

## Features

### Core Tracking
- **Calorie & macro logging** — track calories, protein, carbs, and fat per meal
- **Per-meal history** — edit or delete individual meals; see a full breakdown for any day
- **Food presets** — save your go-to meals for one-tap re-logging
- **Quick re-log** — instantly re-log your most recent meal from the home screen via the Copy Meal card
- **Daily notes** — add freeform notes to any day
- **Refeed day toggle** — mark planned high-calorie days so they don't count against your goal

### AI Features
- **Meal scanner** — describe a meal in plain text or snap a photo, and Claude estimates calories and macros automatically. API key is stored locally on your device — never sent to the server.
- **Weekly AI coach** — scheduled check-ins on your chosen day of the week. Analyzes your calorie trends, weight changes, consistency, and weekly progress, then provides personalized advice and encouragement.
- **Recovery AI** — detects gaps in your logging over the last 7 days and helps you fill them in. Describe what you ate, or choose a quick estimate (under-ate, on track, over-ate) and the AI fills in the blanks.

### Goals & Analytics
- **Goal calculator** — personalized daily calorie targets using the Mifflin-St Jeor equation, adjusted for activity level and pace. Two modes: **By Target Weight** (calculates a timeline) and **By Body Fat %** (targets based on composition).
- **Weekly budget** — visual progress bar showing calories consumed vs. your weekly target, with daily expected pace tracking.
- **Calorie banking** — under-eat on weekdays and bank the surplus for chosen days (e.g., Friday/Saturday/Sunday). Banked amount is calculated automatically and added to your budget on those days.
- **Adaptive TDEE** — your Total Daily Energy Expenditure, calculated from actual weight changes and calorie intake over time. More accurate than static calculators because it adapts to your body. Requires 14+ days of calorie data and 5+ weight entries.

### Charts & Visualization
All charts are SVG-based and responsive.

- **Weight trend** — line chart with raw data points and an EMA-smoothed trend line to filter out daily fluctuations
- **TDEE trend** — shows your calculated adaptive TDEE over time
- **Energy balance** — dual-line chart (intake vs. TDEE) with shaded surplus/deficit regions over the last 60 days
- **Goal waterfall** — bar chart showing daily weight changes toward or away from your goal
- **Calorie history** — 30-day line chart with your goal threshold line
- **Macro breakdown** — 30-day stacked bar chart showing protein, carbs, and fat

### Progress Tracking
- **Weight log** — log weigh-ins with optional metric/imperial toggle
- **Progress photos** — track your transformation with dated photos (compressed and stored in-app, synced to cloud)
- **Calendar view** — color-coded monthly overview (green = under goal, red = over, yellow = refeed, purple dot = has notes)
- **Day streak** — consecutive days of logging, displayed on the Progress page
- **Streak grid** — visual consistency tracker for your last 7 days on the home screen

### History & Search
- **Searchable data log** — browse all logged days with filtering by date, notes, or calorie ranges (supports queries like `>2000` or `<1500`)
- **Table view** showing date, calories, macros, weight, and notes for each day

### Themes
Five built-in color themes:

| Theme | Vibe |
|-------|------|
| **Retro** | Neon green on dark — the default |
| **Slate** | Cool blue/indigo tones |
| **Aurora** | Cyan, purple, and green |
| **Midnight** | Yellow, purple, and green |
| **Clean** | Light mode for daylight use |

### Dashboard Customization
Toggle individual cards on or off in Settings:

- TDEE Trend
- Weekly Budget
- Macro Rings
- Streak Grid
- Energy Balance
- Goal Waterfall
- Smoothed Weight
- Copy Meal
- Coach Countdown

### Other
- **Shame engine** — playful motivational popups when you exceed your red threshold (only triggers for today, not refeed days)
- **Coach countdown** — configurable check-in day with countdown displayed on the home screen
- **CSV export/import** — backup and restore all your data
- **PWA support** — installable on iOS (Add to Home Screen) and Android with offline caching via service worker
- **Multi-device sync** — all data syncs across devices via Supabase

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML / CSS / JS (single-page app, ~3 files) |
| Auth & Database | [Supabase](https://supabase.com) — email/password + Google OAuth |
| AI | [Claude API](https://console.anthropic.com) — meal scanning, coaching, and recovery estimates |
| Hosting | GitHub Pages (static files, no build step) |
| Fonts | [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (display) + [Outfit](https://fonts.google.com/specimen/Outfit) (body) |
| PWA | Service worker with cache-first strategy for offline support |

---

## Architecture

The entire app lives in three files:

```
index.html   — all HTML markup (pages, modals, bottom sheets)
app.js       — all application logic, data layer, and rendering
styles.css   — all styling including themes, animations, and responsive layout
```

**Data layer:** An in-memory cache (`_cache`) holds all user data and syncs to Supabase via a debounced upsert. Reads are synchronous (`ls(key)`), writes are instant locally and flush async (`lsSet(key, val)`).

**Meal logging:** All logging flows (quick log, AI scan, presets, recovery) go through `_addMeal()`, which records individual meals with timestamps. `_recalcDay()` recomputes daily totals and macro sums from the meal array.

**Data is stored as JSONB columns** in a single `user_data` row per user — one column per data type (calories, meals, weights, settings, etc.). Row-level security ensures users can only access their own data.

**UI pattern:** Bottom navigation with 5 pages and a center FAB (floating action button) that opens a quick-add sheet with tiles for Quick Log, Scan Meal, Progress Photo, and Weigh In. Day modals convert to bottom sheets on mobile (< 600px).

---

## Setup

### 1. Create a Supabase project

Sign up at [supabase.com](https://supabase.com) and create a new project.

### 2. Run the database schema

In the Supabase SQL editor, run:

```sql
CREATE TABLE user_data (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  ct_data JSONB DEFAULT '{}',
  ct_macros JSONB DEFAULT '{}',
  ct_meals JSONB DEFAULT '{}',
  ct_notes JSONB DEFAULT '{}',
  ct_refeed JSONB DEFAULT '{}',
  ct_weights JSONB DEFAULT '{}',
  ct_presets JSONB DEFAULT '[]',
  ct_settings JSONB DEFAULT '{}',
  ct_calc JSONB DEFAULT '{}',
  ct_photos JSONB DEFAULT '{}',
  ct_tdee JSONB DEFAULT '{}',
  ct_coach JSONB DEFAULT '[]'
);

ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own data"
  ON user_data FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
```

### 3. Configure authentication

- In Supabase → Authentication → Providers, enable **Google OAuth** (optional)
- In Supabase → Authentication → URL Configuration, set your **Site URL** to your GitHub Pages URL

### 4. Update app.js

Replace the Supabase URL and anon key at the top of `app.js` with your project's credentials.

### 5. Deploy

Enable **GitHub Pages** in your repo settings (branch: `main`, folder: `/`). That's it — no build step required.

---

## AI Setup

The AI features (meal scanning, weekly coach, recovery estimates) all use the Claude API.

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In the app, go to **Settings → AI Meal Scanner** and paste your key
3. The key is stored in your browser's local storage only — it is never synced to Supabase or sent anywhere except directly to the Claude API
4. Estimated cost: ~$0.01 per AI scan

---

## PWA / Mobile Install

BLUBR is a Progressive Web App. To install it on your phone:

- **iOS:** Open in Safari → tap Share → **Add to Home Screen**
- **Android:** Open in Chrome → tap the install banner or menu → **Install app**

The app launches fullscreen with no browser chrome and caches its shell for offline loading.

---

## License

MIT
