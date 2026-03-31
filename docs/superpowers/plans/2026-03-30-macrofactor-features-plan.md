# MacroFactor-Inspired Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add adaptive TDEE, AI weekly coaching, calorie banking, three-tier coloring, and 9 new dashboard cards to the BLUBR calorie tracker.

**Architecture:** All features implemented in vanilla JS/CSS/HTML across three existing files (`app.js`, `index.html`, `styles.css`). New Supabase columns (`ct_tdee`, `ct_coach`) added via migration. No build tools, no frameworks.

**Tech Stack:** Vanilla JS, CSS custom properties, SVG charts, Supabase JSONB, Claude API

**Spec:** `docs/superpowers/specs/2026-03-30-macrofactor-inspired-features-design.md`

---

## File Structure

All changes go into the existing three files:

- **`app.js`** (~1908 lines) — all logic, rendering, data management
- **`index.html`** (~564 lines) — page structure, modals, settings HTML
- **`styles.css`** (~1192 lines) — all styling

New Supabase columns added via MCP tool.

---

## Task 1: Supabase Schema Migration + Cache Updates

**Files:**
- Modify: `app.js:14-17` (cache init), `app.js:31` (keys array), `app.js:141` (logout reset)

- [ ] **Step 1: Add Supabase columns via MCP**

Run Supabase SQL migration to add `ct_tdee` and `ct_coach` columns:

```sql
ALTER TABLE user_data
  ADD COLUMN IF NOT EXISTS ct_tdee JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ct_coach JSONB DEFAULT '[]';
```

- [ ] **Step 2: Update `_cache` initialization in `app.js`**

At line 14, add `ct_tdee` and `ct_coach` to the cache object:

```javascript
let _cache = {
  ct_data: {}, ct_macros: {}, ct_notes: {}, ct_refeed: {},
  ct_weights: {}, ct_presets: [], ct_settings: {}, ct_calc: {},
  ct_photos: {}, ct_meals: {}, ct_tdee: {}, ct_coach: []
};
```

- [ ] **Step 3: Update keys arrays in `_loadFromSupabase` and `_migrateLocalStorage`**

At line 31 and line 42, add the two new keys to both arrays:

```javascript
const keys = ['ct_data','ct_macros','ct_notes','ct_refeed','ct_weights','ct_presets','ct_settings','ct_calc','ct_photos','ct_meals','ct_tdee','ct_coach'];
```

- [ ] **Step 4: Update `authLogout` cache reset**

At line 141, update the reset object to include new keys:

```javascript
_cache = { ct_data:{}, ct_macros:{}, ct_notes:{}, ct_refeed:{}, ct_weights:{}, ct_presets:[], ct_settings:{}, ct_calc:{}, ct_photos:{}, ct_meals:{}, ct_tdee:{}, ct_coach:[] };
```

- [ ] **Step 5: Add constants for new data keys**

After line 74, add:

```javascript
const TDEE_KEY  = 'ct_tdee';
const COACH_KEY = 'ct_coach';
```

- [ ] **Step 6: Verify app still loads**

Open http://localhost:8000 in preview, confirm the app loads without console errors.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: add ct_tdee and ct_coach to cache and Supabase schema"
```

---

## Task 2: Refactor `saveSettings()` to Read-Modify-Write

**Files:**
- Modify: `app.js:195-208` (`saveSettings` function)

The current `saveSettings()` constructs a fresh object, which would destroy new nested fields (`features`, `weekendBinge`, `coachDay`, `weekStartDay`). Must refactor to merge.

- [ ] **Step 1: Refactor `saveSettings()`**

Replace the `saveSettings` function (lines 195-208):

```javascript
function saveSettings() {
  const existing = ls(SET_KEY, {});
  const weekly = parseInt(document.getElementById('sWeekly').value) || 14000;
  const daily  = Math.round(weekly / 7);
  Object.assign(existing, {
    weekly,
    green:     parseInt(document.getElementById('sGreen').value)  || daily,
    red:       parseInt(document.getElementById('sRed').value)    || Math.round(daily * 1.2),
    macroP:    parseInt(document.getElementById('sMacroP').value) || 150,
    macroC:    parseInt(document.getElementById('sMacroC').value) || 200,
    macroF:    parseInt(document.getElementById('sMacroF').value) || 65,
    useMetric: document.getElementById('sMetric').checked,
  });
  lsSet(SET_KEY, existing);
  refreshAll();
}
```

- [ ] **Step 2: Update `getSettings()` to provide defaults for new fields**

Replace the `getSettings` function (lines 186-194):

```javascript
function getSettings() {
  const raw = Object.assign({
    weekly: 14000, macroP: 150, macroC: 200, macroF: 65, useMetric: false,
    weekStartDay: 1, coachDay: 1,
    weekendBinge: { enabled: false, days: [] },
    features: { tdeeTrend:true, weeklyBudget:true, macroRings:true, streakGrid:true,
                energyBalance:true, goalWaterfall:true, smoothedWeight:true, copyMeal:true, coachCountdown:true }
  }, ls(SET_KEY, {}));
  const daily = Math.round(raw.weekly / 7);
  if (!raw.green || raw.green < daily * 0.5) raw.green = daily;
  if (!raw.red   || raw.red   < daily * 0.6) raw.red   = Math.round(daily * 1.2);
  // Ensure nested defaults merge correctly
  if (!raw.features) raw.features = {};
  const defFeatures = { tdeeTrend:true, weeklyBudget:true, macroRings:true, streakGrid:true,
                        energyBalance:true, goalWaterfall:true, smoothedWeight:true, copyMeal:true, coachCountdown:true };
  raw.features = Object.assign({}, defFeatures, raw.features);
  if (!raw.weekendBinge) raw.weekendBinge = { enabled: false, days: [] };
  return raw;
}
```

- [ ] **Step 3: Verify existing settings still work**

Open settings page, change weekly goal, verify it saves and renders correctly. Check that `applyGoal()` still works from the Goals page.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "refactor: saveSettings uses read-modify-write to preserve nested fields"
```

---

## Task 3: Extend `_addMeal()` for Estimated Flag

**Files:**
- Modify: `app.js:900-909` (`_addMeal` function)

- [ ] **Step 1: Add opts parameter to `_addMeal`**

Replace lines 900-909:

```javascript
function _addMeal(dateKey, name, cal, p, c, f, opts) {
  if (!dateKey || !cal) return false;
  cal = parseInt(cal, 10); p = p||0; c = c||0; f = f||0;
  const meals = ls(MEALS_KEY, {});
  if (!meals[dateKey]) meals[dateKey] = [];
  const meal = { name: name||'Meal', cal, p, c, f, ts: Date.now() };
  if (opts && opts.estimated) meal.estimated = true;
  meals[dateKey].push(meal);
  lsSet(MEALS_KEY, meals);
  _recalcDay(dateKey);
  return true;
}
```

- [ ] **Step 2: Verify existing meal logging still works**

Use the + FAB to quick log a meal, verify it appears in the day modal.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: _addMeal supports estimated flag via opts parameter"
```

---

## Task 4: Three-Tier Day Coloring + `getStaticTDEE()`

**Files:**
- Modify: `app.js:785-789` (`colorFor` function)
- Modify: `app.js` (add `getStaticTDEE` helper after `colorFor`)
- Modify: `index.html:1083-1088` (calendar legend)
- Modify: `styles.css` (add `.yellow` class for day modal header)

- [ ] **Step 1: Add `getStaticTDEE()` helper function**

Add after the `colorFor` function (after line 789):

```javascript
function getStaticTDEE() {
  // Try adaptive TDEE first (most recent entry)
  const tdeeData = ls(TDEE_KEY, {});
  const tdeeKeys = Object.keys(tdeeData).sort();
  if (tdeeKeys.length >= 14) return tdeeData[tdeeKeys[tdeeKeys.length - 1]];
  // Fall back to static TDEE from calculator profile
  const p = ls(CALC_KEY, {});
  if (!p.age || !p.weight) return null;
  const ft = parseFloat(p.ft)||0, inVal = parseFloat(p.inch)||0;
  const heightCm = ((ft*12)+inVal)*2.54, weightKg = parseFloat(p.weight)*0.453592;
  const age = parseFloat(p.age);
  let bmr = (10*weightKg)+(6.25*heightCm)-(5*age);
  bmr += p.sex==='male' ? 5 : -161;
  return Math.round(bmr * (parseFloat(p.activity)||1.55));
}
```

- [ ] **Step 2: Update `colorFor` to use three tiers**

Replace lines 785-789:

```javascript
function colorFor(cal, isRefeed) {
  if (isRefeed) return 'refeed';
  const s = getSettings();
  const tdee = getStaticTDEE();
  if (!tdee) {
    // No TDEE available — fall back to green/red thresholds from settings
    return cal <= s.green ? 'green' : cal > s.red ? 'red' : 'yellow';
  }
  if (cal > tdee) return 'red';
  if (cal <= s.green) return 'green';
  return 'yellow';
}
```

- [ ] **Step 3: Update calendar legend in `renderCalendar()`**

Update lines 1083-1088 in `app.js` — the legend HTML inside `renderCalendar()`:

```javascript
const tdee = getStaticTDEE();
const tdeeLabel = tdee ? tdee.toLocaleString() : 'TDEE';
document.getElementById('legend').innerHTML = `
  <div class="legend-item"><div class="legend-dot" style="background:#10b981"></div> ≤ ${s.green} cal (on target)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div> ${s.green}–${tdeeLabel} cal</div>
  <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div> > ${tdeeLabel} cal (surplus)</div>
  <div class="legend-item"><div class="legend-dot" style="background:#6c7ae0"></div> Refeed day</div>
  <div class="legend-item"><div class="legend-dot" style="background:#8b5cf6;border-radius:50%"></div> Has note</div>`;
```

- [ ] **Step 4: Verify the `ct_calc` keys used by `getStaticTDEE` match what `saveCalcProfile` stores**

Search for `saveCalcProfile` to confirm the stored field names (sex, age, ft, inches, weight, activity).

- [ ] **Step 5: Test three-tier coloring**

Open the calendar, verify days show green/yellow/red correctly. Check the "Last 7 Days" strip on the home page.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: three-tier day coloring (green/yellow/red) based on goal and TDEE"
```

---

## Task 5: Weekend Binge (Calorie Banking)

**Files:**
- Modify: `index.html` (settings page — add weekend binge UI after tracking card)
- Modify: `app.js` (add banking calculation + settings save/load)
- Modify: `app.js:800-866` (`renderToday` — show adjusted goal on binge days)
- Modify: `styles.css` (toggle/checkbox styles)

- [ ] **Step 1: Add Weekend Binge settings HTML**

In `index.html`, after the Tracking card (after line 388), add:

```html
<div class="card" id="weekendBingeCard">
  <div class="card-title">Calorie Banking</div>
  <div style="font-size:0.75rem;color:var(--muted);margin:-4px 0 14px;line-height:1.6">Bank unspent weekday calories for your weekend. Only calories below your daily goal get banked.</div>
  <label style="display:flex;align-items:center;gap:8px;font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;cursor:pointer;margin-bottom:12px">
    <input type="checkbox" id="sBingeEnabled" onchange="saveBingeSettings()" style="width:auto;accent-color:var(--cyan)"> Enable Calorie Banking
  </label>
  <div id="bingeDayPicker" style="display:none">
    <div style="font-size:0.72rem;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Add banked calories to:</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer"><input type="checkbox" class="binge-day-cb" value="5" onchange="saveBingeSettings()" style="width:auto;accent-color:var(--yellow)"> Friday</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer"><input type="checkbox" class="binge-day-cb" value="6" onchange="saveBingeSettings()" style="width:auto;accent-color:var(--yellow)"> Saturday</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer"><input type="checkbox" class="binge-day-cb" value="0" onchange="saveBingeSettings()" style="width:auto;accent-color:var(--yellow)"> Sunday</label>
    </div>
    <div id="bankedCalDisplay" style="margin-top:12px;padding:10px;border:2px solid rgba(251,191,36,0.2);background:rgba(251,191,36,0.04);font-size:0.82rem;color:var(--yellow);display:none"></div>
  </div>
</div>
```

- [ ] **Step 2: Add banking logic in `app.js`**

Add after the `saveSettings` function:

```javascript
/* ── CALORIE BANKING ── */
function saveBingeSettings() {
  const existing = ls(SET_KEY, {});
  const enabled = document.getElementById('sBingeEnabled').checked;
  const days = [];
  document.querySelectorAll('.binge-day-cb:checked').forEach(cb => days.push(parseInt(cb.value)));
  if (days.length === 0 && enabled) {
    document.getElementById('sBingeEnabled').checked = false;
    existing.weekendBinge = { enabled: false, days: [] };
  } else {
    existing.weekendBinge = { enabled, days };
  }
  lsSet(SET_KEY, existing);
  document.getElementById('bingeDayPicker').style.display = enabled ? 'block' : 'none';
  updateBankedDisplay();
  refreshAll();
}

function loadBingeSettings() {
  const s = getSettings();
  document.getElementById('sBingeEnabled').checked = s.weekendBinge.enabled;
  document.getElementById('bingeDayPicker').style.display = s.weekendBinge.enabled ? 'block' : 'none';
  document.querySelectorAll('.binge-day-cb').forEach(cb => {
    cb.checked = s.weekendBinge.days.includes(parseInt(cb.value));
  });
  updateBankedDisplay();
}

function getBankedCalories() {
  const s = getSettings();
  if (!s.weekendBinge.enabled || s.weekendBinge.days.length === 0) return { banked: 0, perDay: 0, remainingDays: 0 };
  const today = new Date(); today.setHours(0,0,0,0);
  const data = getData();
  const dailyGoal = Math.round(s.weekly / 7);
  const weekStart = new Date(today);
  const startDay = s.weekStartDay || 1;
  // Find most recent occurrence of weekStartDay
  while (weekStart.getDay() !== startDay) weekStart.setDate(weekStart.getDate() - 1);
  if (weekStart > today) weekStart.setDate(weekStart.getDate() - 7);

  let banked = 0;
  const cur = new Date(weekStart);
  while (cur < today) {
    const key = makeKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
    if (!s.weekendBinge.days.includes(cur.getDay())) {
      const actual = data[key];
      if (actual !== undefined && actual < dailyGoal) {
        banked += (dailyGoal - actual);
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  // Count remaining binge days (today through end of week)
  let remainingDays = 0;
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  const check = new Date(today);
  while (check < weekEnd) {
    if (s.weekendBinge.days.includes(check.getDay())) remainingDays++;
    check.setDate(check.getDate() + 1);
  }

  return { banked, perDay: remainingDays > 0 ? Math.round(banked / remainingDays) : 0, remainingDays };
}

function updateBankedDisplay() {
  const el = document.getElementById('bankedCalDisplay');
  if (!el) return;
  const s = getSettings();
  if (!s.weekendBinge.enabled) { el.style.display = 'none'; return; }
  const { banked, perDay, remainingDays } = getBankedCalories();
  if (banked > 0) {
    el.style.display = 'block';
    el.textContent = `${banked.toLocaleString()} cal banked this week` + (remainingDays > 0 ? ` (+${perDay.toLocaleString()} per binge day)` : ' (no binge days remaining)');
  } else {
    el.style.display = 'block';
    el.textContent = 'No banked calories yet this week';
  }
}
```

- [ ] **Step 3: Update `renderToday()` to show adjusted goal on binge days**

In the `renderToday` function, after `const dailyGoal = Math.round(s.weekly / 7);` (around line 822), add banking adjustment:

```javascript
let adjustedGoal = dailyGoal;
let bankedBonus = 0;
const todayDow = today.getDay();
if (s.weekendBinge.enabled && s.weekendBinge.days.includes(todayDow)) {
  const banking = getBankedCalories();
  bankedBonus = banking.perDay;
  adjustedGoal = dailyGoal + bankedBonus;
}
```

Then update the progress bar and remaining text to use `adjustedGoal` instead of `dailyGoal` on lines 823-830. Specifically, replace `dailyGoal` with `adjustedGoal` in:
- Line 823: `const pct = adjustedGoal > 0 ? Math.min((cal / adjustedGoal) * 100, 100) : 0;`
- Line 824: `const isOver = cal > adjustedGoal;`
- Line 825: `const diff = Math.abs(cal - adjustedGoal);`
- Line 828: `html += \`...\${cal.toLocaleString()} / \${adjustedGoal.toLocaleString()} cal today\`;`

Keep `dailyGoal` in the banking note below (to show the base vs adjusted amounts).

After the remaining text line, add:
```javascript
if (bankedBonus > 0) {
  html += `<div style="font-size:0.68rem;color:var(--yellow);margin-top:2px">Daily Goal: ${adjustedGoal.toLocaleString()} (${dailyGoal.toLocaleString()} + ${bankedBonus.toLocaleString()} banked)</div>`;
}
```

- [ ] **Step 4: Load binge settings on init**

In the `init()` function (around line 1906), add `loadBingeSettings();` after `loadApiKey();`.

- [ ] **Step 5: Test calorie banking**

Enable banking in settings, select Saturday/Sunday. Log a few weekday meals under goal. Verify banked calories display correctly and adjust the daily goal on binge days.

- [ ] **Step 6: Commit**

```bash
git add app.js index.html
git commit -m "feat: calorie banking - bank unspent weekday calories for weekend binge days"
```

---

## Task 6: Copy Meal to Another Day

**Files:**
- Modify: `app.js:1441-1458` (`_renderModalMeals` — meal list rendering)
- Modify: `app.js` (add `copyMeal` and `closeCopyPopover` functions)
- Modify: `styles.css` (copy popover styles)

- [ ] **Step 1: Add copy button to meal rows in `_renderModalMeals()`**

In the meal row rendering (around line 1453), add a copy button next to Edit and Delete:

```javascript
<button class="btn-modal-meal-action" onclick="showCopyPopover(event, ${i})">Copy</button>
```

- [ ] **Step 2: Add copy functions to `app.js`**

```javascript
/* ── COPY MEAL ── */
function showCopyPopover(event, mealIndex) {
  closeCopyPopover(); // close any existing
  const meals = ls(MEALS_KEY, {});
  const meal = (meals[modalKey] || [])[mealIndex];
  if (!meal) return;

  const today = new Date();
  const pad = n => String(n).padStart(2,'0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const tmrw = new Date(today); tmrw.setDate(tmrw.getDate()+1);
  const tmrwStr = `${tmrw.getFullYear()}-${pad(tmrw.getMonth()+1)}-${pad(tmrw.getDate())}`;

  const pop = document.createElement('div');
  pop.className = 'copy-popover';
  pop.id = 'copyPopover';
  pop.innerHTML = `
    <div class="copy-pop-title">Copy "${escHtml(meal.name)}" to:</div>
    <button class="copy-pop-btn" onclick="doCopyMeal(${mealIndex},'${todayStr}')">Today</button>
    <button class="copy-pop-btn" onclick="doCopyMeal(${mealIndex},'${tmrwStr}')">Tomorrow</button>
    <div style="margin-top:6px"><input type="date" class="copy-pop-date" onchange="doCopyMeal(${mealIndex},this.value)"></div>
    <button class="copy-pop-cancel" onclick="closeCopyPopover()">Cancel</button>
  `;
  event.target.closest('.modal-meal-item').appendChild(pop);
}

function closeCopyPopover() {
  const el = document.getElementById('copyPopover');
  if (el) el.remove();
}

function doCopyMeal(mealIndex, targetDate) {
  if (!targetDate) return;
  const meals = ls(MEALS_KEY, {});
  const meal = (meals[modalKey] || [])[mealIndex];
  if (!meal) return;
  _addMeal(targetDate, meal.name, meal.cal, meal.p||0, meal.c||0, meal.f||0);
  closeCopyPopover();
  refreshAll();
  showToast(`Copied ${escHtml(meal.name)} to ${targetDate}`);
}
```

- [ ] **Step 3: Add copy popover CSS to `styles.css`**

```css
.copy-popover {
  position: relative; margin-top: 8px; padding: 10px;
  border: 2px solid var(--cyan); background: var(--card);
  box-shadow: 3px 3px 0 rgba(0,212,255,0.2);
}
.copy-pop-title { font-size: 0.72rem; color: var(--cyan); margin-bottom: 8px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
.copy-pop-btn {
  display: block; width: 100%; padding: 8px; margin-bottom: 4px;
  background: rgba(0,212,255,0.06); border: 1px solid rgba(0,212,255,0.2);
  color: var(--text); font-size: 0.82rem; cursor: pointer; text-align: left;
}
.copy-pop-btn:hover { background: rgba(0,212,255,0.12); border-color: var(--cyan); }
.copy-pop-date { width: 100%; padding: 6px 8px; background: var(--input); border: 1px solid rgba(255,255,255,0.15); color: var(--text); font-size: 0.82rem; }
.copy-pop-cancel { display: block; width: 100%; padding: 6px; margin-top: 6px; background: none; border: 1px solid rgba(255,255,255,0.1); color: var(--muted); font-size: 0.72rem; cursor: pointer; text-align: center; }
```

- [ ] **Step 4: Test copy meal**

Open a day modal with meals. Click Copy on a meal. Verify "Today" copies to today, "Tomorrow" to tomorrow, and date picker works. Check the toast confirmation and that the target day shows the copied meal.

- [ ] **Step 5: Commit**

```bash
git add app.js styles.css
git commit -m "feat: copy individual meals to other days from day modal"
```

---

## Task 7: Feature Toggle Settings

**Files:**
- Modify: `index.html` (settings page — add dashboard features section)
- Modify: `app.js` (save/load feature toggles)

- [ ] **Step 1: Add feature toggles HTML to settings page**

In `index.html`, after the Weekend Binge card (inserted in Task 5), add:

```html
<div class="card">
  <div class="card-title">Dashboard Features</div>
  <div style="font-size:0.75rem;color:var(--muted);margin:-4px 0 14px;line-height:1.6">Toggle dashboard cards on or off.</div>
  <div class="feature-toggles" id="featureToggles"></div>
</div>
```

- [ ] **Step 2: Add feature toggle rendering and save logic in `app.js`**

```javascript
/* ── FEATURE TOGGLES ── */
const FEATURE_LABELS = {
  tdeeTrend: 'TDEE Trend', weeklyBudget: 'Weekly Calorie Budget', macroRings: 'Macro Rings',
  streakGrid: 'Streak & Consistency', energyBalance: 'Energy Balance', goalWaterfall: 'Goal Waterfall',
  smoothedWeight: 'Smoothed Weight Trend', copyMeal: 'Quick Copy Meal', coachCountdown: 'Coach Countdown'
};

function renderFeatureToggles() {
  const s = getSettings();
  const el = document.getElementById('featureToggles');
  if (!el) return;
  el.innerHTML = Object.entries(FEATURE_LABELS).map(([key, label]) => {
    const checked = s.features[key] !== false ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:0.82rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05)">
      <input type="checkbox" ${checked} onchange="saveFeatureToggle('${key}',this.checked)" style="width:auto;accent-color:var(--cyan)"> ${label}
    </label>`;
  }).join('');
}

function saveFeatureToggle(key, enabled) {
  const existing = ls(SET_KEY, {});
  if (!existing.features) existing.features = {};
  existing.features[key] = enabled;
  lsSet(SET_KEY, existing);
  refreshAll();
}
```

- [ ] **Step 3: Add `renderFeatureToggles()` to `init()`**

In `init()`, after `loadBingeSettings();`, add `renderFeatureToggles();`.

- [ ] **Step 4: Test feature toggles**

Open settings, toggle features on/off, verify they save and persist across page loads.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: dashboard feature toggles in settings"
```

---

## Task 8: Week Start Day + Coach Day Settings

**Files:**
- Modify: `index.html` (settings page — add dropdowns)
- Modify: `app.js` (save/load)

- [ ] **Step 1: Add settings HTML**

In `index.html`, after the Dashboard Features card, add:

```html
<div class="card">
  <div class="card-title">Week & Coach</div>
  <div class="settings-grid">
    <div class="setting-item">
      <label>Week Starts On</label>
      <select id="sWeekStart" onchange="saveWeekCoachSettings()">
        <option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option>
        <option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option>
      </select>
    </div>
    <div class="setting-item">
      <label>Coach Check-in Day</label>
      <select id="sCoachDay" onchange="saveWeekCoachSettings()">
        <option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option>
        <option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option>
      </select>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add save/load functions**

```javascript
function saveWeekCoachSettings() {
  const existing = ls(SET_KEY, {});
  existing.weekStartDay = parseInt(document.getElementById('sWeekStart').value);
  existing.coachDay = parseInt(document.getElementById('sCoachDay').value);
  lsSet(SET_KEY, existing);
  refreshAll();
}

function loadWeekCoachSettings() {
  const s = getSettings();
  document.getElementById('sWeekStart').value = s.weekStartDay;
  document.getElementById('sCoachDay').value = s.coachDay;
}
```

- [ ] **Step 3: Call `loadWeekCoachSettings()` in `init()`**

- [ ] **Step 4: Update `updateWeekly()` to respect `weekStartDay`**

In `updateWeekly()` (around line 1012), replace the week start calculation:

```javascript
const wStart = new Date(today);
// getSettings() provides weekStartDay with default of 1 (Monday)
while (wStart.getDay() !== s.weekStartDay) wStart.setDate(wStart.getDate() - 1);
```

- [ ] **Step 5: Test week start day change**

Change week start to Monday, verify weekly progress recalculates correctly.

- [ ] **Step 6: Commit**

```bash
git add app.js index.html
git commit -m "feat: configurable week start day and coach check-in day"
```

---

## Task 9: Macro Rings (SVG Circular Progress)

**Files:**
- Modify: `app.js:832-846` (`renderToday` — macro display section)

- [ ] **Step 1: Add `renderMacroRings()` helper**

```javascript
function renderMacroRings(mac, goals) {
  const rings = [
    { key: 'p', label: 'P', color: '#f472b6', val: mac.p||0, goal: goals.p },
    { key: 'c', label: 'C', color: '#60a5fa', val: mac.c||0, goal: goals.c },
    { key: 'f', label: 'F', color: '#fbbf24', val: mac.f||0, goal: goals.f },
  ];
  return `<div style="display:flex;justify-content:center;gap:20px;margin-top:12px">${rings.map(r => {
    const pct = r.goal > 0 ? Math.min(r.val / r.goal, 1) : 0;
    const radius = 30, circ = 2 * Math.PI * radius;
    const offset = circ * (1 - pct);
    return `<div style="text-align:center">
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle cx="38" cy="38" r="${radius}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="6"/>
        <circle cx="38" cy="38" r="${radius}" fill="none" stroke="${r.color}" stroke-width="6"
          stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
          stroke-linecap="round" transform="rotate(-90 38 38)" style="transition:stroke-dashoffset 0.5s"/>
        <text x="38" y="35" text-anchor="middle" fill="${r.color}" font-size="14" font-weight="700">${Math.round(pct*100)}%</text>
        <text x="38" y="50" text-anchor="middle" fill="#6b7280" font-size="9">${r.val}/${r.goal}g</text>
      </svg>
      <div style="font-size:0.68rem;color:${r.color};font-weight:600;margin-top:-2px">${r.label}</div>
    </div>`;
  }).join('')}</div>`;
}
```

- [ ] **Step 2: Update `renderToday()` to use macro rings when feature enabled**

In `renderToday()`, replace the existing macro display (lines 832-846) with:

```javascript
if (mac) {
  const macGoals = { p: s.macroP, c: s.macroC, f: s.macroF };
  if (s.features.macroRings) {
    html += renderMacroRings(mac, macGoals);
  } else {
    // Original bar display
    html += `<div class="today-macros-display" style="margin-top:8px">P ${mac.p}g · C ${mac.c}g · F ${mac.f}g</div>`;
    html += `<div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">`;
    const macColors = { p: '#f472b6', c: '#60a5fa', f: '#fbbf24' };
    const macLabels = { p: 'P', c: 'C', f: 'F' };
    for (const k of ['p','c','f']) {
      const logged = mac[k] || 0;
      const goal = macGoals[k];
      const mp = goal > 0 ? Math.min((logged / goal) * 100, 100) : 0;
      html += `<div style="font-size:0.72rem;color:var(--muted2)">${macLabels[k]}: ${logged}g / ${goal}g</div>`;
      html += `<div class="bar-wrap" style="height:10px;margin-bottom:2px"><div class="bar-fill" style="width:${mp.toFixed(1)}%;background:${macColors[k]};min-width:0;font-size:0"></div></div>`;
    }
    html += `</div>`;
  }
}
```

- [ ] **Step 3: Test macro rings**

Log a meal with macros, verify the rings display on the home page. Toggle the feature off, verify it falls back to bars.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: macro rings - circular SVG progress indicators for P/C/F"
```

---

## Task 10: Smoothed Weight Trend (EMA Overlay)

**Files:**
- Modify: `app.js:1197-1246` (`renderWeightChart`)

- [ ] **Step 1: Add EMA calculation helper**

```javascript
function calcEMA(values, alpha) {
  if (values.length === 0) return [];
  const ema = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(alpha * values[i] + (1 - alpha) * ema[i - 1]);
  }
  return ema;
}
```

- [ ] **Step 2: Add EMA trend line to `renderWeightChart()`**

At the end of `renderWeightChart()`, before `svg.innerHTML=html;`, add:

```javascript
// Smoothed weight trend (EMA overlay)
const s = getSettings();
if (s.features.smoothedWeight && entries.length >= 3) {
  const emaVals = calcEMA(entries.map(e => e.val), 0.1);
  const emaPts = entries.map((e, i) => `${xS(e.date).toFixed(1)},${yS(emaVals[i]).toFixed(1)}`).join(' ');
  html += `<polyline points="${emaPts}" fill="none" stroke="rgba(139,92,246,0.85)" stroke-width="3.5" stroke-linecap="round"/>`;
  // Label
  html += `<text x="${W-P.r-2}" y="${P.t+12}" text-anchor="end" fill="rgba(139,92,246,0.6)" font-size="10">Trend (EMA)</text>`;
}
```

- [ ] **Step 3: Test smoothed weight trend**

Verify the purple EMA line overlays the raw weight dots. Toggle the feature off, verify the line disappears.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: smoothed weight trend with EMA overlay on weight chart"
```

---

## Task 11: Streak & Consistency Grid

**Files:**
- Modify: `index.html` (progress page — add streak grid card)
- Modify: `app.js` (add `renderStreakGrid` function)
- Modify: `styles.css` (grid styles)

- [ ] **Step 1: Add streak grid card HTML**

In `index.html`, after the stats-bar div in the progress page (after line 134), add:

```html
<div class="card" id="streakGridCard">
  <div class="card-title">Logging Streak</div>
  <div id="streakCount" style="font-size:2rem;font-weight:700;color:var(--green);text-align:center;margin-bottom:8px"></div>
  <div id="streakLabel" style="font-size:0.72rem;color:var(--muted);text-align:center;margin-bottom:14px;text-transform:uppercase;letter-spacing:1px"></div>
  <div id="streakGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;max-width:320px;margin:0 auto"></div>
  <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:0.62rem;color:var(--muted2);max-width:320px;margin-left:auto;margin-right:auto">
    <span id="streakStartLabel"></span><span>Today</span>
  </div>
</div>
```

- [ ] **Step 2: Add `renderStreakGrid()` function**

```javascript
function renderStreakGrid() {
  const s = getSettings();
  if (!s.features.streakGrid) { const el = document.getElementById('streakGridCard'); if (el) el.style.display='none'; return; }
  const el = document.getElementById('streakGridCard'); if (el) el.style.display='';
  const data = getData();
  const today = new Date(); today.setHours(0,0,0,0);
  const totalDays = 91; // ~13 weeks

  const gridEl = document.getElementById('streakGrid');
  let html = '';
  // Align to start on the correct weekday
  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - totalDays + 1);
  // Pad start to align to week grid
  const padStart = startDate.getDay();
  for (let i = 0; i < padStart; i++) html += `<div style="width:100%;aspect-ratio:1"></div>`;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate); d.setDate(startDate.getDate() + i);
    const key = makeKey(d.getFullYear(), d.getMonth(), d.getDate());
    const logged = data[key] !== undefined;
    const isToday = d.getTime() === today.getTime();
    html += `<div style="width:100%;aspect-ratio:1;border-radius:2px;background:${logged ? 'var(--green)' : 'rgba(255,255,255,0.04)'};opacity:${logged ? '0.85' : '1'};${isToday ? 'border:1.5px solid var(--cyan)' : ''}" title="${d.toLocaleDateString()}${logged ? ' ✓' : ''}"></div>`;
  }
  gridEl.innerHTML = html;

  // Streak count
  let streak = 0;
  const cur = new Date(today);
  for (let i = 0; i < 3650; i++) {
    const k = makeKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
    if (data[k] !== undefined) { streak++; cur.setDate(cur.getDate()-1); } else break;
  }
  document.getElementById('streakCount').textContent = streak;
  document.getElementById('streakLabel').textContent = streak === 1 ? 'day streak' : 'day streak';
  document.getElementById('streakStartLabel').textContent = `${startDate.getMonth()+1}/${startDate.getDate()}`;
}
```

- [ ] **Step 3: Add `renderStreakGrid()` to `refreshAll()`**

- [ ] **Step 4: Test streak grid**

Verify the grid shows on the Progress page with green squares for logged days.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: streak & consistency grid on progress page"
```

---

## Task 12: Weekly Calorie Budget Bar

**Files:**
- Modify: `index.html` (home page — add budget bar card after This Week)
- Modify: `app.js` (add `renderWeeklyBudget` function)

- [ ] **Step 1: Add budget bar HTML to home page**

In `index.html`, after the "This Week" card (after line 70), add:

```html
<div class="card" id="weeklyBudgetCard">
  <div class="card-title">Weekly Budget</div>
  <div id="weeklyBudgetContent"></div>
</div>
```

- [ ] **Step 2: Add `renderWeeklyBudget()` function**

```javascript
function renderWeeklyBudget() {
  const s = getSettings();
  const card = document.getElementById('weeklyBudgetCard');
  if (!card) return;
  if (!s.features.weeklyBudget) { card.style.display = 'none'; return; }
  card.style.display = '';
  const data = getData();
  const today = new Date(); today.setHours(0,0,0,0);
  const startDay = s.weekStartDay !== undefined ? s.weekStartDay : 0;
  const wStart = new Date(today);
  while (wStart.getDay() !== startDay) wStart.setDate(wStart.getDate() - 1);

  let consumed = 0;
  const dayDetails = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(wStart); d.setDate(wStart.getDate() + i);
    const key = makeKey(d.getFullYear(), d.getMonth(), d.getDate());
    const cal = data[key] || 0;
    const isBinge = s.weekendBinge.enabled && s.weekendBinge.days.includes(d.getDay());
    const isPast = d <= today;
    if (isPast && data[key] !== undefined) consumed += cal;
    dayDetails.push({ date: d, cal, isBinge, logged: data[key] !== undefined, isPast });
  }

  const banking = getBankedCalories();
  const totalBudget = s.weekly + (s.weekendBinge.enabled ? 0 : 0); // Banking doesn't change total, just redistributes
  const pct = totalBudget > 0 ? Math.min((consumed / totalBudget) * 100, 100) : 0;
  const remaining = totalBudget - consumed;
  const barColor = consumed <= totalBudget ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#ef4444,#f87171)';

  let html = `<div style="font-size:0.82rem;color:var(--muted);margin-bottom:8px">${consumed.toLocaleString()} of ${totalBudget.toLocaleString()} consumed`;
  if (s.weekendBinge.enabled && banking.banked > 0) html += ` <span style="color:var(--yellow)">(${banking.banked.toLocaleString()} banked)</span>`;
  html += `</div>`;
  html += `<div class="bar-wrap"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}">${Math.round(pct)}%</div></div>`;
  html += `<div style="font-size:0.72rem;color:var(--muted2);margin-top:6px">${remaining > 0 ? remaining.toLocaleString() + ' cal remaining' : Math.abs(remaining).toLocaleString() + ' cal over budget'}</div>`;

  // Mini day indicators
  html += `<div style="display:flex;gap:4px;margin-top:10px">`;
  const dailyGoal = Math.round(s.weekly / 7);
  dayDetails.forEach(dd => {
    const dayLetter = DAYS_SHORT[dd.date.getDay()];
    let bg = 'rgba(255,255,255,0.04)';
    if (dd.logged) bg = dd.cal <= dailyGoal ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)';
    const border = dd.isBinge ? '2px solid var(--yellow)' : '1px solid rgba(255,255,255,0.08)';
    html += `<div style="flex:1;text-align:center;padding:4px 0;background:${bg};border:${border};font-size:0.6rem;color:var(--muted)">${dayLetter}</div>`;
  });
  html += `</div>`;

  document.getElementById('weeklyBudgetContent').innerHTML = html;
}
```

- [ ] **Step 3: Add `renderWeeklyBudget()` to `refreshAll()`**

- [ ] **Step 4: Test weekly budget bar**

Verify the bar shows on the home page with correct consumed/remaining. Enable banking, verify binge days show yellow borders.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: weekly calorie budget bar with banking integration"
```

---

## Task 13: Copy Last Meal Card

**Files:**
- Modify: `index.html` (home page — add card after Last 7 Days)
- Modify: `app.js` (add `renderCopyLastMeal` function)

- [ ] **Step 1: Add card HTML**

In `index.html`, after the "Last 7 Days" card (after line 77), add:

```html
<div class="card" id="copyLastMealCard" style="display:none">
  <div id="copyLastMealContent"></div>
</div>
```

- [ ] **Step 2: Add `renderCopyLastMeal()` function**

```javascript
function renderCopyLastMeal() {
  const s = getSettings();
  const card = document.getElementById('copyLastMealCard');
  if (!card) return;
  if (!s.features.copyMeal) { card.style.display = 'none'; return; }

  const meals = ls(MEALS_KEY, {});
  // Find most recent meal across all days
  let lastMeal = null, lastDate = null;
  const sortedDays = Object.keys(meals).sort().reverse();
  for (const day of sortedDays) {
    const dayMeals = meals[day];
    if (dayMeals && dayMeals.length > 0) {
      lastMeal = dayMeals[dayMeals.length - 1];
      lastDate = day;
      break;
    }
  }
  if (!lastMeal) { card.style.display = 'none'; return; }
  card.style.display = '';

  const macStr = (lastMeal.p||lastMeal.c||lastMeal.f)
    ? `<span style="font-size:0.72rem;color:var(--muted2)"> · P${lastMeal.p||0} C${lastMeal.c||0} F${lastMeal.f||0}</span>` : '';

  document.getElementById('copyLastMealContent').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="flex:1;min-width:0">
        <div style="font-size:0.62rem;color:var(--muted2);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Quick Re-log</div>
        <div style="font-weight:600;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(lastMeal.name)}</div>
        <div style="font-size:0.78rem;color:var(--yellow)">${lastMeal.cal.toLocaleString()} cal${macStr}</div>
      </div>
      <button onclick="relogLastMeal()" style="padding:10px 16px;background:rgba(16,185,129,0.1);border:2px solid var(--green);color:var(--green);font-size:0.72rem;font-weight:700;letter-spacing:1px;text-transform:uppercase;cursor:pointer;white-space:nowrap;box-shadow:2px 2px 0 rgba(0,255,65,0.15)">Log Again</button>
    </div>`;
}

function relogLastMeal() {
  const meals = ls(MEALS_KEY, {});
  const sortedDays = Object.keys(meals).sort().reverse();
  let lastMeal = null;
  for (const day of sortedDays) {
    if (meals[day] && meals[day].length > 0) { lastMeal = meals[day][meals[day].length - 1]; break; }
  }
  if (!lastMeal) return;
  const today = new Date();
  const pad = n => String(n).padStart(2,'0');
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  _addMeal(todayKey, lastMeal.name, lastMeal.cal, lastMeal.p||0, lastMeal.c||0, lastMeal.f||0);
  refreshAll();
  showToast(`Logged ${lastMeal.cal.toLocaleString()} cal`);
  showSuccessBurst();
}
```

- [ ] **Step 3: Add `renderCopyLastMeal()` to `refreshAll()`**

- [ ] **Step 4: Test copy last meal**

Log a meal, verify the quick re-log card appears on the home page. Tap "Log Again", verify it adds to today.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: quick re-log last meal card on home page"
```

---

## Task 14: Adaptive TDEE Algorithm

**Files:**
- Modify: `app.js` (add TDEE calculation engine)
- Modify: `app.js:911-927` (`_recalcDay` — trigger TDEE recalc)
- Modify: `app.js:1168-1181` (`logWeight` — trigger TDEE recalc)

- [ ] **Step 1: Add TDEE calculation engine**

```javascript
/* ── ADAPTIVE TDEE ── */
let _tdeeTimer = null;

function _scheduleTDEERecalc() {
  clearTimeout(_tdeeTimer);
  _tdeeTimer = setTimeout(_recalcTDEE, 1500);
}

function _recalcTDEE() {
  const data = getData();
  const weights = ls(WEIGHTS_KEY, {});
  const calDays = Object.keys(data).sort();
  const wtDays = Object.keys(weights).sort();
  if (calDays.length < 14 || wtDays.length < 5) return;

  // Build daily weight EMA (interpolate missing days)
  const allDates = [...new Set([...calDays, ...wtDays])].sort();
  if (allDates.length < 14) return;
  const last28 = allDates.slice(-28);
  const firstDate = new Date(last28[0] + 'T12:00:00');
  const lastDate = new Date(last28[last28.length-1] + 'T12:00:00');

  // Create daily series with interpolation
  const dailySeries = [];
  const cur = new Date(firstDate);
  let lastWeight = null;
  // Find first known weight
  for (const d of wtDays) { if (d >= last28[0]) { lastWeight = weights[d]; break; } }
  if (!lastWeight) { for (const d of wtDays.reverse()) { lastWeight = weights[d]; break; } }
  if (!lastWeight) return;

  while (cur <= lastDate) {
    const key = makeKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
    const w = weights[key] !== undefined ? weights[key] : null;
    const c = data[key] !== undefined ? data[key] : null;
    if (w !== null) lastWeight = w;
    dailySeries.push({ date: key, weight: lastWeight, cal: c });
    cur.setDate(cur.getDate() + 1);
  }

  if (dailySeries.length < 14) return;

  // Weights are always stored internally in lbs (converted at input time), so no metric conversion needed here
  const weightVals = dailySeries.map(d => d.weight);
  const weightEma = calcEMA(weightVals, 0.1);
  const calVals = dailySeries.map(d => d.cal);
  // Fill null calorie days with running average
  let runSum = 0, runCnt = 0;
  calVals.forEach(c => { if (c !== null) { runSum += c; runCnt++; } });
  const avgCal = runCnt > 0 ? runSum / runCnt : 2000;
  const filledCals = calVals.map(c => c !== null ? c : avgCal);
  const calEma = calcEMA(filledCals, 0.1);

  const tdeeData = ls(TDEE_KEY, {});
  for (let i = 1; i < dailySeries.length; i++) {
    let dailyWeightChange = weightEma[i] - weightEma[i-1]; // in lbs (weights stored in lbs internally)
    const dailyEnergyFromWeight = dailyWeightChange * 3500;
    let tdee = calEma[i] + (-dailyEnergyFromWeight);
    // Clamp to reasonable range
    tdee = Math.max(800, Math.min(6000, tdee));
    tdeeData[dailySeries[i].date] = Math.round(tdee);
  }
  // Smooth the TDEE estimates
  const tdeeKeys = Object.keys(tdeeData).sort().slice(-60);
  const tdeeVals = tdeeKeys.map(k => tdeeData[k]);
  if (tdeeVals.length >= 3) {
    const smoothed = calcEMA(tdeeVals, 0.05);
    tdeeKeys.forEach((k, i) => { tdeeData[k] = Math.round(smoothed[i]); });
  }
  lsSet(TDEE_KEY, tdeeData);
}
```

- [ ] **Step 2: Trigger TDEE recalc from `_recalcDay` and `logWeight`**

At the end of `_recalcDay()`, add: `_scheduleTDEERecalc();`

At the end of `logWeight()`, after `checkRecalcBanner();`, add: `_scheduleTDEERecalc();`

- [ ] **Step 3: Test TDEE calculation**

The algorithm needs 14+ days of calorie data and 5+ weight entries. This can be verified by checking `ls('ct_tdee', {})` in console after sufficient data exists.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: adaptive TDEE algorithm - estimates real expenditure from weight + intake"
```

---

## Task 15: TDEE Trend Card + Energy Balance Chart

**Files:**
- Modify: `index.html` (progress page — add cards)
- Modify: `app.js` (add render functions)

- [ ] **Step 1: Add card HTML to progress page**

In `index.html`, after the Weight Trend card (after line 153), add:

```html
<div class="card" id="tdeeTrendCard" style="display:none">
  <div class="card-title">Adaptive TDEE</div>
  <div id="tdeeTrendContent"></div>
</div>

<div class="card" id="energyBalanceCard" style="display:none">
  <div class="card-title">Energy Balance — Last 60 Days</div>
  <div class="chart-area">
    <svg id="energySvg" viewBox="0 0 800 180"></svg>
  </div>
  <div style="display:flex;gap:14px;margin-top:8px;font-size:0.78rem;">
    <span style="color:#00d4ff">■ Intake</span>
    <span style="color:#8b5cf6">■ TDEE</span>
    <span style="color:rgba(16,185,129,0.3)">■ Deficit</span>
    <span style="color:rgba(239,68,68,0.3)">■ Surplus</span>
  </div>
</div>
```

- [ ] **Step 2: Add `renderTDEETrend()` function**

```javascript
function renderTDEETrend() {
  const s = getSettings();
  const card = document.getElementById('tdeeTrendCard');
  if (!card) return;
  if (!s.features.tdeeTrend) { card.style.display = 'none'; return; }
  const tdeeData = ls(TDEE_KEY, {});
  const keys = Object.keys(tdeeData).sort().slice(-60);
  if (keys.length < 7) { card.style.display = 'none'; return; }
  card.style.display = '';

  const latest = tdeeData[keys[keys.length-1]];
  const staticTDEE = getStaticTDEE();

  let html = `<div style="text-align:center;margin-bottom:12px">
    <div style="font-size:2rem;font-weight:700;color:var(--cyan)">${latest.toLocaleString()}</div>
    <div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px">estimated cal/day</div>
    ${staticTDEE ? `<div style="font-size:0.68rem;color:var(--muted2);margin-top:4px">Calculator TDEE: ${staticTDEE.toLocaleString()}</div>` : ''}
  </div>`;

  // Mini sparkline
  const vals = keys.map(k => tdeeData[k]);
  const min = Math.min(...vals) - 50, max = Math.max(...vals) + 50;
  const w = 300, h = 50;
  const pts = vals.map((v, i) => `${(i/(vals.length-1)*w).toFixed(1)},${((max-v)/(max-min)*h).toFixed(1)}`).join(' ');
  html += `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:50px">
    <polyline points="${pts}" fill="none" stroke="var(--cyan)" stroke-width="2"/>
  </svg>`;

  document.getElementById('tdeeTrendContent').innerHTML = html;
}
```

- [ ] **Step 3: Add `renderEnergyBalance()` function**

```javascript
function renderEnergyBalance() {
  const s = getSettings();
  const card = document.getElementById('energyBalanceCard');
  if (!card) return;
  if (!s.features.energyBalance) { card.style.display = 'none'; return; }
  const tdeeData = ls(TDEE_KEY, {});
  const data = getData();
  const today = new Date(); today.setHours(0,0,0,0);
  const days = [];
  for (let i = 59; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = makeKey(d.getFullYear(), d.getMonth(), d.getDate());
    days.push({ date: d, cal: data[key], tdee: tdeeData[key] });
  }
  const hasTDEE = days.some(d => d.tdee);
  if (!hasTDEE) { card.style.display = 'none'; return; }
  card.style.display = '';

  const W=800,H=180,P={l:48,r:20,t:14,b:28};
  const pw=W-P.l-P.r, ph=H-P.t-P.b;
  const allVals = days.filter(d=>d.cal||d.tdee).flatMap(d=>[d.cal,d.tdee].filter(Boolean));
  const maxV = Math.max(...allVals)*1.1, minV = Math.min(...allVals)*0.8;
  const yS = v => P.t+((maxV-v)/(maxV-minV))*ph;

  let html = '';
  // Grid lines
  for(let i=0;i<=4;i++){const v=minV+((maxV-minV)*(4-i)/4),y=P.t+(i/4)*ph;const lbl=v>=1000?(v/1000).toFixed(1)+'k':Math.round(v);html+=`<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W-P.r}" y2="${y.toFixed(1)}" stroke="#1a1535" stroke-width="1"/><text x="${P.l-5}" y="${(y+4).toFixed(1)}" text-anchor="end" fill="#6b7280" font-size="11">${lbl}</text>`;}

  // Shaded area between lines
  const calPts=[], tdeePts=[];
  days.forEach((d,i)=>{
    const x=P.l+i*(pw/60);
    if(d.cal!==undefined)calPts.push({x,y:yS(d.cal),cal:d.cal,tdee:d.tdee});
    if(d.tdee)tdeePts.push({x,y:yS(d.tdee)});
  });

  // Intake line (7-day moving average)
  const calAvg=[];
  for(let i=0;i<60;i++){const slice=days.slice(Math.max(0,i-6),i+1).filter(d=>d.cal!==undefined);if(slice.length>=2){const avg=slice.reduce((s,d)=>s+d.cal,0)/slice.length;calAvg.push(`${(P.l+i*(pw/60)).toFixed(1)},${yS(avg).toFixed(1)}`);}}
  if(calAvg.length>1)html+=`<polyline points="${calAvg.join(' ')}" fill="none" stroke="#00d4ff" stroke-width="2.5"/>`;

  // TDEE line
  if(tdeePts.length>1){const pts=tdeePts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');html+=`<polyline points="${pts}" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-dasharray="6,3"/>`;}

  // Date labels
  for(let i=0;i<60;i+=10){const d=days[i].date;const x=P.l+i*(pw/60);html+=`<text x="${x.toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#6b7280" font-size="10">${d.getMonth()+1}/${d.getDate()}</text>`;}

  document.getElementById('energySvg').innerHTML=html;
}
```

- [ ] **Step 4: Add both render functions to `refreshAll()`**

- [ ] **Step 5: Test**

TDEE trend and energy balance cards appear on the Progress page when sufficient data exists. They stay hidden when data is insufficient.

- [ ] **Step 6: Commit**

```bash
git add app.js index.html
git commit -m "feat: TDEE trend card and energy balance chart on progress page"
```

---

## Task 16: Goal Progress Waterfall Chart

**Files:**
- Modify: `index.html` (progress page — add card)
- Modify: `app.js` (add render function)

- [ ] **Step 1: Add card HTML**

In `index.html`, after the energy balance card, add:

```html
<div class="card" id="goalWaterfallCard" style="display:none">
  <div class="card-title">Goal Progress</div>
  <div class="chart-area">
    <svg id="waterfallSvg" viewBox="0 0 800 160"></svg>
  </div>
  <div style="display:flex;gap:14px;margin-top:8px;font-size:0.78rem;">
    <span style="color:#34d399">■ Toward goal</span>
    <span style="color:#f87171">■ Away from goal</span>
  </div>
</div>
```

- [ ] **Step 2: Add `renderGoalWaterfall()` function**

```javascript
function renderGoalWaterfall() {
  const s = getSettings();
  const card = document.getElementById('goalWaterfallCard');
  if (!card) return;
  if (!s.features.goalWaterfall) { card.style.display='none'; return; }
  const weights = ls(WEIGHTS_KEY, {});
  const calc = ls(CALC_KEY, {});
  const goalWt = parseFloat(calc.goalWeight || document.getElementById('cGoalWeight')?.value);
  const entries = Object.entries(weights).sort((a,b)=>a[0].localeCompare(b[0]));
  if (!goalWt || entries.length < 7) { card.style.display='none'; return; }
  card.style.display='';

  const isCut = entries[0][1] > goalWt;
  const vals = entries.map(e => e[1]);
  const ema = calcEMA(vals, 0.1);
  const changes = [];
  for (let i = 1; i < ema.length; i++) {
    const delta = ema[i] - ema[i-1];
    const toward = isCut ? delta < 0 : delta > 0;
    changes.push({ date: entries[i][0], delta: Math.abs(delta), toward });
  }
  const last30 = changes.slice(-30);

  const W=800,H=160,P={l:48,r:20,t:14,b:28};
  const pw=W-P.l-P.r, ph=H-P.t-P.b;
  const maxDelta = Math.max(...last30.map(c=>c.delta), 0.5);
  const barW = pw/last30.length - 2;

  let html = '';
  last30.forEach((c, i) => {
    const x = P.l + i * (pw/last30.length);
    const barH = Math.max(2, (c.delta/maxDelta) * (ph/2));
    const y = c.toward ? P.t + ph/2 - barH : P.t + ph/2;
    const color = c.toward ? 'rgba(16,185,129,0.72)' : 'rgba(239,68,68,0.72)';
    html += `<rect x="${(x+1).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"><title>${c.date}: ${c.toward?'↓':'↑'} ${c.delta.toFixed(2)} lbs</title></rect>`;
  });
  // Center line
  html += `<line x1="${P.l}" y1="${P.t+ph/2}" x2="${W-P.r}" y2="${P.t+ph/2}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
  // Date labels
  for(let i=0;i<last30.length;i+=5){const d=last30[i];const x=P.l+i*(pw/last30.length);html+=`<text x="${(x+barW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#6b7280" font-size="10">${d.date.slice(5)}</text>`;}

  document.getElementById('waterfallSvg').innerHTML = html;
}
```

- [ ] **Step 3: Add `renderGoalWaterfall()` to `refreshAll()`**

- [ ] **Step 4: Test**

Verify waterfall chart appears when 7+ weight entries exist and goal weight is set.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: goal progress waterfall chart on progress page"
```

---

## Task 17: Claude Weekly Coach

**Files:**
- Modify: `index.html` (add coach modal HTML)
- Modify: `app.js` (add coach logic, check-in trigger, modal)
- Modify: `styles.css` (coach modal styles)

- [ ] **Step 1: Add coach modal HTML**

In `index.html`, before the `<script>` tag (before line 562), add:

```html
<!-- ── COACH MODAL ── -->
<div class="overlay" id="coachOverlay" onclick="coachOverlayClick(event)" style="display:none">
  <div class="modal" style="max-width:480px">
    <h3 id="coachTitle" style="color:var(--cyan)">Weekly Check-in</h3>
    <div id="coachContent"></div>
    <div class="modal-btns" id="coachBtns"></div>
  </div>
</div>
```

- [ ] **Step 2: Add coach logic in `app.js`**

```javascript
/* ── WEEKLY COACH ── */
function checkCoachCheckin() {
  const s = getSettings();
  const today = new Date(); today.setHours(0,0,0,0);
  if (today.getDay() !== s.coachDay) return;
  // Check if already had check-in this week
  const coach = ls(COACH_KEY, []);
  const startDay = s.weekStartDay !== undefined ? s.weekStartDay : 1;
  const wStart = new Date(today);
  while (wStart.getDay() !== startDay) wStart.setDate(wStart.getDate() - 1);
  const wStartStr = makeKey(wStart.getFullYear(), wStart.getMonth(), wStart.getDate());
  const hasCheckin = coach.some(c => c.date >= wStartStr);
  if (hasCheckin) return;
  // Check for API key
  const apiKey = localStorage.getItem('blubr_api_key');
  if (!apiKey) return;
  showCoachModal();
}

async function showCoachModal() {
  const overlay = document.getElementById('coachOverlay');
  overlay.style.display = 'flex';
  const content = document.getElementById('coachContent');
  const btns = document.getElementById('coachBtns');
  content.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Analyzing your week...</div>';
  btns.innerHTML = '<button class="btn-cancel" onclick="closeCoachModal()">Cancel</button>';

  const s = getSettings();
  const data = getData();
  const macros = ls(MACROS_KEY, {});
  const weights = ls(WEIGHTS_KEY, {});
  const today = new Date(); today.setHours(0,0,0,0);
  const startDay = s.weekStartDay !== undefined ? s.weekStartDay : 1;
  const wStart = new Date(today);
  while (wStart.getDay() !== startDay) wStart.setDate(wStart.getDate() - 1);
  wStart.setDate(wStart.getDate() - 7); // Look at LAST week
  const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + 7);

  const dailyCal = {}, dailyMac = {}, wtEntries = {};
  let daysLogged = 0, daysOnTarget = 0, totalCal = 0;
  const dailyGoal = Math.round(s.weekly / 7);
  const cur = new Date(wStart);
  while (cur < wEnd) {
    const key = makeKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
    if (data[key] !== undefined) { dailyCal[key] = data[key]; totalCal += data[key]; daysLogged++; if (data[key] <= dailyGoal) daysOnTarget++; }
    if (macros[key]) dailyMac[key] = macros[key];
    if (weights[key]) wtEntries[key] = isMetric() ? parseFloat((weights[key]*0.453592).toFixed(1)) : weights[key];
    cur.setDate(cur.getDate() + 1);
  }

  const tdee = getStaticTDEE();
  const pace = ls(CALC_KEY, {}).pace;
  const paceLabel = pace ? (parseInt(pace) < 0 ? 'bulk' : parseInt(pace) === 0 ? 'maintain' : 'cut') : 'cut';
  const periodStr = `${makeKey(wStart.getFullYear(),wStart.getMonth(),wStart.getDate())} to ${makeKey(wEnd.getFullYear(),wEnd.getMonth(),wEnd.getDate())}`;

  const payload = {
    period: periodStr, dailyCalories: dailyCal, dailyMacros: dailyMac, weightEntries: wtEntries,
    goal: { type: paceLabel, pace: pace || '500', dailyTarget: dailyGoal },
    adaptiveTDEE: tdee, adherence: { daysLogged, daysOnTarget, avgCalories: daysLogged > 0 ? Math.round(totalCal/daysLogged) : 0 }
  };

  const apiKey = localStorage.getItem('blubr_api_key');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: `You are a friendly nutrition coach inside a calorie tracking app. Be encouraging and adherence-neutral (no shaming). Respond with valid JSON only: {"summary":"2-3 sentences","recommendedCal":number,"recommendedP":number,"recommendedC":number,"recommendedF":number,"tip":"one actionable tip","adjustmentReason":"why or empty string"}. Only recommend changes if data clearly supports it. If data is thin, keep current targets.`,
        messages: [{ role: 'user', content: JSON.stringify(payload) }]
      })
    });
    const json = await res.json();
    const text = json.content[0].text;
    const advice = JSON.parse(text);
    renderCoachAdvice(advice, dailyGoal, s);
  } catch (e) {
    content.innerHTML = `<div style="color:var(--red);padding:12px">Coach unavailable: ${e.message}</div>`;
    btns.innerHTML = '<button class="btn-cancel" onclick="closeCoachModal()">Close</button>';
  }
}

function renderCoachAdvice(advice, currentCal, s) {
  const content = document.getElementById('coachContent');
  const btns = document.getElementById('coachBtns');
  const hasChanges = advice.recommendedCal && advice.recommendedCal !== currentCal;

  let html = `<div style="padding:12px;border:2px solid rgba(0,212,255,0.15);background:rgba(0,212,255,0.03);margin-bottom:12px;font-size:0.88rem;line-height:1.7">${escHtml(advice.summary)}</div>`;

  if (hasChanges) {
    html += `<div style="font-size:0.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Recommended Changes</div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="text-align:center;padding:10px;border:1px solid rgba(255,255,255,0.1)">
        <div style="font-size:0.65rem;color:var(--muted);text-transform:uppercase">Current</div>
        <div style="font-size:1.2rem;font-weight:700">${currentCal.toLocaleString()}</div>
        <div style="font-size:0.65rem;color:var(--muted)">cal/day</div>
      </div>
      <div style="text-align:center;padding:10px;border:2px solid var(--cyan);background:rgba(0,212,255,0.04)">
        <div style="font-size:0.65rem;color:var(--cyan);text-transform:uppercase">Recommended</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--cyan)">${advice.recommendedCal.toLocaleString()}</div>
        <div style="font-size:0.65rem;color:var(--muted)">cal/day</div>
      </div>
    </div>`;
    if (advice.adjustmentReason) html += `<div style="font-size:0.78rem;color:var(--muted);margin-bottom:12px;font-style:italic">${escHtml(advice.adjustmentReason)}</div>`;
  }

  if (advice.tip) {
    html += `<div style="padding:10px 12px;border-left:3px solid var(--green);background:rgba(16,185,129,0.04);font-size:0.82rem;line-height:1.6;color:var(--text)">
      <span style="font-size:0.62rem;color:var(--green);text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:4px">Tip of the week</span>
      ${escHtml(advice.tip)}
    </div>`;
  }

  content.innerHTML = html;
  // Store advice for saving
  content.dataset.advice = JSON.stringify(advice);

  if (hasChanges) {
    btns.innerHTML = `<button class="btn-cancel" onclick="dismissCoach()">Keep Current</button>
      <button class="btn-save" onclick="acceptCoach()">Accept Changes</button>`;
  } else {
    btns.innerHTML = `<button class="btn-save" onclick="dismissCoach()">Got It</button>`;
  }
}

function acceptCoach() {
  const content = document.getElementById('coachContent');
  const advice = JSON.parse(content.dataset.advice || '{}');
  if (advice.recommendedCal) {
    const existing = ls(SET_KEY, {});
    existing.weekly = advice.recommendedCal * 7;
    existing.green = advice.recommendedCal;
    existing.red = Math.round(advice.recommendedCal * 1.2);
    if (advice.recommendedP) existing.macroP = advice.recommendedP;
    if (advice.recommendedC) existing.macroC = advice.recommendedC;
    if (advice.recommendedF) existing.macroF = advice.recommendedF;
    lsSet(SET_KEY, existing);
    // Update settings inputs
    const sWeekly = document.getElementById('sWeekly'); if (sWeekly) sWeekly.value = existing.weekly;
    const sMacroP = document.getElementById('sMacroP'); if (sMacroP) sMacroP.value = existing.macroP;
    const sMacroC = document.getElementById('sMacroC'); if (sMacroC) sMacroC.value = existing.macroC;
    const sMacroF = document.getElementById('sMacroF'); if (sMacroF) sMacroF.value = existing.macroF;
    const sGreen = document.getElementById('sGreen'); if (sGreen) sGreen.value = existing.green;
    const sRed = document.getElementById('sRed'); if (sRed) sRed.value = existing.red;
  }
  saveCoachEntry(advice, true);
  closeCoachModal();
  refreshAll();
  showToast('Goal updated by coach');
}

function dismissCoach() {
  const content = document.getElementById('coachContent');
  const advice = JSON.parse(content.dataset.advice || '{}');
  saveCoachEntry(advice, false);
  closeCoachModal();
}

function saveCoachEntry(advice, accepted) {
  const coach = ls(COACH_KEY, []);
  const today = new Date();
  const pad = n => String(n).padStart(2,'0');
  coach.push({
    date: `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`,
    summary: advice.summary || '', recommendedCal: advice.recommendedCal || 0,
    recommendedP: advice.recommendedP || 0, recommendedC: advice.recommendedC || 0, recommendedF: advice.recommendedF || 0,
    tip: advice.tip || '', adjustmentReason: advice.adjustmentReason || '', accepted
  });
  lsSet(COACH_KEY, coach);
}

function closeCoachModal() { document.getElementById('coachOverlay').style.display = 'none'; }
function coachOverlayClick(e) { if (e.target.id === 'coachOverlay') closeCoachModal(); }
```

- [ ] **Step 3: Trigger coach check-in on app load**

In `init()`, at the end, add: `setTimeout(checkCoachCheckin, 2000);` — delayed so the app loads first.

- [ ] **Step 4: Test coach modal**

Set coach day to today's day of week, verify the modal appears. Test accept and dismiss flows.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: Claude weekly coach - AI-powered weekly check-in with recommendations"
```

---

## Task 18: Coach Countdown Card

**Files:**
- Modify: `index.html` (home page — add card)
- Modify: `app.js` (add render function)

- [ ] **Step 1: Add card HTML to home page**

After the copy last meal card, add:

```html
<div class="card" id="coachCountdownCard" style="display:none">
  <div id="coachCountdownContent"></div>
</div>
```

- [ ] **Step 2: Add `renderCoachCountdown()` function**

```javascript
function renderCoachCountdown() {
  const s = getSettings();
  const card = document.getElementById('coachCountdownCard');
  if (!card) return;
  if (!s.features.coachCountdown) { card.style.display = 'none'; return; }
  const apiKey = localStorage.getItem('blubr_api_key');
  if (!apiKey) { card.style.display = 'none'; return; }
  card.style.display = '';

  const today = new Date(); today.setHours(0,0,0,0);
  let daysUntil = (s.coachDay - today.getDay() + 7) % 7;
  if (daysUntil === 0) daysUntil = 0; // Today is coach day
  const coachDayName = DAYS_LONG[s.coachDay];

  const coach = ls(COACH_KEY, []);
  const last = coach.length > 0 ? coach[coach.length - 1] : null;

  let html = `<div style="display:flex;align-items:center;gap:12px">
    <div style="font-size:2rem;color:var(--cyan)">🧠</div>
    <div style="flex:1">
      <div style="font-size:0.62rem;color:var(--muted2);text-transform:uppercase;letter-spacing:1px">Weekly Coach</div>
      <div style="font-size:0.88rem;font-weight:600">${daysUntil === 0 ? 'Check-in today!' : `Next: ${coachDayName} (${daysUntil} day${daysUntil>1?'s':''})`}</div>
      ${last ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(last.tip || last.summary || '').slice(0,60)}...</div>` : ''}
    </div>
  </div>`;

  document.getElementById('coachCountdownContent').innerHTML = html;
}
```

- [ ] **Step 3: Add `renderCoachCountdown()` to `refreshAll()`**

- [ ] **Step 4: Test**

Verify countdown card shows on home page with correct day calculation.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: coach countdown card on home page"
```

---

## Task 19: Missed Day Recovery Popup

**Files:**
- Modify: `index.html` (add recovery modal)
- Modify: `app.js` (add recovery logic)
- Modify: `styles.css` (estimated day indicator)

- [ ] **Step 1: Add recovery modal HTML**

In `index.html`, before the `<script>` tag, add:

```html
<!-- ── MISSED DAY RECOVERY ── -->
<div class="overlay" id="recoveryOverlay" style="display:none">
  <div class="modal" style="max-width:500px">
    <h3 style="color:var(--yellow)">Missed Days</h3>
    <div style="font-size:0.82rem;color:var(--muted);margin-bottom:14px">Fill in the gaps to keep your data accurate.</div>
    <div id="recoveryDays"></div>
    <div class="modal-btns">
      <button class="btn-save" onclick="closeRecoveryModal()">Done</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add recovery logic in `app.js`**

```javascript
/* ── MISSED DAY RECOVERY ── */
function checkMissedDays() {
  const data = getData();
  const today = new Date(); today.setHours(0,0,0,0);
  const missed = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = makeKey(d.getFullYear(), d.getMonth(), d.getDate());
    if (data[key] === undefined) {
      // Check sessionStorage dismiss
      const dismissed = JSON.parse(sessionStorage.getItem('blubr_dismissed_days') || '[]');
      if (!dismissed.includes(key)) missed.push({ date: d, key });
    }
  }
  if (missed.length > 0) showRecoveryModal(missed);
}

function showRecoveryModal(missed) {
  document.getElementById('recoveryOverlay').style.display = 'flex';
  const container = document.getElementById('recoveryDays');
  container.innerHTML = missed.map(m => {
    const label = `${DAYS_LONG[m.date.getDay()]}, ${MONTHS[m.date.getMonth()]} ${m.date.getDate()}`;
    return `<div class="recovery-day" id="rd-${m.key}" style="border:2px solid rgba(255,255,255,0.08);padding:12px;margin-bottom:8px">
      <div style="font-weight:600;font-size:0.88rem;margin-bottom:8px">${label}</div>
      <div class="recovery-actions" id="ra-${m.key}">
        <button class="btn-modal-meal-action" onclick="recoveryDescribe('${m.key}')">Describe</button>
        <button class="btn-modal-meal-action" onclick="recoveryEstimate('${m.key}','under')">Under ate</button>
        <button class="btn-modal-meal-action" onclick="recoveryEstimate('${m.key}','track')">On track</button>
        <button class="btn-modal-meal-action" onclick="recoveryEstimate('${m.key}','over')">Over ate</button>
        <button class="btn-modal-meal-action btn-modal-meal-del" onclick="recoverySkip('${m.key}')">Skip</button>
      </div>
    </div>`;
  }).join('');
}

function recoveryDescribe(dateKey) {
  const actions = document.getElementById('ra-' + dateKey);
  actions.innerHTML = `<textarea id="rdesc-${dateKey}" placeholder="What did you eat? (e.g., pizza for dinner, skipped lunch)" rows="2" style="width:100%;padding:8px;font-size:0.88rem;font-family:'Outfit',sans-serif;resize:none;background:var(--input);border:2px solid rgba(255,255,255,0.15);color:var(--text);margin-bottom:6px"></textarea>
    <button class="btn-modal-meal-action" onclick="recoveryAIEstimate('${dateKey}')">Estimate with AI</button>
    <button class="btn-modal-meal-action btn-modal-meal-del" onclick="recoverySkip('${dateKey}')">Cancel</button>`;
}

async function recoveryAIEstimate(dateKey) {
  const desc = document.getElementById('rdesc-' + dateKey).value.trim();
  if (!desc) return;
  const actions = document.getElementById('ra-' + dateKey);
  actions.innerHTML = '<div style="color:var(--cyan);font-size:0.82rem">Estimating...</div>';

  const apiKey = localStorage.getItem('blubr_api_key');
  if (!apiKey) { actions.innerHTML = '<div style="color:var(--red)">No API key set</div>'; return; }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: 'Estimate calories and macros for the described food. Return JSON only: {"calories":number,"protein":number,"carbs":number,"fat":number,"notes":"brief meal name"}',
        messages: [{ role: 'user', content: desc }]
      })
    });
    const json = await res.json();
    const est = JSON.parse(json.content[0].text);
    _addMeal(dateKey, est.notes || 'Estimated', est.calories, est.protein||0, est.carbs||0, est.fat||0, { estimated: true });
    actions.innerHTML = `<div style="color:var(--green)">✓ Logged ${est.calories} cal (${est.notes})</div>`;
    refreshAll();
  } catch (e) {
    actions.innerHTML = `<div style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

function recoveryEstimate(dateKey, level) {
  const s = getSettings();
  const dailyGoal = Math.round(s.weekly / 7);
  const multiplier = level === 'under' ? 0.8 : level === 'over' ? 1.3 : 1.0;
  const cal = Math.round(dailyGoal * multiplier);
  _addMeal(dateKey, 'Estimated', cal, 0, 0, 0, { estimated: true });
  const actions = document.getElementById('ra-' + dateKey);
  actions.innerHTML = `<div style="color:var(--green)">✓ Logged ~${cal.toLocaleString()} cal (${level === 'under' ? 'under' : level === 'over' ? 'over' : 'on track'})</div>`;
  refreshAll();
}

function recoverySkip(dateKey) {
  const dismissed = JSON.parse(sessionStorage.getItem('blubr_dismissed_days') || '[]');
  dismissed.push(dateKey);
  sessionStorage.setItem('blubr_dismissed_days', JSON.stringify(dismissed));
  const el = document.getElementById('rd-' + dateKey);
  if (el) el.style.display = 'none';
  // If all days handled, close modal
  const remaining = document.querySelectorAll('.recovery-day:not([style*="display: none"])');
  if (remaining.length === 0) closeRecoveryModal();
}

function closeRecoveryModal() { document.getElementById('recoveryOverlay').style.display = 'none'; }
```

- [ ] **Step 3: Add estimated day CSS indicator**

In `styles.css`, add styles for estimated days in the calendar:

```css
.cal-cell.estimated { border: 2px dashed rgba(251,191,36,0.4) !important; }
```

- [ ] **Step 4: Update `renderCalendar()` to mark estimated days**

In `renderCalendar()`, when building the cell, check if the day's meals have `estimated` flag:

After `const isRefeed = !!refeed[key];`, add:
```javascript
const meals = ls(MEALS_KEY, {});
const dayMeals = meals[key] || [];
const isEstimated = dayMeals.some(m => m.estimated);
```

And after `el.className = 'cal-cell' + (isToday ? ' today' : '');`, add:
```javascript
if (isEstimated) el.classList.add('estimated');
```

- [ ] **Step 5: Trigger missed day check on init**

In `init()`, add: `setTimeout(checkMissedDays, 3000);` — after coach check-in.

- [ ] **Step 6: Test missed day recovery**

Clear a previous day's data. Reload app. Verify popup appears with the missed day. Test "Describe", "On track", and "Skip" flows.

- [ ] **Step 7: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: missed day recovery popup with AI estimation and quick estimates"
```

---

## Task 20: Final Integration & Visual Testing

**Files:**
- Modify: `app.js` (ensure all render functions in `refreshAll`)

- [ ] **Step 1: Verify `refreshAll()` includes all new render functions**

The final `refreshAll()` should include:

```javascript
function refreshAll() {
  renderToday();
  renderRecentStrip();
  renderCalendar();
  updateWeekly();
  updateStatsBar();
  renderCalChart();
  renderMacroChart();
  renderWeightChart();
  renderPresets();
  renderHistory();
  renderProgressPhotos();
  renderGoalSummary();
  // New
  renderWeeklyBudget();
  renderStreakGrid();
  renderCopyLastMeal();
  renderTDEETrend();
  renderEnergyBalance();
  renderGoalWaterfall();
  renderCoachCountdown();
}
```

- [ ] **Step 2: Visual test — Home page**

Preview the app at http://localhost:8000. Verify:
- Today card shows macro rings (if macros logged)
- Weekly budget bar shows correct data
- Copy last meal card shows most recent meal
- Coach countdown card shows next check-in
- Three-tier colors on Last 7 Days strip

- [ ] **Step 3: Visual test — Calendar page**

- Three-tier coloring on calendar cells (green/yellow/red)
- Updated legend with three tiers
- Estimated days show dotted border
- Copy meal button in day modal

- [ ] **Step 4: Visual test — Progress page**

- Streak grid with green squares
- Smoothed weight trend (EMA line on weight chart)
- TDEE trend card (if enough data)
- Energy balance chart (if enough data)
- Goal waterfall (if enough data)

- [ ] **Step 5: Visual test — Settings page**

- Calorie Banking toggle and day pickers
- Dashboard Features toggles
- Week Start Day and Coach Day dropdowns

- [ ] **Step 6: Functional test — Toggle features off**

Toggle each feature off in settings, verify the corresponding card disappears.

- [ ] **Step 7: Functional test — Calorie banking**

Enable banking with Saturday/Sunday, log meals under goal on weekdays, verify the adjusted goal appears on binge days.

- [ ] **Step 8: Commit final integration**

```bash
git add app.js index.html styles.css
git commit -m "feat: complete MacroFactor-inspired features - all 9 dashboard cards, banking, TDEE, coach"
```
