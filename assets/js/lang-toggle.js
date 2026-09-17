/* =========================================================================
   lang-toggle.js
   Site-wide ES/EN toggle for Latent Frontiers.
   No external dependencies. Toggles [data-lang] content blocks (English
   ones ship with a `hidden` attribute by default so there's no
   flash-of-both-languages before this script runs) and relabels the
   navbar links. Blog posts are Spanish-only and carry no [data-lang]
   markup, so this only relabels their navbar on those pages.
   ========================================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'lf-site-lang';

  var NAV_LABELS = {
    'index.html': { es: 'Inicio', en: 'Home' },
    'writings.html': { es: 'Escritos', en: 'Writings' },
    'about.html': { es: 'Acerca de', en: 'About' },
    'cv.html': { es: 'CV', en: 'CV' }
  };

  function getStoredLang() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === 'en' || stored === 'es' ? stored : null;
    } catch (err) {
      return null;
    }
  }

  function storeLang(lang) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (err) {
      /* localStorage unavailable (private mode, etc.): language stays
         scoped to this page load. */
    }
  }

  function linkPageKey(link) {
    var href = link.getAttribute('href') || '';
    if (href.indexOf('#lang-toggle') !== -1) { return null; }
    var pathPart = href.split('#')[0].split('?')[0];
    var segments = pathPart.split('/');
    var last = segments[segments.length - 1];
    return last === '' ? 'index.html' : last;
  }

  function applyLang(lang) {
    lang = lang === 'en' ? 'en' : 'es';

    var blocks = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].hidden = blocks[i].getAttribute('data-lang') !== lang;
    }

    var navLinks = document.querySelectorAll('.navbar-nav .nav-link');
    for (var n = 0; n < navLinks.length; n++) {
      var key = linkPageKey(navLinks[n]);
      var labels = key && NAV_LABELS[key];
      if (!labels) { continue; }
      var textEl = navLinks[n].querySelector('.menu-text') || navLinks[n];
      textEl.textContent = labels[lang];
    }

    var toggle = document.querySelector('a[href$="#lang-toggle"]');
    if (toggle) {
      var target = lang === 'es' ? 'en' : 'es';
      var toggleText = toggle.querySelector('.menu-text') || toggle;
      toggleText.textContent = target.toUpperCase();
      toggle.setAttribute('aria-label', lang === 'es'
        ? 'Cambiar a inglés'
        : 'Switch to Spanish');
    }

    document.documentElement.setAttribute('lang', lang);
    storeLang(lang);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.querySelector('a[href$="#lang-toggle"]');
    var current = getStoredLang() || 'es';

    if (toggle) {
      toggle.addEventListener('click', function (evt) {
        evt.preventDefault();
        current = current === 'es' ? 'en' : 'es';
        applyLang(current);
      });
    }

    applyLang(current);
  });
})();
