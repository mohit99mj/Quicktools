/* ==========================================================================
   motion.js — QuickTools auto-enhancing scroll-reveal (Improvement Pass 2)
   No HTML markup changes required on any page. Fully defensive: no errors
   when targets are missing, when IntersectionObserver is unavailable, or when
   the user prefers reduced motion.
   ========================================================================== */
(function () {
  'use strict';

  function init() {
    var targets;
    try {
      targets = document.querySelectorAll('main .tool-card, main .card, main section');
    } catch (e) {
      return;
    }
    if (!targets || !targets.length) return;

    var reduced = false;
    try {
      reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { /* ignore */ }

    var i, el;
    for (i = 0; i < targets.length; i++) {
      el = targets[i];
      el.classList.add('reveal');
      /* Stagger: transition-delay from the element's index among the reveal
         targets that share its parent (capped so it never drags on). */
      try {
        var sibs = el.parentNode
          ? el.parentNode.querySelectorAll(':scope > .reveal')
          : null;
        var idx = 0;
        if (sibs) {
          for (var j = 0; j < sibs.length; j++) {
            if (sibs[j] === el) { idx = j; break; }
          }
        }
        el.style.transitionDelay = Math.min(idx, 8) * 45 + 'ms';
      } catch (e) { /* ignore */ }
    }

    function clearDelay(el) {
      /* Hover lifts must not inherit the reveal stagger — drop it after the
         reveal finishes (transitionend) or after a safety timeout. */
      var done = false;
      function clear() {
        if (done) return;
        done = true;
        try { el.style.transitionDelay = '0ms'; } catch (e) { /* ignore */ }
      }
      try { el.addEventListener('transitionend', clear); } catch (e) { /* ignore */ }
      setTimeout(clear, 1400);
    }

    if (reduced || !('IntersectionObserver' in window)) {
      /* Reduced motion or no observer support: show everything, no stagger. */
      for (i = 0; i < targets.length; i++) {
        targets[i].classList.add('in');
        targets[i].style.transitionDelay = '0ms';
      }
      return;
    }

    var io;
    try {
      io = new IntersectionObserver(function (entries) {
        for (var k = 0; k < entries.length; k++) {
          var en = entries[k];
          if (en.isIntersecting) {
            en.target.classList.add('in');
            clearDelay(en.target);
            try { io.unobserve(en.target); } catch (e) { /* ignore */ }
          }
        }
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    } catch (e) {
      for (i = 0; i < targets.length; i++) { targets[i].classList.add('in'); }
      return;
    }
    for (i = 0; i < targets.length; i++) {
      try { io.observe(targets[i]); } catch (e) { /* ignore */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
