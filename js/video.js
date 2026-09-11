// ============================================================
// video.js — subject-categorized video UI for admin (upload/delete)
// and students (watch). Talks to Supabase `videos` table + Bunny Stream.
// Depends on globals from app.js: currentUser, toast, openModal, closeModal.
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

  // ---------------- Admin: upload + manage ----------------
  window.openVideoManager = async function () {
    if (!window.BUNNY_LIBRARY_ID || !window.BUNNY_API_KEY) {
      alert('视频功能尚未配置 Bunny Stream（请联系管理员填写 js/bunny-config.js 的 Library ID 与 API Key）。');
      return;
    }
    let libs;
    try { libs = await loadLibraries(); }
    catch (e) { toast('加载学科失败: ' + e.message); return; }

    const body = document.getElementById('videoModalBody');
    body.innerHTML =
      '<div class="video-toolbar">' +
        '<select id="vidLibSelect" class="vid-select">' +
          '<option value="">— 选择学科 —</option>' +
          libs.map(function (l) { return '<option value="' + l.id + '">' + esc(l.name) + '</option>'; }).join('') +
        '</select>' +
        '<span class="vid-count" id="vidCount"></span>' +
      '</div>' +
      '<div class="video-upload">' +
        '<div class="vid-row">' +
          '<input type="file" id="vidFile" accept="video/*" class="vid-file">' +
          '<input type="text" id="vidTitle" placeholder="视频标题（如：第3周 护肤理论）" class="vid-title">' +
        '</div>' +
        '<div class="vid-row">' +
          '<input type="text" id="vidWeek" placeholder="周标签（可选，如：Week 3）" class="vid-week">' +
          '<button id="vidUploadBtn" class="btn btn-primary">上传视频</button>' +
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
    if (!libraryId) { list.innerHTML = '<p class="muted">请选择学科</p>'; return; }
    list.innerHTML = '<p class="muted">加载中…</p>';
    let rows;
    try { rows = await loadVideos(libraryId); }
    catch (e) { list.innerHTML = '<p class="err">加载失败: ' + esc(e.message) + '</p>'; return; }
    cnt.textContent = rows.length + ' 个视频';
    if (!rows.length) { list.innerHTML = '<p class="muted">该学科还没有视频</p>'; return; }
    list.innerHTML = rows.map(function (v) {
      return '<div class="video-card">' +
        '<div class="vc-info"><div class="vc-title">' + esc(v.title) + '</div>' +
        '<div class="vc-meta">' + (v.week_label ? esc(v.week_label) + ' · ' : '') +
        new Date(v.created_at).toLocaleDateString() + '</div></div>' +
        '<button class="btn btn-danger btn-sm" onclick="window.deleteVideoAdmin(\'' + v.id + '\',\'' + v.bunny_video_id + '\')">删除</button>' +
      '</div>';
    }).join('');
  }

  window.deleteVideoAdmin = async function (id, bunnyId) {
    if (!confirm('确定删除这个视频？')) return;
    try {
      await window.Bunny.deleteVideo(bunnyId);
      await vdb.from('videos').delete().eq('id', id);
      toast('已删除');
      const sel = document.getElementById('vidLibSelect');
      if (sel) renderAdminList(sel.value);
    } catch (e) { toast('删除失败: ' + e.message); }
  };

  async function adminUpload(libraryId) {
    if (!libraryId) { toast('请先选择学科'); return; }
    const fileInput = document.getElementById('vidFile');
    const file = fileInput.files && fileInput.files[0];
    if (!file) { toast('请选择 MP4 文件'); return; }
    const title = (document.getElementById('vidTitle').value || file.name).trim();
    const week = document.getElementById('vidWeek').value.trim();
    const btn = document.getElementById('vidUploadBtn');
    const prog = document.getElementById('vidProgress');
    const bar = document.getElementById('vidProgressBar');
    const pct = document.getElementById('vidPct');
    btn.disabled = true; prog.classList.remove('hidden'); bar.style.width = '0%'; pct.textContent = '0%';
    try {
      toast('正在创建视频…');
      const guid = await window.Bunny.createVideo(title);
      toast('正在上传（2G 约需几分钟，支持断点续传）…');
      await window.Bunny.uploadTus(file, guid, title, function (p) { bar.style.width = p + '%'; pct.textContent = p + '%'; });
      await vdb.from('videos').insert({
        library_id: libraryId,
        title: title,
        bunny_video_id: guid,
        week_label: week || null,
        uploaded_by: (currentUser ? currentUser.id : null)
      });
      toast('上传完成！视频转码中，稍候即可播放');
      fileInput.value = ''; document.getElementById('vidTitle').value = ''; document.getElementById('vidWeek').value = '';
      prog.classList.add('hidden');
      renderAdminList(libraryId);
    } catch (e) {
      toast('上传失败: ' + e.message);
      prog.classList.add('hidden');
    } finally {
      btn.disabled = false;
    }
  }

  // ---------------- Student: watch by subject ----------------
  window.openStudentVideos = async function () {
    const body = document.getElementById('videoModalBody');
    body.innerHTML = '<p class="muted">加载中…</p>';
    openModal('videoModal');
    const libs = (currentUser && currentUser.libraries) || [];
    if (!libs.length) { body.innerHTML = '<p class="muted">你还没有被分配学科</p>'; return; }
    let rows;
    try { rows = await loadVideos(null); }
    catch (e) { body.innerHTML = '<p class="err">加载失败: ' + esc(e.message) + '</p>'; return; }
    const assigned = libs.map(String);
    rows = rows.filter(function (v) { return assigned.indexOf(String(v.library_id)) !== -1; });
    if (!rows.length) { body.innerHTML = '<p class="muted">该学科暂无视频</p>'; return; }
    const { data: libRows } = await vdb.from('libraries').select('id,name').in('id', libs);
    const nameMap = {}; (libRows || []).forEach(function (l) { nameMap[l.id] = l.name; });
    body.innerHTML = '<div class="video-grid">' + rows.map(function (v) {
      return '<div class="video-card-block">' +
        '<div class="vc-title">' + esc(v.title) + '</div>' +
        '<div class="vc-meta">' + (nameMap[v.library_id] ? esc(nameMap[v.library_id]) + ' · ' : '') +
        (v.week_label ? esc(v.week_label) + ' · ' : '') + new Date(v.created_at).toLocaleDateString() + '</div>' +
        '<iframe class="video-iframe" src="' + window.Bunny.embedUrl(v.bunny_video_id) +
        '" loading="lazy" allow="autoplay; fullscreen" allowfullscreen></iframe>' +
      '</div>';
    }).join('') + '</div>';
  };
})();
