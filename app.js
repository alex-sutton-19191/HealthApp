/* ── THEME: apply immediately to avoid flash ── */
  (function() {
    const t = localStorage.getItem('blubr_theme');
    if (t && t !== 'retro') document.documentElement.setAttribute('data-theme', t);
  })();

/* ── SUPABASE INIT ── */
  const SUPABASE_URL  = 'https://YOUR_PROJECT_REF.supabase.co';  // replace with your project URL
  const SUPABASE_ANON = 'YOUR_ANON_PUBLIC_KEY';                   // replace with your anon key
  const _configured = !SUPABASE_URL.includes('YOUR_PROJECT_REF');
  const _sb = _configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON) : null;

  /* ── IN-MEMORY CACHE ── */
  let _cache = {
    ct_data: {}, ct_macros: {}, ct_notes: {}, ct_refeed: {},
    ct_weights: {}, ct_presets: [], ct_settings: {}, ct_calc: {}
  };
  let _currentUser = null;
  let _syncTimer   = null;

  async function _loadFromSupabase() {
    if (!_currentUser || !_sb) return;
    const { data, error } = await _sb
      .from('user_data')
      .select('*')
      .eq('id', _currentUser.id)
      .single();
    if (error && error.code !== 'PGRST116') { console.error('Load error:', error); return; }
    if (data) {
      const keys = ['ct_data','ct_macros','ct_notes','ct_refeed','ct_weights','ct_presets','ct_settings','ct_calc'];
      keys.forEach(k => { if (data[k] !== undefined) _cache[k] = data[k]; });
    }
    await _migrateLocalStorage();
  }

  async function _migrateLocalStorage() {
    const hasData = Object.keys(_cache.ct_data).length > 0
                 || Object.keys(_cache.ct_weights).length > 0
                 || (_cache.ct_presets && _cache.ct_presets.length > 0);
    if (hasData) return;
    const keys = ['ct_data','ct_macros','ct_notes','ct_refeed','ct_weights','ct_presets','ct_settings','ct_calc'];
    let foundAny = false;
    keys.forEach(k => {
      try { const v = JSON.parse(localStorage.getItem(k)); if (v !== null) { _cache[k] = v; foundAny = true; } } catch {}
    });
    if (foundAny) { await _flushToSupabase(); console.log('Migrated localStorage data to Supabase'); }
  }

  function _scheduleSave() {
    if (!_configured) return;  // local mode: handled by ls/lsSet localStorage fallback
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_flushToSupabase, 1500);
  }

  async function _flushToSupabase() {
    if (!_currentUser || !_sb) return;
    const { error } = await _sb.from('user_data').upsert({ id: _currentUser.id, ..._cache }, { onConflict: 'id' });
    if (error) console.error('Save error:', error);
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

  let viewYear  = new Date().getFullYear();
  let viewMonth = new Date().getMonth();
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
    // hide logout buttons when running in local (no-Supabase) mode
    const logoutBtn    = document.querySelector('.bottom-nav button[onclick="authLogout()"]');
    const goalsLogout  = document.getElementById('goalsLogoutBtn');
    if (logoutBtn)   logoutBtn.style.display   = _configured ? '' : 'none';
    if (goalsLogout) goalsLogout.style.display = _configured ? '' : 'none';
    const lb = document.getElementById('localModeBanner'); if (lb) lb.style.display = (!_configured && !show) ? 'block' : 'none';
  }

  function showAuthError(msg) {
    const el = document.getElementById('authError');
    el.textContent = msg; el.style.display = msg ? 'block' : 'none';
  }

  async function authSignIn() {
    showAuthError('');
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const { error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) showAuthError(error.message);
  }

  async function authSignUp() {
    showAuthError('');
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    if (password.length < 6) { showAuthError('Password must be at least 6 characters'); return; }
    const { error } = await _sb.auth.signUp({ email, password });
    if (error) showAuthError(error.message);
    else showAuthError('Check your email for a confirmation link!');
  }

  async function authGoogle() {
    showAuthError('');
    const { error } = await _sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href }
    });
    if (error) showAuthError(error.message);
  }

  async function authLogout() {
    await _flushToSupabase();
    await _sb.auth.signOut();
    _cache = { ct_data:{}, ct_macros:{}, ct_notes:{}, ct_refeed:{}, ct_weights:{}, ct_presets:[], ct_settings:{}, ct_calc:{} };
    _currentUser = null;
    showAuthOverlay(true);
  }

  if (_configured) {
    _sb.auth.onAuthStateChange(async (event, session) => {
      if (session && session.user) {
        _currentUser = session.user;
        await _loadFromSupabase();
        showAuthOverlay(false);
        init();
      } else {
        _currentUser = null;
        showAuthOverlay(true);
      }
    });
    window.addEventListener('beforeunload', () => {
      if (_syncTimer) { clearTimeout(_syncTimer); _flushToSupabase(); }
    });
  } else {
    // Supabase not configured yet — run in local mode (localStorage), skip auth overlay
    showAuthOverlay(false);
    init();
  }
  function getData()   { return ls(DATA_KEY, {}); }
  function saveData(d) { lsSet(DATA_KEY, d); }
  function getSettings() { return Object.assign({ weekly: 14000, green: 200, red: 2000, macroP: 150, macroC: 200, macroF: 65, useMetric: false }, ls(SET_KEY, {})); }
  function saveSettings() {
    lsSet(SET_KEY, {
      weekly:    parseInt(document.getElementById('sWeekly').value) || 14000,
      green:     parseInt(document.getElementById('sGreen').value)  || 200,
      red:       parseInt(document.getElementById('sRed').value)    || 2000,
      macroP:    parseInt(document.getElementById('sMacroP').value) || 150,
      macroC:    parseInt(document.getElementById('sMacroC').value) || 200,
      macroF:    parseInt(document.getElementById('sMacroF').value) || 65,
      useMetric: document.getElementById('sMetric').checked,
    });
    refreshAll();
  }

  /* ── CLAUDE API KEY ── */
  function saveApiKey() {
    const k = document.getElementById('sApiKey').value.trim();
    if (k) localStorage.setItem('blubr_api_key', k);
    else   localStorage.removeItem('blubr_api_key');
  }
  function loadApiKey() {
    const el = document.getElementById('sApiKey');
    if (el) el.value = localStorage.getItem('blubr_api_key') || '';
  }
  function toggleApiKey() {
    const el  = document.getElementById('sApiKey');
    const btn = document.getElementById('btnShowKey');
    if (el.type === 'password') { el.type = 'text';     btn.textContent = 'Hide'; }
    else                        { el.type = 'password'; btn.textContent = 'Show'; }
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
      closeAddMenu();
      setTimeout(() => {
        showPage('calendar');
        const desc = document.getElementById('aiDesc');
        if (desc) { desc.focus(); desc.scrollIntoView({ behavior:'smooth', block:'center' }); }
      }, 360);
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
    const data = getData();
    data[dateKey] = (data[dateKey] || 0) + cal;
    saveData(data);
    if (p || c || f) {
      const macros = ls(MACROS_KEY, {});
      const ex = macros[dateKey] || { p:0, c:0, f:0 };
      macros[dateKey] = { p: ex.p+p, c: ex.c+c, f: ex.f+f };
      lsSet(MACROS_KEY, macros);
    }
    refreshAll();
    maybeShame(data[dateKey], dateKey);
    msg.innerHTML = `<span style="color:var(--green)">✓ Logged ${cal} cal for ${dateKey}!</span>`;
    setTimeout(closeAddMenu, 900);
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
    refreshAll();
    const s    = getSettings();
    const unit = s.useMetric ? 'kg' : 'lbs';
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
      const base64 = await _fileToBase64(input.files[0]);
      const photos = JSON.parse(localStorage.getItem('ct_photos') || '{}');
      photos[dateKey] = base64;
      localStorage.setItem('ct_photos', JSON.stringify(photos));
      renderProgressPhotos();
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
    const photos  = JSON.parse(localStorage.getItem('ct_photos') || '{}');
    const entries = Object.entries(photos).sort((a,b) => b[0].localeCompare(a[0]));
    if (!entries.length) {
      container.innerHTML = '<div class="progress-photos-empty">No progress photos yet — tap <strong style="color:var(--green)">+</strong> to add one.</div>';
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
    const photos = JSON.parse(localStorage.getItem('ct_photos') || '{}');
    delete photos[dateKey];
    localStorage.setItem('ct_photos', JSON.stringify(photos));
    renderProgressPhotos();
  }

  function viewProgressPhoto(dateKey) {
    const photos = JSON.parse(localStorage.getItem('ct_photos') || '{}');
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

  /* ── AI MACRO ESTIMATOR ── */
  async function estimateMacros() {
    const apiKey = localStorage.getItem('blubr_api_key');
    const status = document.getElementById('aiStatus');
    const btn    = document.getElementById('btnAiScan');

    if (!apiKey) {
      status.innerHTML = '<span style="color:var(--yellow)">⚠ Add your Claude API key in Goals → Settings first.</span>';
      return;
    }

    const desc        = (document.getElementById('aiDesc').value || '').trim();
    const photoInput  = document.getElementById('aiPhoto');
    const hasPhoto    = photoInput.files && photoInput.files[0];

    if (!desc && !hasPhoto) {
      status.innerHTML = '<span style="color:var(--yellow)">⚠ Add a photo and/or describe your meal.</span>';
      return;
    }

    btn.disabled    = true;
    btn.innerHTML   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Estimating…';
    status.innerHTML = '';

    try {
      const content = [];

      if (hasPhoto) {
        const base64    = await _fileToBase64(photoInput.files[0]);
        const mediaType = photoInput.files[0].type || 'image/jpeg';
        content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
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
        body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 300, messages: [{ role: 'user', content }] })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error ${resp.status}`);
      }

      const raw    = await resp.json();
      const text   = raw.content[0].text.trim();
      const match  = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Unexpected response format');

      const m = JSON.parse(match[0]);

      document.getElementById('logCal').value     = m.calories || '';
      document.getElementById('logProtein').value = m.protein  || '';
      document.getElementById('logCarbs').value   = m.carbs    || '';
      document.getElementById('logFat').value     = m.fat      || '';
      calcMacros();

      status.innerHTML =
        `<span style="color:var(--green)">✓ ${m.calories} cal · ${m.protein}g P · ${m.carbs}g C · ${m.fat}g F</span>` +
        (m.notes ? `<div style="color:var(--muted);font-size:0.75rem;margin-top:3px">${m.notes}</div>` : '');

    } catch (e) {
      status.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`;
    } finally {
      btn.disabled  = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Estimate Macros';
    }
  }

  function _fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function handleAiPhoto(input) {
    const preview = document.getElementById('aiPhotoPreview');
    const label   = document.getElementById('aiPhotoLabel');
    if (input.files && input.files[0]) {
      const url = URL.createObjectURL(input.files[0]);
      preview.innerHTML = `<img src="${url}"><button class="ai-clear-btn" onclick="clearAiPhoto()">×</button>`;
      label.textContent = 'Change';
    }
  }

  function clearAiPhoto() {
    document.getElementById('aiPhoto').value        = '';
    document.getElementById('aiPhotoPreview').innerHTML = '';
    document.getElementById('aiPhotoLabel').textContent = 'Photo';
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

  /* ── HELPERS ── */
  function makeKey(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
  function isMetric() { return !!getSettings().useMetric; }
  function wt(lbs) { return isMetric() ? (lbs*0.453592).toFixed(1)+' kg' : lbs+' lbs'; }
  function colorFor(cal, isRefeed) {
    if (isRefeed) return 'refeed';
    const s = getSettings();
    return cal <= s.green ? 'green' : cal > s.red ? 'red' : 'yellow';
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
      const pct = dailyGoal > 0 ? Math.min((cal / dailyGoal) * 100, 100) : 0;
      const isOver = cal > dailyGoal;
      const diff = Math.abs(cal - dailyGoal);
      const barColor = isOver ? 'linear-gradient(90deg,#ef4444,#f87171)' : 'linear-gradient(90deg,#10b981,#34d399)';
      const remainTxt = isOver ? `<span style="color:#f87171;font-size:0.72rem">${diff.toLocaleString()} cal over daily goal</span>` : `<span style="color:#34d399;font-size:0.72rem">${diff.toLocaleString()} cal remaining</span>`;
      html += `<div style="margin:10px 0 4px;font-size:0.72rem;color:var(--muted)">${cal.toLocaleString()} / ${dailyGoal.toLocaleString()} cal today</div>`;
      html += `<div class="bar-wrap" style="margin-bottom:4px"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${barColor}">${Math.round(pct)}%</div></div>`;
      html += `<div style="margin-bottom:6px">${remainTxt}</div>`;

      if (mac) {
        const macGoals = { p: s.macroP, c: s.macroC, f: s.macroF };
        const macColors = { p: '#f472b6', c: '#60a5fa', f: '#fbbf24' };
        const macLabels = { p: 'P', c: 'C', f: 'F' };
        html += `<div class="today-macros-display" style="margin-top:8px">P ${mac.p}g · C ${mac.c}g · F ${mac.f}g</div>`;
        html += `<div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">`;
        for (const k of ['p','c','f']) {
          const logged = mac[k] || 0;
          const goal = macGoals[k];
          const mp = goal > 0 ? Math.min((logged / goal) * 100, 100) : 0;
          html += `<div style="font-size:0.72rem;color:var(--muted2)">${macLabels[k]}: ${logged}g / ${goal}g</div>`;
          html += `<div class="bar-wrap" style="height:10px;margin-bottom:2px"><div class="bar-fill" style="width:${mp.toFixed(1)}%;background:${macColors[k]};min-width:0;font-size:0"></div></div>`;
        }
        html += `</div>`;
      }

      if (note) html += `<div class="today-note-display">"${escHtml(note)}"</div>`;
      html += `<button class="btn-today-edit" onclick="openModal(${today.getFullYear()}, ${today.getMonth()}, ${today.getDate()})">Edit today's entry →</button>`;
      el.innerHTML = html;
    } else {
      el.innerHTML = `<div class="today-empty">—</div><div class="today-big-sub">nothing logged yet today</div>`;
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
  function _doLog(dateVal, calVal, p, c, f) {
    if (!dateVal || calVal === '') return false;
    const [y, m, d] = dateVal.split('-').map(Number);
    const key  = makeKey(y, m-1, d);
    const data = getData();
    data[key]  = parseInt(calVal, 10);
    saveData(data);
    if (p || c || f) { const macros = ls(MACROS_KEY, {}); macros[key] = { p, c, f }; lsSet(MACROS_KEY, macros); }
    refreshAll();
    maybeShame(parseInt(calVal, 10), key);
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
    wStart.setDate(today.getDate() - today.getDay());

    let actual = 0, daysLogged = 0, daysElapsed = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(wStart); d.setDate(wStart.getDate() + i);
      if (d <= today) daysElapsed++;
      const v = data[makeKey(d.getFullYear(), d.getMonth(), d.getDate())];
      if (v !== undefined) { actual += v; daysLogged++; }
    }

    const expected = Math.round(daysElapsed * (s.weekly / 7));
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

      const isPast = new Date(viewYear, viewMonth, d) < today && !isToday;
      const el = document.createElement('div');
      el.className = 'cal-cell' + (isToday ? ' today' : '');
      if (cal !== undefined) el.classList.add(colorFor(cal, isRefeed));
      else if (isPast) el.classList.add('nodata');

      const calStr = cal !== undefined ? (cal >= 1000 ? (cal/1000).toFixed(1)+'k' : cal) : '';
      el.innerHTML = `<span class="cell-num">${d}</span>` +
        (cal !== undefined ? `<span class="cell-cal">${calStr}</span>` : '') +
        (hasNote ? `<div class="cell-note-dot"></div>` : '');
      el.onclick = () => openModal(viewYear, viewMonth, d);
      grid.appendChild(el);
    }

    document.getElementById('legend').innerHTML = `
      <div class="legend-item"><div class="legend-dot" style="background:#10b981"></div> ≤ ${s.green} cal</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div> ${s.green}–${s.red} cal</div>
      <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div> > ${s.red} cal</div>
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

  /* ── CALENDAR PAGE LOG ── */
  function calcMacros() {
    const p = parseFloat(document.getElementById('logProtein').value) || 0;
    const c = parseFloat(document.getElementById('logCarbs').value)   || 0;
    const f = parseFloat(document.getElementById('logFat').value)     || 0;
    const prev = document.getElementById('macroCalcPreview');
    if (p||c||f) { const t=Math.round(p*4+c*4+f*9); prev.textContent=t.toLocaleString(); document.getElementById('logCal').value=t; }
    else prev.textContent='—';
  }

  function logCalories() {
    const dateVal = document.getElementById('logDate').value;
    const calVal  = document.getElementById('logCal').value;
    const p = parseFloat(document.getElementById('logProtein').value) || 0;
    const c = parseFloat(document.getElementById('logCarbs').value)   || 0;
    const f = parseFloat(document.getElementById('logFat').value)     || 0;
    if (!_doLog(dateVal, calVal, p, c, f)) return;
    document.getElementById('logCal').value=''; document.getElementById('logProtein').value='';
    document.getElementById('logCarbs').value=''; document.getElementById('logFat').value='';
    document.getElementById('macroCalcPreview').textContent='—';
  }

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
    document.getElementById('pName').value=''; document.getElementById('pCal').value='';
    document.getElementById('pPresetP').value=''; document.getElementById('pPresetC').value=''; document.getElementById('pPresetF').value='';
    renderPresets();
  }

  function deletePreset(i) {
    const presets = ls(PRESETS_KEY, []);
    presets.splice(i, 1);
    lsSet(PRESETS_KEY, presets);
    renderPresets();
  }

  function applyPreset(cal, p, c, f) {
    document.getElementById('logCal').value=cal;
    document.getElementById('logProtein').value=p||'';
    document.getElementById('logCarbs').value=c||'';
    document.getElementById('logFat').value=f||'';
    calcMacros();
    document.getElementById('logCal').focus();
  }

  function renderPresets() {
    const presets = ls(PRESETS_KEY, []);
    const chips = document.getElementById('presetChips');
    chips.innerHTML = presets.length === 0
      ? '<span style="font-size:0.78rem;color:var(--muted)">No presets yet — add one below</span>'
      : presets.map(p => `<div class="preset-chip" onclick="applyPreset(${p.cal},${p.p||0},${p.c||0},${p.f||0})">${escHtml(p.name)}<span class="preset-chip-cal">${p.cal.toLocaleString()}</span></div>`).join('');

    const list = document.getElementById('presetList');
    list.innerHTML = presets.length === 0
      ? '<div class="preset-empty">No presets yet.</div>'
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
    document.getElementById('wtVal').value = '';
    renderWeightChart();
    checkRecalcBanner();
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
    svg.innerHTML=html;
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
    days.forEach((day,i)=>{ const x=P.l+i*(pw/30); if (day.cal!==undefined) { const color=day.refeed?'rgba(108,122,224,0.7)':day.cal<=s.green?'rgba(16,185,129,0.72)':day.cal>s.red?'rgba(239,68,68,0.72)':'rgba(245,158,11,0.72)'; const barH=Math.max(2,(day.cal/maxCal)*ph); const d=day.date; html+=`<rect x="${(x+1).toFixed(1)}" y="${(P.t+ph-barH).toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" rx="2"><title>${d.getMonth()+1}/${d.getDate()}: ${day.cal.toLocaleString()} cal</title></rect>`; } });
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
    if (filtered.length===0) { el.innerHTML='<div class="history-empty">No data found. Start tracking to build your history.</div>'; return; }

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

  /* ── MODAL ── */
  function openModal(y, m, d) {
    modalKey = makeKey(y, m, d);
    const data=getData(), notes=ls(NOTES_KEY,{}), refeed=ls(REFEED_KEY,{}), macros=ls(MACROS_KEY,{});
    const existing=data[modalKey], mac=macros[modalKey]||{};
    document.getElementById('modalTitle').textContent=`${MONTHS[m]} ${d}, ${y}`;
    document.getElementById('modalInput').value=existing!==undefined?existing:'';
    document.getElementById('modalProtein').value=mac.p||''; document.getElementById('modalCarbs').value=mac.c||''; document.getElementById('modalFat').value=mac.f||'';
    document.getElementById('modalNote').value=notes[modalKey]||'';
    document.getElementById('modalRefeed').checked=!!refeed[modalKey];
    document.getElementById('btnDel').style.display=existing!==undefined?'inline-block':'none';
    document.getElementById('overlay').classList.add('show');
    setTimeout(()=>document.getElementById('modalInput').focus(),50);
  }

  function closeModal() { document.getElementById('overlay').classList.remove('show'); modalKey=null; }
  function overlayClick(e) { if (e.target===document.getElementById('overlay')) closeModal(); }
  function modalCalcMacros() {
    const p=parseFloat(document.getElementById('modalProtein').value)||0;
    const c=parseFloat(document.getElementById('modalCarbs').value)||0;
    const f=parseFloat(document.getElementById('modalFat').value)||0;
    if (p||c||f) document.getElementById('modalInput').value=Math.round(p*4+c*4+f*9);
  }

  function saveModal() {
    if (!modalKey) return;
    const val=document.getElementById('modalInput').value;
    if (val==='') return;
    const data=getData(), notes=ls(NOTES_KEY,{}), refeed=ls(REFEED_KEY,{}), macros=ls(MACROS_KEY,{});
    data[modalKey]=parseInt(val,10);
    const note=document.getElementById('modalNote').value.trim();
    if (note) notes[modalKey]=note; else delete notes[modalKey];
    if (document.getElementById('modalRefeed').checked) refeed[modalKey]=true; else delete refeed[modalKey];
    const p=parseFloat(document.getElementById('modalProtein').value)||0;
    const c=parseFloat(document.getElementById('modalCarbs').value)||0;
    const f=parseFloat(document.getElementById('modalFat').value)||0;
    if (p||c||f) macros[modalKey]={p,c,f}; else delete macros[modalKey];
    saveData(data); lsSet(NOTES_KEY,notes); lsSet(REFEED_KEY,refeed); lsSet(MACROS_KEY,macros);
    const savedCal = parseInt(val, 10);
    const savedKey = modalKey;
    closeModal(); refreshAll();
    maybeShame(savedCal, savedKey);
  }

  function deleteEntry() {
    if (!modalKey) return;
    const data=getData(), notes=ls(NOTES_KEY,{}), refeed=ls(REFEED_KEY,{}), macros=ls(MACROS_KEY,{});
    delete data[modalKey]; delete notes[modalKey]; delete refeed[modalKey]; delete macros[modalKey];
    saveData(data); lsSet(NOTES_KEY,notes); lsSet(REFEED_KEY,refeed); lsSet(MACROS_KEY,macros);
    closeModal(); refreshAll();
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

    document.getElementById('sWeekly').value=weeklyCal;
    lsSet(SET_KEY,Object.assign(getSettings(),{weekly:weeklyCal}));
    updateWeekly(); renderCalChart(); renderWeightChart(); checkRecalcBanner();
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
  document.getElementById('modalInput').addEventListener('keydown', e=>{ if(e.key==='Enter') saveModal(); if(e.key==='Escape') closeModal(); });
  document.getElementById('logCal').addEventListener('keydown',    e=>{ if(e.key==='Enter') logCalories(); });
  document.getElementById('quickCal').addEventListener('keydown',  e=>{ if(e.key==='Enter') quickLog(); });
  document.getElementById('wtVal').addEventListener('keydown',     e=>{ if(e.key==='Enter') logWeight(); });
  document.getElementById('pCal').addEventListener('keydown',      e=>{ if(e.key==='Enter') addPreset(); });
  document.getElementById('pName').addEventListener('keydown',     e=>{ if(e.key==='Enter') document.getElementById('pCal').focus(); });

  /* ── INIT ── */
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
  }

  function init() {
    const t   = new Date();
    const pad = n => String(n).padStart(2,'0');
    const todayStr = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`;

    document.getElementById('appDate').textContent = `${DAYS_LONG[t.getDay()]}, ${MONTHS[t.getMonth()]} ${t.getDate()}, ${t.getFullYear()}`;
    document.getElementById('quickDate').value = todayStr;
    document.getElementById('logDate').value   = todayStr;
    document.getElementById('wtDate').value    = todayStr;

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

    const savedTheme = localStorage.getItem('blubr_theme') || 'retro';
    setTheme(savedTheme);

    loadCalcProfile();
    loadApiKey();
    runCalc();
    refreshAll();
  }

  // init() is called by onAuthStateChange after user data is loaded from Supabase
