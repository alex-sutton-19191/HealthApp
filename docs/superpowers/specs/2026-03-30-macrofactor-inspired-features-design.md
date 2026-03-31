# BLUBR — MacroFactor-Inspired Features Design Spec

**Date:** 2026-03-30
**Status:** Approved

## Overview

Add MacroFactor-inspired intelligence and UX features to BLUBR in two phases: Phase 1 focuses on UX & dashboard enhancements (immediate usability wins), Phase 2 adds an intelligence layer (adaptive TDEE, AI coaching, missed-day recovery). All features are toggleable via settings.

## Architecture Constraints

- Vanilla HTML/CSS/JS — no frameworks, no build tools
- Single-page app: `index.html`, `app.js`, `styles.css`
- Data layer: in-memory `_cache` synced to Supabase via `lsSet()`
- AI: Claude API (key stored locally, never synced)
- Existing data keys stored as JSONB columns in Supabase `user_data` table

## New Data Keys

Two new JSONB columns added to the `user_data` Supabase table:

| Key | Shape | Purpose |
|---|---|---|
| `ct_tdee` | `{YYYY-MM-DD: number}` | Daily adaptive TDEE estimates |
| `ct_coach` | `[{date, summary, recommendedCal, recommendedP, recommendedC, recommendedF, tip, adjustmentReason, accepted}]` | Weekly coach history |

## Existing Data Key Changes

`ct_settings` gains new fields:

```json
{
  "features": {
    "tdeeTrend": true,
    "weeklyBudget": true,
    "macroRings": true,
    "streakGrid": true,
    "energyBalance": true,
    "goalWaterfall": true,
    "smoothedWeight": true,
    "copyMeal": true,
    "coachCountdown": true
  },
  "weekendBinge": {
    "enabled": false,
    "days": []
  },
  "coachDay": 1,
  "weekStartDay": 1
}
```

- `features`: Dashboard card visibility toggles. All default to `true`.
- `weekendBinge.enabled`: Whether calorie banking is active.
- `weekendBinge.days`: Array of day numbers (5=Friday, 6=Saturday, 0=Sunday) the user wants extra calories on.
- `coachDay`: Day of week for Claude coaching check-in (0=Sun through 6=Sat). Default Monday (1).
- `weekStartDay`: Start of the tracking week (0=Sun through 6=Sat). Default Monday (1).

`ct_meals` entries gain an optional `estimated: true` flag for meals created via missed-day recovery estimation.

**Critical implementation note — settings persistence:** The current `saveSettings()` function constructs a fresh object with only `{weekly, green, red, macroP, macroC, macroF, useMetric}`, which would destroy the new nested fields. `saveSettings()` must be refactored to use a read-modify-write pattern: read existing settings via `ls('ct_settings', {})`, merge in the changed fields, then write back. Each settings section (basic goals, features, weekend binge, coach) should independently merge into the existing object.

**Implementation note — `_addMeal()` extension:** `_addMeal()` currently pushes a fixed shape `{name, cal, p, c, f, ts}`. It needs an optional `opts` parameter to support the `estimated` flag: `_addMeal(dateKey, name, cal, p, c, f, opts)` where `opts` can include `{ estimated: true }`. The flag is spread into the meal object when present.

---

## Phase 1: UX & Dashboard Enhancements

### 1.1 Three-Tier Day Coloring

**Current behavior:** Days are green (under daily target) or red (over daily target).

**New behavior:** Three tiers based on relationship to both goal and TDEE:

| Color | Condition | Meaning |
|---|---|---|
| Green | calories <= daily goal | In deficit, on track |
| Yellow | daily goal < calories <= TDEE | Above goal but below expenditure (still in deficit or maintenance) |
| Red | calories > TDEE | True surplus, gaining weight territory |

**TDEE source:** Uses adaptive TDEE (`ct_tdee`) if available (14+ days data), otherwise falls back to static TDEE re-derived from `ct_calc` inputs by rerunning the Mifflin-St Jeor + activity multiplier calculation (BMR * activity level). This avoids stale cached values — the TDEE is always computed fresh from the stored profile inputs.

**Applies to:**
- Calendar grid cells
- "Last 7 Days" strip on home page
- History page rows
- Day modal header
- Calorie history bar chart (Progress page)

**Implementation notes:**
- New function `getDayColor(date, calories)` returns `'green'`, `'yellow'`, or `'red'`
- Uses `getSettings()` for daily goal, adaptive TDEE or calculated TDEE for expenditure threshold
- Yellow uses `var(--yellow)` from existing theme system
- Legend on calendar page updated to show all three tiers
- Day modal header needs a new `.yellow` CSS class/code path alongside existing green/red logic

### 1.2 Weekend Binge (Calorie Banking)

Allows users to "bank" unspent calories from weekdays and redistribute them to chosen weekend days.

**Settings UI:**
- Toggle: "Enable Weekend Binge"
- When enabled, shows multi-select checkboxes: Friday / Saturday / Sunday
- Shows current week's banked calories in real-time

**Calculation logic:**

```
week_start = most_recent_occurrence_of(weekStartDay)
weekdays = dates from week_start to yesterday that are NOT in binge_days
banked = sum of max(0, daily_goal - actual_calories) for each weekday
remaining_binge_days = selected binge_days that haven't passed yet
bonus_per_binge_day = banked / count(remaining_binge_days)
adjusted_binge_goal = daily_goal + bonus_per_binge_day
```

- Only positive differences bank (if you overate on a weekday, it doesn't subtract)
- Banked calories only apply to binge days that haven't passed yet
- The "Today" card on home page shows the adjusted goal on binge days: "Daily Goal: 2,100 (1,800 + 300 banked)"
- Weekly budget bar visualizes the banking: weekday segments show how much was banked, binge day segments show the inflated budget

**Edge cases:**
- If no binge days are selected, toggle auto-disables
- If all binge days have passed, banked shows as "unused" with no redistribution
- Week boundary respects `weekStartDay` setting
- Changing `weekStartDay` takes effect immediately; the current week recalculates from the new start day. No historical data is affected.

### 1.3 Copy Meal to Another Day

**Interaction:**
1. In the day modal meal list, each meal row gets a copy icon button (right side, next to edit/delete)
2. Tapping copy opens a small popover with three options:
   - "Today" — copies meal to today
   - "Tomorrow" — copies meal to tomorrow
   - "Pick date..." — opens a date input
3. Selecting a target date:
   - Adds the meal (name, cal, p, c, f) to the target day's `ct_meals` array with a new timestamp
   - Calls `_recalcDay()` on the target date
   - Shows a brief toast confirmation: "Copied [meal name] to [date]"

**Implementation notes:**
- Reuses existing `_addMeal()` function with the copied meal's data
- Copy icon uses the same style as existing edit/delete icons in meal rows
- On mobile (< 600px), where the day modal is a bottom sheet, the copy popover should render as a small action menu anchored to the button rather than a floating popover, to avoid z-index/overflow issues within the sheet

### 1.4 Feature Toggle Settings

New section in the Settings page: **"Dashboard Features"**

A list of labeled toggles, one per dashboard card:

| Toggle Label | Key | Default |
|---|---|---|
| TDEE Trend | `tdeeTrend` | on |
| Weekly Calorie Budget | `weeklyBudget` | on |
| Macro Rings | `macroRings` | on |
| Streak & Consistency | `streakGrid` | on |
| Energy Balance | `energyBalance` | on |
| Goal Waterfall | `goalWaterfall` | on |
| Smoothed Weight Trend | `smoothedWeight` | on |
| Quick Copy Meal | `copyMeal` | on |
| Coach Countdown | `coachCountdown` | on |

Each toggle controls whether the corresponding card renders on its page. Cards check `getSettings().features[key]` before rendering.

### 1.5 New Dashboard Cards (Phase 1)

These cards are pure data visualization — no AI or algorithm required.

#### Weekly Calorie Budget Bar (Home Page)

Replaces or supplements the existing weekly progress section.

- Horizontal stacked bar showing: consumed (filled) vs remaining (empty) for the week
- If weekend binge is enabled, binge-day segments are visually distinct (striped or highlighted) showing base + banked allocation
- Numeric labels: "X of Y consumed (Z banked for [days])"

#### Macro Rings (Home Page — Today Card)

Three circular progress rings replacing or augmenting the current numeric macro display:

- Protein ring (pink, `#f472b6`)
- Carbs ring (blue, `#60a5fa`)
- Fat ring (yellow, `#fbbf24`)
- Each ring shows grams consumed / grams target
- Center of each ring shows the percentage

Implemented as SVG circles with `stroke-dasharray` / `stroke-dashoffset` animation.

#### Streak & Consistency Grid (Progress Page)

GitHub-style contribution heatmap:

- Grid of small squares, one per day, showing the last 90-120 days
- Binary coloring: logged = themed green, not logged = dim/empty. No intensity gradient — simplicity over granularity.
- Current streak count displayed prominently above the grid
- Uses green from the current theme (`var(--green)`)

#### Copy Last Meal Card (Home Page)

Small card showing:
- Name and calories of the most recently logged meal
- "Log again" button that adds it to today with one tap
- Only appears if there's a recent meal to copy

#### Smoothed Weight Trend (Progress Page — upgrades existing chart)

Enhances the existing weight trend SVG chart:

- Raw weight entries shown as dots (current behavior)
- Adds an exponential moving average (EMA) trend line overlaid on top
- EMA smoothing factor: ~0.1 (10-day effective window)
- Trend line is thicker and more prominent than the raw dots
- This same EMA calculation feeds into the adaptive TDEE algorithm in Phase 2

---

## Phase 2: Intelligence Layer

### 2.1 Adaptive TDEE Algorithm

Client-side algorithm that estimates real energy expenditure from weight + intake data.

**Algorithm: Exponential Moving Average Energy Balance**

```
// Inputs (daily)
weight_ema = exponential_moving_average(ct_weights, alpha=0.1)
intake_ema = exponential_moving_average(ct_data, alpha=0.1)

// Core calculation
// 1 lb of body weight ≈ 3,500 calories
daily_weight_change = weight_ema[today] - weight_ema[yesterday]  // in lbs
// If useMetric is enabled, convert: daily_weight_change_lbs = daily_weight_change_kg * 2.205
daily_energy_from_weight = daily_weight_change * 3500  // calories stored/released

// TDEE = what you ate + what you lost (or - what you gained)
estimated_tdee = intake_ema + (-daily_energy_from_weight)
```

**Smoothing and confidence:**
- TDEE estimate itself is smoothed with EMA (alpha=0.05) to prevent daily swings
- Minimum data requirement: 14 days of calorie data + 5 weight entries
- Before threshold: falls back to static TDEE re-derived from `ct_calc` profile inputs (Mifflin-St Jeor * activity multiplier)
- Confidence band displayed on chart: wider with less data, narrows over time
- Confidence is based on data density (how many of the last 28 days have both weight + calorie entries)

**Storage:** Each day's estimate saved to `ct_tdee[YYYY-MM-DD]` via `lsSet()`.

**Recalculation trigger:** Runs whenever `_recalcDay()` is called or a weight is logged. Recalculates the last 28 days of estimates to incorporate new smoothed data. Debounced with the same 1.5s delay as `lsSet()` to avoid excessive recalculation during rapid meal logging.

**Dashboard card (Progress page):**
- Line chart showing TDEE trend over the last 60 days
- Shaded confidence band
- Horizontal reference line showing static TDEE from calculator (for comparison)
- Current estimate displayed as a large number: "Estimated TDEE: 2,340 cal/day"

### 2.2 Claude Weekly Coach

AI-powered weekly check-in that analyzes the user's data and recommends adjustments.

**Settings:**
- "Coach Check-in Day" — dropdown selecting day of week (default: Monday)
- Stored in `ct_settings.coachDay`

**Trigger:** When the user opens the app on their check-in day and hasn't had a check-in this week yet (where "this week" is defined by the `weekStartDay`-anchored week, same as calorie banking). A coach modal appears.

**Data payload sent to Claude:**

```json
{
  "period": "2026-03-24 to 2026-03-30",
  "dailyCalories": {"2026-03-24": 1850, "...": "..."},
  "dailyMacros": {"2026-03-24": {"p": 140, "c": 200, "f": 65}, "...": "..."},
  "weightEntries": {"2026-03-25": 195.2, "2026-03-28": 194.8},
  "goal": {"type": "cut", "pace": "1 lb/week", "dailyTarget": 1800},
  "adaptiveTDEE": 2340,
  "weekendBinge": {"enabled": true, "bankedUsed": 450},
  "adherence": {"daysLogged": 6, "daysOnTarget": 4, "avgCalories": 1920}
}
```

**System prompt instructs Claude to:**
- Be encouraging and adherence-neutral (no shaming)
- Provide a 2-3 sentence performance summary
- Recommend calorie/macro adjustments only if data supports it
- Give one specific, actionable tip for the coming week
- Return structured JSON

**Response format:**

```json
{
  "summary": "You stayed close to target most of the week...",
  "recommendedCal": 1750,
  "recommendedP": 145,
  "recommendedC": 190,
  "recommendedF": 60,
  "tip": "Try prepping your weekday lunches on Sunday...",
  "adjustmentReason": "Your TDEE is trending slightly lower..."
}
```

**User flow:**
1. Coach modal slides up (bottom sheet on mobile, centered modal on desktop)
2. Header: "Weekly Check-in — [date range]"
3. Summary text displayed
4. If adjustments recommended: shows current vs. recommended targets side-by-side
5. Two buttons: **"Accept Changes"** (applies new targets to `ct_settings`) or **"Keep Current"**
6. Tip displayed below in a styled callout
7. Check-in saved to `ct_coach` array

**Cost:** ~500-800 tokens per call. One call per week.

### 2.3 Missed Day Recovery

**Trigger:** When the user opens the app, check `ct_data` for any gaps in the last 7 days (days with no meals logged). If gaps exist and the user hasn't already dismissed the prompt for those dates, show the recovery popup.

**User flow:**
1. Popup/modal: "You missed logging on [date(s)]. Want to fill in the gaps?"
2. Each missed day shown as a row with three options:
   - **"Describe"** — text input appears. User types what they ate (e.g., "pizza and beer for dinner, skipped lunch"). Sent to Claude for estimation. Returns estimated calories + macros, saved as a meal with `estimated: true` flag.
   - **"Estimate"** — three buttons: "Under ate" / "On track" / "Over ate"
     - Under ate: logs `daily_goal * 0.8`
     - On track: logs `daily_goal`
     - Over ate: logs `daily_goal * 1.3`
     - Saved as a single meal named "Estimated" with `estimated: true`
   - **"Skip"** — leaves the day empty
3. "Done" button closes the popup

**Visual indicator:** Days with estimated data show a subtle dotted border or "~" icon in the calendar, history, and charts so the user knows it's approximate.

**Dismiss tracking:** Store dismissed dates in `sessionStorage` so the popup doesn't re-appear during the same session, but will re-appear next session if days are still empty.

### 2.4 Remaining Dashboard Cards (Phase 2)

#### Energy Balance Chart (Progress Page)

Dual-line chart overlaying intake vs. expenditure:

- Line 1 (cyan): Daily calorie intake (smoothed with 7-day moving average)
- Line 2 (purple): Adaptive TDEE estimate
- Shaded area between lines: green when intake < TDEE (deficit), red when intake > TDEE (surplus)
- X-axis: last 60 days
- Requires adaptive TDEE data to render; hidden until 14+ days of data

#### Goal Progress Waterfall (Progress Page)

MacroFactor-inspired waterfall bar chart:

- Each bar represents a day (or week, togglable)
- Light/bright bars: weight moved toward goal (e.g., lost weight during a cut)
- Dark/muted bars: weight moved away from goal (e.g., gained weight during a cut)
- Cumulative progress line overlaid
- Uses smoothed weight data to avoid noise
- Requires goal weight set in calculator + 7+ weight entries

#### Coach Countdown Card (Home Page)

Small card showing:
- "Next check-in: [day name] ([X days])"
- Below: one-line summary of last coach recommendation
- If no coach history yet: "Set up your weekly coach in Settings"
- Tap opens coach history view

---

## Settings Page Additions Summary

New sections added to the Settings page:

1. **Dashboard Features** — Toggle grid for all 9 cards (Section 1.4)
2. **Weekend Binge** — Enable toggle + day multi-select (Section 1.2)
3. **Weekly Coach** — Check-in day dropdown (Section 2.2)
4. **Week Start Day** — Dropdown to configure when the tracking week begins

---

## Supabase Schema Migration

```sql
ALTER TABLE user_data
  ADD COLUMN IF NOT EXISTS ct_tdee JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ct_coach JSONB DEFAULT '[]';
```

The `_cache` object, `ls()`, `lsSet()`, and Supabase flush logic must include these two new keys.

---

## Implementation Phasing

**Phase 1 (UX & Dashboard):**
1. Three-tier day coloring
2. Weekend binge calorie banking
3. Copy meal to another day
4. Feature toggle settings
5. New cards: weekly budget bar, macro rings, streak grid, copy last meal, smoothed weight trend

**Phase 2 (Intelligence):**
1. Adaptive TDEE algorithm + TDEE trend card
2. Energy balance chart
3. Goal progress waterfall chart
4. Claude weekly coach + coach countdown card
5. Missed day recovery popup
