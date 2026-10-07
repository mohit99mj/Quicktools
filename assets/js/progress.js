/* QuickTools shared progress overlay + skeleton shimmer + result summary.
 * Loaded site-wide (coordinator injects the <script>/<link> tags); tool pages
 * call it guarded: if (window.QTProgress) QTProgress.show({...}).
 *
 * API:
 *   QTProgress.show({ title, stage, percent })  // percent omitted => indeterminate
 *   QTProgress.update(percent, stage)
 *   QTProgress.hide()
 * Extras (workstream A):
 *   QTProgress.shimmer() / QTProgress.shimmerClear()  // skeleton cover over tool panel
 *   QTProgress.summary(targetEl, html)                 // result summary card
 */
(function(){
  'use strict';

  var NS = 'qtp';
  var overlay = null;   // root overlay element
  var els = null;       // cached inner elements
  var shown = false;
  var skelTimer = null; // delayed skeleton timer (avoids flash on fast loads)
  var skelEl = null;

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function build(){
    if(overlay){ return; }
    overlay = document.createElement('div');
    overlay.className = NS + '-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="' + NS + '-card">' +
        '<div class="' + NS + '-spinner" aria-hidden="true"><span></span></div>' +
        '<div class="' + NS + '-title"></div>' +
        '<div class="' + NS + '-pct">0%</div>' +
        '<div class="' + NS + '-track"><div class="' + NS + '-bar"></div></div>' +
        '<div class="' + NS + '-stage"></div>' +
      '</div>';
    els = {
      title: overlay.querySelector('.' + NS + '-title'),
      pct: overlay.querySelector('.' + NS + '-pct'),
      bar: overlay.querySelector('.' + NS + '-bar'),
      track: overlay.querySelector('.' + NS + '-track'),
      stage: overlay.querySelector('.' + NS + '-stage'),
      spinner: overlay.querySelector('.' + NS + '-spinner')
    };
    // Prevent accidental taps/clicks from reaching the page mid-process.
    overlay.addEventListener('click', function(e){ e.stopPropagation(); }, true);
    overlay.addEventListener('touchstart', function(e){ e.stopPropagation(); }, { passive: true });
  }

  function applyMode(indeterminate){
    if(!overlay){ return; }
    if(indeterminate){
      overlay.classList.add(NS + '-indet');
      els.pct.style.visibility = 'hidden';
    } else {
      overlay.classList.remove(NS + '-indet');
      els.pct.style.visibility = 'visible';
    }
  }

  function clamp(p){
    p = Number(p);
    if(!isFinite(p)){ return 0; }
    return Math.max(0, Math.min(100, Math.round(p)));
  }

  var api = {
    show: function(opts){
      opts = opts || {};
      try{
        build();
        var indet = !(typeof opts.percent === 'number' && isFinite(opts.percent));
        applyMode(indet);
        els.title.textContent = opts.title || 'Working…';
        els.stage.textContent = opts.stage || '';
        if(!indet){
          var p = clamp(opts.percent);
          els.bar.style.width = p + '%';
          els.pct.textContent = p + '%';
        } else {
          els.bar.style.width = '0%';
          els.pct.textContent = '';
        }
        if(!shown){
          document.body.appendChild(overlay);
          // Force reflow so the fade-in transition plays.
          void overlay.offsetWidth;
          overlay.classList.add(NS + '-on');
          overlay.setAttribute('aria-hidden', 'false');
          shown = true;
        }
      }catch(e){ /* never break the tool */ }
      return api;
    },

    update: function(percent, stage){
      if(!shown || !overlay){ return api; }
      try{
        applyMode(false);
        var p = clamp(percent);
        els.bar.style.width = p + '%';
        els.pct.textContent = p + '%';
        if(typeof stage === 'string'){ els.stage.textContent = stage; }
      }catch(e){}
      return api;
    },

    hide: function(){
      if(!shown || !overlay){ return api; }
      try{
        overlay.classList.remove(NS + '-on');
        overlay.setAttribute('aria-hidden', 'true');
        var node = overlay;
        // Remove from DOM after the fade-out; harmless if called twice.
        setTimeout(function(){
          if(node.parentNode){ node.parentNode.removeChild(node); }
        }, 260);
        shown = false;
      }catch(e){ shown = false; }
      return api;
    },

    /* Skeleton shimmer: a shimmering placeholder cover over the tool panel,
     * shown while a CDN library (pdf.js / ffmpeg.wasm / pdf-lib / jszip) is
     * still loading, instead of a dead-looking page. Appears after a short
     * delay so instant loads never flash it. */
    shimmer: function(){
      try{
        api.shimmerClear();
        skelTimer = setTimeout(function(){
          skelTimer = null;
          var host = document.querySelector('.tool-section .tool-panel') ||
                     document.querySelector('.tool-section') ||
                     document.getElementById('main');
          if(!host){ return; }
          var cs = window.getComputedStyle ? window.getComputedStyle(host) : null;
          if(cs && cs.position === 'static'){ host.classList.add(NS + '-skel-host'); }
          skelEl = document.createElement('div');
          skelEl.className = NS + '-skel';
          skelEl.setAttribute('aria-hidden', 'true');
          skelEl.innerHTML =
            '<div class="' + NS + '-skel-row" style="width:62%"></div>' +
            '<div class="' + NS + '-skel-row" style="width:88%"></div>' +
            '<div class="' + NS + '-skel-row" style="width:74%"></div>' +
            '<div class="' + NS + '-skel-btn"></div>';
          host.appendChild(skelEl);
        }, 400);
      }catch(e){}
      return api;
    },

    shimmerClear: function(){
      try{
        if(skelTimer){ clearTimeout(skelTimer); skelTimer = null; }
        if(skelEl && skelEl.parentNode){ skelEl.parentNode.removeChild(skelEl); }
        skelEl = null;
        var hosts = document.querySelectorAll('.' + NS + '-skel-host');
        for(var i = 0; i < hosts.length; i++){ hosts[i].classList.remove(NS + '-skel-host'); }
      }catch(e){}
      return api;
    },

    /* Result summary card, e.g. "12 pages • 2.4 MB → 1.1 MB".
     * Inserts the card right after targetEl (usually the status element),
     * replacing any earlier summary in the same container. */
    summary: function(targetEl, html){
      try{
        if(!targetEl || !targetEl.parentNode){ return api; }
        var parent = targetEl.parentNode;
        var olds = parent.querySelectorAll('.' + NS + '-summary');
        for(var i = 0; i < olds.length; i++){
          if(olds[i].parentNode){ olds[i].parentNode.removeChild(olds[i]); }
        }
        var card = document.createElement('div');
        card.className = NS + '-summary';
        card.setAttribute('role', 'status');
        card.innerHTML =
          '<svg class="' + NS + '-summary-ico" viewBox="0 0 24 24" aria-hidden="true">' +
            '<circle cx="12" cy="12" r="10" fill="#0d6e5f"/>' +
            '<path d="M8 12.5l2.6 2.6L16 9.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
          '<div class="' + NS + '-summary-txt">' + String(html == null ? '' : html) + '</div>';
        if(targetEl.nextSibling){
          parent.insertBefore(card, targetEl.nextSibling);
        } else {
          parent.appendChild(card);
        }
      }catch(e){}
      return api;
    }
  };

  window.QTProgress = api;
})();
