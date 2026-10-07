/* Video & Audio Downloader — shared pure logic + cascade layers.
 * UMD: usable in the browser via window.VDLogic and in Node via require().
 * All network access goes through an injected fetchFn so Node tests can mock it.
 */
(function (root, factory) {
  'use strict';
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = mod; }
  root.VDLogic = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Config                                                              */
  /* ------------------------------------------------------------------ */
  var TIMEOUT_MS = 10000;          // per-instance / per-request timeout
  var COOLDOWN_MS = 2 * 60 * 1000; // 2-minute cooldown for failed instances

  var COBALT_DISCOVERY = 'https://cobalt.directory/api/instances';
  var COBALT_FALLBACK = [
    'https://kittycat.boo',
    'https://liubquanti.click',
    'https://squair.xyz',
    'https://xenon.zone',
    'https://cjs.nz'
  ];
  var PIPED_APIS = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi-libre.kavin.rocks',
    'https://pipedapi.leptons.xyz',
    'https://pipedapi.adminforge.de',
    'https://api.piped.yt',
    'https://pipedapi.reallyaweso.me'
  ];
  var INVIDIOUS_INDEX = 'https://api.invidious.io/instances.json';

  var DIRECT_EXT = /\.(mp4|m4a|mp3|webm|mov|ogg|ogv|wav|flac|mkv|3gp)(\?|#|$)/i;

  /* ------------------------------------------------------------------ */
  /* URL classification                                                  */
  /* ------------------------------------------------------------------ */
  function withScheme(s) {
    s = String(s || '').trim();
    if (!s) { return null; }
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s) && !s.startsWith('//')) { s = 'https://' + s; }
    return s;
  }

  function extractYouTubeId(input) {
    if (input == null) { return null; }
    var s = String(input).trim();
    if (!s) { return null; }
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) { return s; } // bare 11-char id

    var u = null;
    try {
      var cand = withScheme(s);
      if (cand) { u = new URL(cand); }
    } catch (e) { u = null; }

    if (u) {
      var host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
      var id = null;
      if (host === 'youtu.be') {
        var seg = u.pathname.split('/').filter(Boolean);
        if (seg.length) { id = seg[0]; }
      } else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || /\.youtube\.com$/.test(host)) {
        var v = u.searchParams.get('v');
        if (v) { id = v; }
        var m = u.pathname.match(/^\/(?:shorts|embed|live|v|attribution_link)\/([^/?#]+)/);
        if (m) { id = m[1]; }
      }
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) { return id; }
    }

    // Regex fallback for odd strings URL() could not parse.
    var pats = [
      /youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/,
      /youtube\.com\/(?:watch\?[^#]*[?&]v=|shorts\/|embed\/|live\/|v\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/
    ];
    for (var i = 0; i < pats.length; i++) {
      var mm = s.match(pats[i]);
      if (mm) { return mm[1]; }
    }
    return null;
  }

  function isYouTubeUrl(input) {
    return extractYouTubeId(input) !== null;
  }

  function isDirectMediaUrl(input) {
    if (input == null) { return false; }
    var s = String(input).trim();
    if (!s) { return false; }
    return DIRECT_EXT.test(s);
  }

  /** 'youtube' | 'direct' | 'other' (empty string for blank input). */
  function classifyUrl(input) {
    if (input == null || !String(input).trim()) { return ''; }
    if (isYouTubeUrl(input)) { return 'youtube'; }
    if (isDirectMediaUrl(input)) { return 'direct'; }
    return 'other';
  }

  /* ------------------------------------------------------------------ */
  /* fetch with timeout                                                  */
  /* ------------------------------------------------------------------ */
  function fetchWithTimeout(fetchFn, url, opts, ms) {
    opts = opts || {};
    ms = ms == null ? TIMEOUT_MS : ms;
    var ctrl = null;
    var signal = opts.signal;
    if (typeof AbortController !== 'undefined' && !signal) {
      ctrl = new AbortController();
      signal = ctrl.signal;
    }
    var timer = null;
    if (ctrl) {
      timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms);
    }
    var p = fetchFn(url, Object.assign({}, opts, signal ? { signal: signal } : {}));
    return Promise.resolve(p).then(
      function (res) { if (timer) { clearTimeout(timer); } return res; },
      function (err) { if (timer) { clearTimeout(timer); } throw err; }
    );
  }

  /* ------------------------------------------------------------------ */
  /* 2-minute cooldown store (injectable clock for tests)                */
  /* ------------------------------------------------------------------ */
  function makeCooldownStore(nowFn) {
    var map = {};
    var now = nowFn || function () { return Date.now(); };
    return {
      isCool: function (key) {
        var until = map[key];
        return !!until && now() < until;
      },
      cool: function (key, ms) {
        map[key] = now() + (ms == null ? COOLDOWN_MS : ms);
      },
      clear: function () { map = {}; }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Layer A — Cobalt                                                    */
  /* ------------------------------------------------------------------ */
  /** Validate a Cobalt API JSON response; returns normalized result or null. */
  function parseCobaltResponse(json, mode) {
    if (!json || typeof json !== 'object') { return null; }
    var status = json.status;
    if (status === 'tunnel' || status === 'redirect') {
      if (typeof json.url !== 'string' || !json.url) { return null; }
      return {
        ok: true, layer: 'cobalt', kind: status, url: json.url,
        filename: typeof json.filename === 'string' && json.filename ? json.filename : (mode === 'audio' ? 'audio.mp3' : 'video.mp4')
      };
    }
    if (status === 'picker') {
      var items = Array.isArray(json.picker) ? json.picker : [];
      var out = [];
      items.forEach(function (it) {
        if (it && typeof it.url === 'string' && it.url) {
          out.push({ url: it.url, label: typeof it.label === 'string' ? it.label : 'Option' });
        }
      });
      if (!out.length) { return null; }
      return { ok: true, layer: 'cobalt', kind: 'picker', items: out };
    }
    return null; // error / rate-limit / unknown → treat as miss, try next
  }

  function cobaltPayload(pageUrl, mode) {
    return {
      url: pageUrl,
      downloadMode: mode === 'audio' ? 'audio' : 'auto',
      videoQuality: 'max',
      audioFormat: 'mp3'
    };
  }

  /**
   * Try Cobalt instances in order. Returns normalized result object or null.
   * ctx: { instances?, cooldowns?, onStage? } — onStage(n, total, host) for UI.
   */
  function cobaltLayer(fetchFn, pageUrl, mode, ctx) {
    ctx = ctx || {};
    var cooldowns = ctx.cooldowns || makeCooldownStore();
    var instances = ctx.instances ? ctx.instances.slice() : COBALT_FALLBACK.slice();

    function attemptDiscovery() {
      return fetchWithTimeout(fetchFn, COBALT_DISCOVERY, { headers: { Accept: 'application/json' } }, TIMEOUT_MS)
        .then(function (res) {
          var ct = (res.headers && res.headers.get('content-type')) || '';
          if (!res.ok || ct.indexOf('application/json') === -1) { return null; }
          return res.json().catch(function () { return null; });
        })
        .then(function (json) {
          if (!json) { return null; }
          var list = [];
          var arr = Array.isArray(json) ? json : (json.instances || json.data || []);
          arr.forEach(function (it) {
            var u = typeof it === 'string' ? it : (it && (it.api || it.url || it.uri));
            if (typeof u === 'string' && /^https?:\/\//.test(u)) { list.push(u.replace(/\/+$/, '')); }
          });
          return list.length ? list : null;
        })
        .catch(function () { return null; }); // discovery failure is silent
    }

    function tryOne(inst, idx, total) {
      if (cooldowns.isCool(inst)) { return Promise.resolve(null); }
      if (ctx.onStage) { try { ctx.onStage(idx + 1, total, inst); } catch (e) {} }
      return fetchWithTimeout(fetchFn, inst.replace(/\/+$/, '') + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(cobaltPayload(pageUrl, mode))
      }, TIMEOUT_MS)
        .then(function (res) {
          var ct = (res.headers && res.headers.get('content-type')) || '';
          if (!res.ok || ct.indexOf('application/json') === -1) {
            cooldowns.cool(inst); // HTML/405/etc → not a working API, cool it down
            return null;
          }
          return res.json().catch(function () { return null; });
        })
        .then(function (json) {
          var parsed = parseCobaltResponse(json, mode);
          if (!parsed) { cooldowns.cool(inst); return null; }
          return parsed;
        })
        .catch(function () { cooldowns.cool(inst); return null; }); // timeout/network → skip silently
    }

    function chain(list) {
      var i = 0;
      function next() {
        if (i >= list.length) { return Promise.resolve(null); }
        var inst = list[i]; i++;
        return tryOne(inst, i - 1, list.length).then(function (r) {
          return r ? r : next();
        });
      }
      return next();
    }

    if (ctx.skipDiscovery) { return chain(instances); }
    return attemptDiscovery().then(function (found) {
      var list = found && found.length ? found : instances;
      // Merge fallback instances after discovered ones (deduped).
      if (found && found.length) {
        instances.forEach(function (u) { if (list.indexOf(u) === -1) { list.push(u); } });
      }
      return chain(list);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Layer B — Piped                                                     */
  /* ------------------------------------------------------------------ */
  function pickPipedStream(data, mode) {
    if (!data || typeof data !== 'object') { return null; }
    function best(list, wantAudio) {
      if (!Array.isArray(list) || !list.length) { return null; }
      var scored = list
        .filter(function (s) { return s && typeof s.url === 'string' && s.url; })
        .map(function (s) {
          var score = 0;
          if (/pipedproxy/.test(s.url)) { score += 1000; } // proxied → browser-friendly
          score += Number(s.bitrate || s.quality && parseInt(s.quality, 10) || 0) || 0;
          return { s: s, score: score };
        });
      if (!scored.length) { return null; }
      scored.sort(function (a, b) { return b.score - a.score; });
      return scored[0].s;
    }
    var stream = null;
    if (mode === 'audio') {
      stream = best(data.audioStreams, true);
      if (!stream) { stream = best(data.videoStreams, false); }
    } else {
      stream = best(data.videoStreams, false);
      if (!stream) { stream = best(data.audioStreams, true); }
    }
    if (!stream) { return null; }
    return {
      ok: true, layer: 'piped', kind: 'stream', url: stream.url,
      filename: (mode === 'audio' ? 'audio' : 'video') + '.' + (mode === 'audio' ? 'mp3' : 'mp4'),
      label: String(stream.quality || stream.bitrate || '')
    };
  }

  /** Try Piped API mirrors in order. Returns normalized result or null. */
  function pipedLayer(fetchFn, videoId, mode, ctx) {
    ctx = ctx || {};
    var cooldowns = ctx.cooldowns || makeCooldownStore();
    var apis = ctx.apis ? ctx.apis.slice() : PIPED_APIS.slice();
    var i = 0;
    function next() {
      if (i >= apis.length) { return Promise.resolve(null); }
      var api = apis[i]; i++;
      if (cooldowns.isCool(api)) { return next(); }
      if (ctx.onStage) { try { ctx.onStage(i, apis.length, api); } catch (e) {} }
      return fetchWithTimeout(fetchFn, api.replace(/\/+$/, '') + '/streams/' + videoId, { headers: { Accept: 'application/json' } }, TIMEOUT_MS)
        .then(function (res) {
          if (!res.ok) { return { __skip: true }; } // HTTP error → next mirror
          return res.json().catch(function () { return null; });
        })
        .then(function (json) {
          if (json && json.__skip) { cooldowns.cool(api); return next(); } // already decided: move on
          var picked = (!json || json.error) ? null : pickPipedStream(json, mode);
          if (!picked) { cooldowns.cool(api); return next(); }
          return picked;
        })
        .catch(function () { cooldowns.cool(api); return next(); });
    }
    return next();
  }

  /* ------------------------------------------------------------------ */
  /* Layer C — Invidious                                                 */
  /* ------------------------------------------------------------------ */
  function pickInvidiousStream(data, mode) {
    if (!data || typeof data !== 'object') { return null; }
    var url = null, label = '';
    if (mode === 'audio') {
      var aud = (data.adaptiveFormats || []).filter(function (f) {
        return f && /audio/.test(f.type || '') && typeof f.url === 'string';
      });
      aud.sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
      if (aud.length) { url = aud[0].url; label = String(aud[0].bitrate || ''); }
    } else {
      var fmt = (data.formatStreams || []).filter(function (f) {
        return f && typeof f.url === 'string' && f.url;
      });
      // Prefer mp4 with both audio+video, highest declared quality.
      fmt.sort(function (a, b) {
        var qa = /2160|4k/i.test(a.qualityLabel || '') ? 5 : /1440/i.test(a.qualityLabel || '') ? 4 :
                 /1080/i.test(a.qualityLabel || '') ? 3 : /720/i.test(a.qualityLabel || '') ? 2 :
                 /480/i.test(a.qualityLabel || '') ? 1 : 0;
        var qb = /2160|4k/i.test(b.qualityLabel || '') ? 5 : /1440/i.test(b.qualityLabel || '') ? 4 :
                 /1080/i.test(b.qualityLabel || '') ? 3 : /720/i.test(b.qualityLabel || '') ? 2 :
                 /480/i.test(b.qualityLabel || '') ? 1 : 0;
        return qb - qa;
      });
      if (fmt.length) { url = fmt[0].url; label = String(fmt[0].qualityLabel || ''); }
    }
    if (!url) { return null; }
    return {
      ok: true, layer: 'invidious', kind: 'stream', url: url,
      filename: (mode === 'audio' ? 'audio' : 'video') + '.' + (mode === 'audio' ? 'mp3' : 'mp4'),
      label: label
    };
  }

  /**
   * Runtime Invidious discovery: GET instances.json, keep api==true && cors==true.
   * Returns normalized result or null.
   */
  function invidiousLayer(fetchFn, videoId, mode, ctx) {
    ctx = ctx || {};
    var cooldowns = ctx.cooldowns || makeCooldownStore();

    function discover() {
      return fetchWithTimeout(fetchFn, INVIDIOUS_INDEX, { headers: { Accept: 'application/json' } }, TIMEOUT_MS)
        .then(function (res) {
          if (!res.ok) { return null; }
          return res.json().catch(function () { return null; });
        })
        .then(function (json) {
          if (!json) { return null; }
          var out = [];
          var pairs = Array.isArray(json) ? json : [];
          pairs.forEach(function (p) {
            var meta = p && p[1];
            if (meta && meta.api && meta.cors && typeof meta.uri === 'string') {
              out.push(meta.uri.replace(/\/+$/, ''));
            }
          });
          return out.length ? out.slice(0, 4) : null;
        })
        .catch(function () { return null; });
    }

    function tryInstance(inst, idx, total) {
      if (cooldowns.isCool(inst)) { return Promise.resolve(null); }
      if (ctx.onStage) { try { ctx.onStage(idx + 1, total, inst); } catch (e) {} }
      return fetchWithTimeout(fetchFn, inst + '/api/v1/videos/' + videoId, { headers: { Accept: 'application/json' } }, TIMEOUT_MS)
        .then(function (res) {
          if (!res.ok) { cooldowns.cool(inst); return null; }
          return res.json().catch(function () { return null; });
        })
        .then(function (json) {
          var picked = pickInvidiousStream(json, mode);
          if (!picked) { cooldowns.cool(inst); return null; }
          return picked;
        })
        .catch(function () { cooldowns.cool(inst); return null; });
    }

    return discover().then(function (insts) {
      if (!insts) { return null; }
      var i = 0;
      function next() {
        if (i >= insts.length) { return Promise.resolve(null); }
        var inst = insts[i]; i++;
        return tryInstance(inst, i - 1, insts.length).then(function (r) {
          return r ? r : next();
        });
      }
      return next();
    });
  }

  /* ------------------------------------------------------------------ */
  return {
    TIMEOUT_MS: TIMEOUT_MS,
    COOLDOWN_MS: COOLDOWN_MS,
    COBALT_FALLBACK: COBALT_FALLBACK,
    PIPED_APIS: PIPED_APIS,
    extractYouTubeId: extractYouTubeId,
    isYouTubeUrl: isYouTubeUrl,
    isDirectMediaUrl: isDirectMediaUrl,
    classifyUrl: classifyUrl,
    fetchWithTimeout: fetchWithTimeout,
    makeCooldownStore: makeCooldownStore,
    parseCobaltResponse: parseCobaltResponse,
    cobaltPayload: cobaltPayload,
    cobaltLayer: cobaltLayer,
    pickPipedStream: pickPipedStream,
    pipedLayer: pipedLayer,
    pickInvidiousStream: pickInvidiousStream,
    invidiousLayer: invidiousLayer
  };
});
