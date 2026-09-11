// ============================================================
// video.js — subject-categorized video UI for admin (upload/delete)
// and students (watch). Talks to Supabase `videos` table + Bunny Stream.
// Depends on globals from app.js: currentUser, toast, openModal, closeModal,
// and from i18n.js: i18n (t / apply / languageChanged).
// ============================================================
(function () {
  const vdb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function loadLibraries() {
    const { data, error } = await vdb.from('libraries').select('id,name').order('name');
    if (error) throw error;
    return data || [];
  }

  async function loadVideos(libraryId) {
    let q = vdb.from('videos').select('*').order('created_at', { ascending: false });
    if (libraryId) q = q.eq('library_id', libraryId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  // ---------------- Watched tracking (per student, localStorage) ----------------
  function watchKey(id) {
    return 'vidseen_' + (currentUser ? currentUser.id : 'anon') + '_' + id;
  }
  function isWatched(id) {
    try { return localStorage.getItem(watchKey(id)) === '1'; } catch (e) { return false; }
  }
  function markWatched(id) {
    try { localStorage.setItem(watchKey(id), '1'); } catch (e) {}
  }

  // ---------------- Admin: upload + manage ----------------
  window.openVideoManager = async function () {
    if (!window.BUNNY_LIBRARY_ID || !window.BUNNY_API_KEY) {
      alert(i18n.t('video.admin.notConfigured'));
      return;
    }
    let libs;
    try { libs = await loadLibraries(); }
    catch (e) { toast(i18n.t('video.admin.loadLibFail') + e.message); return; }

    const body = document.getElementById('videoModalBody');
    body.innerHTML =
      '<div class="video-toolbar">' +
        '<select id="vidLibSelect" class="vid-select">' +
          '<option value="">' + esc(i18n.t('video.admin.subject.placeholder')) + '</option>' +
          libs.map(function (l) { return '<option value="' + l.id + '">' + esc(l.name) + '</option>'; }).join('') +
        '</select>' +
        '<span class="vid-count" id="vidCount"></span>' +
      '</div>' +
      '<div class="video-upload">' +
        '<div class="vid-row">' +
          '<input type="file" id="vidFile" accept="video/*" class="vid-file">' +
          '<input type="text" id="vidTitle" placeholder="' + esc(i18n.t('video.admin.title.ph')) + '" class="vid-title">' +
        '</div>' +
        '<div class="vid-row">' +
          '<input type="text" id="vidWeek" placeholder="' + esc(i18n.t('video.admin.week.ph')) + '" class="vid-week">' +
          '<button id="vidUploadBtn" class="btn btn-primary">' + esc(i18n.t('video.admin.upload')) + '</button>' +
        '</div>' +
        '<div class="progress hidden" id="vidProgress"><div class="progress-bar" id="vidProgressBar"></div><span id="vidPct">0%</span></div>' +
      '</div>' +
      '<div class="video-list" id="vidList"></div>';
    openModal('videoModal');

    const sel = document.getElementById('vidLibSelect');
    sel.addEventListener('change', function () { renderAdminList(sel.value); });
    document.getElementById('vidUploadBtn').addEventListener('click', function () { adminUpload(sel.value); });

    if (libs.length) { sel.value = libs[0].id; renderAdminList(sel.value); }
  };

  async function renderAdminList(libraryId) {
    const list = document.getElementById('vidList');
    const cnt = document.getElementById('vidCount');
    if (!libraryId) { list.innerHTML = '<p class="muted">' + esc(i18n.t('video.admin.subject.placeholder')) + '</p>'; return; }
    list.innerHTML = '<p class="muted">' + esc(i18n.t('video.admin.loading')) + '</p>';
    let rows;
    try { rows = await loadVideos(libraryId); }
    catch (e) { list.innerHTML = '<p class="err">' + esc(i18n.t('video.admin.fail')) + esc(e.message) + '</p>'; return; }
    cnt.textContent = i18n.t('video.admin.count', { n: rows.length });
    if (!rows.length) { list.innerHTML = '<p class="muted">' + esc(i18n.t('video.admin.empty')) + '</p>'; return; }
    list.innerHTML = rows.map(function (v) {
      return '<div class="video-card">' +
        '<div class="vc-info"><div class="vc-title">' + esc(v.title) + '</div>' +
        '<div class="vc-meta">' + (v.week_label ? esc(v.week_label) + ' · ' : '') +
        new Date(v.created_at).toLocaleDateString() + '</div></div>' +
        '<button class="btn btn-danger btn-sm" onclick="window.deleteVideoAdmin(\'' + v.id + '\',\'' + v.bunny_video_id + '\')">' + esc(i18n.t('btn.delete')) + '</button>' +
      '</div>';
    }).join('');
  }

  window.deleteVideoAdmin = async function (id, bunnyId) {
    if (!confirm(i18n.t('video.admin.confirmDelete'))) return;
    const sel = document.getElementById('vidLibSelect');
    const libVal = sel ? sel.value : '';
    try {
      // 1) Delete the DB row FIRST — this is what controls the list the admin sees.
      const { error } = await vdb.from('videos').delete().eq('id', id);
      if (error) throw error;
      toast(i18n.t('video.admin.deleted'));
      renderAdminList(libVal);
      // 2) Best-effort Bunny cleanup — must NOT block the local delete on API/CORS errors.
      if (bunnyId) {
        try {
          await window.Bunny.deleteVideo(bunnyId);
        } catch (e) {
          console.warn('Bunny video cleanup failed:', e);
          toast(i18n.t('video.admin.bunnyCleanupWarn'));
        }
      }
    } catch (e) { toast(i18n.t('video.admin.deleteFail') + e.message); }
  };

  async function adminUpload(libraryId) {
    if (!libraryId) { toast(i18n.t('video.admin.selectSubjectFirst')); return; }
    const fileInput = document.getElementById('vidFile');
    const file = fileInput.files && fileInput.files[0];
    if (!file) { toast(i18n.t('video.admin.noFile')); return; }
    const title = (document.getElementById('vidTitle').value || file.name).trim();
    const week = document.getElementById('vidWeek').value.trim();
    const btn = document.getElementById('vidUploadBtn');
    const prog = document.getElementById('vidProgress');
    const bar = document.getElementById('vidProgressBar');
    const pct = document.getElementById('vidPct');
    btn.disabled = true; prog.classList.remove('hidden'); bar.style.width = '0%'; pct.textContent = '0%';
    try {
      toast(i18n.t('video.admin.creating'));
      const guid = await window.Bunny.createVideo(title);
      toast(i18n.t('video.admin.uploading'));
      await window.Bunny.uploadTus(file, guid, title, function (p) { bar.style.width = p + '%'; pct.textContent = p + '%'; });
      await vdb.from('videos').insert({
        library_id: libraryId,
        title: title,
        bunny_video_id: guid,
        week_label: week || null,
        uploaded_by: (currentUser ? currentUser.id : null)
      });
      toast(i18n.t('video.admin.done'));
      fileInput.value = ''; document.getElementById('vidTitle').value = ''; document.getElementById('vidWeek').value = '';
      prog.classList.add('hidden');
      renderAdminList(libraryId);
    } catch (e) {
      toast(i18n.t('video.admin.fail') + e.message);
      prog.classList.add('hidden');
    } finally {
      btn.disabled = false;
    }
  }

  // ---------------- Student: watch by subject (grouped) + unwatched dots ----------------
  window.openStudentVideos = async function () {
    const body = document.getElementById('videoModalBody');
    body.innerHTML = '<p class="muted">' + esc(i18n.t('video.student.loading')) + '</p>';
    openModal('videoModal');
    const libs = (currentUser && currentUser.libraries) || [];
    if (!libs.length) { body.innerHTML = '<p class="muted">' + esc(i18n.t('video.student.noLib')) + '</p>'; return; }
    let rows;
    try { rows = await loadVideos(null); }
    catch (e) { body.innerHTML = '<p class="err">' + esc(i18n.t('video.student.fail')) + esc(e.message) + '</p>'; return; }
    const assigned = libs.map(String);
    rows = rows.filter(function (v) { return assigned.indexOf(String(v.library_id)) !== -1; });
    const { data: libRows } = await vdb.from('libraries').select('id,name').in('id', libs);
    const groups = [];
    (libRows || []).forEach(function (l) {
      const gv = rows.filter(function (v) { return String(v.library_id) === String(l.id); });
      if (gv.length) groups.push({ name: l.name, videos: gv });
    });
    if (!groups.length) { body.innerHTML = '<p class="muted">' + esc(i18n.t('video.student.empty')) + '</p>'; return; }
    body.innerHTML = groups.map(function (g) {
      return '<div class="video-subject-group">' +
        '<div class="vsg-head"><span class="vsg-name">' + esc(g.name) + '</span>' +
        '<span class="vsg-count">' + g.videos.length + '</span></div>' +
        '<div class="video-grid">' + g.videos.map(studentCardHtml).join('') + '</div>' +
      '</div>';
    }).join('');
  };

  function studentCardHtml(v) {
    const seen = isWatched(v.id);
    return '<div class="video-card-block' + (seen ? ' is-watched' : '') + '" id="vcb-' + esc(v.id) + '">' +
      (seen ? '' : '<span class="vc-dot" title="' + esc(i18n.t('video.student.watched')) + '"></span>') +
      '<div class="vc-title">' + esc(v.title) + '</div>' +
      '<div class="vc-meta">' + (v.week_label ? esc(v.week_label) + ' · ' : '') +
      new Date(v.created_at).toLocaleDateString() + '</div>' +
      '<div class="vc-player" id="vcplayer-' + esc(v.id) + '">' +
        '<button class="vc-play" onclick="window.playStudentVideo(\'' + esc(v.id) + '\',\'' + esc(v.bunny_video_id) + '\')">▶ ' + esc(i18n.t('video.student.play')) + '</button>' +
      '</div>' +
    '</div>';
  }

  window.playStudentVideo = function (id, bunnyId) {
    const box = document.getElementById('vcplayer-' + id);
    if (!box) return;
    box.innerHTML = '<iframe class="video-iframe" src="' + window.Bunny.embedUrl(bunnyId) +
      '" allow="autoplay; fullscreen" allowfullscreen></iframe>';
    if (!isWatched(id)) {
      markWatched(id);
      const card = document.getElementById('vcb-' + id);
      if (card) { const d = card.querySelector('.vc-dot'); if (d) d.remove(); card.classList.add('is-watched'); }
      if (window.refreshStudentVideoBadge) window.refreshStudentVideoBadge();
    }
  };

  // ---------------- Banner unseen badge (home) ----------------
  window.refreshStudentVideoBadge = async function () {
    const badge = document.getElementById('videoUnseenBadge');
    if (!badge) return;
    if (!currentUser || !currentUser.libraries || !currentUser.libraries.length) { badge.classList.add('hidden'); return; }
    try {
      const libs = currentUser.libraries.map(String);
      const { data, error } = await vdb.from('videos').select('id,library_id').in('library_id', libs);
      if (error) throw error;
      const unseen = (data || []).filter(function (v) { return !isWatched(v.id); }).length;
      if (unseen > 0) {
        badge.textContent = unseen > 99 ? '99+' : String(unseen);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    } catch (e) { badge.classList.add('hidden'); }
  };

  // Best-effort: refresh the unseen badge whenever the home screen re-renders
  // (renderHome is a global function in app.js, a classic script) or language changes.
  if (typeof window.renderHome === 'function') {
    const _orig = window.renderHome;
    window.renderHome = function () {
      _orig.apply(this, arguments);
      if (window.refreshStudentVideoBadge) window.refreshStudentVideoBadge();
    };
  }
  window.addEventListener('languageChanged', function () {
    if (window.refreshStudentVideoBadge) window.refreshStudentVideoBadge();
  });
})();
