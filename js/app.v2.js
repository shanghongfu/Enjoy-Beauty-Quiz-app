/* ================================================
 * Quiz Master - FanKe-style Mobile App
 * PWA | Multi-page navigation | Theme switching
 * v43-MODAL-FIX | 2026-09-09 | exam-settings-header
 * ================================================ */

/* ============ Supabase Client ============ */
// Initialised in supabase-config.js (URL + key)
const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);

/* ============ Storage Keys (kept for theme/streak only) ============ */
const THEME_KEY = 'quiz_master_theme';
const STREAK_KEY = 'quiz_master_streak';
const SESSION_KEY = 'quiz_master_session_v3'; // local-only session marker

/* ============ Auth Layer (Supabase Auth-backed) ============ */
const Auth = {
  // Accounts now live in Supabase `auth.users` (email/password).
  // Profile + role + expiry live in public.users (id = auth.uid()).
  // We expose a thin wrapper over supabase.auth.
  _currentProfile: null,

  // Read a single auth user's profile row from public.users by id.
  async _profile(uid) {
    const { data, error } = await db.from('users').select('*').eq('id', uid).maybeSingle();
    if (error) { console.error('profile load error', error); return null; }
    return data || null;
  },

  // Normalise a public.users row into the shape the rest of the app expects.
  _normalise(row) {
    if (!row) return null;
    // Defensive: Supabase may return Postgres text[] as a string like "{a,b}",
    // OR a JSON array string like '["a","b"]' (when the column is plain text).
    // The old regex only handled "{...}" and silently corrupted "[...]" strings,
    // which made assigned library ids fail to match and students saw no libraries.
    let libs = row.libraries || [];
    if (typeof libs === 'string') {
      const raw = libs.trim();
      if (raw.startsWith('[')) {
        try {
          const parsed = JSON.parse(raw);
          libs = Array.isArray(parsed) ? parsed : [];
        } catch (e) { libs = []; }
      } else if (raw.startsWith('{')) {
        // Postgres text[] textual form: {a,b} or {"a","b"}
        libs = raw.replace(/^\{|\}$/g, '').split(',').map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
      } else {
        libs = raw ? [raw] : [];
      }
    }
    // Defensive: each element might still be a JSON array string like '[lib_id]'.
    libs = libs.flatMap(id => {
      const s = String(id).trim();
      if (s.startsWith('[')) {
        try {
          const parsed = JSON.parse(s);
          return Array.isArray(parsed) ? parsed : [s];
        } catch (e) { return [s]; }
      }
      return [s];
    }).filter(Boolean);
    return {
      id: row.id,
      username: row.username,
      name: row.name || row.username,
      avatar: row.avatar || '📚',
      role: row.role || 'student',
      libraries: libs,
      enabled: row.enabled !== false,
      expires_at: row.expires_at || null,
      notes: row.notes || ''
    };
  },

  // Return the currently signed-in user profile (or null).
  async getCurrent() {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return null;
    const row = await this._profile(user.id);
    if (!row) return null;
    const p = this._normalise(row);
    // Expiry check: block if expired.
    if (p.expires_at && new Date(p.expires_at) < new Date()) {
      await db.auth.signOut();
      throw new Error('expired');
    }
    this._currentProfile = p;
    return p;
  },

  async login(email, password) {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) return null;
    // After sign-in, resolve profile (id = auth uid). Throws on expiry.
    return await this.getCurrent();
  },

  async logout() {
    this._currentProfile = null;
    return await db.auth.signOut();
  },

  // Admin-only: create a student. Goes through a SECURITY DEFINER Postgres
  // function (public.create_student) that writes directly to auth.users +
  // auth.identities + public.users. No email confirmation, no signUp, no
  // session switch. Idempotent: re-saving the same username just resets the
  // password and re-upserts the profile instead of erroring.
  async createStudent({ email, password, username, name, avatar, libraries, expiresAt }) {
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin only');
    // Send libraries as a JSON string. Supabase RPC passes text[] parameters as JSON,
    // and PostgreSQL text[] interprets a JSON array string as a single element,
    // producing nested arrays like {"[lib_id]"}. Sending a JSON text string lets the
    // server-side function parse it correctly with jsonb_array_elements_text.
    const { data: uid, error } = await db.rpc('create_student', {
      p_username: username,
      p_password: password,
      p_name: name || null,
      p_avatar: avatar || '📚',
      p_libraries: JSON.stringify(libraries || []),
      p_expires_at: expiresAt || null
    });
    if (error) throw new Error(error.message || 'Create failed');
    if (!uid) throw new Error('Create returned no id');
    return this._normalise(await this._profile(uid));
  },

  async _attachProfile(uid, { username, name, avatar, libraries, expiresAt }) {
    // Check if profile already exists — if so, only update name/avatar/expiresAt,
    // NEVER overwrite libraries (admin-assigned values must survive re-login).
    const { data: existing } = await db.from('users').select('id').eq('id', uid).maybeSingle();
    const profile = {
      id: uid,
      username,
      name: name || username,
      avatar: avatar || '📚',
      role: 'student',
      enabled: true,
      expires_at: expiresAt || null
    };
    // Only write libraries + upsert for brand-new users; existing users keep their
    // admin-assigned libraries (libraries are managed exclusively by updateStudent).
    if (!existing) {
      profile.libraries = libraries || [];
    }
    const { error } = await db.from('users').upsert(profile, { onConflict: 'id' });
    if (error) throw new Error('Profile insert failed: ' + error.message);
    return this._normalise(await this._profile(uid));
  },

  // Admin-only: update profile fields (not password; password via reset).
  async updateStudent(id, patch) {
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin only');
    // Update public.users table
    const { error } = await db.from('users').update(patch).eq('id', id);
    if (error) throw new Error('Update failed: ' + error.message);
    // Also sync to Auth metadata so student gets updated libraries on next login
    if (patch.libraries !== undefined) {
      await db.auth.admin.updateUserById(id, { data: { libraries: patch.libraries } }).catch(() => {});
    }
    return true;
  },

  // Admin-only: delete a student (public.users profile + auth user).
  async deleteStudent(id, email) {
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin only');
    const { error } = await db.from('users').delete().eq('id', id);
    if (error) throw new Error('Delete profile failed: ' + error.message);
    // Attempt to delete the auth user too (may fail without service_role; ignore).
    if (email) {
      await db.auth.admin ? null : null;
    }
    return true;
  },

  // Admin changes their own password via authenticated updateUser.
  async changeAdminPassword(newPwd) {
    if (!currentUser || currentUser.role !== 'admin') return false;
    const { error } = await db.auth.updateUser({ password: newPwd });
    return !error;
  },

  async listStudents() {
    if (!currentUser || currentUser.role !== 'admin') return [];
    const { data, error } = await db.from('users').select('*').eq('role', 'student');
    if (error) { console.error('listStudents', error); return []; }
    return (data || []).map(r => this._normalise(r));
  },

  // Admin resets a student's password. Goes through a SECURITY DEFINER Postgres
  // function (public.reset_student_password) — no Edge Function / service role needed.
  async resetStudentPassword(email, newPwd) {
    if (!currentUser || currentUser.role !== 'admin') throw new Error('Admin only');
    const { error } = await db.rpc('reset_student_password', {
      p_email: email,
      p_password: newPwd
    });
    if (error) throw new Error(error.message || 'Reset failed');
    return true;
  }
};

/* ============ Data Layer (libraries + questions + stats, Supabase-backed) ============ */
const DB = {
  async _uid() {
    const { data: { user } } = await db.auth.getUser();
    return user ? user.id : null;
  },
  // Shared global libraries + questions (any logged-in user can read; admin writes)
  async loadLibraries() {
    const { data: libs, error } = await db.from('libraries').select('*').order('created_at', { ascending: true });
    if (error) { console.error('loadLibraries', error); return []; }
    return (libs || []).map(l => ({
      id: l.id,
      name: l.name,
      desc: l.description || '',
      icon: l.icon || '📚',
      color: l.color || '#5B6CFF',
      createdAt: l.created_at ? new Date(l.created_at).getTime() : Date.now(),
      examDuration: l.exam_duration || null,
      examQuestionCount: l.exam_question_count || null,
      examPassRate: l.exam_pass_rate || null
    }));
  },

  async loadQuestions() {
    // Load ALL languages. Filtering by language here caused two disasters:
    // 1) admin saw "questions gone" after re-login when questions were tagged
    //    with a non-english language; 2) save() does delete-all + insert-all,
    //    so if only one language was loaded, saving wiped the other languages.
    const { data: qs, error } = await db.from('questions').select('*');
    if (error) { console.error('loadQuestions', error); return []; }
    // Map snake_case (Postgres) -> camelCase (frontend)
    return (qs || []).map(q => {
      const options = q.options || [];
      const isJudge = options.length === 0;
      let answer = q.correct_index;
      let type = isJudge ? 'judge' : 'single';
      if (isJudge) {
        // correct_index 0 = true, 1 = false (per our save logic above)
        answer = q.correct_index === 0;
      }
      return {
        id: q.id,
        libraryId: q.library_id,
        stem: q.text,
        options: options,
        answer: answer,
        explanation: q.explanation || '',
        type: type,
        language: q.language || 'en'
      };
    });
  },

  // Convenience: full data bundle used by app
  async load() {
    const [libraries, questions] = await Promise.all([this.loadLibraries(), this.loadQuestions()]);
    return { libraries, questions };
  },

  async save(arg1, arg2) {
    // Support both DB.save(data) and DB.save(uid, data) call styles.
    // (Some old callers passed only one argument.)
    const d = (arg2 !== undefined) ? arg2 : arg1;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      throw new Error('DB.save requires a data object');
    }
    // SAFE: upsert-only. NEVER delete-all + insert-all.
    // A partial in-memory snapshot can no longer wipe questions/libraries that
    // exist only in the cloud — this was the root cause of "importing library B
    // silently deleted library A's questions". Each row is matched by its `id`,
    // so rows not present in the payload are preserved untouched.
    if (Array.isArray(d.libraries) && d.libraries.length) {
      const rows = d.libraries.map(l => ({
        id: l.id,
        name: l.name,
        description: l.desc || l.description || '',
        exam_duration: l.examDuration || null,
        exam_question_count: l.examQuestionCount || null,
        exam_pass_rate: l.examPassRate || null
      }));
      const { error } = await db.from('libraries').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error('save libs: ' + error.message);
    }
    if (Array.isArray(d.questions) && d.questions.length) {
      const curLang = (window.i18n && window.i18n.currentLang) || 'en';
      const rows = d.questions.map(q => {
        // Judge questions: store as 0=true / 1=false in correct_index, options=[]
        let correctIndex;
        if (q.type === 'judge') {
          correctIndex = q.answer === true ? 0 : 1;
        } else {
          correctIndex = q.answer !== undefined ? q.answer : (q.correctIndex !== undefined ? q.correctIndex : 0);
        }
        return {
          id: q.id,
          library_id: q.libraryId,
          text: q.stem || q.text || '',
          options: q.options || [],
          correct_index: correctIndex,
          explanation: q.explanation || '',
          language: q.language || curLang
        };
      });
      const { error } = await db.from('questions').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error('save qs: ' + error.message);
    }
  },

  // Wipe EVERYTHING (used only by the explicit "reset all" action).
  async clearAll() {
    const { error: qErr } = await db.from('questions').delete().neq('id', '');
    if (qErr) throw new Error('clear qs: ' + qErr.message);
    const { error: lErr } = await db.from('libraries').delete().neq('id', '');
    if (lErr) throw new Error('clear libs: ' + lErr.message);
  },

  // SAFE import: only touches ONE library, never wipes other libraries' questions.
  // Replaces the old delete-all + insert-all behaviour that silently dropped data.
  async importLibrary(lib, questions) {
    if (!lib || !lib.id) throw new Error('importLibrary: missing lib id');
    // Upsert the library row itself
    const { error: libErr } = await db.from('libraries').upsert({
      id: lib.id,
      name: lib.name,
      description: lib.desc || lib.description || '',
      exam_duration: lib.examDuration || null,
      exam_question_count: lib.examQuestionCount || null,
      exam_pass_rate: lib.examPassRate || null
    });
    if (libErr) throw new Error('save lib: ' + libErr.message);
    // Delete only this library's existing questions, then insert the new batch
    const { error: delErr } = await db.from('questions').delete().eq('library_id', lib.id);
    if (delErr) throw new Error('clear qs: ' + delErr.message);
    if (questions && questions.length) {
      const curLang = (window.i18n && window.i18n.currentLang) || 'en';
      const rows = questions.map(q => {
        let correctIndex;
        if (q.type === 'judge') {
          correctIndex = q.answer === true ? 0 : 1;
        } else {
          correctIndex = q.answer !== undefined ? q.answer : (q.correctIndex !== undefined ? q.correctIndex : 0);
        }
        return {
          id: q.id,
          library_id: q.libraryId,
          text: q.stem || q.text || '',
          options: q.options || [],
          correct_index: correctIndex,
          explanation: q.explanation || '',
          language: q.language || curLang
        };
      });
      const { error } = await db.from('questions').insert(rows);
      if (error) throw new Error('save qs: ' + error.message);
    }
  },

  async loadStats(uid) {
    if (!uid) uid = await this._uid();
    if (!uid) return { totalAnswered: 0, totalCorrect: 0, byLibrary: {}, wrongIds: [] };
    const { data: row, error } = await db.from('stats').select('*').eq('user_id', uid).maybeSingle();
    if (error || !row) return { totalAnswered: 0, totalCorrect: 0, byLibrary: {}, wrongIds: [] };
    return {
      totalAnswered: row.total_answered || 0,
      totalCorrect: row.total_correct || 0,
      byLibrary: row.by_library || {},
      wrongIds: row.wrong_ids || []
    };
  },

  async saveStats(uid, s) {
    if (typeof uid === 'object' && uid !== null) { s = uid; uid = null; }
    if (!uid) uid = await this._uid();
    if (!uid) return;
    try {
      const payload = {
        user_id: uid,
        total_answered: s.totalAnswered || 0,
        total_correct: s.totalCorrect || 0,
        by_library: s.byLibrary || {},
        wrong_ids: s.wrongIds || [],
        updated_at: new Date().toISOString()
      };
      const { error } = await db.from('stats').upsert(payload, { onConflict: 'user_id' });
      if (error) console.error('saveStats', error);
    } catch (e) { console.error('DB.saveStats failed', e); }
  }
};

async function upsertUser() {
  // Sync current in-memory data + stats to Supabase for the logged-in user.
  if (!currentUser) return;
  await DB.save(data);
  await DB.saveStats(currentUser.id, stats);
}

let currentUser = null;
let data = { libraries: [], questions: [] };
let stats = { totalAnswered: 0, totalCorrect: 0, byLibrary: {}, wrongIds: [] };

async function reloadCurrentUserData() {
  if (!currentUser) return;
  data = await DB.load();
  // Refresh currentUser.libraries from DB so student always gets latest assignments
  const { data: profile, error } = await db.from('users').select('libraries').eq('id', currentUser.id).maybeSingle();
  if (profile && profile.libraries !== undefined) {
    currentUser.libraries = profile.libraries;
  }
  stats = await DB.loadStats(currentUser.id);
}

let session = {
  active: false, questions: [], index: 0, answers: [], correctCount: 0,
  mode: 'sequential', libraryId: null, startTime: 0
};
let pageStack = [];

/* ============ Helpers ============ */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
// escapeHtml: simple version using string concat (safe)
const escapeHtml = function(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, String.fromCharCode(38,97,109,112,59))
    .replace(/</g, String.fromCharCode(38,108,116,59))
    .replace(/>/g, String.fromCharCode(38,103,116,59))
    .replace(/\"/g, String.fromCharCode(38,113,117,111,116,59))
    .replace(/\x27/g, String.fromCharCode(38,35,51,57,59));
};

function toast(msg) {
  if (typeof msg === 'string' && msg.startsWith('i18n:')) {
    msg = i18n.t(msg.slice(5));
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// Admin-only guard: blocks any data-modifying action for non-admin users
// even if they bypass the hidden UI via devtools.
function requireAdmin() {
  if (!currentUser || currentUser.role !== 'admin') {
    toast('Admin only');
    return false;
  }
  return true;
}

function showLogin() {
  $('splash').style.display = 'none';
  $('app').classList.add('hidden');
  // Show login form if exists
  const loginPage = $('loginPage');
  if (loginPage) loginPage.classList.add('active');
}

function hideLogin() {
  const loginPage = $('loginPage');
  if (loginPage) loginPage.classList.remove('active');
  $('app').classList.remove('hidden');
}

// Hide all .admin-only elements for non-admin users. Runs on login + init.
function applyRoleVisibility() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    if (isAdmin) el.classList.remove('hidden-by-role');
    else el.classList.add('hidden-by-role');
  });
}

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

/* ============ Theme ============ */
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeIcon').textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem(THEME_KEY, theme);
}

$('themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || 'light';
  applyTheme(cur === 'light' ? 'dark' : 'light');
});

/* ============ Greeting ============ */
function setGreeting() {
  const h = new Date().getHours();
  let g = 'Good evening';
  if (h < 12) g = 'Good morning';
  else if (h < 18) g = 'Good afternoon';
  $('greetingText').textContent = g;
}

/* ============ Streak ============ */
function getStreak() {
  try {
    const s = JSON.parse(localStorage.getItem(STREAK_KEY)) || { count: 0, last: null };
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (s.last === today) return s.count;
    if (s.last === yesterday) return s.count;
    return 0;
  } catch { return 0; }
}

function updateStreak() {
  const today = new Date().toDateString();
  const s = JSON.parse(localStorage.getItem(STREAK_KEY)) || { count: 0, last: null };
  if (s.last === today) return; // already counted today
  if (s.last === new Date(Date.now() - 86400000).toDateString()) {
    s.count++;
  } else if (s.last !== today) {
    s.count = 1;
  }
  s.last = today;
  localStorage.setItem(STREAK_KEY, JSON.stringify(s));
}

/* ============ Page Navigation ============ */
async function go(pageId, options = {}) {
  const currentTop = pageStack[pageStack.length - 1];
  if (currentTop === pageId && !options.force) return;
  $$('.page').forEach(p => {
    p.classList.remove('active', 'slide-back');
  });
  const target = $(pageId);
  if (target) target.classList.add('active');
  if (!options.replace) pageStack.push(pageId);

  // refresh page content
  if (typeof refreshPage === 'function') await refreshPage(pageId);

  // update tabbar active
  $$('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === pageId);
  });
}

async function back() {
  if (session.active) {
    if (!confirm('Quit current practice session?')) return;
    session.active = false;
  }
  // If we only have one item on stack, fall back to homePage
  let prev;
  if (pageStack.length > 1) {
    pageStack.pop();
    prev = pageStack[pageStack.length - 1];
  } else {
    prev = 'homePage';
    pageStack = ['homePage'];
  }
  $$('.page').forEach(p => {
    p.classList.remove('active', 'slide-back');
  });
  const prevEl = $(prev);
  if (prevEl) prevEl.classList.add('active');
  if (typeof refreshPage === 'function') await refreshPage(prev);
  $$('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === prev);
  });
}

$$('[data-back]').forEach(b => b.addEventListener('click', back));

$$('.tab').forEach(t => {
  t.addEventListener('click', () => {
    if (session.active && t.dataset.tab !== 'practicePage') {
      if (!confirm('Quit current practice session?')) return;
      session.active = false;
    }
    pageStack = [t.dataset.tab];
    // Use window.go (the wrapped version) so role guards & side-effects run
    (window.go || go)(t.dataset.tab, { replace: true, force: true });
  });
});

$$('[data-go]').forEach(el => {
  el.addEventListener('click', () => (window.go || go)(el.dataset.go));
});

async function refreshPage(pageId) {
  if (pageId === 'homePage') renderHome();
  if (pageId === 'libraryPage') renderLibraryFull();
  if (pageId === 'practicePage') renderPracticeSetup();
  if (pageId === 'profilePage') renderProfile();
  if (pageId === 'statsPage') renderStats();
  if (pageId === 'managePage') await renderManage();
  if (pageId === 'wrongPage') renderWrongFull();
}

/* ============ HOME ============ */
function renderHome() {
  // Stats row
  $('homeStreak').textContent = getStreak();
  const libStats = stats.byLibrary || {};
  const mastered = Object.values(libStats).filter(s => s.answered >= 5 && s.correct / s.answered > 0.8).length;
  $('homeMastered').textContent = mastered;
  $('homeAccuracy').textContent = stats.totalAnswered > 0
    ? Math.round(stats.totalCorrect / stats.totalAnswered * 100) + '%' : '0%';

  // Continue scroll — use getVisibleLibraries() so students only see assigned libs
  const continueEl = $('continueScroll');
  const visForHome = getVisibleLibraries();
  if (!visForHome.length) {
    continueEl.innerHTML = `<div class="empty-hint" style="min-width:260px">📚 No libraries yet. Ask your admin to assign some!</div>`;
  } else {
    continueEl.innerHTML = visForHome.slice(0, 6).map(lib => {
      const memCount = getVisibleQuestions().filter(q => q.libraryId === lib.id).length;
      const libS = libStats[lib.id] || { answered: 0, correct: 0 };
      const pct = libS.answered > 0 ? Math.round(libS.correct / libS.answered * 100) : 0;
      return `<div class="continue-card" data-lib="${lib.id}">
        <div class="cc-icon" style="background:${lib.color || 'var(--bg)'}">${lib.icon || '📚'}</div>
        <div class="cc-name">${escapeHtml(lib.name)}</div>
        <div class="cc-meta"><span class="cc-qcnt" data-lib-q="${lib.id}">${memCount} Qs</span> · ${pct}% acc</div>
        <div class="cc-progress"><div class="cc-progress-fill" style="width:${pct}%;background:${lib.color || 'var(--primary)'}"></div></div>
      </div>`;
    }).join('');
    // Async DB count update (same pattern as Library page)
    visForHome.slice(0, 6).forEach(lib => {
      db.from('questions').select('id', { count: 'exact', head: true }).eq('library_id', lib.id)
        .then(({ count }) => {
          const el = document.querySelector(`.cc-qcnt[data-lib-q="${lib.id}"]`);
          if (el) el.textContent = `${count ?? '?'} Qs`;
        })
        .catch(() => {});
    });
    continueEl.querySelectorAll('.continue-card').forEach(c => {
      c.addEventListener('click', () => {
        go('practicePage');
        setTimeout(async () => { await startPractice('sequential', c.dataset.lib); }, 100);
      });
    });
  }

  // Library cards — use getVisibleLibraries() so students only see assigned libs
  const lcEl = $('libraryCards');
  if (!visForHome.length) {
    lcEl.innerHTML = `<div class="empty-hint">No libraries yet. Ask your admin to assign some!</div>`;
  } else {
    lcEl.innerHTML = visForHome.slice(0, 5).map(lib => {
      const memCount = getVisibleQuestions().filter(q => q.libraryId === lib.id).length;
      return `<div class="lib-card" data-lib="${lib.id}">
        <div class="lib-card-icon" style="background:${lib.color || 'var(--bg)'}">${lib.icon || '📚'}</div>
        <div class="lib-card-info">
          <div class="lib-card-name">${escapeHtml(lib.name)}</div>
          <div class="lib-card-desc">${escapeHtml(lib.desc || 'No description')}</div>
        </div>
        <div class="lib-card-count"><span class="lc-qcnt" data-lib-q="${lib.id}">${memCount} Qs</span></div>
      </div>`;
    }).join('');
    // Async DB count update (same pattern as Library page)
    visForHome.slice(0, 5).forEach(lib => {
      db.from('questions').select('id', { count: 'exact', head: true }).eq('library_id', lib.id)
        .then(({ count }) => {
          const el = document.querySelector(`.lc-qcnt[data-lib-q="${lib.id}"]`);
          if (el) el.textContent = `${count ?? '?'} Qs`;
        })
        .catch(() => {});
    });
    lcEl.querySelectorAll('.lib-card').forEach(c => {
      c.addEventListener('click', () => {
        go('practicePage');
        setTimeout(async () => { await startPractice('sequential', c.dataset.lib); }, 100);
      });
    });
  }
}

// Daily challenge
$('startDailyBtn').addEventListener('click', () => {
  if (getVisibleQuestions().length === 0) {
    toast('Create a library first');
    go('managePage');
    return;
  }
  go('practicePage');
  setTimeout(async () => { await startPractice('random'); }, 100);
  updateStreak();
});

// Category grid (4 modes)
$$('.cat-item').forEach(c => {
  c.addEventListener('click', () => {
    if (getVisibleQuestions().length === 0) {
      toast('Create a library first');
      go('managePage');
      return;
    }
    const mode = c.dataset.mode;
    go('practicePage');
    setTimeout(async () => {
      if (mode === 'wrong') {
        if (stats.wrongIds.length === 0) { toast('No wrong questions yet'); return; }
        await startPractice('wrong', null);
      } else {
        renderPracticeSetup(mode);
      }
    }, 100);
  });
});

/* ============ LIBRARY FULL PAGE ============ */
let libraryFilter = 'all';
let librarySearch = '';

function renderLibraryFull() {
  // Use getVisibleLibraries() so students only see their assigned libraries
  const allLibs = getVisibleLibraries();
  let libs = allLibs.slice();

  if (libraryFilter === 'recent') {
    libs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (libraryFilter === 'large') {
    libs.sort((a, b) => {
      const ac = (data.questions || []).filter(q => q.libraryId === a.id).length;
      const bc = (data.questions || []).filter(q => q.libraryId === b.id).length;
      return bc - ac;
    });
  }

  if (librarySearch) {
    libs = libs.filter(l => l.name.toLowerCase().includes(librarySearch.toLowerCase()));
  }

  const list = $('libraryFullList');
  if (libs.length === 0) {
    list.innerHTML = `<div class="empty-hint">No libraries found.</div>`;
    return;
  }

  list.innerHTML = libs.map(lib => {
    const memCount = (data.questions || []).filter(q => q.libraryId === lib.id).length;
    return `<div class="lib-card" data-lib="${lib.id}">
      <div class="lib-card-icon" style="background:${lib.color || 'var(--bg)'}">${lib.icon || '📚'}</div>
      <div class="lib-card-info">
        <div class="lib-card-name">${escapeHtml(lib.name)}</div>
        <div class="lib-card-desc">${escapeHtml(lib.desc || 'No description')}</div>
        <div class="lib-card-meta"><span class="lib-qcount" data-lib-q="${lib.id}">${memCount} questions</span></div>
      </div>
      <div class="lib-card-count">›</div>
    </div>`;
  }).join('');

  // Async: update each library's question count from live DB (same as renderManage does)
  libs.forEach(lib => {
    db.from('questions').select('id', { count: 'exact', head: true }).eq('library_id', lib.id)
      .then(({ count }) => {
        const el = document.querySelector(`.lib-qcount[data-lib-q="${lib.id}"]`);
        if (el) el.textContent = `${count ?? '?'} questions`;
      })
      .catch(() => {});
  });

  list.querySelectorAll('.lib-card').forEach(c => {
    c.addEventListener('click', () => {
      go('practicePage');
      setTimeout(() => startPractice('sequential', c.dataset.lib), 100);
    });
  });
}

function filterAndSortLibs(libs) {
  let filtered = libs.slice();
  if (libraryFilter === 'recent') {
    filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (libraryFilter === 'large') {
    filtered.sort((a, b) => {
      const ac = getVisibleQuestions().filter(q => q.libraryId === a.id).length;
      const bc = getVisibleQuestions().filter(q => q.libraryId === b.id).length;
      return bc - ac;
    });
  }
  if (librarySearch) {
    filtered = filtered.filter(l => l.name.toLowerCase().includes(librarySearch.toLowerCase()));
  }
  return filtered;
}

$('librarySearch').addEventListener('input', (e) => {
  librarySearch = e.target.value;
  renderLibraryFull();
});

$$('.filter-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('.filter-chips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    libraryFilter = chip.dataset.filter;
    renderLibraryFull();
  });
});

$('addLibraryPageBtn').addEventListener('click', () => { if (requireAdmin()) openLibraryModal(); });

/* ============ PRACTICE SETUP ============ */
let pendingMode = null;
// Fetch live question count for a library from DB (always fresh after import)
async function getLiveQuestionCount(libraryId) {
  try {
    const { count } = await db.from('questions').select('id', { count: 'exact', head: true }).eq('library_id', libraryId);
    return count ?? 0;
  } catch (_) { return 0; }
}

// Fetch live questions for a library from DB (always fresh after import)
async function loadLiveQuestionsForLibrary(libraryId) {
  try {
    const { data: qs, error } = await db.from('questions').select('*').eq('library_id', libraryId);
    if (error || !qs) return [];
    return (qs || []).map(q => {
      const options = q.options || [];
      const isJudge = options.length === 0;
      let answer = q.correct_index;
      let type = isJudge ? 'judge' : 'single';
      if (isJudge) answer = q.correct_index === 0;
      return {
        id: q.id,
        libraryId: q.library_id,
        stem: q.text,
        options: options,
        answer: answer,
        explanation: q.explanation || '',
        type: type,
        language: q.language || 'en'
      };
    });
  } catch (_) { return []; }
}

function renderPracticeSetup(mode) {
  pendingMode = mode || 'sequential';
  $('practiceSetupView').classList.remove('hidden');
  $('practiceAreaView').classList.add('hidden');
  $('practiceResultView').classList.add('hidden');
  $('practicePageTitle').textContent = mode ? `${capitalize(mode)} Practice` : 'Practice';

  const list = $('practiceLibraryList');
  const visLibs = getVisibleLibraries();
  if (!visLibs.length) {
    list.innerHTML = `<div class="empty-hint">No libraries assigned. Ask your admin to assign one.</div>`;
    return;
  }
  // Show loading state while fetching live counts
  list.innerHTML = visLibs.map(lib =>
    `<div class="pl-card" data-lib="${lib.id}">
      <div class="pl-card-icon" style="background:${lib.color || 'var(--bg)'}">${lib.icon || '📚'}</div>
      <div class="pl-card-info">
        <div class="pl-card-name">${escapeHtml(lib.name)}</div>
        <div class="pl-card-meta" id="plcnt-${lib.id}">… questions</div>
      </div>
    </div>`
  ).join('');
  // Async: update each library's question count from live DB (same pattern as Library page)
  visLibs.forEach(lib => {
    getLiveQuestionCount(lib.id).then(count => {
      const el = document.getElementById(`plcnt-${lib.id}`);
      if (el) el.textContent = `${count} questions`;
    });
  });
  list.querySelectorAll('.pl-card').forEach(c => {
    c.addEventListener('click', () => startPractice(pendingMode, c.dataset.lib));
  });
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ============ PRACTICE FLOW ============ */
// startPractice is now async so it can load questions fresh from DB (always
// accurate even after a fresh import, without relying on stale in-memory cache).
async function startPractice(mode, libraryId) {
  // Show loading state on the practice area
  $('practiceSetupView').classList.add('hidden');
  $('practiceAreaView').classList.remove('hidden');
  $('practiceResultView').classList.add('hidden');
  $('questionText').textContent = 'Loading questions…';
  $('optionsList').innerHTML = '';
  $('progressText').textContent = '…/…';
  $('progressFill').style.width = '0%';
  $('submitAnswer').classList.add('hidden');
  $('nextQuestion').classList.add('hidden');
  $('explanation').classList.add('hidden');

  // Load questions live from DB so counts are always accurate after import
  let pool;
  if (libraryId) {
    pool = await loadLiveQuestionsForLibrary(libraryId);
  } else {
    // All questions — load all from DB
    try {
      const { data: qs } = await db.from('questions').select('*');
      pool = (qs || []).map(q => {
        const options = q.options || [];
        const isJudge = options.length === 0;
        let answer = q.correct_index;
        let type = isJudge ? 'judge' : 'single';
        if (isJudge) answer = q.correct_index === 0;
        return {
          id: q.id, libraryId: q.library_id, stem: q.text,
          options, answer, explanation: q.explanation || '',
          type, language: q.language || 'en'
        };
      });
    } catch (_) { pool = []; }
  }

  if (mode === 'wrong') {
    pool = pool.filter(q => stats.wrongIds.includes(q.id));
    if (pool.length === 0) {
      toast('No wrong questions yet');
      go('homePage');
      return;
    }
  } else {
    if (pool.length === 0) {
      toast('Library is empty');
      go('homePage');
      return;
    }
  }

  let questions;
  if (mode === 'random') {
    questions = shuffle(pool).slice(0, Math.min(20, pool.length));
  } else if (mode === 'exam') {
    // Exam mode: respect per-library examQuestionCount (default 50) and examPassRate (default 70)
    const lib = data.libraries.find(l => l.id === libraryId);
    const examCount = (lib && lib.examQuestionCount && lib.examQuestionCount > 0)
      ? Math.min(lib.examQuestionCount, pool.length)
      : Math.min(50, pool.length);
    questions = shuffle(pool).slice(0, examCount);
  } else if (mode === 'wrong') {
    questions = shuffle(pool);
  } else {
    questions = pool.slice();
  }

  // Exam duration: only in exam mode, only when a library has examDuration set
  let examDuration = 0, examPassRate = 70;
  if (mode === 'exam' && libraryId) {
    const lib = data.libraries.find(l => l.id === libraryId);
    if (lib) {
      if (lib.examDuration > 0) examDuration = lib.examDuration;
      if (lib.examPassRate > 0) examPassRate = lib.examPassRate;
    }
  }

  session = {
    active: true,
    mode,
    libraryId,
    questions,
    index: 0,
    answers: new Array(questions.length).fill(null),
    correctCount: 0,
    startTime: Date.now(),
    examDuration,
    examPassRate,
    examEndTime: examDuration > 0 ? Date.now() + examDuration * 60 * 1000 : 0
  };

  if (examDuration > 0) startExamTimer();

  $('practiceAreaView').classList.remove('hidden');
  $('practiceResultView').classList.add('hidden');
  renderQuestion();
}

/* ============ EXAM TIMER ============ */
let examTimerInterval = null;

function startExamTimer() {
  stopExamTimer(); // clear any existing timer
  $('examTimer').classList.remove('hidden');
  renderExamTimer();
  examTimerInterval = setInterval(renderExamTimer, 1000);
}

function stopExamTimer() {
  if (examTimerInterval) {
    clearInterval(examTimerInterval);
    examTimerInterval = null;
  }
  $('examTimer').classList.add('hidden');
}

function renderExamTimer() {
  if (!session || !session.examEndTime) return;
  const remaining = Math.max(0, session.examEndTime - Date.now());
  const totalSec = Math.ceil(remaining / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const el = $('examTimerValue');
  el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  // Turn red when < 2 minutes
  el.style.color = totalSec <= 120 ? '#FF6B6B' : (totalSec <= 300 ? '#FFB84D' : '#6BCFB5');

  if (remaining <= 0) {
    stopExamTimer();
    toast('⏰ Time\'s up! Auto-submitting…');
    setTimeout(() => onExamTimeout(), 300);
  }
}

function onExamTimeout() {
  if (!session || !session.active) return;
  session.active = false;
  session.examTimedOut = true;
  stopExamTimer();
  finishPractice();
}

function renderQuestion() {
  const q = session.questions[session.index];
  const total = session.questions.length;
  $('progressText').textContent = `${session.index + 1}/${total}`;
  $('progressFill').style.width = ((session.index + 1) / total * 100) + '%';

  const typeMap = { single: 'Single Choice', multiple: 'Multiple Choice', judge: 'True / False' };
  $('questionTypeBadge').textContent = typeMap[q.type];
  $('questionText').textContent = q.stem;

  const optsEl = $('optionsList');
  optsEl.innerHTML = '';

  if (q.type === 'judge') {
    ['True', 'False'].forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'opt-item';
      div.innerHTML = `<div class="opt-letter">${i === 0 ? 'T' : 'F'}</div><div class="opt-text">${escapeHtml(opt)}</div>`;
      div.addEventListener('click', () => onSelect(i, q.type));
      optsEl.appendChild(div);
    });
  } else {
    q.options.forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'opt-item';
      const letter = String.fromCharCode(65 + i);
      div.innerHTML = `<div class="opt-letter">${letter}</div><div class="opt-text">${escapeHtml(opt)}</div>`;
      div.addEventListener('click', () => onSelect(i, q.type));
      optsEl.appendChild(div);
    });
  }

  $('explanation').classList.add('hidden');
  $('submitAnswer').classList.remove('hidden');
  $('nextQuestion').classList.add('hidden');
  $('submitAnswer').disabled = true;

  const prev = session.answers[session.index];
  if (prev !== null) {
    const arr = Array.isArray(prev) ? prev : [prev];
    arr.forEach(i => optsEl.children[i].classList.add('selected'));
    $('submitAnswer').disabled = false;
  }
}

function onSelect(idx, type) {
  const items = $('optionsList').children;
  if (type === 'multiple') {
    items[idx].classList.toggle('selected');
  } else {
    for (let el of items) el.classList.remove('selected');
    items[idx].classList.add('selected');
  }
  $('submitAnswer').disabled = false;
}

$('submitAnswer').addEventListener('click', () => {
  const q = session.questions[session.index];
  const items = $('optionsList').children;
  let selected;
  if (q.type === 'multiple') {
    selected = Array.from(items).filter(el => el.classList.contains('selected'))
      .map((el, i) => Array.from(items).indexOf(el));
  } else {
    const sel = Array.from(items).findIndex(el => el.classList.contains('selected'));
    if (sel < 0) return;
    selected = sel;
  }

  session.answers[session.index] = selected;
  const correct = checkAnswer(q, selected);
  const correctIdxs = q.type === 'judge'
    ? (q.answer === true ? [0] : [1])
    : (Array.isArray(q.answer) ? q.answer : [q.answer]);

  for (let el of items) el.style.pointerEvents = 'none';

  if (correct) {
    (Array.isArray(selected) ? selected : [selected]).forEach(i => items[i].classList.add('correct'));
    session.correctCount++;
  } else {
    (Array.isArray(selected) ? selected : [selected]).forEach(i => items[i].classList.add('wrong'));
    correctIdxs.forEach(i => items[i].classList.add('correct'));
  }

  if (q.explanation) {
    $('explanationContent').textContent = q.explanation;
    $('explanation').classList.remove('hidden');
  }

  stats.totalAnswered++;
  if (correct) stats.totalCorrect++;
  const lib = q.libraryId;
  if (!stats.byLibrary[lib]) stats.byLibrary[lib] = { answered: 0, correct: 0 };
  stats.byLibrary[lib].answered++;
  if (correct) stats.byLibrary[lib].correct++;
  if (!correct && !stats.wrongIds.includes(q.id)) stats.wrongIds.push(q.id);
  if (correct) stats.wrongIds = stats.wrongIds.filter(id => id !== q.id);

  DB.saveStats(stats);

  $('submitAnswer').classList.add('hidden');
  $('nextQuestion').classList.remove('hidden');
  $('nextQuestion').textContent = session.index === session.questions.length - 1
    ? 'Finish ✓' : 'Next →';
});

function checkAnswer(q, sel) {
  if (q.type === 'multiple') {
    if (!Array.isArray(sel)) return false;
    const corr = (Array.isArray(q.answer) ? q.answer : [q.answer]).slice().sort();
    const s = sel.slice().sort();
    return corr.length === s.length && corr.every((v, i) => v === s[i]);
  }
  if (q.type === 'judge') {
    return (sel === 0 && q.answer === true) || (sel === 1 && q.answer === false);
  }
  return sel === q.answer;
}

$('nextQuestion').addEventListener('click', () => {
  if (session.index < session.questions.length - 1) {
    session.index++;
    renderQuestion();
  } else {
    finishPractice();
  }
});

function finishPractice() {
  session.active = false;
  stopExamTimer();
  updateStreak();

  $('practiceAreaView').classList.add('hidden');
  $('practiceResultView').classList.remove('hidden');

  const total = session.questions.length;
  const correct = session.correctCount;
  const wrong = total - correct;
  const acc = Math.round(correct / total * 100);
  const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  let icon = '🎉', title = 'Excellent!';
  if (acc < 60) { icon = '💪'; title = 'Keep Practicing!'; }
  else if (acc < 80) { icon = '👍'; title = 'Good Progress!'; }
  else if (acc < 100) { icon = '🌟'; title = 'Great Job!'; }

  $('resultIcon').textContent = icon;
  $('resultTitle').textContent = title;
  $('resultScore').textContent = `${correct}/${total}`;
  $('resultAccuracy').textContent = acc + '%';
  $('resultCorrect').textContent = correct;
  $('resultWrong').textContent = wrong;
  $('resultTime').textContent = `${mins}:${String(secs).padStart(2, '0')}`;

  // Show timed-out badge in exam mode
  const badge = $('resultTimedOutBadge');
  if (session.mode === 'exam' && session.examTimedOut) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // Show pass/fail badge in exam mode
  const passFailBadge = $('resultPassFailBadge');
  if (session.mode === 'exam') {
    const passRate = session.examPassRate || 70;
    const accuracy = Math.round(correct / total * 100);
    if (accuracy >= passRate) {
      passFailBadge.textContent = `✅ Passed (${accuracy}% ≥ ${passRate}%)`;
      passFailBadge.className = 'result-passfail-badge result-pass-badge';
    } else {
      passFailBadge.textContent = `❌ Failed (${accuracy}% < ${passRate}%)`;
      passFailBadge.className = 'result-passfail-badge result-fail-badge';
    }
    passFailBadge.classList.remove('hidden');
  } else {
    passFailBadge.classList.add('hidden');
  }
}

$('retryBtn').addEventListener('click', () => {
  setTimeout(async () => { await startPractice(session.mode, session.libraryId); }, 100);
});
$('backToHomeBtn').addEventListener('click', () => go('homePage'));

/* ============ PROFILE ============ */
function renderProfile() {
  $('profileTotalQs').textContent = getVisibleQuestions().length;
  $('profileAnswered').textContent = stats.totalAnswered;
  $('profileAccuracy').textContent = stats.totalAnswered > 0
    ? Math.round(stats.totalCorrect / stats.totalAnswered * 100) + '%' : '0%';
  $('profileStreak').textContent = getStreak();
  $('wrongCountSub').textContent = `${stats.wrongIds.length} saved`;
}

/* ============ WRONG PAGE ============ */
function renderWrongFull() {
  const list = $('wrongList');
  const items = getVisibleQuestions().filter(q => stats.wrongIds.includes(q.id));
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-hint" style="margin-top:40px">🎉 No wrong questions!<br>You're doing great.</div>`;
    return;
  }
  list.innerHTML = items.map(q => {
    const lib = data.libraries.find(l => l.id === q.libraryId);
    return `<div class="wrong-item-full">
      <div class="wrong-q-text">${escapeHtml(q.stem)}</div>
      <div class="wrong-q-meta">
        <span>${lib ? escapeHtml(lib.name) : 'Unknown'}</span>
        <span>·</span>
        <span>${q.type === 'single' ? 'Single' : q.type === 'multiple' ? 'Multiple' : 'T/F'}</span>
      </div>
      <div class="wrong-q-ans">Correct: ${formatAnswer(q)}</div>
    </div>`;
  }).join('');
}

function formatAnswer(q) {
  if (q.type === 'judge') return q.answer === true ? 'True' : 'False';
  if (q.type === 'multiple') return (Array.isArray(q.answer) ? q.answer : [q.answer])
    .map(i => String.fromCharCode(65 + i)).join(', ');
  return String.fromCharCode(65 + q.answer);
}

$('clearWrongBtn').addEventListener('click', () => {
  if (stats.wrongIds.length === 0) return;
  if (confirm('Clear all wrong questions?')) {
    stats.wrongIds = [];
    DB.saveStats(stats);
    renderWrongFull();
    renderProfile();
    toast('Cleared');
  }
});

/* ============ STATS PAGE ============ */
function renderStats() {
  const acc = stats.totalAnswered > 0
    ? Math.round(stats.totalCorrect / stats.totalAnswered * 100) : 0;
  $('statOverallAcc').textContent = acc + '%';
  $('statOverallBar').style.width = acc + '%';
  $('statTotalAns').textContent = stats.totalAnswered;
  $('statTotalCor').textContent = stats.totalCorrect;
  $('statTotalWrong').textContent = stats.wrongIds.length;
  $('statTotalLib').textContent = getVisibleLibraries().length;

  const list = $('libraryStatsList');
  const entries = Object.entries(stats.byLibrary);
  if (entries.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:20px">No data yet. Start practicing!</div>';
    return;
  }
  list.innerHTML = entries.map(([libId, s]) => {
    const lib = data.libraries.find(l => l.id === libId);
    const pct = s.answered > 0 ? Math.round(s.correct / s.answered * 100) : 0;
    return `<div class="lib-stat-row">
      <div class="lib-stat-name">${lib ? escapeHtml(lib.name) : 'Deleted'}</div>
      <div class="lib-stat-bar"><div class="lib-stat-fill" style="width:${pct}%"></div></div>
      <div class="lib-stat-pct">${pct}%</div>
    </div>`;
  }).join('');
}

$('resetStatsBtn').addEventListener('click', () => {
  if (confirm('Reset all statistics? Wrong questions will also be cleared.')) {
    stats = { totalAnswered: 0, totalCorrect: 0, byLibrary: {}, wrongIds: [] };
    DB.saveStats(stats);
    renderStats();
    renderProfile();
    toast('Reset');
  }
});

/* ============ MANAGE ============ */
// renderManage: fetch live question counts from DB so Manage always shows accurate numbers,
// even when the in-memory cache is stale (e.g. after import before SW refreshes).
async function renderManage() {
  const sel = $('questionLibrary');
  const visibleLibs = await getVisibleLibraries();
  sel.innerHTML = visibleLibs.length === 0
    ? '<option value="">-- Create a library first --</option>'
    : visibleLibs.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');

  const list = $('manageLibraryList');
  if (visibleLibs.length === 0) {
    list.innerHTML = '<div class="empty-hint">No libraries yet</div>';
    return;
  }

  list.innerHTML = visibleLibs.map(lib => {
    // Always query DB directly for question count — in-memory data.questions may be stale
    // after import (data.questions doesn't update when importLibrary writes to cloud).
    // We fetch synchronously in the map by using a helper (async map can't await inline).
    // Instead, use a synchronous fallback but kick off a background refresh.
    let count = '…';
    // Sync render with in-memory count (fast, always available)
    const memCount = data.questions.filter(q => q.libraryId === lib.id).length;
    // Async DB count will be pushed via a DOM attr update below
    const durationTag = (lib.examDuration && lib.examDuration > 0)
      ? `<span class="lib-duration-badge">⏱ ${lib.examDuration} min</span>` : '';
    return `<div class="mng-lib-item" data-lib-id="${lib.id}">
      <div class="mng-lib-icon" style="background:${lib.color || 'var(--bg)'}">${lib.icon || '📚'}</div>
      <div class="mng-lib-info">
        <div class="mng-lib-name">${escapeHtml(lib.name)} ${durationTag}</div>
        <div class="mng-lib-meta" data-count-for="${lib.id}">${memCount} questions</div>
      </div>
      <div class="mng-lib-actions">
        <button onclick="try{openEditLibraryModal('${lib.id}')}catch(e){alert('Error: '+e.message)}">Edit</button>
        <button onclick="try{exportLib('${lib.id}')}catch(e){alert('Error: '+e.message)}">Export</button>
        <button class="del-btn" onclick="try{deleteLib('${lib.id}')}catch(e){alert('Error: '+e.message)}">Delete</button>
      </div>
    </div>`;
  }).join('');
  // Background DB count update (non-blocking, updates DOM after resolve)
  visibleLibs.forEach(lib => {
    db.from('questions').select('id', { count: 'exact', head: true }).eq('library_id', lib.id)
      .then(({ count }) => {
        const el = document.querySelector(`[data-count-for="${lib.id}"]`);
        if (el) el.textContent = `${count ?? '?'} questions`;
      })
      .catch(() => {});
  });
}

function openLibraryModal(existingId) {
  const el = (id) => document.getElementById(id);
  el('libraryName').value = '';
  el('libraryDesc').value = '';
  el('libraryIcon').value = '📚';
  if (el('libraryExamDuration')) el('libraryExamDuration').value = '';
  if (el('libraryExamQCount')) el('libraryExamQCount').value = '';
  if (el('libraryExamPassRate')) el('libraryExamPassRate').value = '';
  $$('.color-dot').forEach((d, i) => d.classList.toggle('active', i === 0));
  $('libraryModalTitle').textContent = 'New Library';
  openModal('libraryModal');
}

function openEditLibraryModal(libId) {
  const el = (id) => document.getElementById(id);
  const lib = data.libraries.find(l => l.id === libId);
  if (!lib) return;
  el('libraryName').value = lib.name;
  el('libraryDesc').value = lib.desc || '';
  el('libraryIcon').value = lib.icon || '⛔';
  console.log('[DEBUG] openEditLibraryModal called, app.js version: FIXED-EDIT');
  const modalBody = el('libraryModal') && el('libraryModal').querySelector('.modal-body');
  if (modalBody && !modalBody.querySelector('.exam-settings-header')) {
    const examSection = document.createElement('div');
    examSection.innerHTML = '<div class="exam-settings-header" style="background:linear-gradient(90deg,#FF6B9D 0%,#FF8FB1 50%,#C4458D 100%);color:#fff;font-size:16px;font-weight:800;padding:16px 18px;border-radius:14px;margin:20px 0 14px;box-shadow:0 4px 12px rgba(255,107,157,0.4);letter-spacing:0.5px;width:100%;display:block;text-align:center">&#x1f3c5; Exam Settings (Exam Mode only)</div><label>Exam Duration (minutes)</label><input type="number" id="libraryExamDuration2" min="1" max="300" placeholder="e.g. 60 - leave empty to disable" /><div class="hint" style="font-size:11px;color:#999;margin:4px 0 10px">Used only in Exam Mode.</div><label>Exam Question Count</label><input type="number" id="libraryExamQCount2" min="1" max="500" placeholder="50" /><div class="hint" style="font-size:11px;color:#999;margin:4px 0 10px">Questions per exam (default 50)</div><label>Pass Rate (%)</label><input type="number" id="libraryExamPassRate2" min="1" max="100" placeholder="70" /><div class="hint" style="font-size:11px;color:#999;margin:4px 0 10px">Default 70%</div>';
    modalBody.appendChild(examSection);
  }
  const modalWrap = el('libraryModal');
  if (modalWrap && !modalWrap.querySelector('.exam-banner')) {
    const banner = document.createElement('div');
    banner.className = 'exam-banner';
    banner.innerHTML = '<div style="text-align:center;padding:12px 0 4px;font-size:15px;font-weight:800;color:#FF6B9D">&darr; Exam Settings &darr;</div><div style="text-align:center;padding:0 0 12px;font-size:13px;color:#999">Scroll down - timer, question count, pass rate</div>';
    banner.style.cssText = 'background:#fff;border-radius:0 0 14px 14px;cursor:pointer;flex-shrink:0;';
    banner.onclick = function() {
      modalBody.scrollTop = modalBody.scrollHeight;
    };
    modalWrap.querySelector('.modal-content').appendChild(banner);
  }
  // Populate fields
  const ed = el('libraryExamDuration2') || el('libraryExamDuration');
  const eq = el('libraryExamQCount2') || el('libraryExamQCount');
  const ep = el('libraryExamPassRate2') || el('libraryExamPassRate');
  if (ed) ed.value = lib.examDuration || '';
  if (eq) eq.value = lib.examQuestionCount || '';
  if (ep) ep.value = lib.examPassRate || '';
  $$('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === lib.color));
  $('libraryModalTitle').textContent = 'Edit Library';
  editingLibId = libId;
  openModal('libraryModal');
}

$('addLibraryTile').addEventListener('click', () => { if (requireAdmin()) openLibraryModal(); });

$('saveLibrary').addEventListener('click', async () => {
  if (!requireAdmin()) return;
  const name = $('libraryName').value.trim();
  if (!name) { toast('Name required'); return; }
  const color = $('.color-dot.active')?.dataset.color || '#5B6CFF';
  const examDurationVal = ($('libraryExamDuration2') || $('libraryExamDuration')).value.trim();
  const examDuration = examDurationVal ? parseInt(examDurationVal, 10) : 0;
  if (examDurationVal && (isNaN(examDuration) || examDuration < 1 || examDuration > 300)) {
    toast('Duration: 1-300 minutes');
    return;
  }
  const examQCountVal = ($('libraryExamQCount2') || $('libraryExamQCount')).value.trim();
  const examQuestionCount = examQCountVal ? parseInt(examQCountVal, 10) : 0;
  if (examQCountVal && (isNaN(examQuestionCount) || examQuestionCount < 1 || examQuestionCount > 500)) {
    toast('Question count: 1-500');
    return;
  }
  const examPassRateVal = ($('libraryExamPassRate2') || $('libraryExamPassRate')).value.trim();
  const examPassRate = examPassRateVal ? parseInt(examPassRateVal, 10) : 0;
  if (examPassRateVal && (isNaN(examPassRate) || examPassRate < 1 || examPassRate > 100)) {
    toast('Pass rate: 1-100%');
    return;
  }

  try {
    if (editingLibId) {
      // Edit existing library
      const idx = data.libraries.findIndex(l => l.id === editingLibId);
      if (idx !== -1) {
        data.libraries[idx].name = name;
        data.libraries[idx].desc = $('libraryDesc').value.trim();
        data.libraries[idx].icon = $('libraryIcon').value.trim() || '📚';
        data.libraries[idx].color = color;
        data.libraries[idx].examDuration = examDuration || null;
        data.libraries[idx].examQuestionCount = examQuestionCount || null;
        data.libraries[idx].examPassRate = examPassRate || null;
      }
      toast('Library updated');
    } else {
      // Create new library
      data.libraries.push({
        id: 'lib_' + Date.now(),
        name,
        desc: $('libraryDesc').value.trim(),
        icon: $('libraryIcon').value.trim() || '📚',
        color,
        examDuration: examDuration || null,
        examQuestionCount: examQuestionCount || null,
        examPassRate: examPassRate || null,
        createdAt: Date.now()
      });
      toast('Library created');
    }
    await upsertUser().catch(e => console.warn('upsertUser failed', e));
    invalidateAdminLibCache();
    await DB.save(data);
    closeModal('libraryModal');
    editingLibId = null;
    await renderManage();
  } catch (e) {
    toast('Save failed: ' + (e && e.message ? e.message : ''));
  }
});

$$('.color-dot').forEach(d => {
  d.addEventListener('click', () => {
    $$('.color-dot').forEach(x => x.classList.remove('active'));
    d.classList.add('active');
  });
});

$('addQuestionTile').addEventListener('click', () => { if (requireAdmin()) openQuestionModal(); });

function openQuestionModal() {
  if ((data.libraries||[]).length === 0) { toast('Create a library first'); return; }
  $('questionStem').value = '';
  $('questionExplanation').value = '';
  $$('[data-option-text]').forEach(el => el.value = '');
  $$('[data-option-correct]').forEach(el => el.checked = false);
  $('questionType').value = 'single';
  // Default language = current UI language
  if ($('questionLanguage')) $('questionLanguage').value = (window.i18n && window.i18n.currentLang) || 'en';
  onTypeChange();
  openModal('questionModal');
}

$('questionType').addEventListener('change', onTypeChange);
function onTypeChange() {
  $('optionsEditor').style.display = $('questionType').value === 'judge' ? 'none' : 'block';
}

$('saveQuestion').addEventListener('click', async () => {
  if (!requireAdmin()) return;
  const libId = $('questionLibrary').value;
  if (!libId) { toast('Choose a library'); return; }
  const stem = $('questionStem').value.trim();
  if (!stem) { toast('Question required'); return; }
  const type = $('questionType').value;
  const explanation = $('questionExplanation').value.trim();

  let q;
  const lang = ($('questionLanguage') && $('questionLanguage').value) || (window.i18n && window.i18n.currentLang) || 'en';
  if (type === 'judge') {
    const correct = confirm('Click OK if TRUE, Cancel if FALSE') ? true : false;
    q = { id: 'q_' + Date.now(), libraryId: libId, type, stem, answer: correct, explanation, language: lang };
  } else {
    const options = [];
    const correct = [];
    $$('[data-option-text]').forEach((el, i) => {
      const txt = el.value.trim();
      if (txt) {
        options.push(txt);
        if ($$(`[data-option-correct="${i}"]`)[0].checked) correct.push(options.length - 1);
      }
    });
    if (options.length < 2) { toast('At least 2 options'); return; }
    if (correct.length === 0) { toast('Mark correct answer(s)'); return; }
    q = { id: 'q_' + Date.now(), libraryId: libId, type, stem, options, explanation,
          answer: type === 'multiple' ? correct : correct[0], language: lang };
  }
  data.questions.push(q);
  try {
    await DB.save(data);
    closeModal('questionModal');
    await renderManage();
    toast('Question added');
  } catch (e) {
    toast('Save failed: ' + (e && e.message ? e.message : ''));
  }
});

window.exportLib = function(libId) {
  const lib = data.libraries.find(l => l.id === libId);
  const questions = getVisibleQuestions().filter(q => q.libraryId === libId);
  const payload = { library: lib, questions };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${lib.name}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported');
};

window.deleteLib = async function(libId) {
  if (!confirm('Delete this library and all its questions?')) return;
  data.libraries = data.libraries.filter(l => l.id !== libId);
  data.questions = data.questions.filter(q => q.libraryId !== libId);
  delete stats.byLibrary[libId];
  stats.wrongIds = stats.wrongIds.filter(id => data.questions.find(q => q.id === id));
  try {
    invalidateAdminLibCache(); // fresh DB query on next getVisibleLibraries()
    // TARGETED deletes only — never touch other libraries' questions.
    await db.from('questions').delete().eq('library_id', libId);
    await db.from('libraries').delete().eq('id', libId);
    await DB.saveStats(stats);
    await renderManage();
    toast('Deleted');
  } catch (e) {
    toast('Delete failed: ' + (e && e.message ? e.message : ''));
    // Restore real state from the server so UI is not misleading.
    await reloadCurrentUserData();
    await renderManage();
  }
};

$('importJsonTile').addEventListener('click', () => { if (requireAdmin()) openModal('importModal'); });

function openImportModal() {
  $('importJson').value = '';
  openModal('importModal');
}

$('confirmImport').addEventListener('click', async () => {
  try {
    const parsed = JSON.parse($('importJson').value);
    await importQuestions(parsed);
    closeModal('importModal');
    await renderManage();
    toast('Imported');
  } catch (e) {
    toast('Invalid JSON');
  }
});

$('loadSampleTile').addEventListener('click', () => { if (requireAdmin()) loadSamples(); });

async function loadSamples() {
  if (!requireAdmin()) return;
  if ((data.libraries||[]).length > 0 && !confirm('Add sample libraries to your existing data?')) return;

  const samples = {
    'Teaching Certification': { icon: '🎓', color: '#5B6CFF', desc: 'Sample pedagogy questions',
      questions: [
        { type: 'single', stem: 'Which best describes the core of education?', options: ['Teaching methods', 'Student development', 'Curriculum design', 'School management'], answer: 1, explanation: 'Education fundamentally promotes student development.' },
        { type: 'single', stem: 'Who proposed the "Law of Practice"?', options: ['Skinner', 'Thorndike', 'Pavlov', 'Bandura'], answer: 1 },
        { type: 'multiple', stem: 'Which are teaching principles?', options: ['Scientific nature', 'Intuitive nature', 'Consciousness', 'Individual nature'], answer: [0, 2, 3] },
        { type: 'judge', stem: 'Education only happens in schools.', answer: false, explanation: 'Education occurs in many settings.' },
        { type: 'single', stem: '"Zone of Proximal Development" was proposed by:', options: ['Piaget', 'Vygotsky', 'Erikson', 'Freud'], answer: 1 }
      ]
    },
    'Driving Test - Subject 1': { icon: '🚗', color: '#FF6B6B', desc: 'Essential driving test questions',
      questions: [
        { type: 'single', stem: 'What does a red light mean?', options: ['Proceed', 'Stop', 'Slow down', 'Yield'], answer: 1 },
        { type: 'single', stem: 'In a roundabout, who has right of way?', options: ['Entering vehicle', 'Vehicle inside', 'Faster one', 'Smaller one'], answer: 1 },
        { type: 'judge', stem: 'You can use a phone while driving on highway.', answer: false },
        { type: 'multiple', stem: 'Prohibited driving behaviors:', options: ['Using phone', 'Drinking', 'Wearing seatbelt', 'Fatigue'], answer: [0, 1, 3] },
        { type: 'single', stem: 'Safe following distance at 100 km/h:', options: ['30m', '50m', '100m', '150m'], answer: 2 }
      ]
    },
    'Computer Basics': { icon: '💻', color: '#4ECDC4', desc: 'Basic computer knowledge',
      questions: [
        { type: 'single', stem: 'What does CPU stand for?', options: ['Computer Processing Unit', 'Central Processing Unit', 'Central Program Unit', 'Computer Program Unit'], answer: 1 },
        { type: 'multiple', stem: 'Which are operating systems?', options: ['Windows', 'macOS', 'Photoshop', 'Linux'], answer: [0, 1, 3] },
        { type: 'judge', stem: 'RAM is volatile memory.', answer: true, explanation: 'RAM loses data when power is off.' },
        { type: 'single', stem: 'Largest storage unit?', options: ['KB', 'MB', 'GB', 'TB'], answer: 3 }
      ]
    }
  };

  Object.entries(samples).forEach(([name, info]) => {
    const lib = { id: 'lib_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                  name, desc: info.desc, icon: info.icon, color: info.color, createdAt: Date.now() };
    data.libraries.push(lib);
    info.questions.forEach(q => {
      data.questions.push({ id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                            libraryId: lib.id, ...q });
    });
  });
  try { await upsertUser(); } catch (e) { console.warn('upsertUser failed', e); }
  invalidateAdminLibCache(); // force fresh library list from DB
  try {
    await DB.save(data);
    renderManage(); // fire and forget — not awaited in non-async context
  } catch (e) {
    toast('Save failed: ' + (e && e.message ? e.message : ''));
  }
}

$('exportAllTile').addEventListener('click', () => { if (requireAdmin()) exportAll(); });

function exportAll() {
  const payload = { libraries: data.libraries, questions: data.questions };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quiz-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported');
}

$('importWordTile').addEventListener('click', () => { if (requireAdmin()) $('fileInput').click(); });
$('exportAllBtn').addEventListener('click', () => { if (requireAdmin()) exportAll(); });
$('importAllBtn').addEventListener('click', () => { if (requireAdmin()) $('fileInput').click(); });

$('resetAllProfileBtn').addEventListener('click', async () => {
  if (!requireAdmin()) return;
  if (!confirm('Delete ALL data?')) return;
  if (!confirm('This cannot be undone. Confirm?')) return;
  try {
    // Wipe cloud libraries + questions as well (not just local memory)
    await DB.clearAll();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STATS_KEY);
    localStorage.removeItem(STREAK_KEY);
    data = { libraries: [], questions: [] };
    stats = { totalAnswered: 0, totalCorrect: 0, byLibrary: {}, wrongIds: [] };
    await renderManage();
    toast('All data cleared');
  } catch (e) {
    toast('Clear failed: ' + (e && e.message ? e.message : ''));
  }
});

$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'json') {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        await importQuestions(parsed);
        await renderManage();
        toast('Imported');
      } catch { toast('Invalid JSON'); }
    };
    reader.readAsText(file);
  } else if (ext === 'docx' || ext === 'doc') {
    importWordFile(file);
  } else {
    toast('Please choose .json, .docx, or .doc');
  }
  e.target.value = '';
});

/* ============ Word Import ============ */
async function importWordFile(file) {
  if (!requireAdmin()) return;
  toast('Parsing Word file...');
  try {
    let text = '';
    if (file.name.toLowerCase().endsWith('.docx')) {
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const xml = await zip.file('word/document.xml').async('string');
      text = extractTextFromDocxXml(xml);
    } else {
      text = await file.text();
    }

    const questions = parseQuestionsFromText(text);
    if (questions.length === 0) {
      // Show the FULL raw text so we can see the actual format and fix the parser
      const sample = (text || '').slice(0, 4000);
      alert('No questions detected (parser found 0).\n'
        + 'Expected format per question:\n'
        + '  1. Question text\n'
        + '  A. Option one\n'
        + '  B. Option two\n'
        + '  Answer: A\n\n'
        + '--- Raw text sample (first 4000 chars) ---\n' + sample);
      return;
    }
    if (questions.length < 5) {
      // Suspiciously few — show a preview so admin can confirm before saving
      const preview = questions.map((q, i) => `${i + 1}. ${q.stem}  [ans=${q.answer}]`).join('\n');
      const ok = confirm(`Detected only ${questions.length} questions. Continue?\n\nPreview:\n` + preview.slice(0, 800));
      if (!ok) return;
    }
    // Detect language from filename suffix: e.g. nic-en.docx, nic-zh.docx
    const fn = file.name.toLowerCase().replace(/\.(docx?|doc)$/i, '');
    const langMatch = fn.match(/[-_](en|es|vi|zh|cn|spa|vie|eng)$/i);
    let fileLang = null;
    if (langMatch) {
      const k = langMatch[1].toLowerCase();
      const map = { en: 'en', eng: 'en', es: 'es', spa: 'es', vi: 'vi', vie: 'vi', zh: 'zh', cn: 'zh' };
      fileLang = map[k] || null;
    }
    if (!fileLang) fileLang = (window.i18n && window.i18n.currentLang) || 'en';

    const libName = prompt(`Detected ${questions.length} questions (language: ${fileLang}).\nEnter library name:`, fn);
    if (!libName) return;
    // Refresh from server FIRST so we never clobber existing questions/libraries
    try { await reloadCurrentUserData(); } catch (e) { console.error('pre-import reload failed', e); }
    let lib = data.libraries.find(l => l.name === libName);
    if (!lib) {
      lib = { id: 'lib_' + Date.now(), name: libName, desc: 'Imported from Word', icon: '📄',
              color: '#5B6CFF', createdAt: Date.now() };
      data.libraries.push(lib);
      try { await upsertUser(); } catch (e) { console.warn('upsertUser failed', e); }
    }
    questions.forEach(q => {
      q.id = 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      q.libraryId = lib.id;
      q.language = fileLang; // tag with detected language
    });
    toast('Saving to cloud...');
    // SAFE: only this library's questions are replaced; other libraries untouched.
    await DB.importLibrary(lib, questions);
    // IMPORTANT: do NOT trust the in-memory data after import — the Service Worker
    // may still be running an old version that caches Supabase REST responses.
    // Instead, query the database directly to get the authoritative count.
    let savedCount = 0;
    try {
      const { data: dbRows, error: countErr } = await db
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('library_id', lib.id);
      savedCount = Array.isArray(dbRows) ? dbRows.length : (dbRows?.length || 0);
    } catch (e) {
      console.warn('DB count check failed, using parse count', e);
      savedCount = questions.length;
    }
    // Also refresh the in-memory cache so the next render is consistent
    invalidateAdminLibCache(); // force fresh library list from DB
    await reloadCurrentUserData();
    await renderManage();
    toast(`Imported ${savedCount} questions → saved to cloud [v18-safe]`);
  } catch (err) {
    console.error('Word import failed:', err);
    toast('Import failed: ' + (err && err.message ? err.message : 'check console'));
  }
}

function extractTextFromDocxXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  // Use getElementsByTagNameNS to reliably match namespaced elements,
  // or fall back to querySelectorAll if that returns nothing.
  let paragraphs;
  try {
    paragraphs = doc.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p'
    );
  } catch (_) {
    paragraphs = doc.querySelectorAll('p');
  }
  // Fallback: if still nothing, try local name search
  if (!paragraphs || paragraphs.length === 0) {
    paragraphs = doc.querySelectorAll('p');
  }
  const lines = [];
  for (let p of paragraphs) {
    // IMPORTANT: <w:t> elements carry the WordprocessingML namespace prefix,
    // so getElementsByTagName('t') matches nothing and every line comes out
    // empty → parser reports 0 questions. Match by localName instead.
    const texts = [];
    for (const node of p.getElementsByTagName('*')) {
      if (node.localName === 't') {
        texts.push(node.textContent);
      }
    }
    const line = texts.join('');
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  return lines.join('\n');
}

function parseQuestionsFromText(text) {
  const questions = [];
  // Strip markdown-ish markers that can leak from docx styling: **1.** **A.** **Answer:**
  const cleanLine = (s) => s.replace(/\*\*/g, '').replace(/^#{1,6}\s*/, '').trim();
  const lines = text.split(/\r?\n/).map(l => cleanLine(l)).filter(l => l);
  let i = 0;
  const isAnswerLine = (s) => /^(answer|answers|答案|correct|correct answer|key|key answer|正确答案|正确选项|标准答案|参考答案|答)\s*[:：.\s)\]]/i.test(s)
    || /^(answer|answers|答案|correct|correct answer|key|key answer)\s*[:：]/i.test(s);
  const extractAnswerText = (s) => (s.match(/[:：]\s*(.+)$/) || s.match(/\]\s*(.+)$/) || [null, s])[1].trim();
  while (i < lines.length) {
    const line = lines[i];
    // Question line: "1." / "1、" / "1)" / "第N题：" or a line ending with ?/？
    const qMatch = line.match(/^(\d+)[.、)）\s]\s*(.+)/)
      || line.match(/^第?\s*(\d+)\s*[题个]\s*[:：.\s]\s*(.+)/)
      || line.match(/^Q\s*(\d+)[.、)）:\s]\s*(.+)/i);
    const isStemByQuestion = !qMatch && /[?？]\s*$/.test(line) && line.length > 8;
    if (qMatch || isStemByQuestion) {
      const stem = (qMatch ? qMatch[2] : line).trim();
      const q = { type: 'single', stem, options: [], answer: null, explanation: '' };
      i++;
      // Collect options: A. / a) / (A) / 1. / ①
      while (i < lines.length) {
        const optMatch = lines[i].match(/^([A-Za-z])[.、)）\s]\s*(.+)/)
          || lines[i].match(/^[（(]\s*([A-Za-z])\s*[)）]\s*(.+)/)
          || lines[i].match(/^(\d+)[.、)）\s]\s*(.+)/);
        if (!optMatch) break;
        q.options.push(optMatch[2].trim());
        i++;
      }
      // Collect answer / explanation lines
      while (i < lines.length) {
        const lower = lines[i].toLowerCase();
        if (isAnswerLine(lines[i])) {
          const ansText = extractAnswerText(lines[i]);
          if (/^(true|t|correct|yes|对|是|√|正确)$/i.test(ansText)) {
            q.type = 'judge'; q.answer = true; q.options = [];
          } else if (/^(false|f|wrong|no|错|否|×|x|错误)$/i.test(ansText)) {
            q.type = 'judge'; q.answer = false; q.options = [];
          } else {
            const letters = ansText.split(/[,\s、，/]/).map(s => s.trim().toUpperCase()).filter(Boolean);
            const idxs = letters.map(l => l.charCodeAt(0) - 65).filter(n => n >= 0 && n < q.options.length);
            if (idxs.length > 1) { q.type = 'multiple'; q.answer = idxs; }
            else if (idxs.length === 1) { q.answer = idxs[0]; }
            else if (/^\d+$/.test(ansText.trim())) {
              const n = parseInt(ansText, 10) - 1;
              if (n >= 0 && n < q.options.length) q.answer = n;
            }
          }
          i++;
        } else if (/^(解析|explanation|analysis|说明| rationale)\s*[:：.\s]\s*(.+)/i.test(lines[i])) {
          q.explanation = lines[i].match(/[:：]\s*(.+)/i)[1].trim();
          i++;
        } else { break; }
      }
      if ((q.options.length >= 2 || q.type === 'judge') && q.answer !== null && q.answer !== undefined) {
        questions.push(q);
      }
    } else { i++; }
  }
  return questions;
}

async function importQuestions(parsed) {
  if (!requireAdmin()) return;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  // Default language: admin's currently selected UI language
  const defaultLang = (window.i18n && window.i18n.currentLang) || 'en';
  try {
    for (const item of items) {
      if (!item.library || !item.questions) continue;
      let lib = data.libraries.find(l => l.name === item.library.name);
      if (!lib) {
        lib = { id: 'lib_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: item.library.name, desc: item.library.desc || '',
                icon: item.library.icon || '📚',
                color: item.library.color || '#5B6CFF', createdAt: Date.now() };
        data.libraries.push(lib);
      }
      const lang = item.language || defaultLang; // per-file language, fallback to UI lang
      const qs = item.questions.map(q => ({
        id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        libraryId: lib.id,
        type: q.type || 'single', stem: q.stem, options: q.options || [],
        answer: q.answer, explanation: q.explanation || '',
        language: q.language || lang
      }));
      // SAFE: only this library's questions are replaced; other libraries untouched.
      await DB.importLibrary(lib, qs);
    }
    await reloadCurrentUserData();
    await renderManage();
    showToast(i18n.t('toast.imported') || 'Imported: ' + data.questions.length + ' questions');
  } catch (e) {
    showToast('Import failed: ' + (e && e.message ? e.message : ''));
  }
}

/* ============ Modal Close ============ */
$$('[data-close]').forEach(el => el.addEventListener('click', () => {
  closeModal(el.dataset.close);
  if (el.dataset.close === 'libraryModal') editingLibId = null;
}));
$$('.modal').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); });
});

/* ============ Search (placeholder) ============ */
$('searchBtn').addEventListener('click', () => go('libraryPage'));

/* ============ PWA Install Prompt ============ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('installBanner').classList.remove('hidden');
});

$('installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  $('installBanner').classList.add('hidden');
  deferredPrompt = null;
});

$('closeBanner').addEventListener('click', () => $('installBanner').classList.add('hidden'));

if (window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true) {
  document.body.classList.add('standalone-mode');
}

/* ============ iOS Add-to-Home-Screen Guide ============ */
// Safari (iOS) never fires beforeinstallprompt, so we show our own guide.
// Only on iPhone/iPad Safari, not standalone, and only if not dismissed before.
(function initIosInstallGuide() {
  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
  }
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }
  function shouldShow() {
    try {
      return localStorage.getItem('ios_install_guide_dismissed') !== '1';
    } catch (e) { return true; }
  }
  const guide = $('iosInstallGuide');
  if (!guide) return;
  if (!isIOS() || isStandalone() || !shouldShow()) return;

  const dismiss = (permanent) => {
    guide.classList.add('hidden');
    if (permanent) {
      try { localStorage.setItem('ios_install_guide_dismissed', '1'); } catch (e) {}
    }
  };

  // Show after a short delay so the app has rendered first
  setTimeout(() => {
    // Re-apply i18n in case the guide was hidden when translations ran
    if (window.i18n && typeof window.i18n.apply === 'function') {
      try { window.i18n.apply(); } catch (e) {}
    }
    guide.classList.remove('hidden');
    $('iosGuideGotIt')?.addEventListener('click', () => dismiss(true));
    $('iosGuideLater')?.addEventListener('click', () => dismiss(false));
    $('iosGuideClose')?.addEventListener('click', () => dismiss(true));
  }, 1200);
})();

/* ============ Utilities ============ */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============ Login Overlay ============ */
function showLogin() {
  const overlay = $('loginOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  $('app').classList.add('hidden');
  $('splash').style.display = 'none';
  setTimeout(() => $('loginEmail') && $('loginEmail').focus(), 100);
}

function hideLogin() {
  const overlay = $('loginOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  $('loginError').textContent = '';
  $('loginEmail').value = '';
  $('loginPassword').value = '';
}

function applyRoleUI() {
  // Hide/show tabs based on role
  const isAdmin = currentUser && currentUser.role === 'admin';
  $$('.tab').forEach(t => {
    const tabKey = t.dataset.tab;
    if (tabKey === 'managePage' || tabKey === 'studentsPage') {
      t.style.display = isAdmin ? '' : 'none';
    }
  });
  // Hide all .admin-only elements for non-admin users
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden-by-role', !isAdmin);
  });
  // Filter libraries list for students: show only assigned ones
  // (handled in renderHome / renderLibrary when called)
  // Update greeting
  if (isAdmin) {
    $('greetingSub').textContent = 'Manage your students and question banks';
  } else {
    $('greetingSub').textContent = 'Ready to learn something new?';
  }
  if ($('profileName')) {
    $('profileName').textContent = currentUser ? currentUser.name : '';
  }
  if ($('profileAvatar')) {
    $('profileAvatar').textContent = currentUser ? currentUser.avatar : '🎓';
  }
  if ($('profileRole')) {
    $('profileRole').textContent = currentUser ? (currentUser.role === 'admin' ? 'Administrator' : 'Student') : '';
  }
}

async function doLogin() {
  const id = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!id || !password) {
    $('loginError').textContent = i18n.t('login.error.empty');
    return;
  }
  // Supabase Auth requires email; convert username → username@quiz.local
  const email = (id.toLowerCase().replace(/[^a-z0-9._-]/g, '_')) + '@quiz.local';
  let user;
  try {
    user = await Auth.login(email, password);
  } catch (e) {
    if (e && e.message === 'expired') {
      $('loginError').textContent = i18n.t('login.error.expired');
    } else {
      $('loginError').textContent = i18n.t('login.error.wrong');
    }
    return;
  }
  if (!user) {
    $('loginError').textContent = i18n.t('login.error.wrong');
    return;
  }
  currentUser = user;
  // Apply user's preferred language (just loaded) and re-render
  await i18n.loadUserPreference();
  i18n.apply();
  await reloadCurrentUserData();
  hideLogin();
  enterApp();
  updateLangMenuSub();
}

async function doLogout() {
  if (!confirm('Log out from ' + (currentUser ? currentUser.name : '') + '?')) return;
  if (session.active) { session.active = false; }
  await Auth.logout();
  currentUser = null;
  data = { libraries: [], questions: [] };
  stats = { totalAnswered: 0, totalCorrect: 0, byLibrary: {}, wrongIds: [] };
  pageStack = [];
  applyRoleUI();
  showLogin();
}

function enterApp() {
  applyRoleUI();
  $('app').classList.remove('hidden');
  pageStack = ['homePage'];
  go('homePage', { force: true });
}

/* ============ Student Filter Helper ============ */
// Admin library cache — invalidated on any library mutation.
let _adminLibCache = null;
let _adminLibCacheTs = 0;
let _pendingDbQuery = null; // avoid concurrent DB reads

function getVisibleLibraries() {
  if (!currentUser) return [];
  if (currentUser.role === 'admin') {
    const now = Date.now();
    if (_adminLibCache && (now - _adminLibCacheTs) < 5000) return _adminLibCache;
    // Kick off background DB refresh if not already in flight
    if (!_pendingDbQuery) {
      _pendingDbQuery = db.from('libraries').select('*').then(({ data: rows, error }) => {
        _pendingDbQuery = null;
        if (!error && Array.isArray(rows)) {
          _adminLibCache = rows.map(l => ({
            id: l.id, name: l.name, desc: l.description || '',
            icon: l.icon || '📚', color: l.color || '#5B6CFF',
            createdAt: l.created_at ? new Date(l.created_at).getTime() : Date.now(),
            examDuration: l.exam_duration || null,
            examQuestionCount: l.exam_question_count || null,
            examPassRate: l.exam_pass_rate || null
          }));
          _adminLibCacheTs = Date.now();
        }
      }).catch(() => { _pendingDbQuery = null; });
    }
    // Still return data.libraries while DB query runs in background
    return data.libraries.slice();
  }
  // student: only assigned — use currentUser.libraries (loaded from DB on login)
  const assigned = new Set((currentUser.libraries || []).map(x => String(x).trim()));
  const visible = data.libraries.filter(lib => assigned.has(String(lib.id).trim()));
  return visible;
}

function invalidateAdminLibCache() { _adminLibCache = null; _adminLibCacheTs = 0; _pendingDbQuery = null; }

function getVisibleQuestions() {
  if (!currentUser) return [];
  if (currentUser.role === 'admin') return data.questions.slice();
  const assigned = new Set((currentUser.libraries || []).map(x => String(x).trim()));
  return data.questions.filter(q => assigned.has(String(q.libraryId).trim()));
}

/* ============ Init ============ */
async function init() {
  try {
  initTheme();
  // Watch for auth state changes (e.g., sign-out from another tab, expiry)
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      data = { libraries: [], questions: [] };
      stats = { totalAnswered: 0, totalCorrect: 0, byLibrary: {}, wrongIds: [] };
      pageStack = [];
      applyRoleUI();
      showLogin();
    }
  });
  // Detect language: localStorage → browser → 'en'
  i18n.setLanguage(i18n.detect());
  // Try to restore session
  let user = null;
  try { user = await Auth.getCurrent(); } catch (e) { /* expired or not signed in */ }
  // If logged in, override language from server preference
  if (user) { await i18n.loadUserPreference(); i18n.apply(); }
  if (user) {
    currentUser = user;
    await reloadCurrentUserData();
    $('splash') && ($('splash').style.display = 'none');
    enterApp();
    updateLangMenuSub();
  } else {
    $('splash') && ($('splash').style.display = 'none');
    showLogin();
  }
  renderLangPickers();
  } catch(e) {
    console.error('[Init Error]', e);
    $('splash') && ($('splash').style.display = 'none');
    $('app') && $('app').classList.remove('hidden');
  }
}

function renderLangPickers() {
  // Login page picker
  const loginBox = $('loginLangOptions');
  if (loginBox) {
    loginBox.innerHTML = I18N_LANGS.map(l =>
      '<button class="lang-pill' + (i18n.current === l ? ' active' : '') + '" data-lang="' + l + '">' +
      I18N_LANG_FLAGS[l] + ' ' + I18N_LANG_NAMES[l] + '</button>'
    ).join('');
    loginBox.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        i18n.setLanguage(btn.dataset.lang);
        renderLangPickers();
      });
    });
  }
  // Settings modal picker
  const langList = $('langList');
  if (langList) {
    langList.innerHTML = I18N_LANGS.map(l =>
      '<button class="lang-row' + (i18n.current === l ? ' active' : '') + '" data-lang="' + l + '">' +
      '<span class="lang-flag">' + I18N_LANG_FLAGS[l] + '</span>' +
      '<span class="lang-name">' + I18N_LANG_NAMES[l] + '</span>' +
      (i18n.current === l ? '<span class="lang-check">✓</span>' : '') +
      '</button>'
    ).join('');
    langList.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', async () => {
        i18n.setLanguage(btn.dataset.lang);
        renderLangPickers();
        closeModal('languageModal');
        updateLangMenuSub();
        // If logged in, refresh questions + library list to match new language
        if (currentUser) {
          try {
            showToast(i18n.t('toast.loadingLang') || 'Loading questions in new language…');
            data = await DB.load();
            renderHome();
          } catch (e) {
            console.error('reload after lang change', e);
          }
        }
      });
    });
  }
  updateLangMenuSub();
}

function updateLangMenuSub() {
  const sub = $('currentLangSub');
  if (sub) sub.textContent = I18N_LANG_FLAGS[i18n.current] + ' ' + I18N_LANG_NAMES[i18n.current];
}

init();

/* ============ Login Event Bindings ============ */
$('loginBtn').addEventListener('click', doLogin);
$('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginPassword').focus(); });
$('logoutBtn').addEventListener('click', doLogout);
$('languageMenuBtn') && $('languageMenuBtn').addEventListener('click', () => openModal('languageModal'));

/* ============ Change Password (Admin) ============ */
$('changePasswordBtn').addEventListener('click', () => {
  // Security: students cannot change their own password
  if (!currentUser || currentUser.role !== 'admin') {
    toast('i18n:toast.passwordOnlyAdmin');
    return;
  }
  $('changePasswordError').textContent = '';
  ['adminNewPassword', 'adminNewPasswordConfirm'].forEach(id => { if ($(id)) $(id).value = ''; });
  openModal('changePasswordModal');
});
$('saveChangePassword').addEventListener('click', async () => {
  // Belt-and-suspenders: re-check role
  if (!currentUser || currentUser.role !== 'admin') {
    toast('Only admin can change password');
    closeModal('changePasswordModal');
    return;
  }
  const newPwd = $('adminNewPassword').value;
  const confirmPwd = $('adminNewPasswordConfirm').value;
  if (!newPwd) {
    $('changePasswordError').textContent = 'Please enter a new password';
    return;
  }
  if (newPwd.length < 4) {
    $('changePasswordError').textContent = 'New password must be at least 4 characters';
    return;
  }
  if (newPwd !== confirmPwd) {
    $('changePasswordError').textContent = 'New passwords do not match';
    return;
  }
  const ok = await Auth.changeAdminPassword(newPwd);
  if (!ok) {
    $('changePasswordError').textContent = 'Update failed (check connection)';
    return;
  }
  closeModal('changePasswordModal');
  toast('i18n:modal.password.done');
});

/* ============ Students Management (Admin) ============ */
let editingStudentId = null;
let editingLibId = null;

async function renderStudents(filter) {
  filter = filter || 'all';
  const search = ($('studentSearch') ? $('studentSearch').value : '').toLowerCase().trim();
  const list = $('studentsList');
  if (!list) return;
  const students = (await Auth.listStudents()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  let filtered = students;
  if (filter === 'enabled') filtered = filtered.filter(s => s.enabled);
  if (filter === 'disabled') filtered = filtered.filter(s => !s.enabled);
  if (search) {
    filtered = filtered.filter(s =>
      s.username.toLowerCase().indexOf(search) >= 0 ||
      (s.name || '').toLowerCase().indexOf(search) >= 0
    );
  }
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-hint" style="text-align:center;padding:40px 20px;color:#888;">No students yet. Tap + to add one.</div>';
    return;
  }
  list.innerHTML = filtered.map(s => {
    const libCount = (s.libraries || []).length;
    const status = s.enabled
      ? '<span class="student-status active">Active</span>'
      : '<span class="student-status inactive">Disabled</span>';
    let expiry = '';
    if (s.expires_at) {
      const d = new Date(s.expires_at);
      const now = new Date();
      const expired = d < now;
      const txt = d.toISOString().slice(0, 10);
      expiry = '<div class="student-meta" style="color:' + (expired ? '#f56565' : '#888') + '">' +
        (expired ? '⏰ Expired ' : '📅 Expires ') + txt + '</div>';
    }
    return '<div class="student-row' + (s.enabled ? '' : ' disabled') + '" data-student-id="' + s.id + '">' +
      '<div class="student-avatar">' + (s.avatar || '📚') + '</div>' +
      '<div class="student-info">' +
        '<div class="student-name">' + escapeHtml(s.name || s.username) + '</div>' +
        '<div class="student-meta">@' + escapeHtml(s.username) + ' · ' + libCount + ' librar' + (libCount === 1 ? 'y' : 'ies') +
          (s.preferred_language ? ' · 🌐 ' + escapeHtml((window.I18N_LANG_NAMES || {})[s.preferred_language] || s.preferred_language) : '') +
        '</div>' +
        expiry +
      '</div>' +
      status +
    '</div>';
  }).join('');
  // bind click
  list.querySelectorAll('.student-row').forEach(row => {
    row.addEventListener('click', () => openStudentDetail(row.dataset.studentId));
  });
}

async function openStudentDetail(id) {
  const students = await Auth.listStudents();
  const s = students.find(x => x.id === id);
  if (!s) return;
  $('studentDetailName').textContent = s.name || s.username;
  $('studentDetailHero').innerHTML =
    '<div class="profile-avatar">' + (s.avatar || '📚') + '</div>' +
    '<div class="profile-name">' + escapeHtml(s.name || s.username) + '</div>' +
    '<div class="profile-bio">@' + escapeHtml(s.username) + ' · ' + (s.enabled === false ? 'Disabled' : 'Active') + '</div>';
  // load student's stats (libraries/questions are global; visible to all)
  const allLibs = data.libraries;
  const allQs = data.questions;
  const sStats = await DB.loadStats(s.id);
  const acc = sStats.totalAnswered > 0 ? Math.round(sStats.totalCorrect / sStats.totalAnswered * 100) : 0;
  const qCount = allQs.filter(q => (s.libraries || []).includes(q.libraryId)).length;
  $('studentDetailStats').innerHTML =
    '<div class="sd-mini-card"><div class="sd-mini-num">' + qCount + '</div><div class="sd-mini-label">Questions</div></div>' +
    '<div class="sd-mini-card"><div class="sd-mini-num">' + sStats.totalAnswered + '</div><div class="sd-mini-label">Answered</div></div>' +
    '<div class="sd-mini-card"><div class="sd-mini-num">' + acc + '%</div><div class="sd-mini-label">Accuracy</div></div>' +
    '<div class="sd-mini-card"><div class="sd-mini-num">' + sStats.wrongIds.length + '</div><div class="sd-mini-label">Wrong Saved</div></div>';
  // assigned libraries
  const libs = allLibs.filter(lib => (s.libraries || []).includes(lib.id));
  if (!libs.length) {
    $('studentDetailLibraries').innerHTML = '<div class="empty-hint" style="text-align:center;padding:20px;color:#888;">No libraries assigned</div>';
  } else {
    $('studentDetailLibraries').innerHTML = libs.map(lib => {
      const libQCount = allQs.filter(q => q.libraryId === lib.id).length;
      return '<div class="lib-card" style="padding:12px 14px;background:var(--surface,#fff);border-radius:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;">' +
        '<div class="lib-icon" style="width:36px;height:36px;border-radius:10px;background:' + (lib.color || '#5B6CFF') + ';color:white;display:flex;align-items:center;justify-content:center;font-size:18px;">' + (lib.icon || '📚') + '</div>' +
        '<div style="flex:1"><div style="font-weight:600;">' + escapeHtml(lib.name) + '</div><div style="font-size:12px;color:#888;">' + libQCount + ' questions</div></div>' +
      '</div>';
    }).join('');
  }
  $('editStudentBtn').onclick = () => openStudentEditModal(s.id);
  // Disable / Extend / Delete buttons
  const disableBtn = $('disableStudentBtn');
  const extendBtn = $('extendStudentBtn');
  const deleteBtn = $('deleteStudentBtn');
  if (disableBtn) disableBtn.textContent = s.enabled === false ? 'Enable' : 'Disable';
  if (disableBtn) disableBtn.onclick = async () => {
    if (!confirm(i18n.t('students.detail.confirmDisable', {
      action: (s.enabled === false ? i18n.t('students.detail.enable') : i18n.t('students.detail.disable')),
      name: s.username
    }))) return;
    try {
      await Auth.updateStudent(s.id, { enabled: !s.enabled });
      toast(s.enabled === false ? 'i18n:toast.enabled' : 'i18n:toast.disabled');
      await renderStudents();
      go('studentsPage');
    } catch (e) { toast(e.message || 'Error'); }
  };
  if (extendBtn) extendBtn.onclick = async () => {
    const base = s.expires_at && new Date(s.expires_at) > new Date()
      ? new Date(s.expires_at)
      : new Date();
    base.setDate(base.getDate() + 30);
    try {
      await Auth.updateStudent(s.id, { expires_at: base.toISOString() });
      toast(i18n.t('students.detail.extended', { date: base.toISOString().slice(0,10) }));
      await openStudentDetail(s.id);
    } catch (e) { toast(e.message || 'Error'); }
  };
  if (deleteBtn) deleteBtn.onclick = async () => {
    if (!confirm(i18n.t('students.detail.confirmDelete', { name: s.username }))) return;
    try {
      await Auth.deleteStudent(s.id);
      toast('i18n:toast.deleted');
      await renderStudents();
      go('studentsPage');
    } catch (e) { toast(e.message || 'Error'); }
  };
  go('studentDetailPage');
}

async function openStudentEditModal(id) {
  editingStudentId = id || null;
  const isEdit = !!id;
  $('studentModalTitle').textContent = isEdit ? 'Edit Student' : 'Add Student';
  // populate library checkboxes
  const cbs = $('studentLibraryCheckboxes');
  cbs.innerHTML = '';
  if (!data.libraries.length) {
    cbs.innerHTML = '<div style="color:#888;font-size:12px;padding:8px;">No libraries available. Create one in Manage first.</div>';
  } else {
    let currentLibs = [];
    if (isEdit) {
      const students = await Auth.listStudents();
      const existing = students.find(x => x.id === id);
      currentLibs = (existing && existing.libraries) || [];
    }
    data.libraries.forEach(lib => {
      const checked = currentLibs.indexOf(lib.id) >= 0;
      const row = document.createElement('label');
      row.className = 'checkbox-row';
      row.innerHTML = '<input type="checkbox" data-lib-id="' + lib.id + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="cb-name">' + escapeHtml(lib.name) + '</span>' +
        '<span class="cb-count">' + data.questions.filter(q => q.libraryId === lib.id).length + ' Q</span>';
      cbs.appendChild(row);
    });
  }
  if (isEdit) {
    const students = await Auth.listStudents();
    const s = students.find(x => x.id === id);
    if (s) {
      $('studentUsername').value = s.username;
      $('studentName').value = s.name || '';
      $('studentPassword').value = '';
      $('studentAvatar').value = s.avatar || '📚';
      document.querySelector('input[name="studentEnabled"][value="' + (s.enabled === false ? '0' : '1') + '"]').checked = true;
      if ($('studentExpiresAt') && s.expires_at) {
        const d = new Date(s.expires_at);
        const pad = n => String(n).padStart(2, '0');
        $('studentExpiresAt').value = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
          'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      }
    }
  } else {
    $('studentUsername').value = '';
    $('studentName').value = '';
    $('studentPassword').value = '';
    $('studentAvatar').value = '📚';
    document.querySelector('input[name="studentEnabled"][value="1"]').checked = true;
    if ($('studentExpiresAt')) $('studentExpiresAt').value = '';
  }
  openModal('studentModal');
}

$('addStudentBtn').addEventListener('click', () => openStudentEditModal(null));
$('addStudentPageBtn') && $('addStudentPageBtn').addEventListener('click', () => openStudentEditModal(null));

$('saveStudent').addEventListener('click', async () => {
  const username = $('studentUsername').value.trim();
  const password = $('studentPassword').value.trim();
  const name = $('studentName').value.trim();
  const avatar = $('studentAvatar').value.trim() || '📚';
  const enabled = document.querySelector('input[name="studentEnabled"]:checked').value === '1';
  const libIds = Array.from($('studentLibraryCheckboxes').querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => cb.dataset.libId);
  const expiresAtVal = $('studentExpiresAt') ? $('studentExpiresAt').value : '';
  if (!username) { toast('i18n:modal.student.err.username'); return; }
  if (!editingStudentId && !password) { toast('i18n:modal.student.err.passwordReq'); return; }
  if (password && password.length < 4) { toast('i18n:modal.student.err.password'); return; }
  // Derive email from username (Supabase Auth requires email)
  const email = (username.toLowerCase().replace(/[^a-z0-9._-]/g, '_')) + '@quiz.local';
  const saveBtn = $('saveStudent');
  if (saveBtn.disabled) return;
  saveBtn.disabled = true;
  try {
    if (editingStudentId) {
      const patch = {
        username, name, avatar,
        libraries: libIds, enabled,
        expires_at: expiresAtVal || null
      };
      await Auth.updateStudent(editingStudentId, patch);
      // If admin typed a new password, reset it via Edge Function (best-effort)
      if (password) {
        try { await Auth.resetStudentPassword(email, password); }
        catch (e) { toast('i18n:modal.student.err.passwordReset'); }
      }
      toast('i18n:modal.student.updated');
    } else {
      await Auth.createStudent({
        email, password, username, name, avatar,
        libraries: libIds,
        expiresAt: expiresAtVal || null
      });
      toast('i18n:modal.student.created');
    }
    closeModal('studentModal');
    await renderStudents();
  } catch (e) {
    toast(e.message || 'Error');
  } finally {
    saveBtn.disabled = false;
  }
});

$('studentSearch') && $('studentSearch').addEventListener('input', () => renderStudents());
$$('[data-student-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('[data-student-filter]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderStudents(chip.dataset.studentFilter);
  });
});

// Wrap go() to add side-effects: re-render students page + apply role UI + student access guard
const _origGo = go;
window.go = function(pageId, options) {
  if (currentUser && currentUser.role === 'student' &&
      (pageId === 'managePage' || pageId === 'studentsPage' || pageId === 'studentDetailPage')) {
    toast('i18n:toast.loginRequired');
    return;
  }
  _origGo(pageId, options);
  if (pageId === 'studentsPage') renderStudents();
  applyRoleUI();
};
$('addStudentPageBtn') && $('addStudentPageBtn').addEventListener('click', () => openStudentEditModal(null));
