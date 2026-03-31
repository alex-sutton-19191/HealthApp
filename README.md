# BLUBR

**EAT. TRACK. REPEAT.**

BLUBR is a retro-neon calorie and macro tracker built as a lightweight single-page web app. No frameworks, no build tools, no `npm install` — just vanilla HTML, CSS, and JavaScript served straight from GitHub Pages.

It syncs across devices via Supabase, supports AI-powered meal scanning via the Claude API, and can be installed as a PWA on iOS and Android for a native app-like experience.

---

## Features

### Core Tracking
- **Calorie & macro logging** — track calories, protein, carbs, and fat per meal
- **Per-meal history** — edit or delete individual meals; see a full breakdown for any day
- **Food presets** — save your go-to meals for one-tap re-logging
- **Quick re-log** — instantly re-log your most recent meal from the home screen
- **Daily notes** — add freeform notes to any day

### AI Meal Scanner
- Describe a meal in plain text or snap a photo
- Claude estimates calories and macros automatically
- API key is stored locally on your device — never sent to the server

### Goals & Analytics
- **Goal calculator** — personalized calorie targets based on your stats, activity level, and weight goal
- **Weekly budget** — visual progress bar showing calories consumed vs. your weekly target
- **Calorie banking** — under-eat on weekdays and bank the surplus for chosen days (e.g., weekends)
- **TDEE trending** — adaptive TDEE estimates calculated from your weight and intake history
- **Energy balance** — see your cumulative surplus/deficit over time

### Progress Tracking
- **Weight log** — log weigh-ins with a smoothed trend line chart
- **Progress photos** — track your transformation with dated photos (compressed and stored in-app)
- **Calendar view** — color-coded monthly overview (green = under goal, red = over, yellow = refeed)
- **Streak grid** — visual consistency tracker for your last 7 days

### Themes
Five built-in themes: **Retro** (neon green), **Slate**, **Aurora**, **Midnight**, and **Clean** (light mode).

### Other
- **Refeed day toggle** — mark planned high-calorie days so they don't count against your goal
- **Shame engine** — motivational popups when you exceed your red threshold
- **Coach countdown** — configurable check-in day reminders
- **PWA support** — installable on iOS (Add to Home Screen) and Android with offline caching
- **Multi-device sync** — all data syncs across devices via Supabase

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML / CSS / JS (single-page app, ~5k lines total) |
| Auth & Database | [Supabase](https://supabase.com) — email/password + Google OAuth |
| AI | [Claude API](https://console.anthropic.com) — meal photo/text analysis |
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

**Meal logging:** All logging flows (quick log, AI scan, presets) go through `_addMeal()`, which records individual meals with timestamps. `_recalcDay()` recomputes daily totals and macro sums from the meal array.

**Data is stored as JSONB columns** in a single `user_data` row per user — one column per data type (calories, meals, weights, settings, etc.). Row-level security ensures users can only access their own data.

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

Replace the Supabase URL and anon key at the top of `app.js` (lines 8–9) with your project's credentials.

### 5. Deploy

Enable **GitHub Pages** in your repo settings (branch: `main`, folder: `/`). That's it — no build step required.

---

## AI Meal Scanner Setup

The AI scanning feature uses the Claude API. To enable it:

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In the app, go to **Settings → AI Meal Scanner** and paste your key
3. The key is stored in your browser's local storage only — it is never synced to Supabase or sent anywhere except directly to the Claude API

---

## PWA / Mobile Install

BLUBR is a Progressive Web App. To install it on your phone:

- **iOS:** Open in Safari → tap Share → **Add to Home Screen**
- **Android:** Open in Chrome → tap the install banner or menu → **Install app**

The app launches fullscreen with no browser chrome and caches its shell for offline loading.

---

## License

MIT
