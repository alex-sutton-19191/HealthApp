# BLUBR

**EAT. TRACK. REPEAT.**

A retro-themed calorie and macro tracker with a cyberpunk/pixel aesthetic. Built as a single-page app with vanilla HTML, CSS, and JavaScript — no frameworks, no build tools.

## Features

- **Calorie & macro tracking** — log daily calories, protein, carbs, and fat
- **AI meal scanner** — snap a photo or describe a meal and let Claude estimate the macros
- **Goal calculator** — personalized calorie targets based on your stats, activity level, and goals
- **Weekly progress** — visual tracking against your weekly calorie budget
- **Weight log & trend chart** — track weigh-ins and see your progress over time
- **Calendar view** — color-coded monthly overview of your logging history
- **Food presets** — save your go-to meals for one-tap logging
- **Progress photos** — track your transformation visually
- **5 themes** — Retro (neon), Slate, Aurora, Midnight, and Clean (light mode)
- **Multi-device sync** — data syncs across devices via Supabase
- **Shame engine** — motivational (?) popups when you go over your red threshold

## Tech Stack

- **Frontend:** Vanilla HTML / CSS / JS
- **Auth & Database:** [Supabase](https://supabase.com) (email/password + Google OAuth)
- **AI:** [Claude API](https://console.anthropic.com) for meal scanning
- **Hosting:** GitHub Pages
- **Fonts:** Press Start 2P (display) + Outfit (body)

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com)

2. **Run the database schema** in the Supabase SQL editor:

   ```sql
   CREATE TABLE user_data (
     id UUID PRIMARY KEY REFERENCES auth.users(id),
     ct_data JSONB DEFAULT '{}',
     ct_macros JSONB DEFAULT '{}',
     ct_notes JSONB DEFAULT '{}',
     ct_refeed JSONB DEFAULT '{}',
     ct_weights JSONB DEFAULT '{}',
     ct_presets JSONB DEFAULT '[]',
     ct_settings JSONB DEFAULT '{}',
     ct_calc JSONB DEFAULT '{}'
   );

   ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "Users can access own data"
     ON user_data FOR ALL
     USING (auth.uid() = id)
     WITH CHECK (auth.uid() = id);
   ```

3. **Enable Google OAuth** in Supabase → Authentication → Providers

4. **Update `app.js`** with your Supabase project URL and anon key (lines 8–9)

5. **Enable GitHub Pages** in your repo settings (branch: `main`, folder: `/`)

6. **Set your Site URL** in Supabase → Authentication → URL Configuration to your GitHub Pages URL

## AI Meal Scanner

The AI scanning feature requires a Claude API key from [console.anthropic.com](https://console.anthropic.com). Enter it in Settings → AI Meal Scanner. The key is stored locally and never synced to the server.

## License

MIT
