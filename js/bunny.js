// ============================================================
// bunny.js — Bunny Stream direct browser upload (no backend server).
// Signature for the TUS resumable upload is computed in-browser with
// Web Crypto (SHA-256), so the library API key stays client-side.
// Requires tus-js-client loaded before this file.
// ============================================================
(function () {
  function base() {
    return 'https://video.bunnycdn.com/library/' + (window.BUNNY_LIBRARY_ID || '');
  }

  // Create an empty video object → returns its GUID
  async function createVideo(title) {
    const res = await fetch(base() + '/videos', {
      method: 'POST',
      headers: { 'AccessKey': window.BUNNY_API_KEY || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || 'Untitled' })
    });
    if (!res.ok) throw new Error('Bunny create failed (' + res.status + ')');
    const d = await res.json();
    return d.guid;
  }

  // SHA-256 signature = hex( libraryId + apiKey + expire + videoId )
  async function signTus(videoId, expire) {
    const msg = '' + window.BUNNY_LIBRARY_ID + window.BUNNY_API_KEY + expire + videoId;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
    return Array.from(new Uint8Array(buf))
      .map(function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  }

  // Resumable chunked upload (handles 2 GB / poor networks)
  function uploadTus(file, videoId, title, onProgress) {
    return new Promise(function (resolve, reject) {
      const expire = Math.floor(Date.now() / 1000) + 172800; // 48h
      signTus(videoId, expire).then(function (sig) {
        const upload = new tus.Upload(file, {
          endpoint: 'https://video.bunnycdn.com/tusupload',
          retryDelays: [0, 3000, 5000, 10000, 20000, 60000],
          chunkSize: 50 * 1024 * 1024,
          headers: {
            AuthorizationSignature: sig,
            AuthorizationExpire: String(expire),
            VideoId: videoId,
            LibraryId: String(window.BUNNY_LIBRARY_ID)
          },
          metadata: { filetype: file.type || 'video/mp4', title: title || file.name },
          onError: function (e) { reject(e); },
          onProgress: function (sent, total) {
            if (onProgress) onProgress(Math.round(sent / total * 100));
          },
          onSuccess: function () { resolve(); }
        });
        upload.start();
      }).catch(reject);
    });
  }

  function embedUrl(videoId) {
    return 'https://iframe.mediadelivery.net/embed/' + window.BUNNY_LIBRARY_ID + '/' + videoId;
  }

  async function deleteVideo(videoId) {
    const res = await fetch(base() + '/videos/' + videoId, {
      method: 'DELETE',
      headers: { 'AccessKey': window.BUNNY_API_KEY || '' }
    });
    if (!res.ok && res.status !== 404) throw new Error('Bunny delete failed (' + res.status + ')');
  }

  window.Bunny = {
    createVideo: createVideo,
    uploadTus: uploadTus,
    embedUrl: embedUrl,
    deleteVideo: deleteVideo
  };
})();
