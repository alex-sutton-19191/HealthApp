/* ── THEME: apply immediately to avoid flash ── */
  (function() {
    const t = localStorage.getItem('blubr_theme');
    document.documentElement.setAttribute('data-theme', t || 'clean');
  })();

/* ── SUPABASE INIT ── */
  const SUPABASE_URL  = 'https://fhublaxwqbufmorqyzhp.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZodWJsYXh3cWJ1Zm1vcnF5emhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTU2MjMsImV4cCI6MjA4ODE3MTYyM30.Rt7Q4YCoaQqKt2lLLUZpdkH4yOsbDL7R6YyNmz-FXFE';
  const _configured = !SUPABASE_URL.includes('YOUR_PROJECT_REF');
  const _sb = _configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'blubr-auth',
      storage: localStorage
    }
  }) : null;

  /* ── IN-MEMORY CACHE ── */
  let _cache = {
    ct_data: {}, ct_macros: {}, ct_notes: {}, ct_refeed: {},
    ct_weights: {}, ct_presets: [], ct_settings: {}, ct_calc: {},
    ct_photos: {}, ct_meals: {}, ct_tdee: {}, ct_coach: []
  };
  let _currentUser = null;
  let _syncTimer   = null;
  let _dataLoaded  = false;  // true after _loadFromSupabase completes
  let _savePending = false;  // true when there are unsaved changes in _cache
  let _saveInFlight = null;  // current save promise (to await before reload)
  let _accessToken = '';     // current auth token for beforeunload saves

  async function _loadFromSupabase() {
    if (!_currentUser || !_sb) return;
    // Don't re-load if we already have data and there are unsaved changes
    if (_dataLoaded && _savePending) {
      console.warn('Skipping reload — unsaved changes in cache');
      return;
    }
    const { data, error } = await _sb
      .from('user_data')
      .select('*')
      .eq('id', _currentUser.id)
      .single();
    if (error && error.code !== 'PGRST116') { console.error('Load error:', error); return; }
    if (data) {
      const keys = ['ct_data','ct_macros','ct_notes','ct_refeed','ct_weights','ct_presets','ct_settings','ct_calc','ct_photos','ct_meals','ct_tdee','ct_coach'];
      keys.forEach(k => { if (data[k] !== undefined) _cache[k] = data[k]; });
    }
    _dataLoaded = true;
    _savePending = false;
    await _migrateLocalStorage();
  }

  async function _migrateLocalStorage() {
    const hasData = Object.keys(_cache.ct_data).length > 0
                 || Object.keys(_cache.ct_weights).length > 0
                 || (_cache.ct_presets && _cache.ct_presets.length > 0);
    if (hasData) return;
    const keys = ['ct_data','ct_macros','ct_notes','ct_refeed','ct_weights','ct_presets','ct_settings','ct_calc','ct_photos','ct_meals','ct_tdee','ct_coach'];
    let foundAny = false;
    keys.forEach(k => {
      try { const v = JSON.parse(localStorage.getItem(k)); if (v !== null) { _cache[k] = v; foundAny = true; } } catch {}
    });
    if (foundAny) { await _flushToSupabase(); console.log('Migrated localStorage data to Supabase'); }
  }

  function _scheduleSave() {
    if (!_configured) return;  // local mode: handled by ls/lsSet localStorage fallback
    _savePending = true;
    // Also persist to localStorage as a safety net (quick backup)
    try { localStorage.setItem('blubr_cache_backup', JSON.stringify(_cache)); } catch {}
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_flushToSupabase, 1500);
  }

  // Call this for critical mutations (add/delete/edit meal) — saves immediately
  function _saveNow() {
    if (!_configured) return;
    _savePending = true;
    try { localStorage.setItem('blubr_cache_backup', JSON.stringify(_cache)); } catch {}
    clearTimeout(_syncTimer);
    _flushToSupabase();
  }

  async function _flushToSupabase() {
    if (!_currentUser || !_sb) return;
    if (!_dataLoaded) { console.warn('Skipping save — data not loaded yet'); return; }
    const payload = { id: _currentUser.id, ..._cache };
    const promise = _sb.from('user_data').upsert(payload, { onConflict: 'id' });
    _saveInFlight = promise;
    const { error } = await promise;
    _saveInFlight = null;
    if (error) {
      console.error('Save error:', error);
    } else {
      _savePending = false;
      try { localStorage.removeItem('blubr_cache_backup'); } catch {}
    }
  }

  /* ── CONSTANTS ── */
  const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS_LONG   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAYS_SHORT  = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const DATA_KEY    = 'ct_data';
  const SET_KEY     = 'ct_settings';
  const NOTES_KEY   = 'ct_notes';
  const REFEED_KEY  = 'ct_refeed';
  const WEIGHTS_KEY = 'ct_weights';
  const PRESETS_KEY = 'ct_presets';
  const CALC_KEY    = 'ct_calc';
  const MACROS_KEY  = 'ct_macros';
  const MEALS_KEY   = 'ct_meals';
  const TDEE_KEY  = 'ct_tdee';
  const COACH_KEY = 'ct_coach';

  let viewYear  = new Date().getFullYear();
  let viewMonth = new Date().getMonth();
  let viewDay   = new Date().getDate();
  let calView   = 'day'; // 'day' | 'week' | 'month'
  let modalKey  = null;
  let calcMode  = 'weight';

  /* ── STORAGE ── */
  function ls(key, fb) {
    if (!_configured) { try { return JSON.parse(localStorage.getItem(key)) ?? fb; } catch { return fb; } }
    const v = _cache[key]; return (v === undefined || v === null) ? fb : v;
  }
  function lsSet(key, val) {
    if (!_configured) { localStorage.setItem(key, JSON.stringify(val)); return; }
    _cache[key] = val; _scheduleSave();
  }

  /* ── AUTH ── */
  function showAuthOverlay(show) {
    document.getElementById('authOverlay').style.display   = show ? 'flex' : 'none';
    document.getElementById('appContainer').style.display  = show ? 'none' : 'block';
    document.querySelector('.bottom-nav').style.display    = show ? 'none' : 'grid';
    // Always reset loading state when showing the overlay
    if (show) _setAuthLoading(false);
    // hide logout buttons when running in local (no-Supabase) mode
    const logoutBtn      = document.querySelector('.bottom-nav button[onclick="authLogout()"]');
    const settingsLogout = document.getElementById('settingsLogoutBtn');
    if (logoutBtn)      logoutBtn.style.display      = _configured ? '' : 'none';
    if (settingsLogout) settingsLogout.style.display = _configured ? '' : 'none';
    const lb = document.getElementById('localModeBanner'); if (lb) lb.style.display = (!_configured && !show) ? 'block' : 'none';
  }

  function showAuthError(msg, isSuccess) {
    const el = document.getElementById('authError');
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
    el.style.color = isSuccess ? 'var(--green)' : 'var(--red)';
  }

  let _authLoadingTimer = null;
  let _authLoadingDelayTimer = null;
  function _setAuthLoading(on) {
    const form = document.getElementById('authForm');
    const spinner = document.getElementById('authSpinner');
    const retryBtn = document.getElementById('authRetryBtn');
    if (_authLoadingTimer) { clearTimeout(_authLoadingTimer); _authLoadingTimer = null; }
    if (_authLoadingDelayTimer) { clearTimeout(_authLoadingDelayTimer); _authLoadingDelayTimer = null; }
    if (on) {
      // Delay showing spinner by 1s — fast logins skip it entirely
      _authLoadingDelayTimer = setTimeout(() => {
        form.style.display = 'none';
        spinner.style.display = 'flex';
        if (retryBtn) retryBtn.style.display = 'none';
        _authLoadingTimer = setTimeout(() => {
          if (retryBtn) retryBtn.style.display = '';
        }, 4000);
      }, 1000);
    } else {
      form.style.display = 'flex';
      spinner.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'none';
    }
  }

  window.toggleAuthPw = function() {
    const inp = document.getElementById('authPassword');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    document.getElementById('authPwEyeOff').style.display = show ? 'none' : '';
    document.getElementById('authPwEye').style.display = show ? '' : 'none';
  };

  function _friendlyAuthError(msg) {
    const m = msg.toLowerCase();
    if (m.includes('rate') && m.includes('limit')) return 'Too many attempts — please wait a few minutes and try again';
    if (m.includes('email rate limit')) return 'Too many sign-up emails sent — please wait a few minutes and try again';
    if (m.includes('invalid login credentials')) return 'Incorrect email or password';
    if (m.includes('email not confirmed')) return 'Please check your email and click the confirmation link first';
    if (m.includes('user already registered')) return 'An account with this email already exists — try signing in instead';
    return msg;
  }

  async function authSignIn() {
    showAuthError('');
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    // Demo mode bypass
    if (email.toLowerCase() === 'admin' && password === 'admin') { _loadDemoData(); return; }
    if (!email) { showAuthError('Please enter your email address'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('Please enter a valid email address'); return; }
    if (!password) { showAuthError('Please enter your password'); return; }
    _setAuthLoading(true);
    const { error } = await _sb.auth.signInWithPassword({ email: email.toLowerCase(), password });
    if (error) { _setAuthLoading(false); showAuthError(_friendlyAuthError(error.message)); }
    // on success, onAuthStateChange will handle the rest and show loading spinner
  }

  function _generateDemoData() {
    // Reset all cache to empty
    _cache = { ct_data:{}, ct_macros:{}, ct_notes:{}, ct_refeed:{}, ct_weights:{}, ct_presets:[], ct_settings:{}, ct_calc:{}, ct_photos:{}, ct_meals:{}, ct_tdee:{}, ct_coach:[] };

    const today = new Date(); today.setHours(0,0,0,0);
    const pad = n => String(n).padStart(2,'0');
    const mk = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const mealNames = [
      ['Oatmeal & Berries','Greek Yogurt Bowl','Eggs & Toast','Protein Pancakes','Smoothie Bowl'],
      ['Chicken Wrap','Turkey Sandwich','Salmon Bowl','Stir Fry','Burrito Bowl'],
      ['Grilled Chicken','Pasta & Meatballs','Steak & Veggies','Fish Tacos','Rice & Beans']
    ];
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    // Generate 60 days of calorie + meal data
    for (let i = 59; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const key = mk(d);
      const base = 1700 + Math.round(Math.random() * 600);
      const p = 120 + Math.round(Math.random() * 60);
      const c = 180 + Math.round(Math.random() * 80);
      const f = 50 + Math.round(Math.random() * 30);
      // Skip a couple recent days to test missed day recovery
      if (i === 2 || i === 4) continue;
      // Skip ~10% of older days randomly for realism
      if (i > 7 && Math.random() < 0.1) continue;
      _cache.ct_meals[key] = [
        { name: pick(mealNames[0]), cal: Math.round(base*0.3), p: Math.round(p*0.3), c: Math.round(c*0.35), f: Math.round(f*0.3), ts: Date.now()-i*86400000 },
        { name: pick(mealNames[1]), cal: Math.round(base*0.35), p: Math.round(p*0.35), c: Math.round(c*0.3), f: Math.round(f*0.35), ts: Date.now()-i*86400000+3600000 },
        { name: pick(mealNames[2]), cal: Math.round(base*0.35), p: Math.round(p*0.35), c: Math.round(c*0.35), f: Math.round(f*0.35), ts: Date.now()-i*86400000+7200000 }
      ];
      const meals = _cache.ct_meals[key];
      _cache.ct_data[key] = meals.reduce((s,m) => s+m.cal, 0);
      _cache.ct_macros[key] = { p: meals.reduce((s,m) => s+m.p, 0), c: meals.reduce((s,m) => s+m.c, 0), f: meals.reduce((s,m) => s+m.f, 0) };
      // Occasional notes
      if (Math.random() < 0.15) _cache.ct_notes[key] = pick(['Felt great today','Hungry all day','Had a cheat snack','Good energy','Skipped a snack']);
    }
    // Generate weight entries (~40% of days over 60 days)
    let wt = 198;
    for (let i = 59; i >= 0; i--) {
      if (Math.random() > 0.4) continue;
      const d = new Date(today); d.setDate(today.getDate() - i);
      wt += (Math.random() - 0.55) * 0.6; // slight downward trend
      _cache.ct_weights[mk(d)] = parseFloat(wt.toFixed(1));
    }
    // Ensure enough weight entries for TDEE (need 5+ in last 28 days)
    for (let i of [0, 2, 5, 8, 12, 17, 21, 28, 35, 42, 50]) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      if (!_cache.ct_weights[mk(d)]) {
        wt += (Math.random() - 0.55) * 0.4;
        _cache.ct_weights[mk(d)] = parseFloat(wt.toFixed(1));
      }
    }
    // Settings
    _cache.ct_settings = { weekly: 14000, green: 2000, red: 2400, macroP: 150, macroC: 200, macroF: 65, useMetric: false,
      weekStartDay: 1, coachDay: today.getDay(),
      weekendBinge: { enabled: true, days: [5, 6] },
      features: { tdeeTrend:true, weeklyBudget:true, macroRings:true, streakGrid:true, energyBalance:true, goalWaterfall:true, smoothedWeight:true, copyMeal:true, coachCountdown:true }
    };
    // Calculator profile for TDEE fallback
    _cache.ct_calc = { sex:'male', age:'30', ft:'5', inch:'10', weight:'195', activity:'1.55', pace:'500', goalWeight:'180' };
    // Presets
    _cache.ct_presets = [
      { name: 'Protein Shake', cal: 280, p: 40, c: 15, f: 8 },
      { name: 'Chicken & Rice', cal: 520, p: 45, c: 55, f: 12 },
      { name: 'Greek Yogurt', cal: 150, p: 20, c: 12, f: 3 }
    ];
  }

  function _loadDemoData() {
    _generateDemoData();
    _currentUser = { id: 'demo' };
    _fetchSharedApiKey();  // load shared API key so AI features work in demo
    showAuthOverlay(false);
    _initialized = true;
    init();
  }

  function resetDemoData() {
    _generateDemoData();
    _initialized = false;
    init();
    showToast('Demo data reset');
  }

  async function authSignUp() {
    showAuthError('');
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!email) { showAuthError('Please enter your email address'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('Please enter a valid email address'); return; }
    if (password.length < 6) { showAuthError('Password must be at least 6 characters'); return; }
    const { data, error } = await _sb.auth.signUp({ email: email.toLowerCase(), password });
    if (error) { showAuthError(_friendlyAuthError(error.message)); return; }
    // Supabase returns a fake user with no identities if the email already exists
    // (e.g. from Google OAuth) — detect this and show a helpful message
    if (data?.user && data.user.identities && data.user.identities.length === 0) {
      showAuthError('An account with this email already exists. Try signing in with Google or use Forgot password.');
      return;
    }
    showAuthError('Check your email for a confirmation link! (Check spam too)', true);
  }

  async function authResetPassword() {
    showAuthError('');
    const email = document.getElementById('authEmail').value.trim();
    if (!email) { showAuthError('Enter your email address above, then tap Forgot password'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('Please enter a valid email address'); return; }
    const redirectUrl = window.location.origin + window.location.pathname;
    const { error } = await _sb.auth.resetPasswordForEmail(email.toLowerCase(), { redirectTo: redirectUrl });
    if (error) showAuthError(_friendlyAuthError(error.message));
    else showAuthError('Password reset link sent! Check your email (and spam folder)', true);
  }

  async function authGoogle() {
    showAuthError('');
    // Use clean base URL — avoid stale OAuth tokens in redirect
    const redirectUrl = window.location.origin + window.location.pathname;
    const { error } = await _sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl }
    });
    if (error) showAuthError(error.message);
  }

  async function authLogout() {
    await _flushToSupabase();
    await _sb.auth.signOut();
    _cache = { ct_data:{}, ct_macros:{}, ct_notes:{}, ct_refeed:{}, ct_weights:{}, ct_presets:[], ct_settings:{}, ct_calc:{}, ct_photos:{}, ct_meals:{}, ct_tdee:{}, ct_coach:[] };
    _currentUser = null;
    _initialized = false;  // Reset so init() re-runs on next login
    _dataLoaded = false;
    _sessionHandled = false;
    _savePending = false;
    try { localStorage.removeItem('blubr_cache_backup'); } catch {}
    showAuthOverlay(true);
  }

  /* ── RESET DATA ── */
  function confirmResetData() {
    document.getElementById('resetOverlay').style.display = 'flex';
  }
  function cancelResetData() {
    document.getElementById('resetOverlay').style.display = 'none';
  }
  async function executeResetData() {
    const settings = getSettings();  // Preserve settings
    _cache = { ct_data:{}, ct_macros:{}, ct_notes:{}, ct_refeed:{}, ct_weights:{}, ct_presets:[], ct_settings: settings, ct_calc:{}, ct_photos:{}, ct_meals:{}, ct_tdee:{}, ct_coach:[] };
    _savePending = true;
    try { localStorage.removeItem('blubr_cache_backup'); } catch {}
    await _flushToSupabase();  // Wait for server confirmation
    document.getElementById('resetOverlay').style.display = 'none';
    refreshAll();
    showToast('All data has been reset');
  }

  let _initialized = false;

  let _sessionHandled = false;  // prevent double handling on page load

  async function _handleSession(session) {
    if (session && session.user) {
      // Always capture the latest access token for beforeunload saves
      _accessToken = session.access_token || '';

      // If transitioning from demo mode to a real account, reset everything
      if (_currentUser && _currentUser.id === 'demo') {
        _cache = { ct_data:{}, ct_macros:{}, ct_notes:{}, ct_refeed:{}, ct_weights:{}, ct_presets:[], ct_settings:{}, ct_calc:{}, ct_photos:{}, ct_meals:{}, ct_tdee:{}, ct_coach:[] };
        _sessionHandled = false;
        _dataLoaded = false;
        _initialized = false;
        _savePending = false;
      }

      // If we already handled this session and data is loaded, just update the user ref
      if (_sessionHandled && _dataLoaded && _currentUser && _currentUser.id === session.user.id) {
        _currentUser = session.user;  // update token but don't reload data
        showAuthOverlay(false);
        return;
      }
      _currentUser = session.user;
      _sessionHandled = true;
      try {
        const _timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
        await Promise.race([
          Promise.all([_loadFromSupabase(), _fetchSharedApiKey()]),
          _timeout(10000)
        ]);
      } catch (e) {
        console.error('Failed to load user data:', e);
      }
      // Check if there was a backup from a previous failed save
      try {
        const backup = localStorage.getItem('blubr_cache_backup');
        if (backup && _dataLoaded) {
          const saved = JSON.parse(backup);
          // If backup has meals the server doesn't, restore them
          if (saved.ct_meals) {
            let restored = false;
            Object.keys(saved.ct_meals).forEach(day => {
              const backupMeals = saved.ct_meals[day];
              const currentMeals = (_cache.ct_meals && _cache.ct_meals[day]) || [];
              if (backupMeals.length > currentMeals.length) {
                _cache.ct_meals[day] = backupMeals;
                restored = true;
              }
            });
            if (restored) {
              // Recalc totals from restored meals
              Object.keys(_cache.ct_meals).forEach(day => {
                const meals = _cache.ct_meals[day];
                if (meals && meals.length > 0) {
                  _cache.ct_data[day] = meals.reduce((s,m) => s + m.cal, 0);
                  const p = meals.reduce((s,m) => s + (m.p||0), 0);
                  const c = meals.reduce((s,m) => s + (m.c||0), 0);
                  const f = meals.reduce((s,m) => s + (m.f||0), 0);
                  if (p||c||f) _cache.ct_macros[day] = {p,c,f};
                }
              });
              console.log('Restored meals from local backup');
              _saveNow();
            }
          }
          localStorage.removeItem('blubr_cache_backup');
        }
      } catch (e) { console.warn('Backup restore check failed:', e); }
      showAuthOverlay(false);
      if (!_initialized) { _initialized = true; init(); }
      else refreshAll();  // Re-render if already initialized (e.g. re-login)
      // Clean OAuth tokens from URL hash after redirect
      if (window.location.hash && window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname);
      }
    }
  }

  if (_configured) {
    // On load, try to restore the existing session first
    _sb.auth.getSession().then(({ data: { session } }) => {
      if (session) _handleSession(session);
    });

    // Handle all auth events including OAuth redirects and token refreshes
    _sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User clicked the password reset link — prompt for new password
        const newPw = prompt('Enter your new password (min 6 characters):');
        if (newPw && newPw.length >= 6) {
          const { error } = await _sb.auth.updateUser({ password: newPw });
          if (error) alert('Failed to update password: ' + error.message);
          else alert('Password updated successfully! You are now signed in.');
        } else if (newPw) {
          alert('Password must be at least 6 characters');
        }
        if (session) await _handleSession(session);
        return;
      } else if (event === 'SIGNED_OUT') {
        _currentUser = null;
        _initialized = false;
        _sessionHandled = false;
        _dataLoaded = false;
        _savePending = false;
        showAuthOverlay(true);
      } else if (event === 'TOKEN_REFRESHED') {
        // Just update the user ref and token, don't reload data
        if (session && session.user) { _currentUser = session.user; _accessToken = session.access_token || ''; }
      } else if (session) {
        await _handleSession(session);
      }
    });

    // Save on page unload — use sendBeacon for reliability
    window.addEventListener('beforeunload', () => {
      if (_savePending && _currentUser) {
        clearTimeout(_syncTimer);
        // sendBeacon is the only reliable way to send data during page unload
        const payload = JSON.stringify({ id: _currentUser.id, ..._cache });
        try {
          // Use Supabase REST API directly via sendBeacon
          const url = SUPABASE_URL + '/rest/v1/user_data?on_conflict=id';
          const blob = new Blob([payload], { type: 'application/json' });
          // sendBeacon can't set custom headers, so fall back to fetch keepalive
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON,
              'Authorization': 'Bearer ' + _accessToken,
              'Prefer': 'resolution=merge-duplicates'
            },
            body: payload,
            keepalive: true  // ensures request survives page unload
          }).catch(() => {});
        } catch {}
      }
    });

    // Also save on visibility change (covers iOS app switching/minimizing)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && _savePending) {
        clearTimeout(_syncTimer);
        _flushToSupabase();
      }
    });
  } else {
    // Supabase not configured yet — run in local mode (localStorage), skip auth overlay
    showAuthOverlay(false);
    init();
  }
  function getData()   { return ls(DATA_KEY, {}); }
  function saveData(d) { lsSet(DATA_KEY, d); }
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
    if (!raw.features) raw.features = {};
    const defFeatures = { tdeeTrend:true, weeklyBudget:true, macroRings:true, streakGrid:true,
                          energyBalance:true, goalWaterfall:true, smoothedWeight:true, copyMeal:true, coachCountdown:true };
    raw.features = Object.assign({}, defFeatures, raw.features);
    if (!raw.weekendBinge) raw.weekendBinge = { enabled: false, days: [] };
    return raw;
  }
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
    const el = document.getElementById('sBingeEnabled');
    if (!el) return;
    el.checked = s.weekendBinge.enabled;
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
    const wStart = new Date(today);
    while (wStart.getDay() !== s.weekStartDay) wStart.setDate(wStart.getDate() - 1);
    if (wStart > today) wStart.setDate(wStart.getDate() - 7);

    let banked = 0;
    const cur = new Date(wStart);
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

    let remainingDays = 0;
    const weekEnd = new Date(wStart); weekEnd.setDate(weekEnd.getDate() + 7);
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

  /* ── CLAUDE API KEY ── */
  let _sharedApiKey = '';
  async function _fetchSharedApiKey() {
    if (!_sb) return;
    try {
      const { data } = await _sb.from('app_config').select('value').eq('key', 'api_key').single();
      if (data && data.value) _sharedApiKey = data.value;
    } catch (e) { /* ignore — user can still enter their own */ }
  }
  function _getApiKey() {
    // User's own key first, then shared key from Supabase
    const s = getSettings();
    return s.apiKey || localStorage.getItem('blubr_api_key') || _sharedApiKey || '';
  }
  function saveApiKey() {
    const k = document.getElementById('sApiKey').value.trim();
    // Save to synced settings (persists across devices)
    const s = getSettings();
    if (k) { s.apiKey = k; } else { delete s.apiKey; }
    lsSet(SETTINGS_KEY, s);
    // Also keep localStorage for backward compat
    if (k) localStorage.setItem('blubr_api_key', k);
    else   localStorage.removeItem('blubr_api_key');
  }
  function loadApiKey() {
    const el = document.getElementById('sApiKey');
    if (el) el.value = _getApiKey();
  }
  function toggleApiKey() {
    const el  = document.getElementById('sApiKey');
    const btn = document.getElementById('btnShowKey');
    if (el.type === 'password') { el.type = 'text';     btn.textContent = 'Hide'; }
    else                        { el.type = 'password'; btn.textContent = 'Show'; }
  }

  function renderAccountInfo() {
    const card = document.getElementById('accountInfoCard');
    const el = document.getElementById('accountInfoContent');
    if (!card || !el) return;
    if (!_currentUser || _currentUser.id === 'demo') { card.style.display = 'none'; return; }
    card.style.display = '';

    const u = _currentUser;
    const email = u.email || '—';
    const provider = (u.app_metadata && u.app_metadata.provider) || 'email';
    const providerLabel = provider === 'google' ? 'Google' : provider === 'email' ? 'Email & Password' : provider;
    const created = u.created_at ? new Date(u.created_at) : null;
    const createdStr = created ? created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

    // Count logged days
    const data = ls('ct_data', {});
    const daysLogged = Object.keys(data).filter(k => data[k] > 0).length;

    el.innerHTML =
      `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted2)">Email</span><span style="color:var(--text)">${escHtml(email)}</span></div>` +
      `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted2)">Sign-in method</span><span style="color:var(--text)">${providerLabel}</span></div>` +
      `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted2)">Member since</span><span style="color:var(--text)">${createdStr}</span></div>` +
      `<div style="display:flex;justify-content:space-between"><span style="color:var(--muted2)">Days logged</span><span style="color:var(--text)">${daysLogged}</span></div>`;
  }

  /* ── ADD MENU ── */
  let _addMenuOpen = false;

  function toggleAddMenu() {
    _addMenuOpen ? closeAddMenu() : openAddMenu();
  }

  function openAddMenu() {
    _addMenuOpen = true;
    const today = new Date();
    const pad   = n => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;

    document.getElementById('addMenuBackdrop').classList.add('visible');
    document.getElementById('addMenuSheet').classList.add('open');
    document.getElementById('btnNavAdd').classList.add('open');
    document.getElementById('addSheetTiles').style.display = 'block';
    document.getElementById('addSheetForm').style.display  = 'none';
    document.body.style.overflow = 'hidden';
  }

  function closeAddMenu() {
    _addMenuOpen = false;
    document.getElementById('addMenuSheet').classList.remove('open');
    document.getElementById('btnNavAdd').classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => {
      document.getElementById('addMenuBackdrop').classList.remove('visible');
      document.getElementById('addSheetTiles').style.display = 'block';
      document.getElementById('addSheetForm').style.display  = 'none';
    }, 300);
  }

  function addSheetAction(action) {
    const today = new Date();
    const pad   = n => String(n).padStart(2,'0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;

    if (action === 'scanmeal') {
      document.getElementById('addSheetTiles').style.display = 'none';
      document.getElementById('addSheetForm').style.display  = 'block';
      document.getElementById('addFormTitle').textContent = 'AI SCAN';
      document.getElementById('addFormContent').innerHTML = `
        <div class="add-form-inner">
          <div style="border:2px solid rgba(0,212,255,0.2);background:rgba(0,212,255,0.03);padding:14px;margin-bottom:4px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span style="background:var(--cyan);color:#000;font-size:0.55rem;font-weight:800;letter-spacing:1px;padding:2px 6px">AI</span>
              <span style="font-size:0.78rem;font-weight:700;color:var(--cyan);letter-spacing:1px;text-transform:uppercase">Scan Meal</span>
              <span style="font-size:0.62rem;color:var(--muted2);margin-left:auto;font-style:italic">powered by Claude</span>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
              <label style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;width:68px;min-width:68px;height:68px;border:2px dashed rgba(0,212,255,0.35);cursor:pointer;color:var(--cyan);font-size:0.65rem;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;background:rgba(0,212,255,0.04)" for="addAiPhoto">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                <span id="addAiPhotoLabel">Photo</span>
              </label>
              <input type="file" id="addAiPhoto" accept="image/*" style="display:none" onchange="handleAddAiPhoto(this)">
              <div id="addAiPhotoPreview" style="flex-shrink:0"></div>
              <textarea id="addAiDesc" placeholder="Describe your meal… (e.g. 2 scrambled eggs, toast with butter, OJ)" rows="2" style="flex:1;padding:8px 10px;font-size:0.9rem;font-family:'Outfit',sans-serif;resize:none;height:68px;line-height:1.5;background:var(--input);border:2px solid rgba(255,255,255,0.18);color:var(--text)"></textarea>
            </div>
            <button class="btn-add-submit" id="btnAddAiScan" onclick="addSheetEstimateMacros()" style="background:var(--cyan);border-color:var(--cyan);box-shadow:3px 3px 0 rgba(0,212,255,0.3)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              Estimate Macros
            </button>
            <div id="addAiStatus" style="margin-top:10px;font-size:0.82rem;line-height:1.6;min-height:0"></div>
          </div>
          <div id="addAiResults" style="display:none">
            <div style="font-size:0.68rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--purple);margin:10px 0 6px;padding-left:8px;border-left:3px solid var(--purple)">Estimated Macros</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:12px">
              <div style="text-align:center;padding:10px 4px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02)">
                <div id="addAiCal" style="font-size:1.3rem;font-weight:700;color:var(--yellow)">—</div>
                <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Cal</div>
              </div>
              <div style="text-align:center;padding:10px 4px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02)">
                <div id="addAiP" style="font-size:1.3rem;font-weight:700;color:#f472b6">—</div>
                <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Protein</div>
              </div>
              <div style="text-align:center;padding:10px 4px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02)">
                <div id="addAiC" style="font-size:1.3rem;font-weight:700;color:#60a5fa">—</div>
                <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Carbs</div>
              </div>
              <div style="text-align:center;padding:10px 4px;border:2px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02)">
                <div id="addAiF" style="font-size:1.3rem;font-weight:700;color:#fbbf24">—</div>
                <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Fat</div>
              </div>
            </div>
            <div id="addAiNote" style="font-size:0.78rem;color:var(--muted);font-style:italic;margin-bottom:12px"></div>
            <div class="add-form-field">
              <label>Date</label>
              <input type="date" id="addAiDate" value="${todayStr}">
            </div>
            <div id="addFormMsg" class="add-form-msg"></div>
            <button class="btn-add-submit" onclick="submitAiLog()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
              Log This Meal
            </button>
          </div>
        </div>`;
      return;
    }

    document.getElementById('addSheetTiles').style.display = 'none';
    document.getElementById('addSheetForm').style.display  = 'block';

    if (action === 'quicklog') {
      document.getElementById('addFormTitle').textContent = 'QUICK LOG';
      document.getElementById('addFormContent').innerHTML = `
        <div class="add-form-inner">
          <div class="add-form-field">
            <label>Date</label>
            <input type="date" id="addFormDate" value="${todayStr}">
          </div>
          <div class="add-form-field">
            <label>Calories</label>
            <input type="number" id="addFormCal" placeholder="0" min="0" max="99999" class="add-form-big-input" autofocus>
          </div>
          <div class="add-form-macros">
            <div class="add-form-macro-item"><label>Protein (g)</label><input type="number" id="addFormP" placeholder="0" min="0" oninput="addFormCalcMacros()"></div>
            <div class="add-form-macro-item"><label>Carbs (g)</label><input type="number" id="addFormC" placeholder="0" min="0" oninput="addFormCalcMacros()"></div>
            <div class="add-form-macro-item"><label>Fat (g)</label><input type="number" id="addFormF" placeholder="0" min="0" oninput="addFormCalcMacros()"></div>
          </div>
          <div class="add-form-hint">P×4 + C×4 + F×9 = <span id="addFormMacroHint" style="color:var(--cyan)">—</span> cal</div>
          <div id="addFormMsg" class="add-form-msg"></div>
          <button class="btn-add-submit" onclick="submitQuickLog()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
            Log It
          </button>
        </div>`;
      setTimeout(() => document.getElementById('addFormCal')?.focus(), 50);

    } else if (action === 'weighin') {
      const s    = getSettings();
      const unit = s.useMetric ? 'kg' : 'lbs';
      document.getElementById('addFormTitle').textContent = 'WEIGH IN';
      document.getElementById('addFormContent').innerHTML = `
        <div class="add-form-inner">
          <div class="add-form-field">
            <label>Date</label>
            <input type="date" id="addWtDate" value="${todayStr}">
          </div>
          <div class="add-form-field">
            <label>Weight (${unit})</label>
            <input type="number" id="addWtVal" placeholder="0.0" min="50" max="700" step="0.1" class="add-form-big-input" autofocus>
          </div>
          <div id="addFormMsg" class="add-form-msg"></div>
          <button class="btn-add-submit" onclick="submitAddWeighIn()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
            Save Weight
          </button>
        </div>`;
      setTimeout(() => document.getElementById('addWtVal')?.focus(), 50);

    } else if (action === 'photo') {
      document.getElementById('addFormTitle').textContent = 'PROGRESS PHOTO';
      document.getElementById('addFormContent').innerHTML = `
        <div class="add-form-inner">
          <div class="add-form-field">
            <label>Date</label>
            <input type="date" id="addPhotoDate" value="${todayStr}">
          </div>
          <label class="add-photo-drop" for="addProgressPhoto" id="addPhotoDropLabel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span>Tap to add photo</span>
            <span style="font-size:0.7rem;color:var(--muted2)">Camera or gallery</span>
          </label>
          <input type="file" id="addProgressPhoto" accept="image/*" capture="environment" style="display:none" onchange="handleProgressPhotoSelect(this)">
          <div id="addProgressPhotoPreview"></div>
          <div id="addFormMsg" class="add-form-msg"></div>
          <button class="btn-add-submit" id="btnSaveProgressPhoto" onclick="submitProgressPhoto()" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
            Save Photo
          </button>
        </div>`;
    }
  }

  function addSheetBack() {
    document.getElementById('addSheetTiles').style.display = 'block';
    document.getElementById('addSheetForm').style.display  = 'none';
  }

  function addFormCalcMacros() {
    const p = parseFloat(document.getElementById('addFormP')?.value) || 0;
    const c = parseFloat(document.getElementById('addFormC')?.value) || 0;
    const f = parseFloat(document.getElementById('addFormF')?.value) || 0;
    const total = Math.round(p*4 + c*4 + f*9);
    const hint  = document.getElementById('addFormMacroHint');
    if (hint) hint.textContent = total > 0 ? total : '—';
    // Auto-fill calories from macros if field is empty
    const calEl = document.getElementById('addFormCal');
    if (calEl && !calEl.value && total > 0) calEl.value = total;
  }

  function submitQuickLog() {
    const dateKey = document.getElementById('addFormDate')?.value;
    const cal     = parseInt(document.getElementById('addFormCal')?.value);
    const p       = parseFloat(document.getElementById('addFormP')?.value)  || 0;
    const c       = parseFloat(document.getElementById('addFormC')?.value)  || 0;
    const f       = parseFloat(document.getElementById('addFormF')?.value)  || 0;
    const msg     = document.getElementById('addFormMsg');

    if (!dateKey || isNaN(cal) || cal <= 0) {
      msg.innerHTML = '<span style="color:var(--red)">Enter a date and calories.</span>';
      return;
    }
    _addMeal(dateKey, 'Quick Log', cal, p, c, f);
    refreshAll();
    maybeShame(getData()[dateKey], dateKey);
    showSuccessBurst();
    showToast(`Logged ${cal} cal for ${dateKey}`);

    // Show "Save as Preset?" prompt
    const formContent = document.getElementById('addFormContent');
    formContent.innerHTML = `
      <div class="add-form-inner" style="text-align:center;padding:12px 0">
        <div style="color:var(--green);font-size:1.2rem;font-weight:700;margin-bottom:8px">✓ Logged ${cal} cal</div>
        <div style="color:var(--muted);font-size:0.82rem;margin-bottom:16px">${p||c||f ? `P${p}g C${c}g F${f}g` : ''}</div>
        <div style="font-size:0.85rem;font-weight:600;color:var(--text);margin-bottom:12px">Save as a preset for quick logging?</div>
        <input type="text" id="presetSaveName" placeholder="Preset name (e.g. My Usual Lunch)" style="width:100%;padding:10px 12px;font-size:0.95rem;font-family:'Outfit',sans-serif;background:var(--input);border:2px solid rgba(255,255,255,0.18);color:var(--text);margin-bottom:10px">
        <div style="display:flex;gap:8px">
          <button class="btn-add-submit" style="flex:1;background:transparent;border-color:rgba(255,255,255,0.2);color:var(--text)" onclick="closeAddMenu()">Skip</button>
          <button class="btn-add-submit" style="flex:1" onclick="saveQuickLogAsPreset(${cal},${p},${c},${f})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
            Save
          </button>
        </div>
      </div>`;
    document.getElementById('presetSaveName')?.focus();
  }

  function saveQuickLogAsPreset(cal, p, c, f) {
    const name = (document.getElementById('presetSaveName')?.value || '').trim();
    if (!name) {
      document.getElementById('presetSaveName').style.borderColor = 'var(--red)';
      return;
    }
    const presets = ls(PRESETS_KEY, []);
    presets.push({ name, cal, p, c, f });
    lsSet(PRESETS_KEY, presets);
    _saveNow();
    renderPresets();
    showToast(`Saved "${name}" preset`);
    closeAddMenu();
  }

  function submitAddWeighIn() {
    const dateKey = document.getElementById('addWtDate')?.value;
    const w       = parseFloat(document.getElementById('addWtVal')?.value);
    const msg     = document.getElementById('addFormMsg');

    if (!dateKey || isNaN(w) || w <= 0) {
      msg.innerHTML = '<span style="color:var(--red)">Enter a date and weight.</span>';
      return;
    }
    const weights = ls(WEIGHTS_KEY, {});
    weights[dateKey] = w;
    lsSet(WEIGHTS_KEY, weights);
    _saveNow();
    refreshAll();
    const s    = getSettings();
    const unit = s.useMetric ? 'kg' : 'lbs';
    showSuccessBurst();
    showToast(`Logged ${w} ${unit}`);
    msg.innerHTML = `<span style="color:var(--green)">✓ Logged ${w} ${unit}!</span>`;
    setTimeout(closeAddMenu, 900);
  }

  function handleProgressPhotoSelect(input) {
    if (!input.files || !input.files[0]) return;
    const url = URL.createObjectURL(input.files[0]);
    document.getElementById('addProgressPhotoPreview').innerHTML =
      `<img src="${url}" style="width:100%;max-height:200px;object-fit:contain;border:2px solid var(--purple);margin-top:2px;display:block;">`;
    const btn = document.getElementById('btnSaveProgressPhoto');
    btn.disabled = false;
    document.getElementById('addPhotoDropLabel').style.display = 'none';
  }

  async function submitProgressPhoto() {
    const input   = document.getElementById('addProgressPhoto');
    const dateKey = document.getElementById('addPhotoDate')?.value;
    const msg     = document.getElementById('addFormMsg');
    const btn     = document.getElementById('btnSaveProgressPhoto');
    if (!input.files || !input.files[0] || !dateKey) return;

    btn.disabled = true;
    btn.querySelector('svg + *') && (btn.lastChild.textContent = ' Saving…');

    try {
      // Compress to 600px wide, JPEG quality 0.7 — keeps sync payload small
      const base64 = await _compressImage(input.files[0], 600, 0.7);
      const photos = ls('ct_photos', {});
      photos[dateKey] = base64;
      lsSet('ct_photos', photos);
      _saveNow();
      renderProgressPhotos();
      showSuccessBurst();
      showToast('Progress photo saved');
      msg.innerHTML = '<span style="color:var(--green)">✓ Photo saved!</span>';
      setTimeout(closeAddMenu, 900);
    } catch (e) {
      msg.innerHTML = '<span style="color:var(--red)">Error saving photo.</span>';
      btn.disabled  = false;
    }
  }

  function renderProgressPhotos() {
    const container = document.getElementById('progressPhotosGrid');
    if (!container) return;
    const photos  = ls('ct_photos', {});
    const entries = Object.entries(photos).sort((a,b) => b[0].localeCompare(a[0]));
    if (!entries.length) {
      container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
        <div class="empty-state-title">No photos yet</div>
        <div class="empty-state-sub">Track your transformation with progress photos.</div>
        <div class="empty-state-cta" onclick="toggleAddMenu()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add a photo
        </div>
      </div>`;
      return;
    }
    container.innerHTML = entries.map(([date, b64]) => `
      <div class="progress-photo-item" onclick="viewProgressPhoto('${date}')">
        <img src="data:image/jpeg;base64,${b64}" loading="lazy">
        <div class="progress-photo-date">${date}</div>
        <button class="progress-photo-del" onclick="event.stopPropagation();deleteProgressPhoto('${date}')">×</button>
      </div>`).join('');
  }

  function deleteProgressPhoto(dateKey) {
    const photos = ls('ct_photos', {});
    delete photos[dateKey];
    lsSet('ct_photos', photos);
    _saveNow();
    renderProgressPhotos();
  }

  function viewProgressPhoto(dateKey) {
    const photos = ls('ct_photos', {});
    const b64    = photos[dateKey];
    if (!b64) return;
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:9000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;';
    ov.innerHTML = `
      <img src="data:image/jpeg;base64,${b64}" style="max-width:95vw;max-height:78vh;object-fit:contain;border:3px solid var(--purple);box-shadow:0 0 30px rgba(255,0,255,0.4);">
      <div style="font-size:0.75rem;color:var(--muted);letter-spacing:2px;">${dateKey}</div>
      <button onclick="this.closest('div').remove()" style="background:transparent;border:2px solid var(--cyan);color:var(--cyan);padding:8px 28px;font-size:0.9rem;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif;letter-spacing:1px;box-shadow:2px 2px 0 var(--cyan)">CLOSE</button>`;
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
  }

  /* ── ADD SHEET AI SCAN ── */
  function handleAddAiPhoto(input) {
    const preview = document.getElementById('addAiPhotoPreview');
    const label   = document.getElementById('addAiPhotoLabel');
    if (input.files && input.files[0]) {
      const url = URL.createObjectURL(input.files[0]);
      preview.innerHTML = `<img src="${url}" style="width:68px;height:68px;object-fit:cover;border:2px solid var(--cyan);display:block">`;
      label.textContent = 'Change';
    }
  }

  async function addSheetEstimateMacros() {
    const apiKey = _getApiKey();
    const status = document.getElementById('addAiStatus');
    const btn    = document.getElementById('btnAddAiScan');

    if (!apiKey) {
      status.innerHTML = '<span style="color:var(--yellow)">⚠ Add your Claude API key in Settings first (⚙ icon on Home).</span>';
      return;
    }

    const desc       = (document.getElementById('addAiDesc').value || '').trim();
    const photoInput = document.getElementById('addAiPhoto');
    const hasPhoto   = photoInput.files && photoInput.files[0];

    if (!desc && !hasPhoto) {
      status.innerHTML = '<span style="color:var(--yellow)">⚠ Add a photo and/or describe your meal.</span>';
      return;
    }

    btn.disabled  = true;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Scanning…';
    status.innerHTML = '';

    try {
      const content = [];
      if (hasPhoto) {
        // Convert to JPEG via canvas — handles HEIC/HEIF/RAW from iPhones
        const base64 = await _compressImage(photoInput.files[0], 1024, 0.85);
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } });
      }
      content.push({ type: 'text', text:
        `Estimate the macronutrients for this meal${desc ? ': ' + desc : ''}.

Respond with ONLY a JSON object — no other text, no markdown:
{"calories":450,"protein":25,"carbs":40,"fat":18,"notes":"brief what-it-is summary"}

Round all numbers to whole integers. Use your best judgment.`
      });

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, messages: [{ role: 'user', content }] })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error ${resp.status}`);
      }

      const raw   = await resp.json();
      const text  = raw.content[0].text.trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Unexpected response format');
      const m = JSON.parse(match[0]);

      // Store for logging
      window._addAiResult = m;

      // Show results
      document.getElementById('addAiCal').textContent = m.calories || '—';
      document.getElementById('addAiP').textContent   = (m.protein || 0) + 'g';
      document.getElementById('addAiC').textContent   = (m.carbs || 0) + 'g';
      document.getElementById('addAiF').textContent    = (m.fat || 0) + 'g';
      document.getElementById('addAiNote').textContent = m.notes || '';
      document.getElementById('addAiResults').style.display = 'block';

      status.innerHTML = '<span style="color:var(--green)">✓ Scan complete — review and log below.</span>';
    } catch (e) {
      status.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`;
    } finally {
      btn.disabled  = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Estimate Macros';
    }
  }

  function submitAiLog() {
    const m = window._addAiResult;
    if (!m || !m.calories) return;
    const dateKey = document.getElementById('addAiDate')?.value;
    const msg     = document.getElementById('addFormMsg');
    if (!dateKey) { msg.innerHTML = '<span style="color:var(--red)">Select a date.</span>'; return; }

    const mealName = m.notes || 'AI Scan';
    _addMeal(dateKey, mealName, m.calories, m.protein||0, m.carbs||0, m.fat||0);
    refreshAll();
    maybeShame(getData()[dateKey], dateKey);
    showSuccessBurst();
    showToast(`Logged ${m.calories} cal via AI scan`);
    msg.innerHTML = `<span style="color:var(--green)">✓ Logged ${m.calories} cal!</span>`;
    setTimeout(closeAddMenu, 900);
  }

  /* ── AI MACRO ESTIMATOR — legacy Log tab form removed, now self-contained in + menu ── */

  function _fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function _compressImage(file, maxWidth, quality) {
    maxWidth = maxWidth || 600;
    quality  = quality  || 0.7;
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const scale  = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        res(dataUrl.split(',')[1]);
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }

  /* ── SHAME ENGINE ── */
  const SHAME_MSGS = [
    { e:'🤢', t:'DISGUSTING.', b:'Your ancestors are weeping right now.' },
    { e:'💀', t:'ARE YOU SERIOUS?', b:'A golden retriever has more self-control than you.' },
    { e:'😭', t:'TRULY SHAMEFUL.', b:'We need to have a very serious conversation about your life choices.' },
    { e:'🤡', t:'WOW. JUST... WOW.', b:"That's not a calorie count. That's a cry for help." },
    { e:'🐷', t:'PATHETIC.', b:"You could've gone for a walk. You didn't. You never do." },
    { e:'😤', t:'UNBELIEVABLE.', b:'Even your calculator is embarrassed for you right now.' },
    { e:'🫵', t:'REALLY??', b:'Your future self is staring at you in absolute disbelief.' },
    { e:'🚨', t:'OH NO.', b:'The scale just filed a restraining order against you.' },
    { e:'💅', t:'BOLD MOVE.', b:'Boldly going where no diet plan has ever survived.' },
    { e:'😑', t:'IMPRESSIVE.', b:'In a bad way. A very, very, catastrophically bad way.' },
    { e:'🗑️', t:'YIKES.', b:"That's not eating. That's an act of self-sabotage." },
    { e:'📞', t:'WE NEED TO TALK.', b:'Your refrigerator called. It feels used and violated.' },
    { e:'😮', t:'SIR. MA\'AM. BESTIE.', b:'What in the absolute calorie are you doing with your life?' },
    { e:'🏳️', t:'GIVE UP NOW.', b:'Just kidding. But also... maybe think about it.' },
    { e:'🧠', t:'BRAIN NOT FOUND.', b:'No rational human would log this many calories willingly.' },
    { e:'⚰️', t:'YOUR DIET IS DEAD.', b:'It died doing what it loved: being ignored by you.' },
    { e:'😬', t:'OH HONEY.', b:"This isn't a cheat day. This is a cheat lifestyle." },
    { e:'🌊', t:'SWEPT AWAY.', b:"You've drowned in a sea of your own bad decisions." },
  ];

  function maybeShame(calories, dateKey) {
    const today = makeKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    if (dateKey !== today) return;  // only shame for today
    const refeed = ls(REFEED_KEY, {});
    if (refeed[dateKey]) return;    // no shame on refeed days, you planned this
    const s = getSettings();
    if (calories <= s.red) return;  // under the red threshold, you're fine (ish)
    const msg = SHAME_MSGS[Math.floor(Math.random() * SHAME_MSGS.length)];
    document.getElementById('shameEmoji').textContent = msg.e;
    document.getElementById('shameTitle').textContent  = msg.t;
    document.getElementById('shameBody').textContent   = msg.b;
    const overlay = document.getElementById('shameOverlay');
    overlay.style.display = 'flex';
    document.body.style.animation = 'bodyShake 0.5s steps(4)';
    setTimeout(() => { document.body.style.animation = ''; }, 500);
  }

  function closeShame() {
    document.getElementById('shameOverlay').style.display = 'none';
  }

  /* ── INFO TOOLTIPS ── */
  let _activeTooltip = null;
  function showInfo(btn, title, text) {
    dismissInfo();
    const tip = document.createElement('div');
    tip.className = 'info-tooltip';
    tip.innerHTML = `<button class="info-tooltip-close" onclick="dismissInfo()">&times;</button><div class="info-tooltip-title">${title}</div>${text}`;
    document.body.appendChild(tip);
    // Position near button
    const r = btn.getBoundingClientRect();
    let top = r.bottom + 8, left = r.left;
    // Keep within viewport
    if (left + 320 > window.innerWidth) left = window.innerWidth - 330;
    if (left < 10) left = 10;
    if (top + 200 > window.innerHeight) top = r.top - tip.offsetHeight - 8;
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
    _activeTooltip = tip;
    // Dismiss on outside click (delayed to avoid immediate dismiss)
    setTimeout(() => {
      document.addEventListener('click', _infoDismissHandler, { once: true });
    }, 50);
  }
  function _infoDismissHandler(e) {
    if (_activeTooltip && !_activeTooltip.contains(e.target)) dismissInfo();
    else if (_activeTooltip) document.addEventListener('click', _infoDismissHandler, { once: true });
  }
  function dismissInfo() {
    if (_activeTooltip) { _activeTooltip.remove(); _activeTooltip = null; }
  }
  window.showInfo = showInfo;
  window.dismissInfo = dismissInfo;

  /* ── SUCCESS FEEDBACK ── */
  function showToast(msg, type) {
    let toast = document.getElementById('appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appToast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.className = 'toast' + (type === 'warn' ? ' toast-warn' : '');
    toast.innerHTML = (type === 'warn' ? '⚠ ' : '✓ ') + msg;
    requestAnimationFrame(() => { toast.classList.add('show'); });
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function showSuccessBurst() {
    const burst = document.createElement('div');
    burst.className = 'success-burst';
    burst.innerHTML = `<div class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="28" height="28"><polyline points="20 6 9 17 4 12"/></svg></div><div class="ring"></div>`;
    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), 700);
  }

  /* ── HELPERS ── */
  function makeKey(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
  function isMetric() { return !!getSettings().useMetric; }
  function wt(lbs) { return isMetric() ? (lbs*0.453592).toFixed(1)+' kg' : lbs+' lbs'; }
  function getStaticTDEE() {
    const tdeeData = ls(TDEE_KEY, {});
    const tdeeKeys = Object.keys(tdeeData).sort();
    if (tdeeKeys.length >= 14) return tdeeData[tdeeKeys[tdeeKeys.length - 1]];
    const p = ls(CALC_KEY, {});
    if (!p.age || !p.weight) return null;
    const ft = parseFloat(p.ft)||0, inVal = parseFloat(p.inch)||0;
    const heightCm = ((ft*12)+inVal)*2.54, weightKg = parseFloat(p.weight)*0.453592;
    const age = parseFloat(p.age);
    let bmr = (10*weightKg)+(6.25*heightCm)-(5*age);
    bmr += p.sex==='male' ? 5 : -161;
    return Math.round(bmr * (parseFloat(p.activity)||1.55));
  }

  function colorFor(cal, isRefeed) {
    if (isRefeed) return 'refeed';
    const s = getSettings();
    const tdee = getStaticTDEE();
    if (!tdee) {
      return cal <= s.green ? 'green' : cal > s.red ? 'red' : 'yellow';
    }
    if (cal > tdee) return 'red';
    if (cal <= s.green) return 'green';
    return 'yellow';
  }
  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* ── PAGE NAV ── */
  function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + name).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.page === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── HOME PAGE ── */
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

  function renderToday() {
    const today = new Date();
    const key   = makeKey(today.getFullYear(), today.getMonth(), today.getDate());
    const data  = getData();
    const macros = ls(MACROS_KEY, {});
    const notes  = ls(NOTES_KEY, {});
    const refeed = ls(REFEED_KEY, {});

    const cal  = data[key];
    const mac  = macros[key];
    const note = notes[key];
    const isRF = !!refeed[key];

    const el = document.getElementById('todayStatus');
    const s  = getSettings();
    if (cal !== undefined) {
      const color = colorFor(cal, isRF);
      const hex = { green: '#34d399', yellow: '#fbbf24', red: '#f87171', refeed: '#a5b4fc' }[color] || 'var(--cyan)';
      let html = `<div class="today-big-cal" style="color:${hex}">${cal.toLocaleString()}</div>
        <div class="today-big-sub">calories logged today${isRF ? ' · refeed day' : ''}</div>`;

      const dailyGoal = Math.round(s.weekly / 7);
      let adjustedGoal = dailyGoal;
      let bankedBonus = 0;
      const todayDow = today.getDay();
      if (s.weekendBinge.enabled && s.weekendBinge.days.includes(todayDow)) {
        const banking = getBankedCalories();
        bankedBonus = banking.perDay;
        adjustedGoal = dailyGoal + bankedBonus;
      }
      const pct = adjustedGoal > 0 ? Math.min((cal / adjustedGoal) * 100, 100) : 0;
      const isOver = cal > adjustedGoal;
      const diff = Math.abs(cal - adjustedGoal);
      const barColor = isOver ? 'linear-gradient(90deg,#ef4444,#f87171)' : 'linear-gradient(90deg,#10b981,#34d399)';
      const remainTxt = isOver ? `<span style="color:#f87171;font-size:0.72rem">${diff.toLocaleString()} cal over daily goal</span>` : `<span style="color:#34d399;font-size:0.72rem">${diff.toLocaleString()} cal remaining</span>`;
      html += `<div style="margin:10px 0 4px;font-size:0.72rem;color:var(--muted)">${cal.toLocaleString()} / ${adjustedGoal.toLocaleString()} cal today</div>`;
      html += `<div class="bar-wrap" style="margin-bottom:4px"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}">${Math.round(pct)}%</div></div>`;
      html += `<div style="margin-bottom:6px">${remainTxt}</div>`;
      if (bankedBonus > 0) {
        html += `<div style="font-size:0.68rem;color:var(--yellow);margin-top:2px">Daily Goal: ${adjustedGoal.toLocaleString()} (${dailyGoal.toLocaleString()} + ${bankedBonus.toLocaleString()} banked)</div>`;
      }

      if (mac) {
        const macGoals = { p: s.macroP, c: s.macroC, f: s.macroF };
        if (s.features.macroRings) {
          html += renderMacroRings(mac, macGoals);
        } else {
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

      if (note) html += `<div class="today-note-display">"${escHtml(note)}"</div>`;
      html += `<div onclick="openModal(${today.getFullYear()}, ${today.getMonth()}, ${today.getDate()})" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;padding:10px;cursor:pointer;border:2px solid rgba(255,255,255,0.08);color:var(--muted);font-size:0.75rem;letter-spacing:0.5px;text-transform:uppercase;transition:all 0.15s" onmouseover="this.style.borderColor='var(--cyan)';this.style.color='var(--cyan)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.08)';this.style.color='var(--muted)'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit Today's Entry
      </div>`;
      el.innerHTML = html;
    } else {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>
        <div class="empty-state-title">Nothing logged today</div>
        <div class="empty-state-sub">Start tracking your calories to see progress toward your goal.</div>
        <div class="empty-state-cta" onclick="toggleAddMenu()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Log your first meal
        </div>
      </div>`;
    }
    renderRecentStrip();
  }

  function renderRecentStrip() {
    const data   = getData();
    const refeed = ls(REFEED_KEY, {});
    const today  = new Date();
    today.setHours(0,0,0,0);

    let html = '';
    for (let i = 6; i >= 0; i--) {
      const d   = new Date(today);
      d.setDate(today.getDate() - i);
      const key  = makeKey(d.getFullYear(), d.getMonth(), d.getDate());
      const cal  = data[key];
      const isRF = !!refeed[key];
      const isT  = i === 0;

      const isPastDay = !isT && d < today;
      let cc = 'recent-cell' + (isT ? ' today' : '');
      if (cal !== undefined) cc += ' ' + colorFor(cal, isRF);
      else if (isPastDay) cc += ' nodata';

      const calStr = cal !== undefined ? (cal >= 1000 ? (cal/1000).toFixed(1)+'k' : String(cal)) : (isPastDay ? '·' : '—');
      html += `<div class="${cc}" onclick="openModal(${d.getFullYear()}, ${d.getMonth()}, ${d.getDate()})">
        <div class="rc-dow">${DAYS_SHORT[d.getDay()]}</div>
        <div class="rc-dom">${d.getDate()}</div>
        <div class="rc-cal">${calStr}</div>
      </div>`;
    }
    document.getElementById('recentStrip').innerHTML = html;
  }

  /* ── SHARED LOG HELPER ── */
  /* ── PER-MEAL LOGGING ── */
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
    _saveNow();  // critical mutation — save immediately
    return true;
  }

  function _recalcDay(dateKey) {
    const meals = ls(MEALS_KEY, {});
    const dayMeals = meals[dateKey] || [];
    const data = getData();
    const macros = ls(MACROS_KEY, {});
    if (dayMeals.length === 0) {
      delete data[dateKey]; delete macros[dateKey];
    } else {
      let totalCal=0, totalP=0, totalC=0, totalF=0;
      dayMeals.forEach(m => { totalCal+=m.cal; totalP+=m.p||0; totalC+=m.c||0; totalF+=m.f||0; });
      data[dateKey] = totalCal;
      if (totalP||totalC||totalF) macros[dateKey] = {p:totalP, c:totalC, f:totalF};
      else delete macros[dateKey];
    }
    saveData(data);
    lsSet(MACROS_KEY, macros);
    _scheduleTDEERecalc();
  }

  function _deleteMeal(dateKey, index) {
    const meals = ls(MEALS_KEY, {});
    if (!meals[dateKey]) return;
    meals[dateKey].splice(index, 1);
    if (meals[dateKey].length === 0) delete meals[dateKey];
    lsSet(MEALS_KEY, meals);
    _recalcDay(dateKey);
    _saveNow();  // critical mutation — save immediately
  }

  function _updateMeal(dateKey, index, name, cal, p, c, f) {
    const meals = ls(MEALS_KEY, {});
    if (!meals[dateKey] || !meals[dateKey][index]) return;
    meals[dateKey][index] = { ...meals[dateKey][index], name, cal: parseInt(cal,10), p:p||0, c:c||0, f:f||0 };
    lsSet(MEALS_KEY, meals);
    _recalcDay(dateKey);
    _saveNow();  // critical mutation — save immediately
  }

  /* Legacy compat: _doLog now adds a meal */
  function _doLog(dateVal, calVal, p, c, f) {
    if (!dateVal || calVal === '') return false;
    _addMeal(dateVal, 'Meal', parseInt(calVal,10), p, c, f);
    refreshAll();
    maybeShame(getData()[dateVal], dateVal);
    return true;
  }

  /* ── QUICK LOG (Home page) ── */
  function quickCalcMacros() {
    const p = parseFloat(document.getElementById('quickProtein').value) || 0;
    const c = parseFloat(document.getElementById('quickCarbs').value)   || 0;
    const f = parseFloat(document.getElementById('quickFat').value)     || 0;
    const prev = document.getElementById('quickMacroPreview');
    if (p || c || f) { const t = Math.round(p*4 + c*4 + f*9); prev.textContent = t.toLocaleString(); document.getElementById('quickCal').value = t; }
    else prev.textContent = '—';
  }

  function quickLog() {
    const dateVal = document.getElementById('quickDate').value;
    const calVal  = document.getElementById('quickCal').value;
    const p = parseFloat(document.getElementById('quickProtein').value) || 0;
    const c = parseFloat(document.getElementById('quickCarbs').value)   || 0;
    const f = parseFloat(document.getElementById('quickFat').value)     || 0;
    if (!_doLog(dateVal, calVal, p, c, f)) return;
    document.getElementById('quickCal').value     = '';
    document.getElementById('quickProtein').value = '';
    document.getElementById('quickCarbs').value   = '';
    document.getElementById('quickFat').value     = '';
    document.getElementById('quickMacroPreview').textContent = '—';
  }

  /* ── STATS BAR ── */
  function updateStatsBar() {
    const data   = getData();
    const refeed = ls(REFEED_KEY, {});
    const today  = new Date();
    today.setHours(0, 0, 0, 0);

    document.getElementById('sbTotal').textContent = Object.keys(data).length;

    let sum = 0, cnt = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const v = data[makeKey(d.getFullYear(), d.getMonth(), d.getDate())];
      if (v !== undefined) { sum += v; cnt++; }
    }
    document.getElementById('sb7Avg').textContent = cnt > 0 ? Math.round(sum / cnt).toLocaleString() : '—';

    let streak = 0;
    const cur = new Date(today);
    for (let i = 0; i < 3650; i++) {
      const k = makeKey(cur.getFullYear(), cur.getMonth(), cur.getDate());
      if (data[k] !== undefined || refeed[k]) { streak++; cur.setDate(cur.getDate()-1); } else break;
    }
    document.getElementById('sbStreak').textContent = streak;
  }

  /* ── WEEKLY ── */
  function updateWeekly() {
    const s     = getSettings();
    const data  = getData();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const wStart = new Date(today);
    while (wStart.getDay() !== s.weekStartDay) wStart.setDate(wStart.getDate() - 1);

    let actual = 0, daysLogged = 0, daysElapsed = 0, firstLoggedIdx = -1;
    for (let i = 0; i < 7; i++) {
      const d = new Date(wStart); d.setDate(wStart.getDate() + i);
      if (d <= today) daysElapsed++;
      const v = data[makeKey(d.getFullYear(), d.getMonth(), d.getDate())];
      if (v !== undefined) { actual += v; daysLogged++; if (firstLoggedIdx < 0) firstLoggedIdx = i; }
    }

    // Only count days from the first logged day onward (not full week if user just started)
    const activeDays = firstLoggedIdx >= 0 ? Math.min(daysElapsed, daysElapsed - firstLoggedIdx) : daysElapsed;
    const expected = Math.round(activeDays * (s.weekly / 7));
    document.getElementById('wGoal').textContent     = s.weekly.toLocaleString();
    document.getElementById('wActual').textContent   = actual.toLocaleString();
    document.getElementById('wExpected').textContent = expected.toLocaleString();

    const pct  = s.weekly > 0 ? Math.min((actual / s.weekly) * 100, 100) : 0;
    const bar  = document.getElementById('barFill');
    const good = actual <= expected;
    bar.style.width      = pct + '%';
    bar.style.background = good ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#ef4444,#f87171)';
    bar.textContent      = Math.round(pct) + '%';
    document.getElementById('wActual').className = 'stat-val ' + (good ? 'good' : 'bad');

    const banner = document.getElementById('statusBanner');
    const diff   = Math.abs(actual - expected);
    if (daysLogged === 0) { banner.textContent = 'Log your first day to see weekly progress.'; banner.className = 'status-banner neutral'; }
    else if (actual < expected) { banner.textContent = `You're ahead — ${diff.toLocaleString()} cal under your weekly pace. Keep it up!`; banner.className = 'status-banner ahead'; }
    else if (actual > expected) { banner.textContent = `Behind pace — ${diff.toLocaleString()} cal over your weekly target. Rein it in!`; banner.className = 'status-banner behind'; }
    else { banner.textContent = 'Exactly on track!'; banner.className = 'status-banner neutral'; }
  }

  /* ── CALENDAR ── */
  function renderCalendar() {
    const grid   = document.getElementById('calGrid');
    const data   = getData();
    const notes  = ls(NOTES_KEY, {});
    const refeed = ls(REFEED_KEY, {});
    const meals  = ls(MEALS_KEY, {});
    const today  = new Date();
    const s      = getSettings();

    grid.querySelectorAll('.cal-cell').forEach(c => c.remove());
    document.getElementById('calMonth').textContent = `${MONTHS[viewMonth]} ${viewYear}`;

    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMo = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < firstDow; i++) {
      const el = document.createElement('div'); el.className = 'cal-cell empty'; grid.appendChild(el);
    }
    for (let d = 1; d <= daysInMo; d++) {
      const key      = makeKey(viewYear, viewMonth, d);
      const cal      = data[key];
      const isToday  = today.getFullYear()===viewYear && today.getMonth()===viewMonth && today.getDate()===d;
      const hasNote  = !!notes[key];
      const isRefeed = !!refeed[key];
      const isEstimated = (meals[key] || []).some(m => m.estimated);

      const isPast = new Date(viewYear, viewMonth, d) < today && !isToday;
      const el = document.createElement('div');
      el.className = 'cal-cell' + (isToday ? ' today' : '');
      if (cal !== undefined) el.classList.add(colorFor(cal, isRefeed));
      else if (isPast) el.classList.add('nodata');
      if (isEstimated) el.classList.add('estimated');

      const calStr = cal !== undefined ? (cal >= 1000 ? (cal/1000).toFixed(1)+'k' : cal) : '';
      el.innerHTML = `<span class="cell-num">${d}</span>` +
        (cal !== undefined ? `<span class="cell-cal">${calStr}</span>` : '') +
        (hasNote ? `<div class="cell-note-dot"></div>` : '');
      el.onclick = () => openModal(viewYear, viewMonth, d);
      grid.appendChild(el);
    }

    const tdee = getStaticTDEE();
    const tdeeLabel = tdee ? tdee.toLocaleString() : 'TDEE';
    document.getElementById('legend').innerHTML = `
      <div class="legend-item"><div class="legend-dot" style="background:#10b981"></div> ≤ ${s.green} cal (on target)</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div> ${s.green}–${tdeeLabel} cal</div>
      <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div> > ${tdeeLabel} cal (surplus)</div>
      <div class="legend-item"><div class="legend-dot" style="background:#6c7ae0"></div> Refeed day</div>
      <div class="legend-item"><div class="legend-dot" style="background:#8b5cf6;border-radius:50%"></div> Has note</div>`;

    const daysInMo2 = daysInMo;
    let logged=0, totalCal=0, green=0, yellow=0, red=0;
    for (let d=1; d<=daysInMo2; d++) {
      const key = makeKey(viewYear, viewMonth, d);
      if (data[key] !== undefined) {
        logged++; totalCal += data[key];
        const c = colorFor(data[key], !!refeed[key]);
        if (c==='green') green++; else if (c==='yellow') yellow++; else if (c==='red') red++;
      }
    }
    const avg = logged > 0 ? Math.round(totalCal/logged) : null;
    document.getElementById('monthSummary').innerHTML = `
      <div class="msbox"><div class="msbox-val">${logged}</div><div class="msbox-lbl">Logged</div></div>
      <div class="msbox"><div class="msbox-val">${avg !== null ? avg.toLocaleString() : '—'}</div><div class="msbox-lbl">Avg Cal</div></div>
      <div class="msbox" style="border-color:rgba(16,185,129,0.3)"><div class="msbox-val" style="color:#34d399">${green}</div><div class="msbox-lbl">Green</div></div>
      <div class="msbox" style="border-color:rgba(245,158,11,0.3)"><div class="msbox-val" style="color:#fbbf24">${yellow}</div><div class="msbox-lbl">Yellow</div></div>
      <div class="msbox" style="border-color:rgba(239,68,68,0.3)"><div class="msbox-val" style="color:#f87171">${red}</div><div class="msbox-lbl">Red</div></div>`;
  }

  function changeMonth(dir) {
    viewMonth += dir;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
    renderCalendar();
  }

  /* ── CALENDAR VIEW SWITCHING ── */
  function showCalInfo() {
    const btn = document.getElementById('calInfoBtn');
    const tips = {
      day: ['Day View', 'See everything you logged for a single day — meals, calories, and macros. Use the arrows to move between days. Tap <b>Edit Day</b> to add meals or notes.'],
      week: ['Week View', 'Your week at a glance with daily macro breakdowns. Color-coded by your calorie goal: <b>Green</b> = on target, <b>Yellow</b> = slightly over, <b>Red</b> = over TDEE. Tap any day to see its details.'],
      month: ['Month View', 'Color-coded calendar of your logging history. <b>Green</b> = at or under your daily goal. <b>Red</b> = over your goal. <b>Yellow</b> = between goal and TDEE. <b>Purple dot</b> = has a note. Tap any day to see details, edit meals, or add notes.']
    };
    const [title, text] = tips[calView] || tips.day;
    showInfo(btn, title, text);
  }

  function setCalView(view) {
    calView = view;
    document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.getElementById('calDayView').style.display  = view === 'day'   ? '' : 'none';
    document.getElementById('calWeekView').style.display  = view === 'week'  ? '' : 'none';
    document.getElementById('calMonthView').style.display = view === 'month' ? '' : 'none';
    renderCalendarView();
  }

  function renderCalendarView() {
    if (calView === 'day')   renderDayView();
    else if (calView === 'week') renderWeekView();
    else renderCalendar();
  }

  function calNavPrev() {
    if (calView === 'day') {
      const d = new Date(viewYear, viewMonth, viewDay - 1);
      viewYear = d.getFullYear(); viewMonth = d.getMonth(); viewDay = d.getDate();
      renderDayView();
    } else if (calView === 'week') {
      const d = new Date(viewYear, viewMonth, viewDay - 7);
      viewYear = d.getFullYear(); viewMonth = d.getMonth(); viewDay = d.getDate();
      renderWeekView();
    } else {
      changeMonth(-1);
    }
  }

  function calNavNext() {
    if (calView === 'day') {
      const d = new Date(viewYear, viewMonth, viewDay + 1);
      viewYear = d.getFullYear(); viewMonth = d.getMonth(); viewDay = d.getDate();
      renderDayView();
    } else if (calView === 'week') {
      const d = new Date(viewYear, viewMonth, viewDay + 7);
      viewYear = d.getFullYear(); viewMonth = d.getMonth(); viewDay = d.getDate();
      renderWeekView();
    } else {
      changeMonth(1);
    }
  }

  /* ── DAY VIEW ── */
  function renderDayView() {
    const key = makeKey(viewYear, viewMonth, viewDay);
    const data = getData();
    const meals = ls(MEALS_KEY, {});
    const macros = ls(MACROS_KEY, {});
    const notes = ls(NOTES_KEY, {});
    const refeed = ls(REFEED_KEY, {});
    const s = getSettings();
    const dayMeals = meals[key] || [];
    const totalCal = data[key] || 0;
    const mac = macros[key] || {};
    const today = new Date();
    const isToday = today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === viewDay;

    // Update nav title
    const dateObj = new Date(viewYear, viewMonth, viewDay);
    const dayName = DAYS_LONG[dateObj.getDay()];
    const navLabel = isToday ? 'Today' : `${dayName}, ${MONTHS[viewMonth]} ${viewDay}`;
    document.getElementById('calMonth').textContent = navLabel;

    const el = document.getElementById('calDayView');
    let html = '';

    // Day summary
    if (totalCal > 0) {
      const dayColor = colorFor(totalCal, !!refeed[key]);
      const colorHex = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)', refeed: '#a5b4fc' }[dayColor] || 'var(--text)';
      const macStr = (mac.p || mac.c || mac.f)
        ? `<div class="cal-day-macros">P <span>${mac.p || 0}g</span> · C <span>${mac.c || 0}g</span> · F <span>${mac.f || 0}g</span></div>`
        : '';
      const goalText = s.green ? `Goal: ${s.green.toLocaleString()} cal` : '';
      html += `<div class="cal-day-summary">
        <div class="cal-day-total" style="color:${colorHex}">${totalCal.toLocaleString()} <span style="font-size:0.75rem;font-weight:500;color:var(--muted)">cal</span></div>
        ${macStr}
        ${goalText ? `<div class="cal-day-goal">${goalText}</div>` : ''}
      </div>`;
    } else {
      html += `<div class="cal-day-summary"><div class="cal-day-empty">No meals logged${isToday ? ' yet today' : ''}</div></div>`;
    }

    // Meals list
    if (dayMeals.length > 0) {
      html += '<div class="cal-day-meals">';
      dayMeals.forEach((meal, i) => {
        const macLine = (meal.p || meal.c || meal.f)
          ? `<div class="cal-day-meal-macros">P ${meal.p || 0}g · C ${meal.c || 0}g · F ${meal.f || 0}g</div>`
          : '';
        html += `<div class="cal-day-meal" onclick="openModal(${viewYear},${viewMonth},${viewDay})">
          <div style="flex:1;min-width:0">
            <div class="cal-day-meal-name">${escHtml(meal.name)}</div>
            ${macLine}
          </div>
          <div class="cal-day-meal-cal">${meal.cal.toLocaleString()} cal</div>
        </div>`;
      });
      html += '</div>';
    } else if (totalCal > 0) {
      // Legacy data
      html += `<div class="cal-day-meals"><div class="cal-day-meal" onclick="openModal(${viewYear},${viewMonth},${viewDay})">
        <div style="flex:1"><div class="cal-day-meal-name">Logged total</div><div class="cal-day-meal-macros">Legacy entry (not itemized)</div></div>
        <div class="cal-day-meal-cal">${totalCal.toLocaleString()} cal</div>
      </div></div>`;
    }

    // Note
    if (notes[key]) {
      html += `<div class="cal-day-note"><div class="cal-day-note-label">Note</div>${escHtml(notes[key])}</div>`;
    }

    // Tap to edit hint
    if (totalCal > 0 || dayMeals.length > 0) {
      html += `<div style="text-align:center;margin-top:12px"><button class="btn-sm" onclick="openModal(${viewYear},${viewMonth},${viewDay})" style="font-size:0.8rem">Edit Day</button></div>`;
    } else {
      html += `<div style="text-align:center;margin-top:8px"><button class="btn-sm" onclick="openModal(${viewYear},${viewMonth},${viewDay})" style="font-size:0.8rem">Add Meal</button></div>`;
    }

    el.innerHTML = html;
  }

  /* ── WEEK VIEW ── */
  function renderWeekView() {
    const today = new Date();
    // Find start of week (Sunday) containing viewDay
    const current = new Date(viewYear, viewMonth, viewDay);
    const startOfWeek = new Date(current);
    startOfWeek.setDate(current.getDate() - current.getDay());

    const data = getData();
    const meals = ls(MEALS_KEY, {});
    const macros = ls(MACROS_KEY, {});
    const refeed = ls(REFEED_KEY, {});
    const s = getSettings();

    // Nav label
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const startLabel = `${MONTHS[startOfWeek.getMonth()].slice(0, 3)} ${startOfWeek.getDate()}`;
    const endLabel = `${MONTHS[endOfWeek.getMonth()].slice(0, 3)} ${endOfWeek.getDate()}, ${endOfWeek.getFullYear()}`;
    document.getElementById('calMonth').textContent = `${startLabel} – ${endLabel}`;

    const el = document.getElementById('calWeekView');
    let html = '';
    let weekCal = 0, weekP = 0, weekC = 0, weekF = 0, daysLogged = 0;

    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const key = makeKey(d.getFullYear(), d.getMonth(), d.getDate());
      const cal = data[key];
      const mac = macros[key] || {};
      const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
      const isRefeed = !!refeed[key];
      const isPast = d < today && !isToday;

      let colorClass = '';
      if (cal !== undefined) {
        colorClass = colorFor(cal, isRefeed);
        weekCal += cal;
        weekP += (mac.p || 0); weekC += (mac.c || 0); weekF += (mac.f || 0);
        daysLogged++;
      } else if (isPast) {
        colorClass = 'nodata';
      }

      const calDisplay = cal !== undefined ? cal.toLocaleString() : '—';
      const macDisplay = (mac.p || mac.c || mac.f)
        ? `<div class="cal-week-macros"><span class="wm-p">P ${mac.p || 0}g</span><span class="wm-c">C ${mac.c || 0}g</span><span class="wm-f">F ${mac.f || 0}g</span></div>`
        : `<div class="cal-week-macros" style="color:var(--muted2)">No macros</div>`;

      html += `<div class="cal-week-day ${colorClass}${isToday ? ' today' : ''}" onclick="viewDayFromWeek(${d.getFullYear()},${d.getMonth()},${d.getDate()})">
        <div class="cal-week-date">
          <div class="cal-week-date-name">${DAYS_SHORT[d.getDay()]}</div>
          <div class="cal-week-date-day">${d.getDate()}</div>
        </div>
        ${macDisplay}
        <div class="cal-week-cal ${colorClass}">${calDisplay}</div>
      </div>`;
    }

    // Week summary
    const avg = daysLogged > 0 ? Math.round(weekCal / daysLogged) : 0;
    html += `<div class="cal-week-summary">
      <div class="msbox"><div class="msbox-val">${daysLogged}</div><div class="msbox-lbl">Logged</div></div>
      <div class="msbox"><div class="msbox-val">${weekCal > 0 ? weekCal.toLocaleString() : '—'}</div><div class="msbox-lbl">Total Cal</div></div>
      <div class="msbox"><div class="msbox-val">${avg > 0 ? avg.toLocaleString() : '—'}</div><div class="msbox-lbl">Avg Cal</div></div>
      <div class="msbox"><div class="msbox-val" style="font-size:0.68rem"><span class="wm-p">P${daysLogged?Math.round(weekP/daysLogged):0}</span> <span class="wm-c">C${daysLogged?Math.round(weekC/daysLogged):0}</span> <span class="wm-f">F${daysLogged?Math.round(weekF/daysLogged):0}</span></div><div class="msbox-lbl">Avg Macros</div></div>
    </div>`;

    el.innerHTML = html;
  }

  function viewDayFromWeek(y, m, d) {
    viewYear = y; viewMonth = m; viewDay = d;
    setCalView('day');
  }

  /* ── CALENDAR PAGE LOG (legacy form removed — all logging via + FAB) ── */

  /* ── PRESETS ── */
  function addPreset() {
    const name = document.getElementById('pName').value.trim();
    const cal  = parseInt(document.getElementById('pCal').value);
    if (!name || !cal || cal < 1) return;
    const p = parseFloat(document.getElementById('pPresetP').value) || 0;
    const c = parseFloat(document.getElementById('pPresetC').value) || 0;
    const f = parseFloat(document.getElementById('pPresetF').value) || 0;
    const presets = ls(PRESETS_KEY, []);
    presets.push({ name, cal, p, c, f });
    lsSet(PRESETS_KEY, presets);
    _saveNow();
    document.getElementById('pName').value=''; document.getElementById('pCal').value='';
    document.getElementById('pPresetP').value=''; document.getElementById('pPresetC').value=''; document.getElementById('pPresetF').value='';
    renderPresets();
  }

  function deletePreset(i) {
    const presets = ls(PRESETS_KEY, []);
    presets.splice(i, 1);
    lsSet(PRESETS_KEY, presets);
    _saveNow();
    renderPresets();
  }

  function applyPreset(name, cal, p, c, f) {
    const today = new Date();
    const pad = n => String(n).padStart(2,'0');
    const dateKey = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
    _addMeal(dateKey, name, cal, p||0, c||0, f||0);
    refreshAll();
    showSuccessBurst();
    showToast(`Logged ${cal} cal`);
  }

  function renderPresets() {
    const presets = ls(PRESETS_KEY, []);
    const chips = document.getElementById('presetChips');
    chips.innerHTML = presets.length === 0
      ? ''
      : '<div style="font-size:0.62rem;color:var(--muted2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Tap to log today</div>' +
        presets.map(p => `<div class="preset-chip" onclick="applyPreset('${escHtml(p.name).replace(/'/g,"\\'")}',${p.cal},${p.p||0},${p.c||0},${p.f||0})">${escHtml(p.name)}<span class="preset-chip-cal">${p.cal.toLocaleString()}</span></div>`).join('');

    const list = document.getElementById('presetList');
    list.innerHTML = presets.length === 0
      ? '<div class="empty-state" style="padding:16px"><div class="empty-state-sub">No presets yet — add your go-to meals above for quick logging.</div></div>'
      : presets.map((p,i) => {
          const macStr = (p.p||p.c||p.f) ? `<span style="font-size:0.72rem;color:var(--muted2);margin-left:6px">P${p.p||0}g C${p.c||0}g F${p.f||0}g</span>` : '';
          return `<div class="preset-list-item"><span class="preset-item-name">${escHtml(p.name)}</span>${macStr}<span class="preset-item-cal">${p.cal.toLocaleString()} cal</span><button class="btn-icon" onclick="deletePreset(${i})">✕</button></div>`;
        }).join('');
  }

  /* ── WEIGHT LOG ── */
  function logWeight() {
    const dateVal = document.getElementById('wtDate').value;
    const wtVal   = document.getElementById('wtVal').value;
    if (!dateVal || !wtVal) return;
    const [y,m,d] = dateVal.split('-').map(Number);
    const weights = ls(WEIGHTS_KEY, {});
    const rawVal = parseFloat(wtVal);
    weights[makeKey(y, m-1, d)] = isMetric() ? rawVal / 0.453592 : rawVal;
    lsSet(WEIGHTS_KEY, weights);
    _saveNow();
    document.getElementById('wtVal').value = '';
    renderWeightChart();
    renderWeightHistory();
    checkRecalcBanner();
    _scheduleTDEERecalc();
  }

  function checkRecalcBanner() {
    const weights = ls(WEIGHTS_KEY, {});
    const calcWt  = parseFloat(document.getElementById('cWeight').value);
    const banner  = document.getElementById('recalcBanner');
    if (!calcWt || Object.keys(weights).length===0) { banner.style.display='none'; return; }
    const sorted = Object.entries(weights).sort((a,b)=>a[0].localeCompare(b[0]));
    const latest = sorted[sorted.length-1][1];
    const diff   = Math.abs(latest - calcWt);
    if (diff >= 10) {
      banner.style.display='block';
      banner.textContent=`Your logged weight (${wt(latest)}) is ${wt(diff)} from your calculator starting weight (${wt(calcWt)}). Consider re-running the Goal Calculator.`;
    } else { banner.style.display='none'; }
  }

  function calcEMA(values, alpha) {
    if (values.length === 0) return [];
    const ema = [values[0]];
    for (let i = 1; i < values.length; i++) {
      ema.push(alpha * values[i] + (1 - alpha) * ema[i - 1]);
    }
    return ema;
  }

  function renderWeightChart() {
    const weights = ls(WEIGHTS_KEY, {});
    const entries = Object.entries(weights).map(([k,v])=>({date:new Date(k+'T12:00:00'),val:v})).sort((a,b)=>a.date-b.date);
    const empty = document.getElementById('weightEmpty');
    const svg   = document.getElementById('weightSvg');
    if (entries.length < 2) { empty.style.display='block'; svg.style.display='none'; return; }
    empty.style.display='none'; svg.style.display='block';

    const W=800,H=160, P={l:48,r:20,t:14,b:28};
    const pw=W-P.l-P.r, ph=H-P.t-P.b;
    const minD=entries[0].date.getTime(), maxD=entries[entries.length-1].date.getTime();
    const vals=entries.map(e=>e.val);
    const minV=Math.floor(Math.min(...vals)-3), maxV=Math.ceil(Math.max(...vals)+3);
    const xS=d=>P.l+((d.getTime()-minD)/((maxD-minD)||1))*pw;
    const yS=v=>P.t+((maxV-v)/(maxV-minV))*ph;

    const metric = isMetric();
    const unit = metric ? 'kg' : 'lbs';
    const dispVal = v => metric ? parseFloat((v*0.453592).toFixed(1)) : v;
    const minVD = dispVal(minV), maxVD = dispVal(maxV);

    let html='<defs><linearGradient id="wGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#00d4ff"/></linearGradient></defs>';
    html+=`<text transform="rotate(-90)" x="${-(P.t+ph/2)}" y="12" text-anchor="middle" fill="#6b7280" font-size="10">${unit}</text>`;
    for (let i=0;i<=4;i++) {
      const v=minV+((maxV-minV)*(4-i)/4), y=P.t+(i/4)*ph;
      const lbl=metric ? (v*0.453592).toFixed(1) : Math.round(v);
      html+=`<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W-P.r}" y2="${y.toFixed(1)}" stroke="#1a1535" stroke-width="1"/>`;
      html+=`<text x="${P.l-5}" y="${(y+4).toFixed(1)}" text-anchor="end" fill="#6b7280" font-size="11">${lbl}</text>`;
    }
    const goalEl=document.getElementById('rGoalWt');
    if (goalEl && goalEl.textContent!=='—') {
      const gw=parseFloat(goalEl.textContent);
      if (gw>=minV && gw<=maxV) {
        const gy=yS(gw);
        html+=`<line x1="${P.l}" y1="${gy.toFixed(1)}" x2="${W-P.r}" y2="${gy.toFixed(1)}" stroke="rgba(0,212,255,0.38)" stroke-width="1.5" stroke-dasharray="5,4"/>`;
        html+=`<text x="${P.l+6}" y="${(gy-4).toFixed(1)}" fill="rgba(0,212,255,0.5)" font-size="10">Goal: ${dispVal(gw)} ${unit}</text>`;
      }
    }
    const pts=entries.map(e=>`${xS(e.date).toFixed(1)},${yS(e.val).toFixed(1)}`).join(' ');
    const areaPts=`${P.l},${(P.t+ph).toFixed(1)} ${pts} ${xS(entries[entries.length-1].date).toFixed(1)},${(P.t+ph).toFixed(1)}`;
    html+=`<polygon points="${areaPts}" fill="rgba(139,92,246,0.07)"/>`;
    html+=`<polyline points="${pts}" fill="none" stroke="url(#wGrad)" stroke-width="2.5"/>`;
    entries.forEach(e=>{
      const titleTxt=`${e.date.toLocaleDateString()}\n${wt(e.val)}`;
      html+=`<circle cx="${xS(e.date).toFixed(1)}" cy="${yS(e.val).toFixed(1)}" r="4" fill="#00d4ff" stroke="#07071a" stroke-width="2"><title>${titleTxt}</title></circle>`;
    });
    const step=Math.max(1,Math.floor(entries.length/6));
    for (let i=0;i<entries.length;i+=step) { const e=entries[i]; html+=`<text x="${xS(e.date).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#6b7280" font-size="10">${e.date.getMonth()+1}/${e.date.getDate()}</text>`; }
    // Smoothed weight trend (EMA overlay)
    const sEMA = getSettings();
    if (sEMA.features.smoothedWeight && entries.length >= 3) {
      const emaVals = calcEMA(entries.map(e => e.val), 0.1);
      const emaPts = entries.map((e, i) => `${xS(e.date).toFixed(1)},${yS(emaVals[i]).toFixed(1)}`).join(' ');
      html += `<polyline points="${emaPts}" fill="none" stroke="rgba(139,92,246,0.85)" stroke-width="3.5" stroke-linecap="round"/>`;
      html += `<text x="${W-P.r-2}" y="${P.t+12}" text-anchor="end" fill="rgba(139,92,246,0.6)" font-size="10">Trend (EMA)</text>`;
    }
    svg.innerHTML=html;
  }

  function renderWeightHistory() {
    const el = document.getElementById('weightHistory');
    if (!el) return;
    const weights = ls(WEIGHTS_KEY, {});
    const entries = Object.entries(weights).sort((a, b) => b[0].localeCompare(a[0]));
    if (entries.length === 0) { el.innerHTML = ''; return; }

    const metric = isMetric();
    const show = Math.min(entries.length, 10);
    let html = '<div style="font-size:0.72rem;color:var(--muted2);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Recent Entries</div>';
    entries.slice(0, show).forEach(([k, v]) => {
      const [yr, mo, dy] = k.split('-');
      const dateStr = `${MONTHS[parseInt(mo) - 1].slice(0, 3)} ${parseInt(dy)}`;
      const dispW = metric ? (v * 0.453592).toFixed(1) + ' kg' : v + ' lbs';
      html += `<div class="wt-hist-row" data-key="${k}">
        <span class="wt-hist-date">${dateStr}</span>
        <span class="wt-hist-val">${dispW}</span>
        <button class="wt-hist-btn" onclick="editWeightEntry('${k}', ${v})" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="wt-hist-btn wt-hist-del" onclick="deleteWeightEntry('${k}')" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>`;
    });
    if (entries.length > show) {
      html += `<div style="font-size:0.72rem;color:var(--muted2);text-align:center;margin-top:6px">+ ${entries.length - show} more entries</div>`;
    }
    el.innerHTML = html;
  }

  function editWeightEntry(dateKey, currentVal) {
    const metric = isMetric();
    const dispVal = metric ? (currentVal * 0.453592).toFixed(1) : currentVal;
    const unit = metric ? 'kg' : 'lbs';
    const newVal = prompt(`Edit weight for ${dateKey} (${unit}):`, dispVal);
    if (newVal === null) return;
    const parsed = parseFloat(newVal);
    if (isNaN(parsed) || parsed <= 0) { showToast('Invalid weight'); return; }
    const weights = ls(WEIGHTS_KEY, {});
    weights[dateKey] = metric ? parseFloat((parsed / 0.453592).toFixed(1)) : parsed;
    lsSet(WEIGHTS_KEY, weights);
    renderWeightChart();
    renderWeightHistory();
    refreshAll();
    showToast('Weight updated');
  }

  function deleteWeightEntry(dateKey) {
    if (!confirm('Delete weight entry for ' + dateKey + '?')) return;
    const weights = ls(WEIGHTS_KEY, {});
    delete weights[dateKey];
    lsSet(WEIGHTS_KEY, weights);
    renderWeightChart();
    renderWeightHistory();
    refreshAll();
    showToast('Weight entry deleted');
  }

  function renderCalChart() {
    const data=getData(), s=getSettings(), refeed=ls(REFEED_KEY,{});
    const today=new Date(); today.setHours(0,0,0,0);
    const days=[];
    for (let i=29;i>=0;i--) { const d=new Date(today); d.setDate(today.getDate()-i); const key=makeKey(d.getFullYear(),d.getMonth(),d.getDate()); days.push({date:d,cal:data[key],refeed:!!refeed[key]}); }

    const W=800,H=150, P={l:48,r:12,t:14,b:26};
    const pw=W-P.l-P.r, ph=H-P.t-P.b;
    const dailyGoal=s.weekly/7;
    const logged=days.filter(d=>d.cal!==undefined).map(d=>d.cal);
    const maxCal=logged.length>0?Math.max(dailyGoal*1.2,...logged):dailyGoal*1.5;
    const yS=v=>P.t+((maxCal-v)/maxCal)*ph;
    const barW=pw/30-2;

    let html='';
    for (let i=0;i<=3;i++) { const v=maxCal*(3-i)/3, y=P.t+(i/3)*ph; const lbl=v>=1000?(v/1000).toFixed(1)+'k':Math.round(v); html+=`<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W-P.r}" y2="${y.toFixed(1)}" stroke="#1a1535" stroke-width="1"/><text x="${P.l-5}" y="${(y+4).toFixed(1)}" text-anchor="end" fill="#6b7280" font-size="11">${lbl}</text>`; }
    const goalY=yS(dailyGoal);
    html+=`<line x1="${P.l}" y1="${goalY.toFixed(1)}" x2="${W-P.r}" y2="${goalY.toFixed(1)}" stroke="rgba(0,212,255,0.33)" stroke-width="1.5" stroke-dasharray="5,3"/>`;
    html+=`<text x="${W-P.r-2}" y="${(goalY-4).toFixed(1)}" text-anchor="end" fill="rgba(0,212,255,0.48)" font-size="10">Daily goal</text>`;
    days.forEach((day,i)=>{ const x=P.l+i*(pw/30); if (day.cal!==undefined) { const cc=colorFor(day.cal, day.refeed); const color=cc==='refeed'?'rgba(108,122,224,0.7)':cc==='green'?'rgba(16,185,129,0.72)':cc==='red'?'rgba(239,68,68,0.72)':'rgba(245,158,11,0.72)'; const barH=Math.max(2,(day.cal/maxCal)*ph); const d=day.date; html+=`<rect x="${(x+1).toFixed(1)}" y="${(P.t+ph-barH).toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"><title>${d.getMonth()+1}/${d.getDate()}: ${day.cal.toLocaleString()} cal</title></rect>`; } });
    const avgPts=[];
    for (let i=0;i<30;i++) { const slice=days.slice(Math.max(0,i-6),i+1).filter(d=>d.cal!==undefined); if (slice.length>=3) { const avg=slice.reduce((acc,d)=>acc+d.cal,0)/slice.length; const x=P.l+i*(pw/30)+barW/2; avgPts.push(`${x.toFixed(1)},${yS(avg).toFixed(1)}`); } }
    if (avgPts.length>1) { html+=`<polyline points="${avgPts.join(' ')}" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/><text x="${W-P.r-2}" y="${H-4}" text-anchor="end" fill="rgba(255,255,255,0.3)" font-size="10">7-day avg</text>`; }
    for (let i=0;i<30;i+=5) { const d=days[i].date; const x=P.l+i*(pw/30); html+=`<text x="${(x+barW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#475569" font-size="10">${d.getMonth()+1}/${d.getDate()}</text>`; }
    document.getElementById('calSvg').innerHTML=html;
  }

  /* ── MACRO CHART ── */
  function renderMacroChart() {
    const macros = ls(MACROS_KEY, {});
    const today  = new Date(); today.setHours(0,0,0,0);
    const days   = [];
    for (let i=29;i>=0;i--) { const d=new Date(today); d.setDate(today.getDate()-i); const key=makeKey(d.getFullYear(),d.getMonth(),d.getDate()); days.push({date:d,mac:macros[key]}); }

    const W=800,H=150, P={l:48,r:12,t:14,b:26};
    const pw=W-P.l-P.r, ph=H-P.t-P.b;
    const barW=pw/30-2;

    const totals = days.map(d => d.mac ? (d.mac.p||0)*4 + (d.mac.c||0)*4 + (d.mac.f||0)*9 : 0);
    const maxTotal = Math.max(...totals, 1);
    const scale = (maxTotal * 1.1);
    const yS = v => P.t + ((scale-v)/scale)*ph;

    let html='';
    for (let i=0;i<=3;i++) { const v=scale*(3-i)/3, y=P.t+(i/3)*ph; const lbl=v>=1000?(v/1000).toFixed(1)+'k':Math.round(v); html+=`<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W-P.r}" y2="${y.toFixed(1)}" stroke="#1a1535" stroke-width="1"/><text x="${P.l-5}" y="${(y+4).toFixed(1)}" text-anchor="end" fill="#6b7280" font-size="11">${lbl}</text>`; }

    days.forEach((day,i) => {
      if (!day.mac) return;
      const x = P.l + i*(pw/30);
      const pCal = (day.mac.p||0)*4;
      const cCal = (day.mac.c||0)*4;
      const fCal = (day.mac.f||0)*9;
      const total = pCal + cCal + fCal;
      if (total === 0) return;
      const totalH = Math.max(2, (total/scale)*ph);
      const baseY  = P.t + ph - totalH;
      const pH = totalH * (pCal/total);
      const cH = totalH * (cCal/total);
      const fH = totalH - pH - cH;
      const dateStr = `${day.date.getMonth()+1}/${day.date.getDate()}`;
      let curY = baseY;
      html+=`<rect x="${(x+1).toFixed(1)}" y="${curY.toFixed(1)}" width="${barW.toFixed(1)}" height="${pH.toFixed(1)}" fill="rgba(244,114,182,0.8)" rx="0"><title>${dateStr}: P ${day.mac.p||0}g (${pCal} cal)</title></rect>`;
      curY += pH;
      html+=`<rect x="${(x+1).toFixed(1)}" y="${curY.toFixed(1)}" width="${barW.toFixed(1)}" height="${cH.toFixed(1)}" fill="rgba(96,165,250,0.8)" rx="0"><title>${dateStr}: C ${day.mac.c||0}g (${cCal} cal)</title></rect>`;
      curY += cH;
      html+=`<rect x="${(x+1).toFixed(1)}" y="${curY.toFixed(1)}" width="${barW.toFixed(1)}" height="${fH.toFixed(1)}" fill="rgba(251,191,36,0.8)" rx="0"><title>${dateStr}: F ${day.mac.f||0}g (${fCal} cal)</title></rect>`;
    });

    for (let i=0;i<30;i+=5) { const d=days[i].date; const x=P.l+i*(pw/30); html+=`<text x="${(x+barW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#6b7280" font-size="10">${d.getMonth()+1}/${d.getDate()}</text>`; }
    document.getElementById('macroSvg').innerHTML=html;
  }

  /* ── HISTORY ── */
  function renderHistory() {
    const data    = getData();
    const notes   = ls(NOTES_KEY, {});
    const refeed  = ls(REFEED_KEY, {});
    const weights = ls(WEIGHTS_KEY, {});
    const macros  = ls(MACROS_KEY, {});
    const search  = (document.getElementById('histSearch').value||'').trim().toLowerCase();
    const allKeys = [...new Set([...Object.keys(data),...Object.keys(weights)])].sort().reverse();
    let filtered;
    if (!search) {
      filtered = allKeys;
    } else {
      const calOp = search.match(/^(>=|<=|>|<|=)(\d+)$/);
      if (calOp) {
        const [,op,val] = calOp; const n = parseInt(val);
        filtered = allKeys.filter(k => {
          const cal = data[k];
          if (cal === undefined) return false;
          if (op==='>') return cal > n;
          if (op==='>=') return cal >= n;
          if (op==='<') return cal < n;
          if (op==='<=') return cal <= n;
          if (op==='=') return cal === n;
          return false;
        });
      } else {
        filtered = allKeys.filter(k => k.includes(search) || (notes[k]||'').toLowerCase().includes(search));
      }
    }

    const el = document.getElementById('historyContent');
    if (filtered.length===0) { el.innerHTML=`<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="24" height="24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
      <div class="empty-state-title">${search ? 'No matches found' : 'No data yet'}</div>
      <div class="empty-state-sub">${search ? 'Try a different search term or calorie filter like ">2000".' : 'Start logging meals and your history will appear here.'}</div>
    </div>`; return; }

    let rows='';
    filtered.forEach(k=>{
      const cal=data[k], wt=weights[k], note=notes[k]||'', isRF=!!refeed[k], mac=macros[k];
      const color=cal!==undefined?colorFor(cal,isRF):'';
      const [yr,mo,dy]=k.split('-');
      const dateStr=`${MONTHS[parseInt(mo)-1].slice(0,3)} ${parseInt(dy)}, ${yr}`;
      const calStr=cal!==undefined?`<span class="hist-cal ${color}">${cal.toLocaleString()}${isRF?' ↻':''}</span>`:'<span style="color:var(--muted)">—</span>';
      const macStr=mac?`<div class="hist-macros">P <span>${mac.p}g</span> · C <span>${mac.c}g</span> · F <span>${mac.f}g</span></div>`:'';
      rows+=`<tr onclick="openModal(${parseInt(yr)},${parseInt(mo)-1},${parseInt(dy)})" title="Click to edit">
        <td><span class="hist-date">${dateStr}</span></td>
        <td>${calStr}${macStr}</td>
        <td>${wt!==undefined?wt+' lbs':'—'}</td>
        <td class="hist-note">${escHtml(note)}</td>
      </tr>`;
    });
    el.innerHTML=`<table class="history-table"><thead><tr><th>Date</th><th>Calories / Macros</th><th>Weight</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /* ── MODAL (per-meal view) ── */
  let _modalEditIdx = -1;  // -1 = adding new meal, 0+ = editing existing

  function openModal(y, m, d) {
    modalKey = makeKey(y, m, d);
    _modalEditIdx = -1;
    document.getElementById('modalTitle').textContent = `${MONTHS[m]} ${d}, ${y}`;

    // Notes + refeed
    const notes = ls(NOTES_KEY, {}), refeed = ls(REFEED_KEY, {});
    document.getElementById('modalNote').value = notes[modalKey] || '';
    document.getElementById('modalRefeed').checked = !!refeed[modalKey];

    // Hide meal form, show meal list
    document.getElementById('modalMealForm').style.display = 'none';
    _renderModalMeals();
    _renderModalButtons('list');

    document.getElementById('overlay').classList.add('show');
  }

  function _renderModalMeals() {
    const meals = ls(MEALS_KEY, {});
    const dayMeals = meals[modalKey] || [];
    const data = getData();
    const totalCal = data[modalKey] || 0;
    const macros = ls(MACROS_KEY, {});
    const mac = macros[modalKey] || {};

    // Day summary
    const summaryEl = document.getElementById('modalDaySummary');
    if (totalCal > 0) {
      const refeedData = ls(REFEED_KEY, {});
      const dayColor = colorFor(totalCal, !!refeedData[modalKey]);
      const colorHex = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)', refeed: '#a5b4fc' }[dayColor] || 'var(--green)';
      const macStr = (mac.p||mac.c||mac.f)
        ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:2px">P ${mac.p||0}g · C ${mac.c||0}g · F ${mac.f||0}g</div>`
        : '';
      summaryEl.innerHTML = `<div style="text-align:center;padding:8px 0 12px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:12px">
        <div style="font-size:1.6rem;font-weight:700;color:${colorHex}">${totalCal.toLocaleString()} <span style="font-size:0.75rem;font-weight:500;color:var(--muted)">cal total</span></div>
        ${macStr}
      </div>`;
    } else {
      summaryEl.innerHTML = `<div style="text-align:center;padding:12px 0;color:var(--muted);font-size:0.85rem">No meals logged yet</div>`;
    }

    // Meal list
    const listEl = document.getElementById('modalMealList');
    if (dayMeals.length === 0) {
      // Check if there's legacy data (total but no meals)
      if (totalCal > 0) {
        listEl.innerHTML = `<div class="modal-meal-item" style="border:2px dashed rgba(255,255,255,0.12);padding:10px 12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:600;font-size:0.88rem">Logged total</div>
              <div style="font-size:0.72rem;color:var(--muted2);margin-top:2px">Legacy entry (not itemized)</div>
            </div>
            <div style="font-weight:700;color:var(--yellow)">${totalCal.toLocaleString()} cal</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn-modal-meal-action" onclick="convertLegacyMeal()">Convert to meal</button>
            <button class="btn-modal-meal-action btn-modal-meal-del" onclick="deleteLegacyDay()">Delete</button>
          </div>
        </div>`;
      } else {
        listEl.innerHTML = '';
      }
    } else {
      listEl.innerHTML = dayMeals.map((meal, i) => {
        const macLine = (meal.p||meal.c||meal.f)
          ? `<div style="font-size:0.7rem;color:var(--muted2);margin-top:1px">P${meal.p||0}g C${meal.c||0}g F${meal.f||0}g</div>`
          : '';
        return `<div class="modal-meal-item" style="border:2px solid rgba(255,255,255,0.08);padding:10px 12px;margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(meal.name)}</div>
              ${macLine}
            </div>
            <div style="font-weight:700;font-size:0.95rem;color:var(--yellow);margin-left:12px;white-space:nowrap">${meal.cal.toLocaleString()} cal</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn-modal-meal-action" onclick="showModalMealForm(${i})">Edit</button>
            <button class="btn-modal-meal-action" onclick="showCopyPopover(event, ${i})">Copy</button>
            <button class="btn-modal-meal-action btn-modal-meal-del" onclick="modalDeleteMeal(${i})">Delete</button>
          </div>
        </div>`;
      }).join('');
    }
  }

  function _renderModalButtons(mode) {
    const btns = document.getElementById('modalBtns');
    if (mode === 'list') {
      btns.innerHTML = `
        <button class="btn-cancel" onclick="closeModal()">Close</button>
        <button class="btn-save" onclick="showModalMealForm(-1)">+ Add Meal</button>`;
    } else {
      btns.innerHTML = `
        <button class="btn-cancel" onclick="cancelModalMealForm()">Cancel</button>
        <button class="btn-save" onclick="saveModalMeal()">Save Meal</button>`;
    }
  }

  function showModalMealForm(idx) {
    _modalEditIdx = idx;
    const form = document.getElementById('modalMealForm');
    form.style.display = 'block';
    if (idx >= 0) {
      const meals = ls(MEALS_KEY, {});
      const meal = (meals[modalKey] || [])[idx];
      if (meal) {
        document.getElementById('modalMealName').value = meal.name || '';
        document.getElementById('modalInput').value = meal.cal || '';
        document.getElementById('modalProtein').value = meal.p || '';
        document.getElementById('modalCarbs').value = meal.c || '';
        document.getElementById('modalFat').value = meal.f || '';
      }
    } else {
      document.getElementById('modalMealName').value = '';
      document.getElementById('modalInput').value = '';
      document.getElementById('modalProtein').value = '';
      document.getElementById('modalCarbs').value = '';
      document.getElementById('modalFat').value = '';
    }
    _renderModalButtons('form');
    setTimeout(() => document.getElementById('modalMealName').focus(), 50);
  }

  function cancelModalMealForm() {
    document.getElementById('modalMealForm').style.display = 'none';
    _renderModalButtons('list');
    _modalEditIdx = -1;
  }

  function saveModalMeal() {
    if (!modalKey) return;
    const name = (document.getElementById('modalMealName').value || '').trim() || 'Meal';
    const cal = parseInt(document.getElementById('modalInput').value);
    if (isNaN(cal) || cal <= 0) return;
    const p = parseFloat(document.getElementById('modalProtein').value) || 0;
    const c = parseFloat(document.getElementById('modalCarbs').value) || 0;
    const f = parseFloat(document.getElementById('modalFat').value) || 0;

    if (_modalEditIdx >= 0) {
      _updateMeal(modalKey, _modalEditIdx, name, cal, p, c, f);
    } else {
      _addMeal(modalKey, name, cal, p, c, f);
    }
    // Save notes + refeed too
    _saveModalMeta();
    document.getElementById('modalMealForm').style.display = 'none';
    _modalEditIdx = -1;
    _renderModalMeals();
    _renderModalButtons('list');
    refreshAll();
    showToast(`${_modalEditIdx >= 0 ? 'Updated' : 'Added'} ${cal.toLocaleString()} cal`);
  }

  function modalDeleteMeal(idx) {
    if (!modalKey) return;
    _deleteMeal(modalKey, idx);
    _saveModalMeta();
    _renderModalMeals();
    refreshAll();
    showToast('Meal deleted');
  }

  function convertLegacyMeal() {
    if (!modalKey) return;
    const data = getData();
    const macros = ls(MACROS_KEY, {});
    const totalCal = data[modalKey] || 0;
    const mac = macros[modalKey] || {};
    _addMeal(modalKey, 'Logged total', totalCal, mac.p||0, mac.c||0, mac.f||0);
    _renderModalMeals();
    refreshAll();
  }

  function deleteLegacyDay() {
    if (!modalKey) return;
    const data=getData(), notes=ls(NOTES_KEY,{}), refeed=ls(REFEED_KEY,{}), macros=ls(MACROS_KEY,{});
    delete data[modalKey]; delete notes[modalKey]; delete refeed[modalKey]; delete macros[modalKey];
    saveData(data); lsSet(NOTES_KEY,notes); lsSet(REFEED_KEY,refeed); lsSet(MACROS_KEY,macros);
    _saveNow();
    _renderModalMeals();
    refreshAll();
    showToast('Day cleared');
  }

  function _saveModalMeta() {
    const notes = ls(NOTES_KEY, {}), refeed = ls(REFEED_KEY, {});
    const note = document.getElementById('modalNote').value.trim();
    if (note) notes[modalKey] = note; else delete notes[modalKey];
    if (document.getElementById('modalRefeed').checked) refeed[modalKey] = true; else delete refeed[modalKey];
    lsSet(NOTES_KEY, notes); lsSet(REFEED_KEY, refeed);
  }

  function closeModal() {
    // Save notes/refeed on close
    if (modalKey) { _saveModalMeta(); _saveNow(); }
    document.getElementById('overlay').classList.remove('show');
    document.getElementById('modalMealForm').style.display = 'none';
    modalKey = null;
    _modalEditIdx = -1;
    refreshAll();
  }
  function overlayClick(e) { if (e.target===document.getElementById('overlay')) closeModal(); }
  function modalCalcMacros() {
    const p=parseFloat(document.getElementById('modalProtein').value)||0;
    const c=parseFloat(document.getElementById('modalCarbs').value)||0;
    const f=parseFloat(document.getElementById('modalFat').value)||0;
    if (p||c||f) document.getElementById('modalInput').value=Math.round(p*4+c*4+f*9);
  }

  /* ── EXPORT ── */
  function exportCSV() {
    const data=getData(), notes=ls(NOTES_KEY,{}), refeed=ls(REFEED_KEY,{}), weights=ls(WEIGHTS_KEY,{}), macros=ls(MACROS_KEY,{});
    const allKeys=[...new Set([...Object.keys(data),...Object.keys(weights)])].sort();
    const rows=['Date,Calories,Protein (g),Carbs (g),Fat (g),Weight (lbs),Refeed,Notes'];
    allKeys.forEach(k=>{ const mac=macros[k]||{}; const note=(notes[k]||'').replace(/,/g,';').replace(/[\r\n]+/g,' '); rows.push(`${k},${data[k]??''},${mac.p||''},${mac.c||''},${mac.f||''},${weights[k]??''},${refeed[k]?'Yes':''},"${note}"`); });
    const blob=new Blob([rows.join('\r\n')],{type:'text/csv'}); const url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{href:url,download:'calorie_tracker.csv'}); document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  /* ── IMPORT CSV ── */
  function importCSV() {
    document.getElementById('importInput').click();
  }
  document.getElementById('importInput').addEventListener('change', function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      const lines = ev.target.result.split(/\r?\n/).slice(1);
      const data = getData(), notes = ls(NOTES_KEY,{}), refeed = ls(REFEED_KEY,{}), weights = ls(WEIGHTS_KEY,{}), macros = ls(MACROS_KEY,{});
      let count = 0;
      lines.forEach(line => {
        if (!line.trim()) return;
        const cols = []; let cur = '', inQ = false;
        for (let ch of line) { if (ch==='"') { inQ=!inQ; } else if (ch===',' && !inQ) { cols.push(cur); cur=''; } else { cur+=ch; } }
        cols.push(cur);
        const [dateStr,calStr,pStr,cStr,fStr,wtStr,refeedStr,...noteParts] = cols;
        const key = (dateStr||'').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        if (calStr.trim()) { const cal=parseInt(calStr); if (!isNaN(cal)) data[key]=cal; }
        const p=parseFloat(pStr),c=parseFloat(cStr),f=parseFloat(fStr);
        if (!isNaN(p)||!isNaN(c)||!isNaN(f)) macros[key]={p:p||0,c:c||0,f:f||0};
        if (wtStr.trim()) { const wtv=parseFloat(wtStr); if (!isNaN(wtv)) weights[key]=wtv; }
        if ((refeedStr||'').trim().toLowerCase()==='yes') refeed[key]=true;
        const note=noteParts.join(',').trim();
        if (note) notes[key]=note;
        count++;
      });
      saveData(data); lsSet(NOTES_KEY,notes); lsSet(REFEED_KEY,refeed); lsSet(WEIGHTS_KEY,weights); lsSet(MACROS_KEY,macros);
      _saveNow();
      refreshAll();
      alert('Imported ' + count + ' rows!');
      e.target.value='';
    };
    reader.readAsText(file);
  });

  /* ── GOAL CALCULATOR ── */
  function saveCalcProfile() {
    lsSet(CALC_KEY, { mode:calcMode, sex:document.getElementById('cSex').value, age:document.getElementById('cAge').value, ft:document.getElementById('cFt').value, inch:document.getElementById('cIn').value, weight:document.getElementById('cWeight').value, activity:document.getElementById('cActivity').value, pace:document.getElementById('cPace').value, goalWeight:document.getElementById('cGoalWeight').value, curBF:document.getElementById('cCurBF').value, goalBF:document.getElementById('cGoalBF').value });
  }

  function loadCalcProfile() {
    const p=ls(CALC_KEY,{});
    if (p.mode) setCalcMode(p.mode);
    if (p.sex)        document.getElementById('cSex').value=p.sex;
    if (p.age)        document.getElementById('cAge').value=p.age;
    if (p.ft)         document.getElementById('cFt').value=p.ft;
    if (p.inch)       document.getElementById('cIn').value=p.inch;
    if (p.weight)     document.getElementById('cWeight').value=p.weight;
    if (p.activity)   document.getElementById('cActivity').value=p.activity;
    if (p.pace)       document.getElementById('cPace').value=p.pace;
    if (p.goalWeight) document.getElementById('cGoalWeight').value=p.goalWeight;
    if (p.curBF)      document.getElementById('cCurBF').value=p.curBF;
    if (p.goalBF)     document.getElementById('cGoalBF').value=p.goalBF;
  }

  function setCalcMode(mode) {
    calcMode=mode;
    document.getElementById('modeWeightBtn').classList.toggle('active',mode==='weight');
    document.getElementById('modeBFBtn').classList.toggle('active',mode==='bf');
    document.getElementById('goalWeightRow').style.display=mode==='weight'?'':'none';
    document.getElementById('curBFRow').style.display=mode==='bf'?'':'none';
    document.getElementById('goalBFRow').style.display=mode==='bf'?'':'none';
    runCalc();
  }

  function runCalc() {
    saveCalcProfile();
    const sex=document.getElementById('cSex').value;
    const age=parseFloat(document.getElementById('cAge').value);
    const ft=parseFloat(document.getElementById('cFt').value)||0;
    const inVal=parseFloat(document.getElementById('cIn').value)||0;
    const weightLbs=parseFloat(document.getElementById('cWeight').value);
    const activity=parseFloat(document.getElementById('cActivity').value);
    const deficit=parseInt(document.getElementById('cPace').value);
    const heightCm=((ft*12)+inVal)*2.54, weightKg=weightLbs*0.453592;
    if (!age||!heightCm||!weightLbs) { document.getElementById('calcResults').style.display='none'; return; }

    let bmr=(10*weightKg)+(6.25*heightCm)-(5*age); bmr+=sex==='male'?5:-161;
    const tdee=bmr*activity, tdeeWeekly=Math.round(tdee*7), actBurn=Math.round(tdee-bmr);
    const bmi=weightKg/Math.pow(heightCm/100,2);
    const bmiCat=bmi<18.5?'Underweight':bmi<25?'Normal weight':bmi<30?'Overweight':'Obese';

    let goalWeightLbs=null, bfNote='', fatLbs=null, leanLbs=null, fatToLose=null;
    if (calcMode==='weight') {
      goalWeightLbs=parseFloat(document.getElementById('cGoalWeight').value);
      if (!goalWeightLbs) { document.getElementById('calcResults').style.display='none'; return; }
    } else {
      const curBF=parseFloat(document.getElementById('cCurBF').value);
      const goalBF=parseFloat(document.getElementById('cGoalBF').value);
      if (!curBF||!goalBF||goalBF>=curBF) { document.getElementById('calcResults').style.display='none'; return; }
      const leanMass=weightLbs*(1-curBF/100);
      goalWeightLbs=leanMass/(1-goalBF/100);
      fatLbs=weightLbs*curBF/100; leanLbs=weightLbs-fatLbs; fatToLose=fatLbs-(goalWeightLbs*goalBF/100);
      bfNote=`At ${goalBF}% body fat your goal weight is ${goalWeightLbs.toFixed(1)} lbs. `;
    }

    const tolose=weightLbs-goalWeightLbs, dailyCal=Math.round(tdee-deficit);
    const weeklyCal=dailyCal*7, weeklyDeficit=deficit*7;
    const totalDeficit=Math.round(Math.abs(tolose)*3500);
    const weeks=deficit!==0?Math.round(Math.abs(tolose)/((Math.abs(deficit)*7)/3500)):0;
    const protein=Math.round((leanLbs!==null?leanLbs:goalWeightLbs)*0.8);

    document.getElementById('rBMR').textContent=Math.round(bmr).toLocaleString();
    document.getElementById('rActBurn').textContent=actBurn.toLocaleString();
    document.getElementById('rTDEE').textContent=Math.round(tdee).toLocaleString();
    document.getElementById('rTDEEWeek').textContent=tdeeWeekly.toLocaleString();
    document.getElementById('rBMI').textContent=bmi.toFixed(1);
    document.getElementById('rBMISub').textContent=bmiCat;
    document.getElementById('rProtein').textContent=protein+'g';

    // Show full macro breakdown in the protein result box subtitle
    const proteinCalc = protein * 4;
    const remainCalc = Math.max(0, dailyCal - proteinCalc);
    const carbsCalc = Math.round((remainCalc * 0.55) / 4);
    const fatCalc   = Math.round((remainCalc - Math.round(remainCalc * 0.55)) / 9);
    document.getElementById('rProtein').closest('.calc-result-box').querySelector('.calc-result-sub').innerHTML = `P ${protein}g · C ${carbsCalc}g · F ${fatCalc}g`;
    document.getElementById('rTarget').textContent=dailyCal.toLocaleString();
    document.getElementById('rTargetSub').textContent=deficit<0?'cal / day to gain weight':deficit===0?'cal / day to maintain':'cal / day to lose weight';
    document.getElementById('rWeekly').textContent=weeklyCal.toLocaleString();
    document.getElementById('rWeeklyDeficit').textContent=weeklyDeficit.toLocaleString();
    document.getElementById('rGoalWt').textContent=goalWeightLbs.toFixed(1);
    document.getElementById('rTime').textContent=weeks>0?weeks:'—';
    document.getElementById('rTimeSub').textContent=weeks>52?`weeks (~${(weeks/4.33).toFixed(1)} mo)`:weeks>0?'weeks':'';
    document.getElementById('rTotalDeficit').textContent=Math.abs(tolose)>0?totalDeficit.toLocaleString():'—';

    const showBComp=calcMode==='bf'&&fatLbs!==null;
    document.getElementById('bcompLbl').style.display=showBComp?'':'none';
    document.getElementById('bcompGrid').style.display=showBComp?'':'none';
    if (showBComp) { document.getElementById('rFatLbs').textContent=fatLbs.toFixed(1); document.getElementById('rLeanLbs').textContent=leanLbs.toFixed(1); document.getElementById('rFatToLose').textContent=fatToLose.toFixed(1); }

    const noteEl=document.getElementById('calcNote'); const msgs=[];
    if (bfNote) msgs.push(bfNote);
    if (deficit<0) msgs.push('Surplus mode: you\'re aiming to gain weight.');
    if (deficit===0) msgs.push('Maintenance mode: your target matches your estimated daily burn.');
    if (dailyCal<1200 && deficit>0) { msgs.push('Daily target is below 1,200 cal. Consider a gentler pace to protect your metabolism.'); noteEl.className='calc-note warn'; }
    else noteEl.className='calc-note';
    msgs.push('Uses Mifflin-St Jeor. Protein based on 0.8g/lb lean mass. 1 lb fat ≈ 3,500 cal. Results vary by individual.');
    noteEl.textContent=msgs.join(' ');
    document.getElementById('calcResults').style.display='block';

    // Calculate macro split: protein from lean mass, then carbs ~40% remaining, fat the rest
    const proteinCal = protein * 4;
    const remainingCal = Math.max(0, dailyCal - proteinCal);
    const carbsCal = Math.round(remainingCal * 0.55);  // ~55% of remaining from carbs
    const fatCal   = remainingCal - carbsCal;            // rest from fat
    const carbs = Math.round(carbsCal / 4);
    const fat   = Math.round(fatCal / 9);

    // Store calculated values for the "Set As My Goal" button — don't auto-apply
    _lastCalcResult = { dailyCal, weeklyCal, protein, carbs, fat };
    // Reset button state when inputs change
    const btn = document.getElementById('btnApplyGoal');
    const msg = document.getElementById('goalApplyMsg');
    if (btn) { btn.textContent = '✓ Set As My Goal'; btn.style.opacity = '1'; }
    if (msg) msg.innerHTML = '';
    checkRecalcBanner();
  }

  let _lastCalcResult = null;

  function applyGoal() {
    if (!_lastCalcResult) return;
    const { dailyCal, weeklyCal, protein, carbs, fat } = _lastCalcResult;

    // Save to settings — including auto-calculated green/red thresholds
    const s = getSettings();
    s.weekly = weeklyCal;
    s.green  = dailyCal;                       // at or under daily target = green
    s.red    = Math.round(dailyCal * 1.2);     // 20% over = red
    if (protein) s.macroP = protein;
    if (carbs)   s.macroC = carbs;
    if (fat)     s.macroF = fat;
    lsSet(SET_KEY, s);

    // Update settings page inputs if they exist
    const sWeekly = document.getElementById('sWeekly');
    const sMacroP = document.getElementById('sMacroP');
    const sMacroC = document.getElementById('sMacroC');
    const sMacroF = document.getElementById('sMacroF');
    const sGreen  = document.getElementById('sGreen');
    const sRed    = document.getElementById('sRed');
    if (sWeekly) sWeekly.value = weeklyCal;
    if (sMacroP && protein) sMacroP.value = protein;
    if (sMacroC && carbs)   sMacroC.value = carbs;
    if (sMacroF && fat)     sMacroF.value = fat;
    if (sGreen) sGreen.value = dailyCal;
    if (sRed)   sRed.value = Math.round(dailyCal * 1.2);

    // Visual confirmation
    const btn = document.getElementById('btnApplyGoal');
    const msg = document.getElementById('goalApplyMsg');
    if (btn) {
      btn.textContent = '✓ Goal Saved!';
      btn.style.opacity = '0.7';
    }
    if (msg) {
      msg.innerHTML = `<span style="color:var(--green)">Your target is now ${dailyCal.toLocaleString()} cal/day · ${weeklyCal.toLocaleString()} cal/week</span>`;
    }
    showSuccessBurst();
    showToast(`Goal set: ${dailyCal.toLocaleString()} cal/day`);

    // Refresh everything with new goal + thresholds
    refreshAll();
  }

  function renderGoalSummary() {
    const card = document.getElementById('goalSummaryCard');
    const content = document.getElementById('goalSummaryContent');
    const badge = document.getElementById('goalPaceBadge');
    if (!card || !content) return;

    const s = getSettings();
    const dailyGoal = Math.round(s.weekly / 7);

    // Determine pace from saved calc profile
    const p = ls(CALC_KEY, {});
    const paceVal = parseInt(p.pace);
    let paceText = '';
    if (!isNaN(paceVal)) {
      if (paceVal < 0) paceText = 'Bulking';
      else if (paceVal === 0) paceText = 'Maintaining';
      else if (paceVal <= 250) paceText = 'Gentle cut';
      else if (paceVal <= 500) paceText = '~1 lb/week';
      else if (paceVal <= 750) paceText = '~1.5 lb/week';
      else paceText = '~2 lb/week';
    }
    if (badge) badge.textContent = paceText;

    content.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="text-align:center;padding:18px 12px;border:2px solid var(--green);background:rgba(16,185,129,0.05);box-shadow:3px 3px 0 rgba(0,255,65,0.15)">
          <div style="font-size:2.2rem;font-weight:700;color:var(--green);line-height:1">${dailyGoal.toLocaleString()}</div>
          <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:6px">cal / day</div>
        </div>
        <div style="text-align:center;padding:18px 12px;border:2px solid var(--purple);background:rgba(139,92,246,0.05);box-shadow:3px 3px 0 rgba(255,0,255,0.15)">
          <div style="font-size:2.2rem;font-weight:700;color:var(--purple);line-height:1">${s.weekly.toLocaleString()}</div>
          <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-top:6px">cal / week</div>
        </div>
      </div>
      ${s.macroP ? `<div style="display:flex;justify-content:center;gap:16px;margin-top:12px;font-size:0.75rem;color:var(--muted)">
        <span>P: <strong style="color:var(--text)">${s.macroP}g</strong></span>
        <span>C: <strong style="color:var(--text)">${s.macroC}g</strong></span>
        <span>F: <strong style="color:var(--text)">${s.macroF}g</strong></span>
      </div>` : ''}
    `;

    // Add goal ETA row if available
    const eta = _calcGoalETA();
    if (eta) {
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const dateStr = `${monthNames[eta.eta.getMonth()]} ${eta.eta.getDate()}, ${eta.eta.getFullYear()}`;
      const timeStr = eta.weeks > 52 ? `${(eta.weeks / 4.33).toFixed(0)} months` : `${eta.weeks} week${eta.weeks !== 1 ? 's' : ''}`;
      content.innerHTML += `
        <div style="display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px 14px;background:rgba(0,255,65,0.04);border:1px solid rgba(0,255,65,0.12);border-radius:6px">
          <div style="font-size:1.6rem">&#127937;</div>
          <div style="flex:1">
            <div style="font-size:0.62rem;color:var(--muted2);text-transform:uppercase;letter-spacing:1px">Estimated Goal Date</div>
            <div style="font-size:1rem;font-weight:700;color:var(--green)">${dateStr}</div>
            <div style="font-size:0.72rem;color:var(--muted)">${eta.lbsToLose} lbs to go &middot; ~${timeStr}</div>
          </div>
        </div>`;
    }
  }

  /* ── THEME ── */
  function setTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    localStorage.setItem('blubr_theme', name);
    document.querySelectorAll('#themePicker .theme-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === name);
    });
  }

  /* ── KEYBOARD ── */
  document.getElementById('modalInput')?.addEventListener('keydown', e=>{ if(e.key==='Enter') saveModalMeal(); if(e.key==='Escape') closeModal(); });
  document.getElementById('wtVal')?.addEventListener('keydown',     e=>{ if(e.key==='Enter') logWeight(); });
  document.getElementById('pCal')?.addEventListener('keydown',      e=>{ if(e.key==='Enter') addPreset(); });
  document.getElementById('pName')?.addEventListener('keydown',     e=>{ if(e.key==='Enter') document.getElementById('pCal').focus(); });

  function renderStreakGrid() {
    const s = getSettings();
    if (!s.features.streakGrid) { const el = document.getElementById('streakGridCard'); if (el) el.style.display='none'; return; }
    const el = document.getElementById('streakGridCard'); if (el) el.style.display='';
    const data = getData();
    const today = new Date(); today.setHours(0,0,0,0);
    const totalDays = 91;

    const gridEl = document.getElementById('streakGrid');
    if (!gridEl) return;
    let html = '';
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - totalDays + 1);
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

  function renderWeeklyBudget() {
    const s = getSettings();
    const card = document.getElementById('weeklyBudgetCard');
    if (!card) return;
    if (!s.features.weeklyBudget) { card.style.display = 'none'; return; }
    card.style.display = '';
    const data = getData();
    const today = new Date(); today.setHours(0,0,0,0);
    const startDay = s.weekStartDay !== undefined ? s.weekStartDay : 1;
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
    const totalBudget = s.weekly;
    const pct = totalBudget > 0 ? Math.min((consumed / totalBudget) * 100, 100) : 0;
    const remaining = totalBudget - consumed;
    const barColor = consumed <= totalBudget ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#ef4444,#f87171)';

    let html = `<div style="font-size:0.82rem;color:var(--muted);margin-bottom:8px">${consumed.toLocaleString()} of ${totalBudget.toLocaleString()} consumed`;
    if (s.weekendBinge.enabled && banking.banked > 0) html += ` <span style="color:var(--yellow)">(${banking.banked.toLocaleString()} banked)</span>`;
    html += `</div>`;
    html += `<div class="bar-wrap"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}">${Math.round(pct)}%</div></div>`;
    html += `<div style="font-size:0.72rem;color:var(--muted2);margin-top:6px">${remaining > 0 ? remaining.toLocaleString() + ' cal remaining' : Math.abs(remaining).toLocaleString() + ' cal over budget'}</div>`;

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

  function renderCopyLastMeal() {
    const s = getSettings();
    const card = document.getElementById('copyLastMealCard');
    if (!card) return;
    if (!s.features.copyMeal) { card.style.display = 'none'; return; }

    const meals = ls(MEALS_KEY, {});
    let lastMeal = null;
    const sortedDays = Object.keys(meals).sort().reverse();
    for (const day of sortedDays) {
      const dayMeals = meals[day];
      if (dayMeals && dayMeals.length > 0) {
        lastMeal = dayMeals[dayMeals.length - 1];
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

    const allDates = [...new Set([...calDays, ...wtDays])].sort();
    if (allDates.length < 14) return;
    const last28 = allDates.slice(-28);
    const firstDate = new Date(last28[0] + 'T12:00:00');
    const lastDate = new Date(last28[last28.length-1] + 'T12:00:00');

    const dailySeries = [];
    const cur = new Date(firstDate);
    let lastWeight = null;
    for (const d of wtDays) { if (d >= last28[0]) { lastWeight = weights[d]; break; } }
    if (!lastWeight) { for (const d of wtDays.slice().reverse()) { lastWeight = weights[d]; break; } }
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

    const weightVals = dailySeries.map(d => d.weight);
    const weightEma = calcEMA(weightVals, 0.1);
    const calVals = dailySeries.map(d => d.cal);
    let runSum = 0, runCnt = 0;
    calVals.forEach(c => { if (c !== null) { runSum += c; runCnt++; } });
    const avgCal = runCnt > 0 ? runSum / runCnt : 2000;
    const filledCals = calVals.map(c => c !== null ? c : avgCal);
    const calEma = calcEMA(filledCals, 0.1);

    const tdeeData = ls(TDEE_KEY, {});
    for (let i = 1; i < dailySeries.length; i++) {
      let dailyWeightChange = weightEma[i] - weightEma[i-1];
      const dailyEnergyFromWeight = dailyWeightChange * 3500;
      let tdee = calEma[i] + (-dailyEnergyFromWeight);
      tdee = Math.max(800, Math.min(6000, tdee));
      tdeeData[dailySeries[i].date] = Math.round(tdee);
    }
    const tdeeKeys = Object.keys(tdeeData).sort().slice(-60);
    const tdeeVals = tdeeKeys.map(k => tdeeData[k]);
    if (tdeeVals.length >= 3) {
      const smoothed = calcEMA(tdeeVals, 0.05);
      tdeeKeys.forEach((k, i) => { tdeeData[k] = Math.round(smoothed[i]); });
    }
    lsSet(TDEE_KEY, tdeeData);
  }

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

    const vals = keys.map(k => tdeeData[k]);
    const min = Math.min(...vals) - 50, max = Math.max(...vals) + 50;
    const w = 300, h = 50;
    const pts = vals.map((v, i) => `${(i/(vals.length-1)*w).toFixed(1)},${((max-v)/(max-min)*h).toFixed(1)}`).join(' ');
    html += `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:50px">
      <polyline points="${pts}" fill="none" stroke="var(--cyan)" stroke-width="2"/>
    </svg>`;

    document.getElementById('tdeeTrendContent').innerHTML = html;
  }

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
    if (allVals.length === 0) { card.style.display = 'none'; return; }
    const maxV = Math.max(...allVals)*1.1, minV = Math.min(...allVals)*0.8;
    const yS = v => P.t+((maxV-v)/(maxV-minV))*ph;

    let html = '';
    for(let i=0;i<=4;i++){const v=minV+((maxV-minV)*(4-i)/4),y=P.t+(i/4)*ph;const lbl=v>=1000?(v/1000).toFixed(1)+'k':Math.round(v);html+=`<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W-P.r}" y2="${y.toFixed(1)}" stroke="#1a1535" stroke-width="1"/><text x="${P.l-5}" y="${(y+4).toFixed(1)}" text-anchor="end" fill="#6b7280" font-size="11">${lbl}</text>`;}

    const tdeePts=[];
    days.forEach((d,i)=>{
      const x=P.l+i*(pw/60);
      if(d.tdee)tdeePts.push({x,y:yS(d.tdee)});
    });

    const calAvg=[];
    for(let i=0;i<60;i++){const slice=days.slice(Math.max(0,i-6),i+1).filter(d=>d.cal!==undefined);if(slice.length>=2){const avg=slice.reduce((s,d)=>s+d.cal,0)/slice.length;calAvg.push(`${(P.l+i*(pw/60)).toFixed(1)},${yS(avg).toFixed(1)}`);}}
    if(calAvg.length>1)html+=`<polyline points="${calAvg.join(' ')}" fill="none" stroke="#00d4ff" stroke-width="2.5"/>`;

    if(tdeePts.length>1){const pts=tdeePts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');html+=`<polyline points="${pts}" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-dasharray="6,3"/>`;}

    for(let i=0;i<60;i+=10){const d=days[i].date;const x=P.l+i*(pw/60);html+=`<text x="${x.toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#6b7280" font-size="10">${d.getMonth()+1}/${d.getDate()}</text>`;}

    document.getElementById('energySvg').innerHTML=html;
  }

  function renderGoalWaterfall() {
    const s = getSettings();
    const card = document.getElementById('goalWaterfallCard');
    if (!card) return;
    if (!s.features.goalWaterfall) { card.style.display='none'; return; }
    const weights = ls(WEIGHTS_KEY, {});
    const calc = ls(CALC_KEY, {});
    const goalWt = parseFloat(calc.goalWeight || (document.getElementById('cGoalWeight') ? document.getElementById('cGoalWeight').value : 0));
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
    html += `<line x1="${P.l}" y1="${P.t+ph/2}" x2="${W-P.r}" y2="${P.t+ph/2}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>`;
    for(let i=0;i<last30.length;i+=5){const d=last30[i];const x=P.l+i*(pw/last30.length);html+=`<text x="${(x+barW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" fill="#6b7280" font-size="10">${d.date.slice(5)}</text>`;}

    document.getElementById('waterfallSvg').innerHTML = html;
  }

  /* ── WEEKLY COACH ── */
  function checkCoachCheckin() {
    const s = getSettings();
    const today = new Date(); today.setHours(0,0,0,0);
    if (today.getDay() !== s.coachDay) return;
    const coach = ls(COACH_KEY, []);
    const startDay = s.weekStartDay !== undefined ? s.weekStartDay : 1;
    const wStart = new Date(today);
    while (wStart.getDay() !== startDay) wStart.setDate(wStart.getDate() - 1);
    const wStartStr = makeKey(wStart.getFullYear(), wStart.getMonth(), wStart.getDate());
    const hasCheckin = coach.some(c => c.date >= wStartStr);
    if (hasCheckin) return;
    const apiKey = _getApiKey();
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
    wStart.setDate(wStart.getDate() - 7);
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

    const apiKey = _getApiKey();
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
      const text = json.content[0].text.trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Unexpected response format');
      const advice = JSON.parse(match[0]);
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

  /* ── MISSED DAY RECOVERY ── */
  function checkMissedDays() {
    const data = getData();
    const today = new Date(); today.setHours(0,0,0,0);

    // Find the earliest logged day — only flag gaps after that date
    const allDates = Object.keys(data).sort();
    if (allDates.length === 0) return;  // No data yet — nothing to recover
    const firstLogged = new Date(allDates[0] + 'T00:00:00');

    const dismissed = JSON.parse(sessionStorage.getItem('blubr_dismissed_days') || '[]');
    const missed = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      if (d < firstLogged) continue;  // Before user started tracking
      const key = makeKey(d.getFullYear(), d.getMonth(), d.getDate());
      if (data[key] === undefined && !dismissed.includes(key)) {
        missed.push({ date: d, key });
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

    const apiKey = _getApiKey();
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
      const text = json.content[0].text.trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Unexpected response format');
      const est = JSON.parse(match[0]);
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

    // Estimate macros proportionally from macro goals
    const macroTotal = (s.macroP || 0) + (s.macroC || 0) + (s.macroF || 0);
    const ratio = macroTotal > 0 ? cal / ((s.macroP * 4) + (s.macroC * 4) + (s.macroF * 9)) : 0;
    const p = macroTotal > 0 ? Math.round((s.macroP || 0) * ratio) : 0;
    const c = macroTotal > 0 ? Math.round((s.macroC || 0) * ratio) : 0;
    const f = macroTotal > 0 ? Math.round((s.macroF || 0) * ratio) : 0;

    const label = level === 'under' ? 'Under ate' : level === 'over' ? 'Over ate' : 'On track';
    _addMeal(dateKey, label + ' (est.)', cal, p, c, f, { estimated: true });
    const actions = document.getElementById('ra-' + dateKey);
    actions.innerHTML = `<div style="color:var(--green)">✓ Logged ~${cal.toLocaleString()} cal (${label.toLowerCase()})</div>`;
    refreshAll();
  }

  function recoverySkip(dateKey) {
    const dismissed = JSON.parse(sessionStorage.getItem('blubr_dismissed_days') || '[]');
    dismissed.push(dateKey);
    sessionStorage.setItem('blubr_dismissed_days', JSON.stringify(dismissed));
    const el = document.getElementById('rd-' + dateKey);
    if (el) el.style.display = 'none';
    const remaining = document.querySelectorAll('.recovery-day:not([style*="display: none"])');
    if (remaining.length === 0) closeRecoveryModal();
  }

  function closeRecoveryModal() { document.getElementById('recoveryOverlay').style.display = 'none'; }

  function _calcGoalETA() {
    const p = ls(CALC_KEY, {});
    const paceVal = parseInt(p.pace);
    if (!paceVal || paceVal <= 0) return null; // only for cutting
    const goalWeightLbs = parseFloat(p.goalWeight);
    if (!goalWeightLbs) return null;

    // Use latest weigh-in if available, else calculator weight
    const weights = ls(WEIGHTS_KEY, {});
    const sortedDates = Object.keys(weights).sort();
    let currentWeight = parseFloat(p.weight);
    if (sortedDates.length > 0) currentWeight = weights[sortedDates[sortedDates.length - 1]];
    if (!currentWeight || currentWeight <= goalWeightLbs) return null;

    const lbsToLose = currentWeight - goalWeightLbs;
    const lbsPerWeek = (paceVal * 7) / 3500;
    const weeks = Math.ceil(lbsToLose / lbsPerWeek);
    const eta = new Date();
    eta.setDate(eta.getDate() + weeks * 7);
    return { eta, weeks, currentWeight, goalWeightLbs, lbsToLose: lbsToLose.toFixed(1) };
  }

  function renderGoalETA() {
    const card = document.getElementById('goalETACard');
    if (!card) return;
    const result = _calcGoalETA();
    if (!result) { card.style.display = 'none'; return; }
    card.style.display = '';

    const { eta, weeks, lbsToLose } = result;
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateStr = `${monthNames[eta.getMonth()]} ${eta.getDate()}, ${eta.getFullYear()}`;
    const timeStr = weeks > 52 ? `${(weeks / 4.33).toFixed(0)} months` : `${weeks} week${weeks !== 1 ? 's' : ''}`;

    document.getElementById('goalETAContent').innerHTML = `<div style="display:flex;align-items:center;gap:12px">
      <div style="font-size:2rem;color:var(--green)">&#127937;</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.62rem;color:var(--muted2);text-transform:uppercase;letter-spacing:1px">Goal ETA</div>
        <div style="font-size:0.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${dateStr}</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${lbsToLose} lbs in ~${timeStr}</div>
      </div>
    </div>`;
  }

  function renderCoachCountdown() {
    const s = getSettings();
    const card = document.getElementById('coachCountdownCard');
    if (!card) return;
    if (!s.features.coachCountdown) { card.style.display = 'none'; return; }
    const apiKey = _getApiKey();
    if (!apiKey) { card.style.display = 'none'; return; }
    card.style.display = '';

    const today = new Date(); today.setHours(0,0,0,0);
    let daysUntil = (s.coachDay - today.getDay() + 7) % 7;
    const coachDayName = DAYS_LONG[s.coachDay];

    const coach = ls(COACH_KEY, []);
    const last = coach.length > 0 ? coach[coach.length - 1] : null;

    let html = `<div style="display:flex;align-items:center;gap:12px">
      <div style="font-size:2rem;color:var(--cyan)">&#129504;</div>
      <div style="flex:1">
        <div style="font-size:0.62rem;color:var(--muted2);text-transform:uppercase;letter-spacing:1px">Weekly Coach</div>
        <div style="font-size:0.88rem;font-weight:600">${daysUntil === 0 ? 'Check-in today!' : `Next: ${coachDayName} (${daysUntil} day${daysUntil>1?'s':''})`}</div>
        ${last ? `<div style="font-size:0.72rem;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(last.tip || last.summary || '').slice(0,60)}...</div>` : ''}
      </div>
    </div>`;

    document.getElementById('coachCountdownContent').innerHTML = html;
  }

  /* ── INIT ── */
  function refreshAll() {
    renderToday();
    renderRecentStrip();
    renderCalendarView();
    updateWeekly();
    updateStatsBar();
    renderCalChart();
    renderMacroChart();
    renderWeightChart();
    renderWeightHistory();
    renderPresets();
    renderHistory();
    renderProgressPhotos();
    renderGoalSummary();
    renderWeeklyBudget();
    renderStreakGrid();
    renderCopyLastMeal();
    renderTDEETrend();
    renderEnergyBalance();
    renderGoalWaterfall();
    renderCoachCountdown();
    renderGoalETA();
  }

  /* ── COPY MEAL ── */
  function showCopyPopover(event, mealIndex) {
    closeCopyPopover();
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

  /* ── FEATURE TOGGLES ── */
  const FEATURE_TOGGLES = {
    tdeeTrend: { label: 'TDEE Trend', desc: 'Adaptive estimate of your daily calorie burn based on real weight + intake data.' },
    weeklyBudget: { label: 'Weekly Calorie Budget', desc: 'Visual bar showing calories consumed vs. your weekly total. Integrates with calorie banking.' },
    macroRings: { label: 'Macro Rings', desc: 'Circular progress rings for protein, carbs, and fat on the Today card.' },
    energyBalance: { label: 'Energy Balance', desc: '60-day chart comparing your intake vs. expenditure with deficit/surplus shading.' },
    goalWaterfall: { label: 'Goal Waterfall', desc: 'Daily weight changes toward or away from your goal, using smoothed data.' },
    smoothedWeight: { label: 'Smoothed Weight Trend', desc: 'EMA trend line on your weight chart that filters out daily fluctuations.' },
    copyMeal: { label: 'Quick Copy Meal', desc: 'One-tap card to re-log your most recent meal.' },
    coachCountdown: { label: 'Coach Countdown', desc: 'Shows when your next AI coaching check-in is and last week\'s advice.' }
  };

  function renderFeatureToggles() {
    const s = getSettings();
    const el = document.getElementById('featureToggles');
    if (!el) return;
    el.innerHTML = Object.entries(FEATURE_TOGGLES).map(([key, { label, desc }]) => {
      const checked = s.features[key] !== false ? 'checked' : '';
      return `<label style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;font-size:0.82rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05)">
        <input type="checkbox" ${checked} onchange="saveFeatureToggle('${key}',this.checked)" style="width:auto;accent-color:var(--cyan);margin-top:2px">
        <span><strong>${label}</strong><br><span style="font-size:0.74rem;color:var(--muted);line-height:1.5">${desc}</span></span>
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

  function saveWeekCoachSettings() {
    const existing = ls(SET_KEY, {});
    existing.weekStartDay = parseInt(document.getElementById('sWeekStart').value);
    existing.coachDay = parseInt(document.getElementById('sCoachDay').value);
    lsSet(SET_KEY, existing);
    refreshAll();
  }

  function loadWeekCoachSettings() {
    const s = getSettings();
    const ws = document.getElementById('sWeekStart');
    const cd = document.getElementById('sCoachDay');
    if (ws) ws.value = s.weekStartDay;
    if (cd) cd.value = s.coachDay;
  }

  function init() {
    const t   = new Date();
    const pad = n => String(n).padStart(2,'0');
    const todayStr = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`;

    document.getElementById('appDate').textContent = `${DAYS_LONG[t.getDay()]}, ${MONTHS[t.getMonth()]} ${t.getDate()}, ${t.getFullYear()}`;
    const logDateEl = document.getElementById('logDate');
    const wtDateEl  = document.getElementById('wtDate');
    if (logDateEl) logDateEl.value = todayStr;
    if (wtDateEl)  wtDateEl.value  = todayStr;

    const s = getSettings();
    document.getElementById('sWeekly').value = s.weekly;
    document.getElementById('sGreen').value  = s.green;
    document.getElementById('sRed').value    = s.red;
    document.getElementById('sMacroP').value = s.macroP;
    document.getElementById('sMacroC').value = s.macroC;
    document.getElementById('sMacroF').value = s.macroF;
    document.getElementById('sMetric').checked = s.useMetric;
    if (s.useMetric) {
      document.getElementById('wtVal').placeholder = 'Weight (kg)';
    } else {
      document.getElementById('wtVal').placeholder = 'Weight (lbs)';
    }

    const savedTheme = localStorage.getItem('blubr_theme') || 'clean';
    setTheme(savedTheme);

    loadCalcProfile();
    loadApiKey();
    loadBingeSettings();
    renderFeatureToggles();
    loadWeekCoachSettings();
    renderAccountInfo();
    runCalc();
    refreshAll();
    // Show demo reset button if in demo mode
    const demoCard = document.getElementById('demoResetCard');
    if (demoCard) demoCard.style.display = (_currentUser && _currentUser.id === 'demo') ? '' : 'none';
    setTimeout(checkCoachCheckin, 2000);
    setTimeout(checkMissedDays, 3000);
  }

  // init() is called by onAuthStateChange after user data is loaded from Supabase
