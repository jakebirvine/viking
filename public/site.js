/* ==========================================================================
   site.js — page behaviour: nav, reveals, stage rail, gallery, quote form.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     CONFIG — change these five lines and the whole site updates.
     ====================================================================== */
  var CONFIG = {
    business: 'Viking Landscapes',                 // appears in the quote email subject/body
    phone:    '0416 720 401',                      // display format
    phoneIntl:'+61416720401',                      // dialable format
    email:    'quotes@example.com.au',             // PLACEHOLDER: real inbox
    instagram:'https://instagram.com/',            // PLACEHOLDER: real profile URL
    facebook: 'https://facebook.com/'              // PLACEHOLDER: real page URL
  };
  /* ==================================================================== */

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ------------------------------------------------- hydrate contact info */
  $$('[data-phone]').forEach(function (el) { el.textContent = CONFIG.phone; });
  $$('[data-email]').forEach(function (el) { el.textContent = CONFIG.email; });
  $$('[data-tel]').forEach(function (el) { el.href = 'tel:' + CONFIG.phoneIntl; });
  $$('[data-mailto]').forEach(function (el) { el.href = 'mailto:' + CONFIG.email; });
  $$('[data-insta]').forEach(function (el) { el.href = CONFIG.instagram; el.target = '_blank'; });
  $$('[data-fb]').forEach(function (el) { el.href = CONFIG.facebook; el.target = '_blank'; });
  var yr = $('#year'); if (yr) yr.textContent = new Date().getFullYear();

  /* --------------------------------------------------------------- header */
  var head = $('#siteHead');
  var bar = $('#headProgress');
  var burger = $('#burger');
  var nav = $('#nav');

  burger.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $$('#nav a').forEach(function (a) {
    a.addEventListener('click', function () {
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      nav.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
      burger.focus();
    }
  });

  function onScroll() {
    var y = window.scrollY;
    head.classList.toggle('stuck', y > 30);
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (bar) bar.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
    $('#stageRail').classList.toggle('on', y > window.innerHeight * 0.55);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ------------------------------------------------------- reveal on view */
  var reveals = $$('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var sibs = Array.prototype.slice.call(en.target.parentNode.children).indexOf(en.target);
        en.target.style.transitionDelay = Math.min(sibs, 6) * 60 + 'ms';
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------ active nav link */
  var links = $$('#nav a[href^="#"]').filter(function (a) { return a.getAttribute('href').length > 1; });
  var sections = links.map(function (a) { return $(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    var navIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) {
          a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { navIO.observe(s); });
  }

  /* -------------------------------------------- stage rail + live process */
  var railItems = $$('#stageRail li');
  var stepCards = $$('.step');
  function setStage(i) {
    railItems.forEach(function (li, n) {
      li.classList.toggle('on', n === i);
      li.classList.toggle('done', n < i);
    });
    stepCards.forEach(function (c, n) { c.classList.toggle('live', n === i); });
  }
  window.addEventListener('scenestage', function (e) { setStage(e.detail.stage); });
  setStage(window.Scene ? window.Scene.state.stage : 0);

  /* --------------------------------------------------------- stat counter */
  var statsWrap = $('.stats');
  if (statsWrap && 'IntersectionObserver' in window && !reduce) {
    var sIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        $$('[data-count]', en.target).forEach(function (el) {
          var end = parseFloat(el.getAttribute('data-count'));
          var suffix = el.getAttribute('data-suffix') || '';
          var t0 = performance.now(), dur = 1100;
          (function tick(now) {
            var k = Math.min((now - t0) / dur, 1);
            var e2 = 1 - Math.pow(1 - k, 3);
            el.textContent = Math.round(end * e2) + suffix;
            if (k < 1) requestAnimationFrame(tick);
          })(t0);
        });
        sIO.disconnect();
      });
    }, { threshold: 0.4 });
    sIO.observe(statsWrap);
  }

  /* ------------------------------------------------------------- gallery
     Drop real photos into public/img/ using the filenames in data-src and
     they replace the dashed placeholders automatically.                    */
  $$('.shot-img[data-src]').forEach(function (el) {
    var src = el.getAttribute('data-src');
    var img = new Image();
    img.onload = function () {
      el.style.backgroundImage = 'url("' + src + '")';
      el.classList.add('has-img');
    };
    img.src = src;
  });

  /* ------------------------------------------------------------ the form */
  var form = $('#quoteForm');
  if (!form) return;

  var sentBox = $('#sentBox');
  var sentPre = $('#sentPre');

  function fieldOf(el) { return el.closest('.field'); }
  function setErr(el, msg) {
    var f = fieldOf(el);
    if (!f) return;
    f.classList.toggle('invalid', !!msg);
    var e = $('[data-err]', f);
    if (e) e.textContent = msg || '';
  }

  var PHONE_RE = /^(\+?61|0)[\s-]?[2-478](?:[\s-]?\d){8}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validate() {
    var ok = true;

    [['name', 'Let us know who to ask for.'],
     ['suburb', 'Which suburb is the job in?']].forEach(function (pair) {
      var el = form.elements[pair[0]];
      var v = el.value.trim();
      if (!v) { setErr(el, pair[1]); ok = false; } else setErr(el, '');
    });

    var ph = form.elements.phone, phv = ph.value.trim();
    if (!phv) { setErr(ph, 'We need a number to call you back on.'); ok = false; }
    else if (!PHONE_RE.test(phv.replace(/[()]/g, ''))) { setErr(ph, "That doesn't look like an Australian number."); ok = false; }
    else setErr(ph, '');

    var em = form.elements.email, emv = em.value.trim();
    if (!emv) { setErr(em, 'We send the written quote here.'); ok = false; }
    else if (!EMAIL_RE.test(emv)) { setErr(em, 'Check that email address.'); ok = false; }
    else setErr(em, '');

    var picked = $$('input[name="service"]:checked', form);
    var fs = $('fieldset.field', form);
    fs.classList.toggle('invalid', picked.length === 0);
    $('[data-err]', fs).textContent = picked.length ? '' : 'Pick at least one — "Not sure yet" is fine.';
    if (!picked.length) ok = false;

    return ok;
  }

  form.addEventListener('input', function (e) {
    if (e.target.closest('.field.invalid')) validate();
  });

  function buildMessage() {
    var f = form.elements;
    var services = $$('input[name="service"]:checked', form).map(function (i) { return i.value; }).join(', ');
    var lines = [
      'QUOTE REQUEST — ' + CONFIG.business,
      '',
      'Name:     ' + f.name.value.trim(),
      'Mobile:   ' + f.phone.value.trim(),
      'Email:    ' + f.email.value.trim(),
      'Suburb:   ' + f.suburb.value.trim(),
      '',
      'Work needed: ' + services,
      'Rough size:  ' + (f.size.value || 'Not sure'),
      'Timing:      ' + (f.timing.value || 'Flexible'),
      '',
      'Details:',
      (f.details.value.trim() || '(none given)'),
      '',
      '— Sent from the website quote form on ' + new Date().toLocaleString('en-AU')
    ];
    return {
      subject: 'Free quote request — ' + f.name.value.trim() + ', ' + f.suburb.value.trim(),
      body: lines.join('\n')
    };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) {
      var bad = $('.field.invalid', form);
      if (bad) {
        bad.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        var inp = $('input,select,textarea', bad);
        if (inp) inp.focus({ preventScroll: true });
      }
      return;
    }

    var msg = buildMessage();
    var href = 'mailto:' + CONFIG.email +
               '?subject=' + encodeURIComponent(msg.subject) +
               '&body=' + encodeURIComponent(msg.body);

    // open the user's mail client
    var a = document.createElement('a');
    a.href = href;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    sentPre.textContent = msg.body;
    $('#smsBtn').href = 'sms:' + CONFIG.phoneIntl + '?body=' + encodeURIComponent(msg.body);
    sentBox.hidden = false;
    sentBox.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  });

  $('#copyBtn').addEventListener('click', function () {
    var btn = this, txt = sentPre.textContent;
    var done = function () {
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = 'Copy the details'; }, 2200);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(done, fallback);
    } else fallback();

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (err) { btn.textContent = 'Select the text below'; }
      document.body.removeChild(ta);
    }
  });

  $('#resetBtn').addEventListener('click', function () {
    form.reset();
    $$('.field', form).forEach(function (f) { f.classList.remove('invalid'); });
    sentBox.hidden = true;
    form.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
})();
