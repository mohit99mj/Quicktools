/* QuickTools — shared site behaviors (classic script, no modules) */
(function () {
  'use strict';

  /* ---------- Footer year ---------- */
  var yearEls = document.querySelectorAll('[data-year]');
  for (var i = 0; i < yearEls.length; i++) {
    yearEls[i].textContent = String(new Date().getFullYear());
  }

  /* ---------- Mobile nav toggle ---------- */
  var toggle = document.querySelector('[data-nav-toggle]');
  var panel = document.querySelector('[data-nav-panel]');
  if (toggle && panel) {
    toggle.addEventListener('click', function () {
      var open = panel.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Close the panel when a link inside it is activated
    panel.addEventListener('click', function (e) {
      var link = e.target.closest('a');
      if (link) {
        panel.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- Active nav link ---------- */
  var path = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
  var navLinks = document.querySelectorAll('.site-nav a, .nav-panel a');
  for (var n = 0; n < navLinks.length; n++) {
    var link = navLinks[n];
    var href = (link.getAttribute('href') || '').replace(/\/$/, '');
    if (href === '' || href === '#') continue;
    // Match absolute root links ("/") and root-relative tool links on file:// too
    var isHome = (href === '/' || href === 'index.html');
    if (isHome && (path === '' || path === '/' || /index\.html$/.test(window.location.pathname))) {
      link.classList.add('active');
    } else if (!isHome && path !== '' && path !== '/') {
      // highlight tool pages under their category-less nav? Only Home/All Tools exist
      // so only exact matches apply
      var abs = link.pathname ? link.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') : href;
      if (abs === path) link.classList.add('active');
    }
  }

  /* ---------- Search with live dropdown ---------- */
  function iconSvg(id) {
    // sprite is referenced relative to the page; the sprite file is copied to dist/assets
    return '<svg class="icon" aria-hidden="true"><use href="' + SPRITE_PATH + '#' + id + '"></use></svg>';
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function score(item, q) {
    var name = item.name.toLowerCase();
    var kw = (item.keywords || '').toLowerCase();
    var cat = (item.category || '').toLowerCase();
    if (name === q) return 100;
    if (name.indexOf(q) === 0) return 80;
    if (name.indexOf(q) !== -1) return 60;
    if (kw.indexOf(q) !== -1) return 40;
    if (cat.indexOf(q) !== -1) return 20;
    return 0;
  }

  var SPRITE_PATH = (function () {
    // Determine sprite path from current depth: tool pages use ../../assets/icons.svg
    var depth = (window.location.pathname.match(/\//g) || []).length;
    // dist/tools/<slug>/index.html -> depth 4; dist/index.html -> depth 1
    if (/\btools\b/.test(window.location.pathname)) return '../../assets/icons.svg';
    return 'assets/icons.svg';
  })();

  var inputs = document.querySelectorAll('[data-tool-search]');
  for (var s = 0; s < inputs.length; s++) {
    initSearch(inputs[s]);
  }

  function initSearch(input) {
    var wrap = input.closest('.search-wrap');
    if (!wrap) return;
    var dd = document.createElement('div');
    dd.className = 'search-dropdown';
    dd.setAttribute('role', 'listbox');
    wrap.appendChild(dd);

    var highlightIdx = -1;
    var currentItems = [];

    function close() {
      dd.classList.remove('open');
      dd.innerHTML = '';
      highlightIdx = -1;
      currentItems = [];
    }

    function toolUrl(slug) {
      if (/\btools\b/.test(window.location.pathname)) return '../' + slug + '/';
      return 'tools/' + slug + '/';
    }

    function render(q) {
      q = q.trim().toLowerCase();
      if (!q || !window.TOOLS_INDEX) { close(); return; }
      var items = window.TOOLS_INDEX
        .map(function (t) { return { t: t, s: score(t, q) }; })
        .filter(function (r) { return r.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 8)
        .map(function (r) { return r.t; });
      currentItems = items;
      highlightIdx = -1;
      if (!items.length) {
        dd.innerHTML = '<div class="sd-empty">No tools match "' + esc(q) + '". Try another keyword.</div>';
      } else {
        dd.innerHTML = items.map(function (t, idx) {
          return '<a href="' + esc(toolUrl(t.slug)) + '" role="option" data-idx="' + idx + '">' +
            iconSvg(t.icon || 'search') +
            '<span>' + esc(t.name) + '</span>' +
            '<span class="sd-cat">' + esc(t.category || '') + '</span></a>';
        }).join('');
      }
      dd.classList.add('open');
    }

    function moveHighlight(dir) {
      var links = dd.querySelectorAll('a');
      if (!links.length) return;
      highlightIdx = (highlightIdx + dir + links.length) % links.length;
      for (var k = 0; k < links.length; k++) {
        links[k].classList.toggle('highlight', k === highlightIdx);
      }
      if (links[highlightIdx]) links[highlightIdx].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('focus', function () { if (input.value) render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveHighlight(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveHighlight(-1); }
      else if (e.key === 'Enter' && highlightIdx >= 0 && currentItems[highlightIdx]) {
        window.location.href = toolUrl(currentItems[highlightIdx].slug);
      }
      else if (e.key === 'Escape') { close(); input.blur(); }
    });
    dd.addEventListener('mousedown', function (e) {
      // Let link navigation proceed before input blur closes the dropdown
      var a = e.target.closest('a');
      if (a) { e.preventDefault(); window.location.href = a.getAttribute('href'); }
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) close();
    });
    input.addEventListener('blur', function () {
      setTimeout(close, 150);
    });
  }

  /* ---------- Home: big search filters the visible grid ---------- */
  var homeInput = document.querySelector('[data-home-search]');
  var homeGrid = document.querySelector('[data-home-grid]');
  var homeCount = document.querySelector('[data-home-count]');
  if (homeInput && homeGrid) {
    homeInput.addEventListener('input', function () {
      var q = homeInput.value.trim().toLowerCase();
      var links = homeGrid.querySelectorAll('.tool-link, .tool-card');
      var shown = 0;
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        var text = (el.textContent || '').toLowerCase();
        var match = !q || text.indexOf(q) !== -1;
        el.style.display = match ? '' : 'none';
        if (match) shown++;
      }
      if (homeCount) {
        homeCount.textContent = q
          ? shown + (shown === 1 ? ' tool' : ' tools') + ' match "' + homeInput.value.trim() + '"'
          : '';
      }
    });
  }
})();
