/* core.js */
/* Tandem front end, core: storage, learner, theme, progress and sync, search, glossary cards, helpers.
   Plain JavaScript, no libraries. Never write a decrement operator or a double hyphen in these files. */
(function () {
  'use strict';
  var T = window.TANDEM || {};
  var TD = window.Tandem = {};
  var $ = TD.$ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = TD.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var body = document.body;
  TD.root = body.getAttribute('data-root') || '';
  TD.server = location.protocol === 'http:' || location.protocol === 'https:';
  TD.data = T;

  var store = TD.store = {
    get: function (k, d) { try { var v = localStorage.getItem('tandem.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('tandem.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var esc = TD.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  TD.undash = function (s) { return String(s).replace(/\s*\u2014\s*/g, ', ').replace(/(\d)\s*\u2013\s*(\d)/g, '$1 to $2').replace(/\s*\u2013\s*/g, ', '); };

  /* a tiny event bus */
  var subs = {};
  TD.on = function (ev, fn) { (subs[ev] = subs[ev] || []).push(fn); };
  TD.emit = function (ev, x) { (subs[ev] || []).forEach(function (fn) { try { fn(x); } catch (e) { if (window.console) { console.error(e); } } }); };

  /* learners: Piyush writes C++, Shubhi writes Java */
  var LEARNERS = { piyush: { id: 'piyush', name: 'Piyush', lang: 'cpp', langName: 'C++' }, shubhi: { id: 'shubhi', name: 'Shubhi', lang: 'java', langName: 'Java' } };
  TD.LEARNERS = LEARNERS;
  (function () {   /* URL hooks for screenshots and tests: ?learner=shubhi&theme=night */
    var m = /learner=(piyush|shubhi)/.exec(location.search); if (m) { store.set('learner', m[1]); }
    var t = /theme=(light|paper|night|black|auto)/.exec(location.search); if (t) { store.set('theme', t[1]); }
  })();
  TD.learner = function () { var l = store.get('learner', 'piyush'); return LEARNERS[l] ? l : 'piyush'; };
  TD.who = function (id) { return LEARNERS[id || TD.learner()]; };
  TD.lang = function () { return TD.who().lang; };
  function applyClasses() {
    var d = document.documentElement;
    var keep = d.className.split(/\s+/).filter(function (c) { return c && c.indexOf('l-') !== 0 && c.indexOf('t-') !== 0; });
    keep.push('t-' + realTheme(themeChoice()));
    keep.push('l-' + TD.learner());
    d.className = keep.join(' ');
  }
  TD.setLearner = function (id) {
    if (!LEARNERS[id] || id === TD.learner()) { return; }
    store.set('learner', id);
    applyClasses();
    paintLearner();
    TD.emit('learner', id);
    if (TD.server) { pullProgress(); }
  };
  function paintLearner() {
    $$('[data-learner]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-learner') === TD.learner()); });
  }
  $$('[data-learner]').forEach(function (b) { b.addEventListener('click', function () { TD.setLearner(b.getAttribute('data-learner')); TD.toast(TD.who().name + ' is learning now, in ' + TD.who().langName + '.'); }); });

  /* themes */
  var THEMES = ['light', 'paper', 'night', 'black'];
  function themeChoice() { var t = store.get('theme', 'auto'); return t === 'auto' || THEMES.indexOf(t) >= 0 ? t : 'auto'; }
  function realTheme(t) { if (THEMES.indexOf(t) >= 0) { return t; } return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'light'; }
  function paintTheme() { $$('[data-theme-set]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-theme-set') === themeChoice()); }); }
  var pop = $('#themepop');
  $$('[data-theme-menu]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); pop.hidden = !pop.hidden; }); });
  $$('[data-theme-set]').forEach(function (b) { b.addEventListener('click', function () { store.set('theme', b.getAttribute('data-theme-set')); applyClasses(); paintTheme(); }); });
  document.addEventListener('click', function (e) { if (pop && !pop.hidden && !e.target.closest('.themes')) { pop.hidden = true; } });
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (themeChoice() === 'auto') { applyClasses(); } }); } catch (e) {}

  /* toast */
  var toastTimer = 0;
  TD.toast = function (msg) {
    var t = $('#toast'); if (!t) { return; }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  };

  /* progress, kept per learner in this browser and mirrored to the local server */
  var KEYS = ['done', 'mcq', 'prob', 'test', 'theory', 'ans'];
  /* a removal is stored as a timestamped tombstone so that it wins over older copies when browser and server merge */
  TD.prog = function (kind, who) {
    var p = store.get(kind + '.' + (who || TD.learner()), {}), out = {};
    Object.keys(p).forEach(function (k) { var v = p[k]; if (!(v && typeof v === 'object' && v.gone)) { out[k] = v; } });
    return out;
  };
  TD.setProg = function (kind, key, val, who) {
    who = who || TD.learner();
    var p = store.get(kind + '.' + who, {});
    p[key] = val === null ? { gone: true, ts: Date.now() } : val;
    store.set(kind + '.' + who, p);
    queuePush(who);
    TD.emit('progress', kind);
  };
  var pushTimer = {};
  function queuePush(who) {
    if (!TD.server) { return; }
    clearTimeout(pushTimer[who]);
    pushTimer[who] = setTimeout(function () {
      var data = {}; KEYS.forEach(function (k) { data[k] = store.get(k + '.' + who, {}); });
      TD.api('progress', { user: who, data: data }).catch(function () {});
    }, 900);
  }
  function merge(a, b) {   /* newest timestamp wins, key by key */
    var out = {}, k;
    for (k in a) { if (Object.prototype.hasOwnProperty.call(a, k)) { out[k] = a[k]; } }
    for (k in b) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) { continue; }
      var x = out[k], y = b[k];
      var tx = x && typeof x === 'object' ? (x.ts || 0) : (typeof x === 'number' ? x : 0);
      var ty = y && typeof y === 'object' ? (y.ts || 0) : (typeof y === 'number' ? y : 0);
      if (x === undefined || ty >= tx) { out[k] = y; }
    }
    return out;
  }
  function pullProgress() {
    ['piyush', 'shubhi'].forEach(function (who) {
      if (TD.static) { return; }
      fetch(TD.root + 'api/progress?user=' + who).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (!j || !j.data) { return; }
        var changed = false;
        KEYS.forEach(function (k) {
          var mine = store.get(k + '.' + who, {}), theirs = j.data[k] || {};
          var m = merge(mine, theirs);
          if (JSON.stringify(m) !== JSON.stringify(mine)) { store.set(k + '.' + who, m); changed = true; }
          if (JSON.stringify(m) !== JSON.stringify(theirs)) { queuePush(who); }
        });
        if (changed) { TD.emit('progress', 'sync'); }
      }).catch(function () {});
    });
  }
  TD.pullProgress = pullProgress;

  /* lesson statistics used by the hub, the section home, track pages and the progress page */
  TD.lessons = T.lessons || [];
  TD.lessonBySlug = {};
  TD.lessons.forEach(function (l) { TD.lessonBySlug[l.slug] = l; });
  TD.trackOrder = function (who) { var l = LEARNERS[who || TD.learner()].lang; return [l, 'core']; };
  TD.stats = function (who) {
    who = who || TD.learner();
    var done = TD.prog('done', who), mcq = TD.prog('mcq', who), prob = TD.prog('prob', who);
    var s = { total: 0, done: 0, byTrack: {}, byMod: {}, mcqRight: 0, mcqAll: 0, solved: 0, tried: 0 };
    var mine = LEARNERS[who].lang;
    TD.lessons.forEach(function (l) {
      if (l.track !== 'core' && l.track !== mine) { return; }
      var key = l.track + '-' + l.module;
      s.byTrack[l.track] = s.byTrack[l.track] || [0, 0];
      s.byMod[key] = s.byMod[key] || [0, 0];
      s.byTrack[l.track][1] += 1; s.byMod[key][1] += 1; s.total += 1;
      if (done[l.slug]) { s.byTrack[l.track][0] += 1; s.byMod[key][0] += 1; s.done += 1; }
    });
    TD.lessons.forEach(function (l) {   /* the other refresher still gets its own bar */
      if (l.track === 'core' || l.track === mine) { return; }
      s.byTrack[l.track] = s.byTrack[l.track] || [0, 0];
      s.byMod[l.track + '-' + l.module] = s.byMod[l.track + '-' + l.module] || [0, 0];
      s.byTrack[l.track][1] += 1; s.byMod[l.track + '-' + l.module][1] += 1;
      if (done[l.slug]) { s.byTrack[l.track][0] += 1; s.byMod[l.track + '-' + l.module][0] += 1; }
    });
    Object.keys(mcq).forEach(function (k) { s.mcqAll += 1; if (mcq[k].ok) { s.mcqRight += 1; } });
    Object.keys(prob).forEach(function (k) { if (prob[k].st === 'solved') { s.solved += 1; } else { s.tried += 1; } });
    s.pct = s.total ? Math.round(100 * s.done / s.total) : 0;
    return s;
  };
  TD.nextLesson = function (who) {
    who = who || TD.learner();
    var done = TD.prog('done', who), order = TD.trackOrder(who);
    for (var o = 0; o < order.length; o += 1) {
      for (var i = 0; i < TD.lessons.length; i += 1) {
        var l = TD.lessons[i];
        if (l.track === order[o] && !done[l.slug]) { return l; }
      }
    }
    return null;
  };

  /* calls to the local server */
  TD.static = body.hasAttribute('data-static');     /* the online copy: no local server behind it */
  TD.api = function (path, data) {
    if (TD.static) { return Promise.reject(new Error('This needs the Tandem app on the laptop.')); }
    return fetch(TD.root + 'api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tandem': '1' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('The server answered ' + r.status)); e.status = r.status; e.data = j; throw e; } return j; }); });
  };
  TD.getJSON = function (path) {
    if (TD.static) { return Promise.reject(new Error('This needs the Tandem app on the laptop.')); }
    return fetch(TD.root + 'api/' + path).then(function (r) { return r.json().then(function (j) { if (!r.ok) { throw new Error(j.error || 'request failed'); } return j; }); });
  };
  TD.offlineText = 'Tandem\'s helpers live in the small Tandem server on this Mac. Double click <code>Open Tandem.command</code> in the Tandem folder: it opens the site at <code>http://127.0.0.1:8766</code> with Navigator, Logbook, Bar Raiser and the code runner switched on.';

  /* markdown for AI answers: code fences, headings, lists, tables, bold, italics, inline code */
  TD.md = function (src) {
    src = TD.undash(String(src || ''));
    var parts = src.split(/```/), out = [];
    parts.forEach(function (part, i) {
      if (i % 2 === 1) {
        var nl = part.indexOf('\n'), lang = nl > 0 ? part.slice(0, nl).trim().toLowerCase() : '', code = nl > 0 ? part.slice(nl + 1) : part;
        lang = { 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp' }[lang] || lang;
        out.push('<pre><code>' + (TD.highlight ? TD.highlight(code.replace(/\n$/, ''), lang) : esc(code)) + '</code></pre>');
      } else { out.push(mdBlocks(part)); }
    });
    return out.join('');
  };
  function inline(t) {
    return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  }
  function mdBlocks(s) {
    var lines = s.split('\n'), out = [], list = null, table = [], para = [];
    function flushPara() { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } }
    function flushList() { if (list) { out.push('</' + list + '>'); list = null; } }
    function flushTable() {
      if (!table.length) { return; }
      var rows = table.filter(function (r) { return !/^\|?[\s:|]*$/.test(r.replace(/-/g, '')); });
      out.push('<table>' + rows.map(function (r, i) {
        var cells = r.replace(/^\|/, '').replace(/\|$/, '').split('|');
        return '<tr>' + cells.map(function (c) { return (i ? '<td>' : '<th>') + inline(c.trim()) + (i ? '</td>' : '</th>'); }).join('') + '</tr>';
      }).join('') + '</table>');
      table = [];
    }
    lines.forEach(function (ln) {
      var m;
      if (/^\s*\|.*\|\s*$/.test(ln)) { flushPara(); flushList(); table.push(ln.trim()); return; }
      flushTable();
      if ((m = ln.match(/^\s*[\-*•]\s+(.*)/))) { flushPara(); if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      if ((m = ln.match(/^#{1,4}\s+(.*)/))) { flushPara(); flushList(); out.push('<h4>' + inline(m[1]) + '</h4>'); return; }
      if ((m = ln.match(/^>\s?(.*)/))) { flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); return; }
      if (!ln.trim()) { flushPara(); flushList(); return; }
      if (list && /^\s{2,}\S/.test(ln)) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ' ' + inline(ln.trim()) + '</li>'); return; }
      flushList(); para.push(ln.trim());
    });
    flushPara(); flushList(); flushTable();
    return out.join('');
  }

  /* active nav link */
  (function () {
    var page = location.pathname.split('/').pop() || 'index.html';
    var map = { 'practice.html': 'practice.html', 'interview.html': 'interview.html', 'logbook.html': 'logbook.html', 'speak.html': 'speak.html' };
    var on = map[page] || (/^(p|t|d|test)-/.test(page) ? 'practice.html' : 'index.html');
    $$('.mainnav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === on && body.getAttribute('data-section')); });
  })();

  /* search over lessons, problems, theory and the glossary */
  var q = $('#q'), res = $('#results');
  function norm(s) { return String(s || '').toLowerCase(); }
  function search(text) {
    var t = norm(text).trim(); if (t.length < 2) { return []; }
    var words = t.split(/\s+/), out = [];
    function score(fields) {
      var s = 0;
      words.forEach(function (w) {
        var hit = false;
        fields.forEach(function (f) { if (!hit && norm(f[0]).indexOf(w) >= 0) { s += f[1]; hit = true; } });
        if (!hit) { s -= 6; }
      });
      return s;
    }
    TD.lessons.forEach(function (l) {
      var s = score([[l.title, 9], [l.summary, 4], [l.text, 1.5]]);
      if (norm(l.title).indexOf(t) >= 0) { s += 6; }
      if (s > 1) {
        var i = norm(l.text).indexOf(words[0]), snip = l.summary;
        if (norm(l.title).indexOf(words[0]) < 0 && i >= 0) { snip = (i > 40 ? '...' : '') + l.text.slice(Math.max(0, i - 40), i + 110) + '...'; }
        var trk = { core: 'Lesson', cpp: 'C++', java: 'Java' }[l.track];
        out.push({ s: s, kind: trk + ' ' + l.module + '.' + l.num, title: l.title, sub: snip, href: l.slug + '.html' });
      }
    });
    (T.problems || []).forEach(function (p) {
      var s = score([[p.title, 9], [p.tags.join(' '), 4], [p.kind, 2]]);
      if (s > 1) { out.push({ s: s + 1, kind: 'Problem', title: p.title, sub: (T.kinds || {})[p.kind] + ', ' + p.difficulty, href: 'p-' + p.slug + '.html' }); }
    });
    (T.theory || []).forEach(function (th) {
      th.qs.forEach(function (x) {
        var s = score([[x.q, 3]]);
        if (s > 1) { out.push({ s: s - 1, kind: 'Question', title: x.q, sub: th.title, href: 't-' + th.slug + '.html#' + th.slug + '-' + x.n }); }
      });
    });
    var G = T.glossary || {};
    Object.keys(G).forEach(function (k) {
      var e = G[k], s = score([[e.term + ' ' + (e.aliases || ''), 8], [e.def, 1]]);
      if (norm(e.term).indexOf(t) === 0) { s += 6; }
      if (s > 2) { out.push({ s: s, kind: 'Term', title: e.term, sub: e.def, href: 'glossary.html#' + k }); }
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, 14);
  }
  var sel = -1;
  if (q && res) {
    q.addEventListener('input', function () {
      var r = search(q.value); sel = -1;
      if (!q.value.trim()) { res.hidden = true; return; }
      res.innerHTML = r.length ? r.map(function (x) {
        return '<a href="' + x.href + '"><span class="rk">' + esc(x.kind) + '</span><span class="rt">' + esc(x.title) + '</span><span class="rs">' + esc(x.sub) + '</span></a>';
      }).join('') : '<div class="empty">Nothing yet. Try another word, or ask Navigator.</div>';
      res.hidden = false;
    });
    q.addEventListener('keydown', function (e) {
      var items = $$('a', res);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
        items.forEach(function (a, i) { a.classList.toggle('sel', i === sel); });
      } else if (e.key === 'Enter' && items.length) { location.href = items[Math.max(sel, 0)].href; }
      else if (e.key === 'Escape') { res.hidden = true; q.blur(); }
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) { res.hidden = true; } });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); q.focus(); }
    });
  }

  /* glossary cards on dotted words */
  var card = null;
  function closeCard() { if (card) { card.remove(); card = null; } }
  $$('a.term').forEach(function (a) {
    function show(ev) {
      var e = (T.glossary || {})[a.getAttribute('data-term')];
      if (!e) { return; }
      closeCard();
      card = document.createElement('div');
      card.className = 'termcard';
      card.innerHTML = '<b>' + esc(e.term) + '</b>' + esc(e.def) +
        ((e.java || e.cpp) ? '<div class="tl2">' + (e.cpp ? '<span><strong>C++</strong> ' + esc(e.cpp) + '</span>' : '') + (e.java ? '<span><strong>Java</strong> ' + esc(e.java) + '</span>' : '') + '</div>' : '') +
        '<a href="' + a.getAttribute('href') + '">Open in the glossary</a>';
      document.body.appendChild(card);
      var r = a.getBoundingClientRect(), w = Math.min(360, window.innerWidth - 24);
      card.style.maxWidth = w + 'px';
      card.style.left = Math.max(12, Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - w - 12)) + 'px';
      card.style.top = (window.scrollY + r.bottom + 8) + 'px';
      card.dataset.k = a.getAttribute('data-term');
      if (ev) { ev.preventDefault(); }
    }
    a.addEventListener('click', function (ev) { if (card && card.dataset.k === a.getAttribute('data-term')) { return; } show(ev); });
    a.addEventListener('mouseenter', function () { if (window.matchMedia('(hover: hover)').matches) { show(); } });
  });
  document.addEventListener('click', function (e) { if (card && !e.target.closest('.termcard') && !e.target.closest('a.term')) { closeCard(); } });
  window.addEventListener('scroll', function () { if (card && window.matchMedia('(hover: hover)').matches) { closeCard(); } }, { passive: true });

  /* boot */
  applyClasses();
  paintLearner();
  paintTheme();
  TD.ready = function (fn) { if (document.readyState !== 'loading') { setTimeout(fn, 0); } else { document.addEventListener('DOMContentLoaded', fn); } };
  if (TD.server) { TD.ready(pullProgress); }
})();

/* panel.js */
/* Tandem front end, the side panel: Navigator (ask anything), Logbook (notes) and Bar Raiser (tests and mocks).
   One thread of each per learner, on the local server. Voice input is transcribed on this Mac. */
(function () {
  'use strict';
  var TD = window.Tandem, $ = TD.$, $$ = TD.$$, esc = TD.esc, store = TD.store, body = document.body;
  var panel = $('#panel'); if (!panel) { return; }
  var input = $('#pinput'), send = $('#psend'), form = $('#pform');
  var logs = { navigator: $('#log-navigator'), logbook: $('#log-logbook'), barraiser: $('#log-barraiser') };
  var loadedFor = {}, busy = {}, viaVoice = false;
  var slug = body.getAttribute('data-slug') || '', pageTitle = body.getAttribute('data-title') || '';
  var NAME = { navigator: 'Navigator', logbook: 'Logbook', barraiser: 'Bar Raiser' };
  var PH = {
    navigator: 'Ask anything: a line you did not follow, why some code is unsafe, what an interviewer means. Enter sends, Shift Enter makes a new line.',
    logbook: 'Note it, "revise later: ...", "doubt: ...", "mistake: ...", "interview line: ...", or ask "what did I note about memory orders?"',
    barraiser: 'Ask to be tested ("quiz me on condition variables"), answer a question, or start a mock round.'
  };

  function tab() { var t = store.get('panel.tab', 'navigator'); return logs[t] ? t : 'navigator'; }
  function width() { var w = store.get('panel.width', 0) || Math.round(window.innerWidth * 0.4); return Math.max(360, Math.min(w, Math.round(window.innerWidth * 0.66))); }
  function layout() {
    var top = $('.top');   /* the page makes room for the panel; the top bar keeps its full width */
    if (top) { top.style.marginRight = ''; }
    if (panel.hidden) { body.style.paddingRight = ''; body.classList.remove('panel-open'); return; }
    if (window.innerWidth < 1050) { panel.style.width = '100vw'; body.style.paddingRight = ''; body.classList.add('panel-open'); return; }
    var w = width(); panel.style.width = w + 'px'; body.style.paddingRight = w + 'px'; body.classList.add('panel-open');
    if (top) { top.style.marginRight = (0 - w) + 'px'; }
  }
  function paintCtx() {
    var who = TD.who();
    $('#pthread').textContent = who.name + '\'s ' + NAME[tab()] + ' · ' + who.langName;
    $('#pwhere').textContent = pageTitle ? 'On: ' + pageTitle : '';
  }

  TD.addMsg = addMsg;
  function addMsg(t, kind, html, by, raw) {
    var d = document.createElement('div');
    d.className = 'msg ' + kind;
    var head = by ? '<span class="by">' + esc(by) + (kind === 'ai' && raw ? '<button class="speak" type="button">Read aloud</button>' : '') + '</span>' : '';
    d.innerHTML = head + '<div class="mbody">' + html + '</div>';
    var sp = $('.speak', d); if (sp) { sp.addEventListener('click', function () { speak(raw, sp); }); }
    logs[t].appendChild(d);
    logs[t].scrollTop = logs[t].scrollHeight;
    return d;
  }
  function thinking(t, label) {
    var t0 = Date.now();
    var m = addMsg(t, 'ai', '<div class="thinking"><i></i><i></i><i></i><span>' + esc(label) + ' <b data-secs>0</b>s</span></div>', NAME[t]);
    var timer = setInterval(function () { var b = $('[data-secs]', m); if (b) { b.textContent = Math.round((Date.now() - t0) / 1000); } }, 1000);
    return function () { clearInterval(timer); m.remove(); };
  }
  function offline(t, extra) { addMsg(t, 'sys', (extra ? esc(extra) + '<br>' : '') + TD.offlineText); }

  /* read aloud with the browser's own voice */
  var speaking = null;
  function speak(text, btn) {
    if (!window.speechSynthesis) { return; }
    window.speechSynthesis.cancel();
    if (speaking === btn) { speaking = null; btn.classList.remove('on'); btn.textContent = 'Read aloud'; return; }
    $$('.speak.on').forEach(function (b) { b.classList.remove('on'); b.textContent = 'Read aloud'; });
    var clean = String(text).replace(/```[\s\S]*?```/g, ' (code shown on screen) ').replace(/[*`#|>]/g, ' ').replace(/\s+/g, ' ');
    var u = new SpeechSynthesisUtterance(clean), voices = window.speechSynthesis.getVoices();
    var v = voices.filter(function (x) { return x.lang === 'en-IN'; })[0] || voices.filter(function (x) { return /^en/.test(x.lang); })[0];
    if (v) { u.voice = v; }
    u.onend = function () { if (speaking === btn) { speaking = null; if (btn) { btn.classList.remove('on'); btn.textContent = 'Read aloud'; } } };
    speaking = btn; if (btn) { btn.classList.add('on'); btn.textContent = 'Stop reading'; }
    window.speechSynthesis.speak(u);
  }

  /* open, close, resize, tabs */
  function open(t, prefill, autosend) {
    var was = !panel.hidden;
    if (t && logs[t]) { switchTab(t, true); }
    panel.hidden = false;
    if (!was) { body.classList.add('panel-anim'); setTimeout(function () { body.classList.remove('panel-anim'); }, 350); }
    store.set('panel.open', true);
    layout(); paintCtx(); load(tab());
    if (prefill) { input.value = prefill; autoGrow(); }
    setTimeout(function () { input.focus(); }, 60);
    if (prefill && autosend) { submit(); }
  }
  function close() { panel.hidden = true; store.set('panel.open', false); if (window.speechSynthesis) { window.speechSynthesis.cancel(); } layout(); }
  function switchTab(t, quiet) {
    store.set('panel.tab', t);
    $$('[data-ptab]').forEach(function (b) { var on = b.getAttribute('data-ptab') === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    Object.keys(logs).forEach(function (k) { logs[k].hidden = k !== t; });
    $('#brquick').hidden = t !== 'barraiser';
    send.textContent = t === 'logbook' ? 'Save' : (t === 'barraiser' ? 'Send' : 'Ask');
    input.placeholder = PH[t];
    paintCtx();
    if (!quiet && !panel.hidden) { load(t); }
  }
  TD.panel = { open: open, close: close, tab: tab };
  $$('[data-panel-open]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); if (panel.hidden) { open(); } else { close(); } }); });
  $$('[data-panel-close]').forEach(function (b) { b.addEventListener('click', close); });
  $$('[data-ptab]').forEach(function (b) { b.addEventListener('click', function () { switchTab(b.getAttribute('data-ptab')); input.focus(); }); });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (panel.hidden) { open(); } else { close(); } }
    else if (e.key === 'Escape' && !panel.hidden && panel.contains(document.activeElement)) { close(); }
  });
  var grip = $('#pgrip');
  grip.addEventListener('mousedown', function (e) {
    e.preventDefault(); body.classList.add('panel-resizing');
    function move(ev) { store.set('panel.width', Math.max(360, Math.min(window.innerWidth - ev.clientX, Math.round(window.innerWidth * 0.66)))); layout(); }
    function up() { body.classList.remove('panel-resizing'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  grip.addEventListener('dblclick', function () { store.set('panel.width', 0); layout(); });
  window.addEventListener('resize', function () { if (!panel.hidden) { layout(); } });
  function autoGrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight + 2, 240) + 'px'; }
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  var vl = $('#voicelang'), as = $('#autosend'), ar = $('#autoread');
  vl.value = store.get('voice.lang', 'hinglish'); as.checked = !!store.get('voice.autosend', false); ar.checked = !!store.get('panel.autoread', false);
  vl.addEventListener('change', function () { store.set('voice.lang', vl.value); });
  as.addEventListener('change', function () { store.set('voice.autosend', as.checked); });
  ar.addEventListener('change', function () { store.set('panel.autoread', ar.checked); if (!ar.checked && window.speechSynthesis) { window.speechSynthesis.cancel(); } });
  TD.on('learner', function () { loadedFor = {}; paintCtx(); if (!panel.hidden) { load(tab()); } });

  function submit() {
    var text = input.value.trim(), t = tab();
    if (!text || busy[t]) { return; }
    if (!TD.server) { offline(t); return; }
    input.value = ''; autoGrow();
    var via = viaVoice ? 'voice' : 'typed'; viaVoice = false;
    if (t === 'navigator') { askNavigator(text); }
    else if (t === 'logbook') { sayNote(text, via); }
    else { askBarRaiser(text); }
  }
  function context() { return { user: TD.learner(), page: location.pathname.split('/').pop(), title: pageTitle, slug: slug, lang: TD.lang() }; }

  /* history */
  function load(t) {
    var who = TD.learner();
    if (loadedFor[t] === who) { return; }
    loadedFor[t] = who;
    logs[t].innerHTML = '';
    if (!TD.server) { offline(t); return; }
    if (t === 'logbook') { loadNotes(); return; }
    TD.getJSON('history?thread=' + t + '&user=' + who + '&n=60').then(function (h) {
      if (loadedFor[t] !== who) { return; }
      if (!h.items || !h.items.length) {
        addMsg(t, 'sys', t === 'navigator'
          ? 'This is ' + esc(TD.who().name) + '\'s own Navigator. It knows every lesson in Tandem, answers in ' + esc(TD.who().langName) + ' first, and remembers what you found hard. Ask about anything on the page, or anything at all about concurrency.'
          : 'This is ' + esc(TD.who().name) + '\'s Bar Raiser. It tests you like a senior interviewer: MCQs, theory, code, what-can-this-print and spot-the-bug questions, and full mock rounds. It keeps a record of your weak spots. Pick a quick start below, or say what you want.');
      }
      (h.items || []).forEach(function (it) {
        addMsg(t, 'me', esc(it.text || it.question || ''), TD.who().name + (it.title ? ' · ' + it.title : ''));
        if (t === 'navigator') { addMsg(t, 'ai', TD.md(it.answer || ''), 'Navigator', it.answer || ''); }
        else { renderBR(it.reply || {}, true); }
      });
    }).catch(function () { offline(t, 'The Tandem server is not answering.'); });
  }

  /* Navigator */
  function askNavigator(text) {
    busy.navigator = true; send.disabled = true;
    addMsg('navigator', 'me', esc(text), TD.who().name + (pageTitle ? ' · ' + pageTitle : ''));
    var stop = thinking('navigator', 'Thinking it through');
    TD.api('ask', Object.assign(context(), { thread: 'navigator', text: text })).then(function (j) {
      stop();
      var m = addMsg('navigator', 'ai', TD.md(j.answer || ''), 'Navigator', j.answer || '');
      if (store.get('panel.autoread', false)) { speak(j.answer || '', $('.speak', m)); }
    }).catch(function (e) { stop(); addMsg('navigator', 'sys', esc(e.message)); })
      .then(function () { busy.navigator = false; send.disabled = false; });
  }
  TD.askNavigator = function (text, autosend) { open('navigator', text, autosend !== false); };

  /* Bar Raiser: replies come as { say, items } where items are mcq, open, mark, problem */
  var mockTimer = 0;
  function askBarRaiser(text, meta) {
    busy.barraiser = true; send.disabled = true;
    addMsg('barraiser', 'me', esc(meta && meta.show ? meta.show : text), TD.who().name + (pageTitle ? ' · ' + pageTitle : ''));
    var stop = thinking('barraiser', 'Preparing your questions');
    TD.api('ask', Object.assign(context(), { thread: 'barraiser', text: text, meta: meta || {} })).then(function (j) {
      stop(); renderBR(j, false);
    }).catch(function (e) { stop(); addMsg('barraiser', 'sys', esc(e.message)); })
      .then(function () { busy.barraiser = false; send.disabled = false; });
  }
  TD.askBarRaiser = function (text, meta) {
    open('barraiser');
    if (!TD.server) { return; }
    if (busy.barraiser) { TD.toast('Bar Raiser is still preparing the last reply.'); return; }
    askBarRaiser(text, meta);
  };
  function renderBR(r, fromHistory) {
    var t = 'barraiser';
    if (r.say) {
      var m = addMsg(t, 'ai', TD.md(r.say), 'Bar Raiser', r.say);
      if (!fromHistory && store.get('panel.autoread', false)) { speak(r.say, $('.speak', m)); }
    }
    (r.items || []).forEach(function (it) {
      var d = document.createElement('div');
      d.className = 'bri ' + it.type;
      if (it.type === 'mcq') { mcqItem(d, it); }
      else if (it.type === 'open') { openItem(d, it); }
      else if (it.type === 'mark') { markItem(d, it); }
      else if (it.type === 'problem') {
        d.innerHTML = '<div class="bk">Practice problem</div><a href="p-' + esc(it.slug) + '.html">' + esc(it.title || it.slug) + '</a>' + (it.why ? '<p>' + esc(it.why) + '</p>' : '');
      } else { return; }
      logs[t].appendChild(d);
    });
    if (r.mock && r.mock.minutes && !fromHistory) { startMockTimer(r.mock.minutes); }
    logs[t].scrollTop = logs[t].scrollHeight;
  }
  function mcqItem(d, it) {
    var multi = !!it.multi;
    d.innerHTML = '<div class="bk">' + (multi ? 'Select all that apply' : 'Multiple choice') + (it.topic ? ' · ' + esc(it.topic) : '') + '</div>' +
      '<div class="qt">' + TD.md(it.q) + '</div><ol class="opts">' + (it.options || []).map(function (o, i) {
        return '<li><button type="button" class="opt" data-i="' + i + '"><span class="ok">' + String.fromCharCode(65 + i) + '</span><span class="ot">' + TD.md(o).replace(/^<p>|<\/p>$/g, '') + '</span></button></li>';
      }).join('') + '</ol>' + (multi ? '<button type="button" class="btn small qcheck">Check answer</button>' : '') + '<div class="why" hidden></div>';
    var picked = [];
    function reveal(res) {
      d.classList.add('done');
      $$('.opt', d).forEach(function (b) {
        var i = +b.getAttribute('data-i'), ok = (res.correct || []).indexOf(i) >= 0, mine = picked.indexOf(i) >= 0;
        b.classList.toggle('right', ok && mine); b.classList.toggle('wrong', mine && !ok); b.classList.toggle('missed', ok && !mine); b.disabled = true;
      });
      var w = $('.why', d); w.innerHTML = '<strong>' + (res.ok ? 'Right.' : 'Not quite.') + '</strong> ' + TD.md(res.why || '');
      w.hidden = false;
      var qc = $('.qcheck', d); if (qc) { qc.remove(); }
    }
    if (it.answered) { picked = it.choice || []; reveal(it.result || {}); return; }
    function check() {
      if (!picked.length) { return; }
      TD.api('test/answer', { user: TD.learner(), qid: it.id, choice: picked }).then(reveal).catch(function (e) { TD.toast(e.message); });
    }
    $$('.opt', d).forEach(function (b) {
      b.addEventListener('click', function () {
        if (d.classList.contains('done')) { return; }
        var i = +b.getAttribute('data-i');
        if (multi) { var k = picked.indexOf(i); if (k >= 0) { picked.splice(k, 1); } else { picked.push(i); } b.classList.toggle('picked'); }
        else { picked = [i]; check(); }
      });
    });
    var qc = $('.qcheck', d); if (qc) { qc.addEventListener('click', check); }
  }
  function openItem(d, it) {
    var mono = /code|pseudo|output|debug/.test(it.kind || '');
    var label = { theory: 'Explain', code: 'Write code', pseudo: 'Pseudo code', design: 'Design', output: 'What can this print?', debug: 'Find the bug', numbers: 'Numbers' }[it.kind] || 'Your answer';
    d.innerHTML = '<div class="bk">' + esc(label) + (it.topic ? ' · ' + esc(it.topic) : '') + '</div><div class="qt">' + TD.md(it.q) + '</div>' +
      (it.answered ? '<div class="mbody"><em>You answered:</em><pre>' + esc(it.answer || '') + '</pre></div>' :
        '<textarea class="' + (mono ? 'mono' : '') + '" placeholder="' + (mono ? 'Write it in ' + esc(TD.who().langName) + '.' : 'Answer as you would out loud.') + '">' + esc(it.starter || '') + '</textarea>' +
        '<div class="brow"><button type="button" class="btn small">Submit answer</button>' + (it.kind === 'code' ? '<button type="button" class="btn ghost small" data-try>Run it first</button>' : '') + '</div>');
    var ta = $('textarea', d), b = $('.btn', d), tr = $('[data-try]', d);
    if (ta) {
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') { e.preventDefault(); var s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 4; }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); b.click(); }
      });
    }
    if (b) {
      b.addEventListener('click', function () {
        var ans = ta.value.trim(); if (!ans) { ta.focus(); return; }
        b.disabled = true;
        askBarRaiser('Answer to question ' + it.id + ':\n' + (mono ? '```' + (TD.lang() === 'cpp' ? 'cpp' : 'java') + '\n' + ans + '\n```' : ans), { answer_to: it.id, show: ans });
        d.querySelector('textarea').readOnly = true;
      });
    }
    if (tr && TD.runSnippet) {
      tr.addEventListener('click', function () {
        var out = d.querySelector('.runout') || document.createElement('div');
        out.className = 'runout'; d.appendChild(out);
        TD.runSnippet(TD.lang(), ta.value, out, 'ok');
      });
    }
  }
  function markItem(d, it) {
    var s = Number(it.score), of = Number(it.out_of || 5);
    if (s / of < 0.6) { d.classList.add('low'); }
    function list(x) { return x && x.length ? '<ul>' + x.map(function (y) { return '<li>' + TD.md(y).replace(/^<p>|<\/p>$/g, '') + '</li>'; }).join('') + '</ul>' : ''; }
    d.innerHTML = '<div class="bk">Marked</div><div class="score">' + esc(isNaN(s) ? '' : s) + '<small>out of ' + esc(of) + '</small></div>' +
      (it.verdict ? '<p><strong>' + esc(it.verdict) + '</strong></p>' : '') +
      (it.good && it.good.length ? '<h5>What was right</h5>' + list(it.good) : '') +
      (it.missing && it.missing.length ? '<h5>What was missing or wrong</h5>' + list(it.missing) : '') +
      (it.model ? '<h5>The strong answer</h5>' + TD.md(it.model) : '') +
      (it.next ? '<h5>Next</h5>' + TD.md(it.next) : '');
    if (it.scorecard) { d.innerHTML += '<h5>Scorecard</h5>' + TD.md(it.scorecard); }
  }
  function startMockTimer(min) {
    clearInterval(mockTimer);
    var end = Date.now() + min * 60000, bar = document.createElement('div');
    bar.className = 'mocktimer'; logs.barraiser.prepend(bar);
    function tick() {
      var left = Math.max(0, end - Date.now()), m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
      bar.innerHTML = '<span>Mock interview in progress</span><span>' + m + ':' + ('0' + s).slice(-2) + ' left</span>';
      if (!left) { clearInterval(mockTimer); bar.innerHTML = '<span>Time is up. Ask Bar Raiser for your scorecard.</span>'; }
    }
    tick(); mockTimer = setInterval(tick, 1000);
  }
  function topic() { return pageTitle ? '"' + pageTitle + '"' : 'concurrency in general'; }
  var QUICK = {
    mcq: function () { return 'Give me 5 MCQs on ' + topic() + '. Mix concept questions, code reading in ' + TD.who().langName + ', and at least one "what can this print" question. Make the wrong options real misconceptions.'; },
    theory: function () { return 'Ask me one theory question an interviewer would ask about ' + topic() + '. Wait for my answer, then mark it out of 5.'; },
    code: function () { return 'Give me one coding question about ' + topic() + ' to answer in ' + TD.who().langName + ', at senior interview level. Wait for my code, then review it like an interviewer: correctness under concurrency first, then follow ups.'; },
    output: function () { return 'Show me a short ' + TD.who().langName + ' snippet with two or three threads about ' + topic() + ', and ask me for every possible output. Wait for my answer, then mark it.'; },
    bug: function () { return 'Show me a short ' + TD.who().langName + ' snippet about ' + topic() + ' with one concurrency bug. Ask me to find it, explain the failing interleaving, and fix it. Wait for my answer.'; },
    rapid: function () { return 'Run a rapid fire oral round, like a phone screen: 10 short questions on ' + topic() + ' and the operating system basics behind it (process vs thread, mutex vs semaphore, deadlock conditions, paging, context switches), one question at a time as open items. I should answer each in about 60 seconds, out loud style. After my tenth answer, give one scorecard for all ten with the model answer for every miss.'; },
    weak: function () { return 'Drill my weak spots. Use what you know about where I struggled so far, and start with the weakest one.'; }
  };
  $$('[data-br]').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-br'); TD.askBarRaiser(QUICK[k]()); }); });

  /* Logbook */
  var TYPE = { note: 'Note', revise: 'Revise', doubt: 'Doubt', mistake: 'Mistake', line: 'Interview line' };
  TD.NOTE_TYPES = TYPE;
  function loadNotes(force) {
    var who = TD.learner(), lg = logs.logbook;
    if (force) { lg.innerHTML = ''; }
    TD.getJSON('notes?user=' + who).then(function (j) {
      if (TD.learner() !== who) { return; }
      paintBadges((j.due || []).length);
      if ((j.due || []).length) { lg.appendChild(revStrip(j.due)); }
      if (!(j.chat || []).length) {
        addMsg('logbook', 'sys', 'This is ' + esc(TD.who().name) + '\'s Logbook. Type or speak anything worth keeping: "note: ...", "revise later: ...", "doubt: ...", "mistake: ...", "interview line: ...". Later ask "what did I note about deadlocks?" Revise notes come back after 1, 3, 7 and 21 days.');
      }
      (j.chat || []).forEach(function (c) {
        addMsg('logbook', 'me', esc(c.said), TD.who().name + (c.via === 'voice' ? ' · spoken' : ''));
        var saved = (j.items || []).filter(function (n) { return (c.saved || []).indexOf(n.id) >= 0; });
        addMsg('logbook', 'ai', TD.md(c.reply) + (saved.length ? '<div class="saved">' + saved.map(mini).join('') + '</div>' : ''), 'Logbook', c.action === 'answer' ? c.reply : null);
      });
    }).catch(function () { offline('logbook', 'The Tandem server is not answering.'); });
  }
  TD.reloadNotesTab = function () { loadedFor.logbook = null; if (!panel.hidden && tab() === 'logbook') { load('logbook'); } };
  function mini(n) {
    return '<div class="mini"><span class="tpill tp-' + n.type + '">' + TYPE[n.type] + '</span> <b>' + esc(n.title) + '</b>' + esc(n.text) +
      (n.lesson && TD.lessonBySlug[n.lesson] ? '<br><a href="' + n.lesson + '.html">Explained in: ' + esc(TD.lessonBySlug[n.lesson].title) + '</a>' : '') +
      (n.revise_due ? '<br><small>First revision on ' + esc(n.revise_due) + '</small>' : '') + '</div>';
  }
  function paintBadges(n) { $$('[data-due-badge]').forEach(function (b) { b.hidden = !n; b.textContent = n || ''; }); TD.emit('due', n); }
  TD.paintDue = paintBadges;
  function revStrip(due) {
    var d = document.createElement('div'); d.className = 'revstrip';
    d.innerHTML = '<h4>Revise today <span class="badge">' + due.length + '</span></h4>' + due.map(function (n) {
      return '<div class="ritem"><div><b>' + esc(n.title) + '</b><small>' + esc(n.text) + '</small><small>Round ' + ((n.revise_stage || 0) + 1) + ' of 4</small></div><button class="btn ghost small" data-rev="' + n.id + '">Revised</button></div>';
    }).join('') + '<div class="ractions"><button class="btn small" data-quiz>Quiz me on these</button><a class="btn ghost small" href="logbook.html">Open my Logbook</a></div>';
    $$('[data-rev]', d).forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        TD.api('notes/revised', { user: TD.learner(), id: b.getAttribute('data-rev') }).then(function () { loadNotes(true); TD.emit('notes'); }).catch(function (e) { b.disabled = false; TD.toast(e.message); });
      });
    });
    $('[data-quiz]', d).addEventListener('click', function () { TD.quizNotes(due); });
    return d;
  }
  TD.quizNotes = function (items) {
    if (!items.length) { return; }
    TD.askBarRaiser('Quiz me on these notes I am revising today. One question at a time, the kind that needs real reasoning. Wait for my answer, mark it, then ask the next:\n' +
      items.map(function (n, i) { return (i + 1) + '. ' + n.title + ': ' + n.text; }).join('\n'));
  };
  function sayNote(text, via) {
    busy.logbook = true; send.disabled = true;
    addMsg('logbook', 'me', esc(text), TD.who().name + (via === 'voice' ? ' · spoken' : ''));
    var stop = thinking('logbook', 'Writing it down');
    TD.api('notes/say', Object.assign(context(), { text: text, via: via })).then(function (j) {
      stop();
      addMsg('logbook', 'ai', TD.md(j.reply) + ((j.saved || []).length ? '<div class="saved">' + j.saved.map(mini).join('') + '</div>' : ''), 'Logbook', j.action === 'answer' ? j.reply : null);
      paintBadges((j.due || []).length); TD.emit('notes');
    }).catch(function (e) { stop(); addMsg('logbook', 'sys', esc(e.message)); })
      .then(function () { busy.logbook = false; send.disabled = false; });
  }
  TD.noteThis = function (prefill) { open('logbook', prefill || '', false); };
  if (TD.server) {
    TD.ready(function () { TD.getJSON('notes?user=' + TD.learner()).then(function (j) { paintBadges((j.due || []).length); }).catch(function () {}); });
    TD.on('learner', function () { TD.getJSON('notes?user=' + TD.learner()).then(function (j) { paintBadges((j.due || []).length); }).catch(function () {}); });
  }

  /* voice: record in the browser, transcribe on this Mac with Whisper, text lands in the box */
  var mic = $('#mic'), recbar = $('#recbar'), recmsg = $('#recmsg'), rectime = $('#rectime'), meter = $('#meter');
  var rec = null, chunks = [], stream = null, actx = null, raf = 0, recT0 = 0, tick = 0, downAt = 0, startedOnDown = false;
  for (var mi = 0; mi < 28; mi += 1) { meter.appendChild(document.createElement('i')); }
  function fmt(s) { s = Math.floor(s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function stopMeter() { cancelAnimationFrame(raf); clearInterval(tick); if (actx) { try { actx.close(); } catch (e) {} actx = null; } }
  function startRec() {
    if (rec) { return; }
    if (!TD.server) { offline(tab(), 'Voice needs the Tandem server, because your speech is turned into text on this Mac.'); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { addMsg(tab(), 'sys', 'This browser cannot record audio. Please use Chrome or Safari.'); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }).then(function (s) {
      stream = s; chunks = [];
      var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].filter(function (x) { return MediaRecorder.isTypeSupported(x); })[0];
      rec = type ? new MediaRecorder(s, { mimeType: type }) : new MediaRecorder(s);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) { chunks.push(e.data); } };
      rec.onstop = function () { transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); };
      rec.start(250); recT0 = Date.now();
      mic.classList.add('rec'); recbar.classList.add('on'); recbar.classList.remove('work'); recmsg.textContent = 'Listening';
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var an = actx.createAnalyser(); an.fftSize = 256; actx.createMediaStreamSource(s).connect(an);
      var data = new Uint8Array(an.frequencyBinCount), bars = $$('i', meter), hist = [];
      (function draw() {
        an.getByteTimeDomainData(data);
        var sum = 0; for (var i = 0; i < data.length; i += 1) { var v = (data[i] - 128) / 128; sum += v * v; }
        hist.push(Math.min(1, Math.sqrt(sum / data.length) * 4)); if (hist.length > bars.length) { hist.shift(); }
        bars.forEach(function (b, i) { b.style.height = Math.max(3, Math.round((hist[i] || 0) * 24)) + 'px'; });
        raf = requestAnimationFrame(draw);
      })();
      tick = setInterval(function () { var s2 = (Date.now() - recT0) / 1000; rectime.textContent = fmt(s2); if (s2 >= 120) { stopRec(); } }, 200);
    }).catch(function () { addMsg(tab(), 'sys', 'The microphone is blocked. Allow it for 127.0.0.1 in the browser (the icon at the left of the address bar), then try again.'); });
  }
  function stopRec() {
    if (!rec) { return; }
    stopMeter(); try { rec.stop(); } catch (e) {}
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); }
    mic.classList.remove('rec');
  }
  function transcribe(blob) {
    var secs = (Date.now() - recT0) / 1000; rec = null;
    if (secs < 0.6 || blob.size < 1200) { recbar.classList.remove('on'); return; }
    mic.classList.add('busy'); recbar.classList.add('work'); recmsg.textContent = 'Turning your voice into text on this Mac';
    var t0 = Date.now(); tick = setInterval(function () { rectime.textContent = fmt((Date.now() - t0) / 1000); }, 200);
    fetch(TD.root + 'api/transcribe?lang=' + encodeURIComponent(store.get('voice.lang', 'hinglish')), { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-Tandem': '1' }, body: blob })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok || !x.j.text) { addMsg(tab(), 'sys', esc((x.j && x.j.error) || 'I could not hear any words. Please try again.')); return; }
        var cur = input.value.trim(); input.value = (cur ? cur + ' ' : '') + x.j.text; autoGrow(); input.focus(); viaVoice = true;
        if (store.get('voice.autosend', false)) { submit(); }
      })
      .catch(function () { offline(tab(), 'The Tandem server stopped answering.'); })
      .then(function () { clearInterval(tick); mic.classList.remove('busy'); recbar.classList.remove('on'); });
  }
  mic.addEventListener('pointerdown', function (e) {
    e.preventDefault(); if (mic.classList.contains('busy')) { return; }
    downAt = Date.now();
    if (rec) { startedOnDown = false; stopRec(); } else { startedOnDown = true; startRec(); }
  });
  mic.addEventListener('pointerup', function () { if (startedOnDown && rec && Date.now() - downAt > 600) { stopRec(); } startedOnDown = false; });

  /* boot */
  switchTab(tab(), true);
  if (location.hash === '#ask' || store.get('panel.open', false)) { panel.hidden = false; layout(); paintCtx(); load(tab()); }
})();

/* code.js */
/* Tandem front end, code: highlighting, code blocks (tabs, copy, edit, run), the problem editor and run reports. */
(function () {
  'use strict';
  var TD = window.Tandem, $ = TD.$, $$ = TD.$$, esc = TD.esc, store = TD.store, body = document.body;

  /* the same highlighting rules as builder/highlight.py */
  function set(s) { var o = {}; s.split(/\s+/).forEach(function (w) { if (w) { o[w] = 1; } }); return o; }
  var KW = {
    java: set('abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try var void volatile while record sealed permits yield true false null'),
    cpp: set('alignas alignof and asm auto bitand bitor break case catch class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do dynamic_cast else enum explicit export extern false for friend goto if inline mutable namespace new noexcept not nullptr operator or private protected public register reinterpret_cast requires return sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union using virtual volatile while override final')
  };
  var TY = {
    java: set('boolean byte char double float int long short String Object Thread Runnable Callable Integer Long Boolean Double Character List Map Set Queue Deque'),
    cpp: set('void bool char int long short float double unsigned signed size_t int64_t uint64_t int32_t uint32_t uint8_t std string vector deque list map unordered_map set unordered_set queue priority_queue stack pair tuple optional variant function thread jthread mutex timed_mutex recursive_mutex shared_mutex lock_guard unique_lock scoped_lock shared_lock condition_variable condition_variable_any atomic atomic_flag memory_order future promise packaged_task shared_future async counting_semaphore binary_semaphore latch barrier stop_token stop_source chrono milliseconds microseconds nanoseconds seconds steady_clock system_clock time_point duration shared_ptr unique_ptr weak_ptr string_view array exception runtime_error exception_ptr once_flag cout cerr endl')
  };
  var RX = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])+')|(^[ \t]*#[ \t]*\w+[^\n]*)|(@[A-Za-z_]\w*)|(\b(?:0[xX][0-9a-fA-F']+|\d[\d_']*(?:\.\d+)?(?:[eE][+\-]?\d+)?[fFlLuU]*)\b)|([A-Za-z_]\w*)|(\s+|[\s\S])/gm;
  TD.highlight = function (code, lang) {
    lang = { 'c++': 'cpp', java: 'java', cpp: 'cpp' }[lang] || lang;
    if (lang !== 'java' && lang !== 'cpp') { return esc(code); }
    var out = [], m, kw = KW[lang], ty = TY[lang];
    RX.lastIndex = 0;
    while ((m = RX.exec(code)) !== null) {
      var text = m[0], cls = '';
      if (m[1]) { cls = 'c'; } else if (m[2]) { cls = 's'; } else if (m[3]) { cls = lang === 'cpp' ? 'p' : ''; }
      else if (m[4]) { cls = lang === 'java' ? 'a' : ''; } else if (m[5]) { cls = 'n'; }
      else if (m[6]) {
        if (kw[text]) { cls = 'k'; }
        else if (ty[text] || (lang === 'java' && /^[A-Z][a-z]/.test(text))) { cls = 't'; }
        else if (/^\s*\(/.test(code.slice(RX.lastIndex, RX.lastIndex + 40))) { cls = 'f'; }
      }
      out.push(cls ? '<span class="' + cls + '">' + esc(text) + '</span>' : esc(text));
      if (!text.length) { RX.lastIndex += 1; }
    }
    return out.join('');
  };

  /* run reports */
  var LNAME = { cpp: 'C++', java: 'Java' };
  TD.renderRun = function (r, el, opts) {
    opts = opts || {};
    var cls = 'ok', head, explain = '';
    var tsan = (r.tsan || []).length, tests = r.tests || [];
    if (!r.compiled) { cls = 'no'; head = 'Does not compile'; explain = 'The compiler stopped before your program could run. Read the first error first; later errors often follow from it.'; }
    else if (r.timed_out) {
      cls = opts.expect === 'deadlock' ? 'ok' : 'no';
      head = opts.expect === 'deadlock' ? 'Deadlocked, as this demo intends' : 'Still running after ' + Math.round(r.secs) + ' s: stopped';
      explain = 'A program that never finishes usually has a deadlock, a missed or lost wakeup, a thread nobody told to stop, or a busy loop. ' +
        (r.dump ? 'Below is where every thread was waiting when it was stopped: look for the cycle.' : '');
    } else if (tests.length || r.done) {
      var ok = r.done && !r.failed && r.passed > 0 && !tsan;
      cls = ok ? 'ok' : 'no';
      head = ok ? 'All ' + r.passed + ' tests passed' + (r.lang === 'cpp' ? ', and ThreadSanitizer is quiet' : '') : (r.failed ? r.failed + ' of ' + (r.passed + r.failed) + ' tests failed' : (tsan ? 'Tests passed, but there is a data race' : 'The tests did not finish'));
      if (!r.done) { explain = 'The program ended before the test harness finished. It may have crashed or thrown an exception; check the output below.'; }
      else if (tsan && !r.failed) { explain = 'The results looked right this time, but ThreadSanitizer saw two threads touch the same memory without synchronization, at least one of them writing. On another day, with other timing, that race gives wrong answers. In C++ it is undefined behavior.'; }
    } else if (tsan) {
      cls = opts.expect === 'race' ? 'ok' : 'no';
      head = opts.expect === 'race' ? 'ThreadSanitizer caught the race, as this demo intends' : 'Data race detected';
      explain = 'Two threads accessed the same memory without a happens-before edge between them, and at least one access was a write. Each report names both accesses with the line in your code.';
    } else if (r.exit && r.exit !== 0) { cls = 'no'; head = 'Exited with code ' + r.exit; }
    else { head = 'Ran successfully'; }
    var parts = ['<div class="rhead ' + cls + '">' + esc(head) + '<span class="rs">' + esc(LNAME[r.lang] || '') + (r.mode === 'fast' ? ' · optimized, no sanitizer' : (r.lang === 'cpp' ? ' · ThreadSanitizer on' : '')) + (r.secs ? ' · ' + r.secs + ' s' : '') + '</span></div>'];
    if (explain) { parts.push('<div class="rexplain">' + esc(explain) + '</div>'); }
    if (tests.length) {
      parts.push('<div class="rblock">' + tests.map(function (t) {
        return '<div class="tline ' + (t.ok ? 'ok' : 'no') + '"><span class="tk">' + (t.ok ? '&#10003;' : '&#10007;') + '</span><span><span class="tn">' + esc(t.name) + '</span><br><span class="td">' + esc(t.detail) + '</span></span></div>';
      }).join('') + '</div>');
    }
    if (!r.compiled && r.compile_out) { parts.push('<div class="rblock compile"><h5>Compiler</h5><pre>' + esc(r.compile_out) + '</pre></div>'); }
    (r.tsan || []).forEach(function (t, i) { parts.push('<div class="rblock tsan"><h5>ThreadSanitizer report ' + (i + 1) + '</h5><pre>' + esc(t) + '</pre></div>'); });
    if (r.dump) { parts.push('<div class="rblock dump"><h5>' + (r.lang === 'java' ? 'Thread dump' : 'Thread stacks') + '</h5><pre>' + esc(r.dump) + '</pre></div>'); }
    var so = r.stdout || '';
    if (tests.length) { so = so.split('\n').filter(function (l) { return !/^\[(PASS|FAIL|DONE)\]/.test(l); }).join('\n').trim(); }
    if (so) { parts.push('<div class="rblock"><h5>Output</h5><pre>' + esc(so) + '</pre></div>'); }
    if (r.stderr && r.compiled) { parts.push('<div class="rblock"><h5>Errors</h5><pre>' + esc(r.stderr) + '</pre></div>'); }
    el.innerHTML = parts.join('');
    el.hidden = false;
    return cls === 'ok';
  };
  function running(el, label) { el.hidden = false; el.innerHTML = '<div class="rhead wait"><span class="thinking"><i></i><i></i><i></i></span>' + esc(label) + '</div>'; }
  TD.runSnippet = function (lang, code, el, expect, mode) {
    if (!TD.server) { el.hidden = false; el.innerHTML = '<div class="rexplain">' + TD.offlineText + '</div>'; return; }
    running(el, lang === 'cpp' ? 'Compiling with ThreadSanitizer and running' : 'Compiling and running');
    TD.api('run', { user: TD.learner(), kind: 'snippet', lang: lang, code: code, mode: mode || 'tsan', expect: expect || 'ok' })
      .then(function (r) { TD.renderRun(r, el, { expect: expect }); })
      .catch(function (e) { el.innerHTML = '<div class="rhead no">' + esc(e.message) + '</div>'; });
  };

  /* code blocks in lessons */
  function visiblePane(fig) {
    var panes = $$('pre.pane', fig);
    if (panes.length === 1) { return panes[0]; }
    var pick = fig.getAttribute('data-pick') || TD.lang();
    return $('pre.pane-' + pick, fig) || panes[0];
  }
  function paintTabs(fig) {
    var pick = fig.getAttribute('data-pick') || TD.lang();
    $$('.ctab', fig).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === pick); });
  }
  $$('figure.code').forEach(function (fig) {
    paintTabs(fig);
    $$('.ctab', fig).forEach(function (b) { b.addEventListener('click', function () { fig.setAttribute('data-pick', b.getAttribute('data-lang')); paintTabs(fig); }); });
    var cp = $('[data-copy]', fig);
    if (cp) {
      cp.addEventListener('click', function () {
        var text = $('code', visiblePane(fig)).innerText;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy'; }, 1400); }).catch(function () { TD.toast('Select the code and press Cmd C.'); });
      });
    }
    var ed = $('[data-edit]', fig);
    if (ed) {
      ed.addEventListener('click', function () {
        var c = $('code', visiblePane(fig)), on = c.getAttribute('contenteditable') !== 'plaintext-only';
        $$('pre.pane code', fig).forEach(function (x) { x.removeAttribute('contenteditable'); x.parentNode.parentNode.removeAttribute('contenteditable'); });
        if (on) { c.setAttribute('contenteditable', 'plaintext-only'); c.setAttribute('spellcheck', 'false'); visiblePane(fig).setAttribute('contenteditable', 'true'); c.focus(); ed.textContent = 'Done editing'; }
        else { ed.textContent = 'Edit'; }
      });
    }
    var run = $('[data-run]', fig);
    if (run) {
      run.addEventListener('click', function () {
        var pane = visiblePane(fig), lang = pane.getAttribute('data-lang');
        TD.runSnippet(lang, $('code', pane).innerText, $('.runout', fig), fig.getAttribute('data-expect') || 'ok');
      });
    }
  });
  TD.on('learner', function () { $$('figure.code').forEach(paintTabs); });

  /* the problem page: editor, runs, hints, solution, review */
  var pdataEl = $('#pdata');
  if (!pdataEl) { return; }
  var P = JSON.parse(pdataEl.textContent), slug = P.slug;
  var ta = $('.esrc'), hl = $('.ehl code'), gutter = $('.egutter'), stat = $('#idestat'), resEl = $('#results-run');
  var lang = TD.lang(), last = null;
  function key(l) { return 'code.' + TD.learner() + '.' + slug + '.' + (l || lang); }
  function paint() {
    var v = ta.value;
    hl.innerHTML = TD.highlight(v, lang) + '\n';
    var n = v.split('\n').length, g = [];
    for (var i = 1; i <= n; i += 1) { g.push(i); }
    gutter.textContent = g.join('\n');
    var box = $('#editor'), h = Math.max(box.clientHeight, hl.parentNode.scrollHeight);
    ta.style.height = h + 'px';
  }
  function load() {
    $$('[data-ilang]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-ilang') === lang); });
    var saved = store.get(key(), null);
    ta.value = saved && saved.code ? saved.code : P.starter[lang];
    paint();
    $('[data-fast]').hidden = lang !== 'cpp';
    stat.textContent = (lang === 'cpp' ? 'C++20, ThreadSanitizer on' : 'Java 21') + (saved ? ' · your saved code' : ' · starter code');
    if (TD.server) {
      TD.getJSON('code?user=' + TD.learner() + '&problem=' + slug + '&lang=' + lang).then(function (j) {
        if (j.code && (!saved || (j.ts || 0) > (saved.ts || 0)) && j.code !== ta.value) { ta.value = j.code; paint(); stat.textContent += ' · loaded from the server'; }
      }).catch(function () {});
    }
  }
  var saveTimer = 0;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { store.set(key(), { code: ta.value, ts: Date.now() }); }, 400); }
  ta.addEventListener('input', function () { paint(); save(); });
  ta.addEventListener('scroll', function () { hl.parentNode.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', function (e) {
    var s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    if (e.key === 'Tab') {
      e.preventDefault();
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      if (e.shiftKey) {
        if (v.slice(ls, ls + 4) === '    ') { ta.value = v.slice(0, ls) + v.slice(ls + 4); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - 4); }
      } else if (s !== en && v.slice(s, en).indexOf('\n') >= 0) {
        var block = v.slice(ls, en).replace(/^/gm, '    ');
        ta.value = v.slice(0, ls) + block + v.slice(en); ta.selectionStart = ls; ta.selectionEnd = ls + block.length;
      } else { ta.value = v.slice(0, s) + '    ' + v.slice(en); ta.selectionStart = ta.selectionEnd = s + 4; }
      paint(); save();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runTests('tsan'); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      var line = v.slice(v.lastIndexOf('\n', s - 1) + 1, s), ind = (line.match(/^\s*/) || [''])[0];
      if (/[{(\[:]\s*$/.test(line)) { ind += '    '; }
      var ins = '\n' + ind;
      ta.value = v.slice(0, s) + ins + v.slice(en); ta.selectionStart = ta.selectionEnd = s + ins.length; paint(); save();
    } else if (e.key === '}' && /^\s+$/.test(v.slice(v.lastIndexOf('\n', s - 1) + 1, s)) && v.slice(v.lastIndexOf('\n', s - 1) + 1, s).length >= 4) {
      e.preventDefault();
      var ls2 = v.lastIndexOf('\n', s - 1) + 1;
      ta.value = v.slice(0, s - 4) + '}' + v.slice(en); ta.selectionStart = ta.selectionEnd = s - 3; paint(); save();
      void ls2;
    } else if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); store.set(key(), { code: ta.value, ts: Date.now() }); TD.toast('Saved in this browser. Runs also save it on the server.'); }
  });
  window.addEventListener('resize', paint);
  $$('[data-ilang]').forEach(function (b) { b.addEventListener('click', function () { store.set(key(), { code: ta.value, ts: Date.now() }); lang = b.getAttribute('data-ilang'); load(); }); });
  TD.on('learner', function () { lang = TD.lang(); load(); });
  $('[data-reset]').addEventListener('click', function () {
    if (!confirm('Replace your code with the starter code?')) { return; }
    ta.value = P.starter[lang]; paint(); store.set(key(), { code: ta.value, ts: Date.now() });
  });
  function runTests(mode) {
    if (!TD.server) { resEl.innerHTML = '<div class="rexplain">' + TD.offlineText + '</div>'; return; }
    var btn = $('[data-runp]'); btn.disabled = true;
    store.set(key(), { code: ta.value, ts: Date.now() });
    running(resEl, lang === 'cpp' ? (mode === 'fast' ? 'Compiling with optimizations and running the tests' : 'Compiling with ThreadSanitizer and running the tests') : 'Compiling and running the tests');
    TD.api('run', { user: TD.learner(), kind: 'problem', problem: slug, lang: lang, code: ta.value, mode: mode })
      .then(function (r) {
        last = r;
        var ok = TD.renderRun(r, resEl, {});
        var prev = TD.prog('prob')[slug];
        if (ok && r.tests && r.tests.length) {
          TD.setProg('prob', slug, { st: 'solved', ts: Date.now(), lang: lang });
          if (!prev || prev.st !== 'solved') { TD.toast('Solved. Now try the follow ups, or ask Bar Raiser to review it.'); }
        } else if (!prev || prev.st !== 'solved') { TD.setProg('prob', slug, { st: 'tried', ts: Date.now(), lang: lang }); }
      })
      .catch(function (e) { resEl.innerHTML = '<div class="rhead no">' + esc(e.message) + '</div>'; })
      .then(function () { btn.disabled = false; });
  }
  $('[data-runp]').addEventListener('click', function () { runTests('tsan'); });
  $('[data-fast]').addEventListener('click', function () { runTests('fast'); });
  $$('[data-ptab2]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-ptab2');
      $$('[data-ptab2]').forEach(function (x) { x.classList.toggle('on', x === b); });
      $$('[data-ppane]').forEach(function (p) { p.hidden = p.getAttribute('data-ppane') !== t; });
    });
  });
  $$('[data-showhint]').forEach(function (b) { b.addEventListener('click', function () { b.nextElementSibling.hidden = false; b.remove(); }); });
  $('[data-reveal]').addEventListener('click', function () {
    var st = TD.prog('prob')[slug];
    if ((!st || st.st !== 'solved') && !confirm('You have not solved it yet. Show the solution anyway?')) { return; }
    $('#spoiler').hidden = true;
    var sol = $('.solution'); sol.hidden = false;
    var pick = TD.lang();
    $('.solcode').innerHTML = '<figure class="code pair" data-pick="' + pick + '"><figcaption><span class="ctitle">Reference solution</span><span class="ctabs">' +
      '<button type="button" class="ctab" data-lang="cpp">C++</button><button type="button" class="ctab" data-lang="java">Java</button></span></figcaption><div class="panes">' +
      ['cpp', 'java'].map(function (l) { return '<pre class="pane pane-' + l + '" data-lang="' + l + '"><div class="cwrap"><code>' + TD.highlight(P.solution[l], l) + '</code></div></pre>'; }).join('') + '</div></figure>';
    var fig = $('.solcode figure');
    function pt() { $$('.ctab', fig).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-lang') === fig.getAttribute('data-pick')); }); }
    $$('.ctab', fig).forEach(function (x) { x.addEventListener('click', function () { fig.setAttribute('data-pick', x.getAttribute('data-lang')); pt(); }); });
    pt();
  });
  function summary() {
    if (!last) { return 'I have not run the tests yet.'; }
    if (!last.compiled) { return 'It does not compile yet.'; }
    return 'Test results: passed ' + last.passed + ', failed ' + last.failed + (last.timed_out ? ', and it timed out' : '') + (last.lang === 'cpp' ? ', ThreadSanitizer reports: ' + (last.tsan || []).length : '') + '.' +
      ((last.tests || []).filter(function (t) { return !t.ok; }).slice(0, 3).map(function (t) { return '\nFailing: ' + t.name + ': ' + t.detail; }).join(''));
  }
  var fence = function () { return '```' + (lang === 'cpp' ? 'cpp' : 'java') + '\n' + ta.value + '\n```'; };
  $('[data-review]').addEventListener('click', function () {
    TD.askBarRaiser('Review my solution to the practice problem "' + P.title + '" (' + slug + ') in ' + (lang === 'cpp' ? 'C++' : 'Java') + ', the way a senior interviewer would: correctness under every interleaving first, then primitive choice, then clarity, then the follow ups you would ask next. Give a mark out of 5.\n' + summary() + '\nMy code:\n' + fence(),
      { show: 'Please review my solution to "' + P.title + '".', review: slug });
  });
  $('[data-nudge]').addEventListener('click', function () {
    TD.askNavigator('I am working on the practice problem "' + P.title + '" in ' + (lang === 'cpp' ? 'C++' : 'Java') + '. Give me a nudge in the right direction without writing the solution for me. ' + summary() + '\nMy code so far:\n' + fence());
  });
  load();
})();

/* learn.js */
/* Tandem front end, learning: quick checks, checkpoints, theory cards, module tests and the lesson page. */
(function () {
  'use strict';
  var TD = window.Tandem, $ = TD.$, $$ = TD.$$, esc = TD.esc, store = TD.store, body = document.body;
  var slug = body.getAttribute('data-slug'), title = body.getAttribute('data-title') || '';

  /* MCQs: single answer marks on click; multi answer marks on "Check answer". Results are kept per learner. */
  function wireMCQ(m, onAnswer, exam) {
    if (m.getAttribute('data-wired')) { return; }
    m.setAttribute('data-wired', '1');
    var answer = (m.getAttribute('data-a') || '').split(',').filter(Boolean).map(Number);
    var multi = m.getAttribute('data-multi') === '1', picked = [];
    function reveal(record) {
      m.classList.add('done');
      var ok = picked.length === answer.length && picked.every(function (i) { return answer.indexOf(i) >= 0; });
      $$('.opt', m).forEach(function (b) {
        var i = +b.getAttribute('data-i'), right = answer.indexOf(i) >= 0, mine = picked.indexOf(i) >= 0;
        b.classList.toggle('right', right && (mine || ok)); b.classList.toggle('wrong', mine && !right); b.classList.toggle('missed', right && !mine && !ok);
        b.classList.remove('picked');
      });
      m.classList.toggle('answered', ok); m.classList.toggle('missed', !ok);
      $('.why', m).hidden = false;
      var qc = $('.qcheck', m); if (qc) { qc.hidden = true; }
      if (record) { TD.setProg('mcq', m.getAttribute('data-id'), { ok: ok, ts: Date.now(), pick: picked }); }
      if (onAnswer) { onAnswer(ok); }
    }
    $$('.opt', m).forEach(function (b) {
      b.addEventListener('click', function () {
        if (m.classList.contains('done')) { return; }
        var i = +b.getAttribute('data-i');
        if (multi) { var k = picked.indexOf(i); if (k >= 0) { picked.splice(k, 1); } else { picked.push(i); } b.classList.toggle('picked'); if (exam && onAnswer) { onAnswer(null); } }
        else if (exam) { picked = [i]; $$('.opt', m).forEach(function (x) { x.classList.toggle('picked', x === b); }); if (onAnswer) { onAnswer(null); } }
        else { picked = [i]; reveal(true); }
      });
    });
    var qc = $('.qcheck', m); if (qc) { if (exam) { qc.hidden = true; } else { qc.addEventListener('click', function () { if (picked.length) { reveal(true); } }); } }
    m.submit = function () { if (!m.classList.contains('done')) { reveal(true); } };
    m.hasPick = function () { return picked.length > 0; };
    m.reset = function () { picked = []; m.classList.remove('done', 'answered', 'missed'); $$('.opt', m).forEach(function (b) { b.classList.remove('right', 'wrong', 'missed', 'picked'); }); $('.why', m).hidden = true; var c = $('.qcheck', m); if (c) { c.hidden = !!exam; } };
    m.restore = function () { var rec = TD.prog('mcq')[m.getAttribute('data-id')]; if (rec && rec.pick) { picked = rec.pick.slice(); reveal(false); } };
  }
  TD.wireMCQ = wireMCQ;
  function visibleMCQs(root) { return $$('.mcq', root).filter(function (m) { var l = m.getAttribute('data-lang'); return !l || l === TD.lang(); }); }

  /* lesson quick checks */
  $$('section.quiz[data-lesson]').forEach(function (q) {
    if (body.classList.contains('page-test')) { return; }
    function score() {
      var ms = visibleMCQs(q), done = ms.filter(function (m) { return m.classList.contains('done'); }), right = done.filter(function (m) { return m.classList.contains('answered'); });
      var box = $('.qscore', q);
      if (done.length === ms.length && ms.length) {
        box.hidden = false;
        box.innerHTML = 'You got ' + right.length + ' of ' + ms.length + '. ' + (right.length === ms.length ? 'Clean sweep. ' : 'Read the why under each miss; Bar Raiser can drill them. ') +
          '<button type="button" class="btn small" data-retry>Try again</button>';
        $('[data-retry]', box).addEventListener('click', function () { ms.forEach(function (m) { m.reset(); }); box.hidden = true; });
      }
    }
    $$('.mcq', q).forEach(function (m) { wireMCQ(m, score); m.restore(); });
    score();
  });

  /* checkpoints and theory cards: write, compare, get marked */
  function ansKey(id) { return id; }
  $$('.cq').forEach(function (c) {
    var id = c.getAttribute('data-q'), ta = $('textarea.myans', c);
    function loadAns() { var a = TD.prog('ans')[ansKey(id)]; ta.value = a && a.text ? a.text : ''; var k = TD.prog('theory')[id]; c.classList.toggle('known', !!k); }
    loadAns();
    TD.on('learner', loadAns); TD.on('progress', function (k) { if (k === 'sync') { loadAns(); } });
    var t = 0;
    ta.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { TD.setProg('ans', ansKey(id), ta.value.trim() ? { text: ta.value, ts: Date.now() } : null); }, 500); });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Tab' && ta.classList.contains('mono')) { e.preventDefault(); var s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 4; } });
    var mb = $('[data-model]', c);
    mb.addEventListener('click', function () { var mdl = $('.model', c); mdl.hidden = !mdl.hidden; mb.textContent = mdl.hidden ? 'Show the model answer' : 'Hide the model answer'; });
    $('[data-mark]', c).addEventListener('click', function () {
      var mine = ta.value.trim();
      if (!mine) { ta.focus(); ta.placeholder = 'Write your answer first, then ask Bar Raiser to mark it.'; return; }
      var q = $('.qtext', c).innerText.trim(), model = $('.model', c).innerText.replace(/^Model answer\s*/, '').trim();
      var where = body.classList.contains('page-theory') ? 'the theory bank (' + document.title.split(' · ')[0] + ')' : 'the lesson "' + title + '"';
      TD.askBarRaiser('Mark my answer to this question from ' + where + ', strictly but kindly, like a senior interviewer. Score it out of 5, say what was right, what was missing or wrong, and give the strong answer in a few lines. Then ask me one follow up.\n\nQuestion: ' + q + '\n\nMy answer:\n' + mine + '\n\nReference answer for you (do not quote it back unless it helps): ' + model.slice(0, 3000),
        { show: 'Please mark my answer to: ' + q.slice(0, 160) + (q.length > 160 ? '...' : ''), mark: id });
    });
    var g = $('[data-gotit]', c);
    if (g) { g.addEventListener('click', function () { var k = !TD.prog('theory')[id]; TD.setProg('theory', id, k ? Date.now() : null); c.classList.toggle('known', k); g.textContent = k ? 'Marked as known' : 'I knew this'; }); }
  });

  /* theory page filters */
  if (body.classList.contains('page-theory')) {
    var lv = '', onlyOpen = false;
    function applyT() { $$('.tq').forEach(function (c) { c.hidden = (lv && c.getAttribute('data-level') !== lv) || (onlyOpen && c.classList.contains('known')); }); }
    $$('[data-flevel]').forEach(function (b) { b.addEventListener('click', function () { lv = lv === b.getAttribute('data-flevel') ? '' : b.getAttribute('data-flevel'); $$('[data-flevel]').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-flevel') === lv); }); applyT(); }); });
    $$('[data-fopen]').forEach(function (b) { b.addEventListener('click', function () { onlyOpen = !onlyOpen; b.classList.toggle('on', onlyOpen); applyT(); }); });
    $$('.tq').forEach(function (c) { c.id = c.getAttribute('data-q').replace('.t', '-'); });
  }

  /* lesson page: done, test me, note, map, table of contents */
  if (slug && body.classList.contains('page-lesson')) {
    var paintDone = function () {
      var d = !!TD.prog('done')[slug];
      body.classList.toggle('is-done', d);
      $$('[data-done] span').forEach(function (s) { s.textContent = d ? 'Done. Mark as not done' : 'Mark lesson as done'; });
      var dn = TD.prog('done');
      $$('.map a[data-slug]').forEach(function (a) { a.parentNode.classList.toggle('done', !!dn[a.getAttribute('data-slug')]); });
      var st = TD.stats();
      $$('[data-modfrac]').forEach(function (e) { var v = st.byMod[e.getAttribute('data-modfrac')]; e.textContent = v ? v[0] + '/' + v[1] : ''; });
    };
    $$('[data-done]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = !TD.prog('done')[slug];
        TD.setProg('done', slug, d ? Date.now() : null);
        paintDone();
        if (d) { var nx = $('.lnav .next'); TD.toast(nx ? 'Done. Next: ' + nx.querySelector('b').textContent : 'Done. That was the last lesson in this track.'); }
      });
    });
    $$('[data-test-me]').forEach(function (b) {
      b.addEventListener('click', function () {
        TD.askBarRaiser('Test me on the lesson "' + title + '" (' + slug + '). Start with 3 MCQs, at least one of them a code reading or "what can this print" question in my language. Then ask one open question that needs real reasoning, wait for my answer and mark it. Focus on what I found hard before, if you know.',
          { show: 'Test me on "' + title + '".', test: slug });
      });
    });
    $$('[data-note-here]').forEach(function (b) { b.addEventListener('click', function () { TD.noteThis(''); }); });
    $$('[data-map-toggle]').forEach(function (b) { b.addEventListener('click', function () { body.classList.toggle('map-hidden'); store.set('map.hidden', body.classList.contains('map-hidden')); }); });
    if (store.get('map.hidden', false)) { body.classList.add('map-hidden'); }
    TD.on('learner', paintDone); TD.on('progress', paintDone);
    paintDone();
    var here = $('.map a.here'); if (here) { here.scrollIntoView({ block: 'center' }); }
    var links = $$('.toc a'), targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    if (links.length && window.IntersectionObserver) {
      var io = new IntersectionObserver(function () {
        var y = 120, best = 0;
        targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top < y) { best = i; } });
        links.forEach(function (a, i) { a.classList.toggle('on', i === best); });
      }, { rootMargin: '0px 0px -60% 0px', threshold: [0, 1] });
      targets.forEach(function (t) { if (t) { io.observe(t); } });
    }
  }

  /* module tests and the mixed test */
  var tb = $('section.testbody');
  if (tb) {
    var tid = tb.getAttribute('data-test');
    if (tid === 'mixed') {
      var all = (window.TANDEM_MCQ || []), done = TD.prog('done');
      var pool = all.filter(function (q) { return (!q.lang || q.lang === TD.lang()) && (done[q.lesson] || Object.keys(done).length < 3); });
      if (pool.length < 20) { pool = all.filter(function (q) { return !q.lang || q.lang === TD.lang(); }); }
      for (var i = pool.length - 1; i > 0; i -= 1) { var j = Math.floor(Math.random() * (i + 1)), x = pool[i]; pool[i] = pool[j]; pool[j] = x; }
      tb.innerHTML = pool.slice(0, 20).map(function (q) {
        return '<div class="mcq" data-id="' + esc(q.id) + '" data-a="' + q.a.join(',') + '" data-multi="' + (q.multi ? 1 : 0) + '"' + (q.lang ? ' data-lang="' + q.lang + '"' : '') + '><div class="mq"><span class="qn"></span><div class="qt">' +
          (q.multi ? '' : '') + q.q + (q.multi ? '<span class="qmulti">Select all that apply</span>' : '') + '</div></div><ol class="opts">' +
          q.o.map(function (o, k) { return '<li><button type="button" class="opt" data-i="' + k + '"><span class="ok">' + String.fromCharCode(65 + k) + '</span><span class="ot">' + o + '</span></button></li>'; }).join('') +
          '</ol>' + (q.multi ? '<button type="button" class="btn small qcheck">Check answer</button>' : '') + '<div class="why" hidden><strong>Why.</strong> ' + q.why +
          '<div class="qsrc">From: <a href="' + q.lesson + '.html">' + esc(q.title) + '</a></div></div></div>';
      }).join('');
      if (TD.highlightAll) { TD.highlightAll(tb); }
    }
    var tprog = $('#tprog'), tscore = $('#tscore'), end = $('#testend');
    var drill = tb.hasAttribute('data-drill'), minutes = +(tb.getAttribute('data-minutes') || 0), exam = drill && minutes > 0;
    var started = 0, clock = null, used = '';
    function mmss(ms) { var t = Math.max(0, Math.round(ms / 1000)); return (t < 600 ? '0' : '') + Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60); }
    var update = function () {
      var ms = visibleMCQs(tb), dn = ms.filter(function (m) { return m.classList.contains('done'); }), right = dn.filter(function (m) { return m.classList.contains('answered'); });
      if (exam && dn.length < ms.length) {
        tprog.textContent = ms.filter(function (m) { return m.hasPick(); }).length + ' of ' + ms.length + ' answered';
        tscore.textContent = '';
        return;
      }
      tprog.textContent = dn.length + ' of ' + ms.length + ' answered';
      tscore.textContent = dn.length ? Math.round(100 * right.length / dn.length) + '% right so far' : '';
      if (dn.length === ms.length && ms.length) {
        var pct = Math.round(100 * right.length / ms.length), best = TD.prog('test')[tid];
        if (!best || pct >= best.pct) { TD.setProg('test', tid, { pct: pct, ts: Date.now() }); }
        end.hidden = false;
        var missed = ms.filter(function (m) { return !m.classList.contains('answered'); });
        end.innerHTML = '<h2>You scored ' + pct + '%' + (used ? ' in ' + used : '') + '</h2><p>' + (drill
            ? (pct >= 85 ? 'That clears a real online assessment. Try another set tomorrow so it stays automatic.' : pct >= 65 ? 'Borderline for a real cut off. Read the why under every miss above, then retake this set in two days.' : 'Not yet. Read every explanation above, let Bar Raiser drill your misses, and retake this set later this week.')
            : (pct >= 90 ? 'Interview ready on this module. Keep it fresh with the mixed test.' : pct >= 70 ? 'Close. Reread the why under each miss, then try again tomorrow.' : 'Go back to the lessons behind the misses; each question links to its lesson.')) + '</p>' +
          (missed.length ? '<button type="button" class="btn" data-drill>Ask Bar Raiser to drill my ' + missed.length + ' misses</button>' : '');
        var d = $('[data-drill]', end);
        if (d) {
          d.addEventListener('click', function () {
            TD.askBarRaiser('I just took a module test and missed these questions. Drill me on the ideas behind them with fresh questions, one at a time, and mark each answer:\n' +
              missed.map(function (m, k) { return (k + 1) + '. ' + $('.qt', m).innerText.trim().slice(0, 300); }).join('\n'), { show: 'Drill my test misses.' });
          });
        }
      }
    };
    $$('.mcq', tb).forEach(function (m) { wireMCQ(m, update, exam); });
    function shuffle() { var ms = $$('.mcq', tb); for (var a = ms.length - 1; a > 0; a -= 1) { var b = Math.floor(Math.random() * (a + 1)); tb.insertBefore(ms[a], ms[b]); } }
    function shuffleOptions() {   /* drills only: a retake should test the idea, not the position of the answer */
      $$('.mcq', tb).forEach(function (m) {
        var ol = $('ol.opts', m), lis = $$('li', ol);
        for (var a = lis.length - 1; a > 0; a -= 1) { var b = Math.floor(Math.random() * (a + 1)); var t = lis[a]; lis[a] = lis[b]; lis[b] = t; }
        lis.forEach(function (li, k) { ol.appendChild(li); var ok = $('.ok', li); if (ok) { ok.textContent = String.fromCharCode(65 + k); } });
      });
    }
    $('[data-treset]').addEventListener('click', function () {
      $$('.mcq', tb).forEach(function (m) { m.reset(); }); end.hidden = true; used = '';
      if (drill) { tb.hidden = true; $('.drillbar').hidden = true; $('#dstart').hidden = false; $('[data-dsubmit]').hidden = false; $('[data-treset]').hidden = true; $('#dtimer').classList.remove('low'); }
      update(); window.scrollTo(0, 0);
    });
    if ($('[data-tshuffle]')) { $('[data-tshuffle]').addEventListener('click', shuffle); }
    function submitAll() {
      if (clock) { clearInterval(clock); clock = null; }
      used = mmss(Date.now() - started);
      $$('.mcq', tb).forEach(function (m) { m.submit(); });
      $('[data-dsubmit]').hidden = true; $('[data-treset]').hidden = false;
      update(); end.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (drill) {
      $('[data-dstart]').addEventListener('click', function () {
        shuffle(); shuffleOptions(); $('#dstart').hidden = true; $('.drillbar').hidden = false; tb.hidden = false; started = Date.now();
        if (exam) {
          var timer = $('#dtimer'), limit = minutes * 60000;
          var tick = function () { var left = limit - (Date.now() - started); timer.textContent = mmss(left); timer.classList.toggle('low', left < 60000); if (left <= 0) { TD.toast('Time is up. Here is how you did.'); submitAll(); } };
          tick(); clock = setInterval(tick, 250);
        } else { $('#dtimer').hidden = true; $('[data-dsubmit]').hidden = true; }
        update();
      });
      $('[data-dsubmit]').addEventListener('click', function () {
        var open = visibleMCQs(tb).filter(function (m) { return !m.hasPick(); }).length;
        if (open && !window.confirm(open + (open === 1 ? ' question is' : ' questions are') + ' still unanswered. Submit anyway?')) { return; }
        submitAll();
      });
    }
    update();
    var best0 = TD.prog('test')[tid]; if (best0) { tscore.textContent = 'Best so far: ' + best0.pct + '%'; }
  }
})();

/* speech.js */
/* Tandem front end, speaking practice: answer out loud, see your delivery numbers, hear yourself, get scored.
   Recording happens in the browser; transcription happens on this Mac (Whisper, verbatim mode); Bar Raiser marks
   content and delivery. Used by "Say it out loud" cards, "Answer out loud" buttons and the Speaking page. */
(function () {
  'use strict';
  var TD = window.Tandem, $ = TD.$, $$ = TD.$$, esc = TD.esc, store = TD.store, body = document.body;

  var RATE = {
    pace: { good: 'comfortable', slow: 'slow', fast: 'too fast' },
    fillers: { good: 'clean', ok: 'some', work: 'too many' },
    hedges: { good: 'confident', ok: 'some hedging', work: 'too much hedging' },
    pauses: { good: 'fine', ok: 'a few long ones', work: 'many long ones' },
    length: { good: 'on target', short: 'too short', long: 'too long' },
    start: { good: 'quick start', slow: 'slow start' }
  };
  var CLS = { good: 'g', ok: 'o', work: 'b', slow: 'o', fast: 'o', short: 'o', long: 'o' };

  function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function plain(html) { var d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); }
  function canRecord() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  function lang() { var l = store.get('speak.lang', 'en'); return l === 'hinglish' ? 'hinglish' : 'en'; }

  /* one recording: microphone, a level meter and a timer */
  function record(onTick, onLevel) {
    var api = {};
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }).then(function (stream) {
      var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].filter(function (x) { return MediaRecorder.isTypeSupported(x); })[0];
      var rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      var chunks = [], t0 = Date.now(), raf = 0, timer = 0, ctx = null;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        var an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
        var buf = new Uint8Array(an.fftSize);
        var tick = function () { an.getByteTimeDomainData(buf); var m = 0; for (var i = 0; i < buf.length; i += 1) { m = Math.max(m, Math.abs(buf[i] - 128)); } onLevel(m / 128); raf = requestAnimationFrame(tick); };
        tick();
      } catch (e) { ctx = null; }
      timer = setInterval(function () { onTick((Date.now() - t0) / 1000); }, 250);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) { chunks.push(e.data); } };
      rec.start(250);
      api.stop = function () {
        return new Promise(function (res) {
          rec.onstop = function () {
            clearInterval(timer); cancelAnimationFrame(raf);
            stream.getTracks().forEach(function (t) { t.stop(); });
            if (ctx) { ctx.close(); }
            res({ blob: new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), secs: (Date.now() - t0) / 1000 });
          };
          rec.stop();
        });
      };
      return api;
    });
  }

  function metricsHTML(m) {
    var r = m.ratings || {};
    function chip(label, value, key) { var v = r[key]; return '<span class="mchip ' + (CLS[v] || 'g') + '"><b>' + esc(value) + '</b>' + esc(label) + (v && RATE[key] ? '<i>' + esc(RATE[key][v] || v) + '</i>' : '') + '</span>'; }
    var kinds = Object.keys(m.filler_kinds || {}).sort(function (a, b) { return m.filler_kinds[b] - m.filler_kinds[a]; })
      .map(function (k) { return esc(k) + ' ' + m.filler_kinds[k]; }).join(' · ');
    return '<div class="mchips">' +
      chip(m.target ? 'length (target ' + mmss(m.target) + ')' : 'length', mmss(m.speak_secs), 'length') +
      chip('words per minute', m.wpm, 'pace') +
      chip('fillers (' + m.filler_per_min + ' a minute)', m.fillers, 'fillers') +
      chip('hedges', m.hedges, 'hedges') +
      chip('pauses over 2 s', m.long_pauses, 'pauses') +
      chip('s before the first word', m.start_delay, 'start') + '</div>' +
      (kinds ? '<p class="mkinds">Fillers: ' + kinds + '</p>' : '');
  }

  function transcriptHTML(rec) {
    var toks = rec.tokens || [];
    if (!toks.length) { return '<p class="ttext">' + esc(rec.text) + '</p>'; }
    return '<p class="ttext">' + toks.map(function (t) { return t[1] ? '<mark class="' + t[1] + '">' + esc(t[0]) + '</mark>' : esc(t[0]); }).join(' ') + '</p>' +
      '<p class="tlegend"><mark class="filler">filler</mark><mark class="hedge">hedge</mark><mark class="repeat">repeat</mark></p>';
  }

  function scoreHTML(k) {
    function list(title, arr) { return arr && arr.length ? '<div class="sgroup"><div class="mlabel">' + title + '</div><ul>' + arr.map(function (x) { return '<li>' + TD.md(x).replace(/^<p>|<\/p>$/g, '') + '</li>'; }).join('') + '</ul></div>' : ''; }
    function block(title, text) { return text ? '<div class="sgroup"><div class="mlabel">' + title + '</div>' + TD.md(text) + '</div>' : ''; }
    function num(x) { return x === null || x === undefined ? '?' : (Math.round(x * 10) / 10); }
    return '<div class="scard"><div class="sscores"><div class="sscore"><b>' + num(k.content) + '</b><span>of 5</span><em>Content</em></div>' +
      '<div class="sscore"><b>' + num(k.delivery) + '</b><span>of 5</span><em>Delivery</em></div>' +
      '<p class="sverdict">' + esc(k.verdict || k.say || '') + '</p></div>' +
      block('Structure', k.structure) + list('What worked', k.good) + list('What to change', k.fix) +
      block('Your answer, tightened', k.rewrite) + block('How a strong senior would say it', k.model) +
      (k.drill ? '<div class="sdrill"><strong>Next attempt, practise this:</strong> ' + esc(k.drill) + '</div>' : '') +
      (k.followup ? '<div class="sfollow"><strong>The interviewer\'s next question:</strong> <span>' + esc(k.followup) + '</span> <button type="button" class="btn ghost small" data-fanswer>Answer it out loud</button></div>' : '') +
      '</div>';
  }

  /* mount a recorder for one question; spec = {qid, q, points, model, follow, seconds, onAttempt} */
  function mount(host, spec) {
    if (host.getAttribute('data-mounted')) { return; }
    host.setAttribute('data-mounted', '1');
    host.hidden = false;
    var target = spec.seconds || 90, current = null, rec = null;
    if (TD.static) {   /* the online copy cannot record: answer out loud yourself, then compare */
      host.innerHTML = '<div class="spkstatic"><p>Answer out loud first, as if the interviewer just asked, in about ' + mmss(target) + '. Then compare.</p>' +
        (spec.onAttempt ? '<button type="button" class="btn small" data-spts>Show what a strong answer covers</button>' : '') +
        (spec.onModel ? '<button type="button" class="btn ghost small" data-smodel>Show the model answer</button>' : '') + '</div>';
      var sp = $('[data-spts]', host), sm = $('[data-smodel]', host);
      if (sp) { sp.addEventListener('click', function () { spec.onAttempt(); sp.hidden = true; }); }
      if (sm) { sm.addEventListener('click', function () { spec.onModel(); sm.hidden = true; }); }
      return host;
    }
    host.innerHTML = '<div class="spkbar"><button type="button" class="btn rec" data-rec><span class="dot"></span><span data-rl>Record your answer</span></button>' +
      '<span class="spktime" data-time hidden>0:00 / ' + mmss(target) + '</span><span class="spklevel" data-level hidden><i></i></span>' +
      '<select class="spklang" data-slang title="Language you will speak in"><option value="en">English</option><option value="hinglish">Hinglish</option></select>' +
      '<span class="spkhint" data-hint>Answer as if the interviewer just asked. Aim for about ' + mmss(target) + '.</span></div>' +
      '<div class="spkout" data-out></div><div class="spkhist" data-hist></div>';
    var btn = $('[data-rec]', host), lbl = $('[data-rl]', host), tm = $('[data-time]', host), lv = $('[data-level]', host), out = $('[data-out]', host), sel = $('[data-slang]', host);
    sel.value = lang();
    sel.addEventListener('change', function () { store.set('speak.lang', sel.value); });
    if (!canRecord()) { btn.disabled = true; $('[data-hint]', host).textContent = 'This browser cannot record audio. Please use Chrome or Safari.'; }

    function showAttempt(r) {
      current = r;
      out.innerHTML = '<div class="attempt"><div class="ahead"><span class="mlabel">Your answer, ' + esc((r.ts || '').slice(5, 16)) + '</span>' +
        '<audio controls preload="none" src="' + TD.root + 'api/speech/audio?user=' + TD.learner() + '&id=' + r.id + '"></audio></div>' +
        metricsHTML(r.metrics || {}) + transcriptHTML(r) +
        '<div class="cqa"><button type="button" class="btn small" data-score>' + (r.mark ? 'Scored' : 'Get Bar Raiser\'s scorecard') + '</button>' +
        (spec.model ? '<button type="button" class="btn ghost small" data-showmodel>Show the model answer</button>' : '') +
        '<button type="button" class="btn ghost small" data-del>Delete this attempt</button></div><div class="sout">' + (r.mark ? scoreHTML(r.mark) : '') + '</div></div>';
      if (r.mark) { $('[data-score]', out).disabled = true; wireScore(); }
      $('[data-score]', out).addEventListener('click', score);
      var sm = $('[data-showmodel]', out); if (sm) { sm.addEventListener('click', function () { if (spec.onModel) { spec.onModel(); } sm.hidden = true; }); }
      $('[data-del]', out).addEventListener('click', function () {
        if (!window.confirm('Delete this recording and its scores?')) { return; }
        TD.api('speech/delete', { user: TD.learner(), id: r.id }).then(function () { out.innerHTML = ''; loadHistory(); });
      });
      if (spec.onAttempt) { spec.onAttempt(); }
    }

    function wireScore() {
      var f = $('[data-fanswer]', out);
      if (!f) { return; }
      f.addEventListener('click', function () {
        var box = document.createElement('div'); box.className = 'spk followbox';
        f.parentNode.parentNode.appendChild(box); f.hidden = true;
        mount(box, { qid: spec.qid + '.f', q: current.mark.followup, seconds: 75, points: [], model: '', follow: '' });
      });
    }

    function score() {
      var b = $('[data-score]', out), so = $('.sout', out);
      b.disabled = true; b.textContent = 'Bar Raiser is listening to your answer...';
      TD.api('speech/mark', { user: TD.learner(), id: current.id, q: plain(spec.q), points: spec.points || [], model: plain(spec.model),
                              follow: plain(spec.follow), seconds: target, page: location.pathname.split('/').pop(),
                              slug: body.getAttribute('data-slug') || '', title: body.getAttribute('data-title') || document.title })
        .then(function (j) { current.mark = j.mark; so.innerHTML = scoreHTML(j.mark); b.textContent = 'Scored'; wireScore(); loadHistory(); TD.emit('speech', current); })
        .catch(function (e) { b.disabled = false; b.textContent = 'Get Bar Raiser\'s scorecard'; so.innerHTML = '<p class="serr">' + esc(e.message) + ' Your recording and numbers are saved; ask again later.</p>'; });
    }

    function loadHistory() {
      TD.getJSON('speech?user=' + TD.learner() + '&qid=' + encodeURIComponent(spec.qid)).then(function (j) {
        var items = (j.items || []).slice().reverse(), h = $('[data-hist]', host);
        if (!items.length) { h.innerHTML = ''; return; }
        h.innerHTML = '<details' + (current ? '' : ' open') + '><summary>Your attempts (' + items.length + ')</summary><ol>' + items.map(function (r, i) {
          var m = r.metrics || {}, k = r.mark;
          return '<li><button type="button" class="linkish" data-att="' + i + '">' + esc((r.ts || '').slice(5, 16)) + '</button> ' + mmss(m.speak_secs || 0) + ' · ' + (m.wpm || 0) + ' wpm · ' +
            (m.filler_per_min || 0) + ' fillers a minute' + (k ? ' · content ' + k.content + ', delivery ' + k.delivery : '') + '</li>';
        }).join('') + '</ol></details>';
        $$('[data-att]', h).forEach(function (b) { b.addEventListener('click', function () { showAttempt(items[+b.getAttribute('data-att')]); }); });
      }).catch(function () { /* offline: the server is not running */ });
    }

    btn.addEventListener('click', function () {
      if (rec) {
        btn.disabled = true; lbl.textContent = 'Transcribing on this Mac...';
        rec.stop().then(function (r) {
          rec = null; tm.hidden = true; lv.hidden = true; btn.classList.remove('on');
          if (r.secs < 2) { btn.disabled = false; lbl.textContent = 'Record your answer'; TD.toast('That was too short to score. Try again.'); return; }
          return fetch(TD.root + 'api/speech?user=' + TD.learner() + '&qid=' + encodeURIComponent(spec.qid) + '&lang=' + sel.value + '&target=' + target,
                       { method: 'POST', headers: { 'Content-Type': r.blob.type || 'application/octet-stream', 'X-Tandem': '1' }, body: r.blob })
            .then(function (x) { return x.json(); })
            .then(function (j) {
              btn.disabled = false; lbl.textContent = 'Record again';
              if (j.error) { TD.toast(j.error); return; }
              showAttempt(j); loadHistory();
            });
        }).catch(function (e) { btn.disabled = false; lbl.textContent = 'Record your answer'; TD.toast('Could not save the recording: ' + e.message); });
        return;
      }
      record(function (s) { tm.textContent = mmss(s) + ' / ' + mmss(target); tm.classList.toggle('over', s > target * 1.3); },
             function (l) { $('i', lv).style.width = Math.min(100, Math.round(l * 160)) + '%'; })
        .then(function (r) { rec = r; btn.classList.add('on'); lbl.textContent = 'Stop and score'; tm.hidden = false; lv.hidden = false; })
        .catch(function () { TD.toast('Microphone access was blocked. Allow it in the browser, then try again.'); });
    });
    loadHistory();
    return host;
  }
  TD.speakMount = mount;

  function cardSpec(card) {
    var pts = $$('.sqpts li', card).map(function (li) { return li.textContent.trim(); });
    return {
      qid: card.getAttribute('data-sq'), q: $('.qtext', card).innerHTML, points: pts,
      model: ($('.mtext', card) || {}).innerHTML || '', follow: ($('.ftext', card) || {}).textContent || '',
      seconds: +card.getAttribute('data-seconds') || 90,
      onAttempt: function () { var p = $('.sqpts', card); if (p) { p.hidden = false; } },
      onModel: function () { var m = $('.model', card); if (m) { m.hidden = false; } }
    };
  }
  TD.speakCardSpec = cardSpec;

  /* "Say it out loud" cards in lessons */
  $$('.sayit .sq').forEach(function (card) { mount($('.spk', card), cardSpec(card)); });

  /* "Answer out loud" on checkpoint and theory cards: the model answer is the reference */
  $$('[data-speak]').forEach(function (b) {
    b.addEventListener('click', function () {
      var card = b.closest('.cq'), host = $('.spk', card);
      var model = $('.model', card), mhtml = model ? model.innerHTML.replace(/<div class="mlabel">.*?<\/div>/, '') : '';
      mount(host, { qid: card.getAttribute('data-q'), q: $('.qtext', card).innerHTML, model: mhtml, points: [], follow: '', seconds: 90,
                    onModel: function () { if (model) { model.hidden = false; } } });
      b.hidden = true;
      host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  /* the Speaking page */
  if (!body.classList.contains('page-speak')) { return; }
  var ALL = (window.TANDEM_SPEAK || []).filter(function (it) { return it.track === 'core' || it.track === TD.lang(); });
  var BYID = {}; ALL.forEach(function (it) { BYID[it.id] = it; });

  function cardFor(it, n) {
    var d = document.createElement('div');
    d.className = 'sq'; d.setAttribute('data-sq', it.id); d.setAttribute('data-seconds', it.seconds);
    d.innerHTML = '<div class="cqh">' + (n ? '<span class="tqn">' + n + '</span>' : '') + '<span class="kind k-speak">Out loud</span><span class="sqt">about ' + it.seconds + ' s</span>' +
      '<a class="sqsrc" href="' + it.lesson + '.html#say-it">' + esc(it.title) + '</a></div><div class="qtext">' + it.q + '</div><div class="spk"></div>' +
      '<div class="sqpts" hidden><div class="mlabel">What a strong answer covers</div><ul>' + it.points.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>' +
      '<div class="model" hidden><div class="mlabel">How a senior would say it</div><div class="mtext">' + it.model + '</div>' +
      (it.follow ? '<p class="follow"><strong>Likely follow up:</strong> <span class="ftext">' + it.follow + '</span></p>' : '') + '</div>';
    if (TD.highlightAll) { TD.highlightAll(d); }
    return d;
  }
  function open(it, where, n) { var d = cardFor(it, n); where.appendChild(d); mount($('.spk', d), cardSpec(d)); return d; }

  /* numbers over time */
  function stats(recs) {
    var box = $('#spstats');
    var withM = recs.filter(function (r) { return r.metrics; }), last = withM.slice(-10);
    if (!withM.length) { return; }
    function avg(a) { return a.length ? Math.round(10 * a.reduce(function (x, y) { return x + y; }, 0) / a.length) / 10 : null; }
    var marked = last.filter(function (r) { return r.mark; });
    var c = avg(marked.map(function (r) { return r.mark.content || 0; })), dl = avg(marked.map(function (r) { return r.mark.delivery || 0; }));
    function spark(vals, good) {
      if (vals.length < 2) { return ''; }
      var max = Math.max.apply(null, vals.concat([good * 1.5])), w = 160, h = 36;
      var pts = vals.map(function (v, i) { return Math.round(i * w / (vals.length - 1)) + ',' + Math.round(h - 4 - (h - 8) * v / max); }).join(' ');
      return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '"><line x1="0" x2="' + w + '" y1="' + Math.round(h - 4 - (h - 8) * good / max) + '" y2="' + Math.round(h - 4 - (h - 8) * good / max) + '" class="gl"/><polyline points="' + pts + '"/></svg>';
    }
    var fpm = withM.slice(-20).map(function (r) { return r.metrics.filler_per_min; });
    box.innerHTML = '<div class="kchips">' +
      '<div class="kchip"><b>' + withM.length + '</b>recordings</div>' +
      '<div class="kchip"><b>' + avg(last.map(function (r) { return r.metrics.wpm; })) + '</b>words a minute (last 10)</div>' +
      '<div class="kchip"><b>' + avg(last.map(function (r) { return r.metrics.filler_per_min; })) + '</b>fillers a minute (last 10)' + spark(fpm, 2) + '</div>' +
      (c !== null ? '<div class="kchip"><b>' + c + '</b>content score (last 10 scored)</div><div class="kchip"><b>' + dl + '</b>delivery score (last 10 scored)</div>' : '') +
      '</div>';
  }

  function recent(recs) {
    var box = $('#sprecent'), items = recs.slice(-12).reverse();
    if (!items.length) { return; }
    box.innerHTML = '<ol class="sprec">' + items.map(function (r) {
      var it = BYID[r.qid], m = r.metrics || {}, k = r.mark;
      var title = it ? plain(it.q).slice(0, 110) : (r.q ? plain(r.q).slice(0, 110) : r.qid);
      return '<li><span class="when">' + esc((r.ts || '').slice(5, 16)) + '</span> <span class="what">' + esc(title) + '</span> <span class="nums">' + Math.round(m.speak_secs || 0) + ' s · ' + (m.wpm || 0) + ' wpm · ' +
        (m.filler_per_min || 0) + ' fillers a minute' + (k ? ' · content ' + k.content + ', delivery ' + k.delivery : ' · not scored yet') + '</span>' +
        (it ? ' <button type="button" class="linkish" data-again="' + esc(r.qid) + '">Practise again</button>' : '') + '</li>';
    }).join('') + '</ol>';
    $$('[data-again]', box).forEach(function (b) { b.addEventListener('click', function () { var d = open(BYID[b.getAttribute('data-again')], $('#screenbox')); d.scrollIntoView({ behavior: 'smooth' }); }); });
  }

  function list(which) {
    var done = TD.prog('done'), box = $('#sqlist');
    var items = which === 'done' ? ALL.filter(function (it) { return done[it.lesson]; }) : ALL;
    if (!items.length) { box.innerHTML = '<p class="empty">' + (which === 'done' ? 'Finish a lesson and its spoken questions show up here. Or pick All.' : 'No spoken questions yet.') + '</p>'; return; }
    var groups = {};
    items.forEach(function (it) { var k = (it.track === 'core' ? 'Module ' : TD.who().langName + ' refresher, module ') + (it.module < 10 ? '0' : '') + it.module; (groups[k] = groups[k] || []).push(it); });
    box.innerHTML = Object.keys(groups).map(function (g) {
      return '<details class="sqgroup"><summary>' + esc(g) + ' <span>' + groups[g].length + ' questions</span></summary><ul>' + groups[g].map(function (it) {
        return '<li><button type="button" class="linkish" data-open="' + esc(it.id) + '">' + esc(plain(it.q).slice(0, 160)) + '</button> <span class="from">' + esc(it.title) + '</span><div class="openbox"></div></li>';
      }).join('') + '</ul></details>';
    }).join('');
    $$('[data-open]', box).forEach(function (b) {
      b.addEventListener('click', function () { var ob = b.parentNode.querySelector('.openbox'); if (!ob.firstChild) { open(BYID[b.getAttribute('data-open')], ob); } });
    });
  }
  $$('[data-sfilter]').forEach(function (b) {
    b.addEventListener('click', function () { $$('[data-sfilter]').forEach(function (x) { x.classList.toggle('on', x === b); }); list(b.getAttribute('data-sfilter')); });
  });
  list('done');

  $('[data-screen]').addEventListener('click', function () {
    var done = TD.prog('done'), pool = ALL.filter(function (it) { return done[it.lesson]; });
    if (pool.length < 5) { pool = ALL.slice(); }
    for (var i = pool.length - 1; i > 0; i -= 1) { var j = Math.floor(Math.random() * (i + 1)), x = pool[i]; pool[i] = pool[j]; pool[j] = x; }
    var box = $('#screenbox'); box.innerHTML = '<p class="shsub">Answer each one out loud, in order, as if on a call. Keep each to about two minutes.</p>';
    pool.slice(0, 5).forEach(function (it, k) { open(it, box, k + 1); });
    box.scrollIntoView({ behavior: 'smooth' });
  });

  TD.getJSON('speech?user=' + TD.learner()).then(function (j) { stats(j.items || []); recent(j.items || []); }).catch(function () {});
  TD.on('speech', function () { TD.getJSON('speech?user=' + TD.learner()).then(function (j) { stats(j.items || []); recent(j.items || []); }); });
})();

/* widgets.js */
/* Tandem front end, interactive simulators used inside lessons: <widget name="...">. */
(function () {
  'use strict';
  var TD = window.Tandem, $ = TD.$, $$ = TD.$$, esc = TD.esc;
  function fmt(n) { return Math.round(n).toLocaleString('en-IN'); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function slider(id, label, min, max, step, val, unit) {
    return '<label class="wslider"><span>' + esc(label) + '</span><input type="range" data-s="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><output data-o="' + id + '"></output></label>';
  }
  function head(t, s) { return '<div class="wtitle">' + esc(t) + '</div><div class="wsub">' + esc(s) + '</div>'; }
  function val(w, id) { return Number($('[data-s="' + id + '"]', w).value); }
  function out(w, id, text) { $('[data-o="' + id + '"]', w).textContent = text; }

  var W = {};

  /* 1. a lost update, one instruction at a time */
  W['race-stepper'] = function (w) {
    w.innerHTML = head('Watch an increment disappear', 'Two threads each run count += 1, which is really read, add, write. Step through the interleaving.') +
      '<div class="wrow"><button type="button" class="chip on" data-mode="unsafe">No lock</button><button type="button" class="chip" data-mode="locked">Same lock</button></div>' +
      '<div class="wgrid"><div class="wbox"><div class="wl">Thread A register</div><div class="wv" data-ra>none</div></div>' +
      '<div class="wbox"><div class="wl">Thread B register</div><div class="wv" data-rb>none</div></div>' +
      '<div class="wbox hot"><div class="wl">count in memory</div><div class="wv" data-mem>0</div></div></div>' +
      '<div class="wsteps" data-steps></div><div class="wrow"><button type="button" class="btn small" data-next>Next step</button><button type="button" class="btn ghost small" data-auto>Play all</button><button type="button" class="btn ghost small" data-reset>Reset</button></div><div class="wnote" data-note>Two increments should end at 2.</div>';
    var mode = 'unsafe', i = 0, ra = null, rb = null, mem = 0, timer = 0;
    var SEQ = { unsafe: ['A read', 'B read', 'A add', 'B add', 'A write', 'B write'], locked: ['A lock', 'A read', 'A add', 'A write', 'A unlock', 'B lock', 'B read', 'B add', 'B write', 'B unlock'] };
    function paint(note) {
      $('[data-ra]', w).textContent = ra === null ? 'none' : ra; $('[data-rb]', w).textContent = rb === null ? 'none' : rb; $('[data-mem]', w).textContent = mem;
      $('[data-steps]', w).innerHTML = SEQ[mode].map(function (s, k) { return '<div class="' + (k < i ? 'did' : k === i ? 'cur' : '') + '">' + (k + 1) + '. Thread ' + esc(s) + '</div>'; }).join('');
      var n = $('[data-note]', w); n.className = 'wnote'; n.textContent = note || 'Two increments should end at 2.';
    }
    function reset() { clearInterval(timer); i = 0; ra = rb = null; mem = 0; paint(); }
    function step() {
      var seq = SEQ[mode]; if (i >= seq.length) { return false; }
      var p = seq[i].split(' '), th = p[0], op = p[1], note = '';
      if (op === 'read') { if (th === 'A') { ra = mem; } else { rb = mem; } note = 'Thread ' + th + ' copies count (' + mem + ') into its private register.'; }
      else if (op === 'add') { if (th === 'A') { ra += 1; } else { rb += 1; } note = 'Thread ' + th + ' adds 1 in its register. Memory has not changed.'; }
      else if (op === 'write') { mem = th === 'A' ? ra : rb; note = 'Thread ' + th + ' writes ' + mem + ' to memory.'; }
      else if (op === 'lock') { note = 'Thread ' + th + ' takes the lock. The other thread would have to wait.'; }
      else { note = 'Thread ' + th + ' releases the lock, publishing its write.'; }
      i += 1; paint(note);
      if (i === seq.length) {
        var n = $('[data-note]', w);
        if (mem === 2) { n.className = 'wnote good'; n.textContent = 'count is 2. The lock made read, add, write one indivisible step.'; }
        else { n.className = 'wnote bad'; n.textContent = 'count is 1. Both threads read 0, so the second write erased the first: a lost update.'; }
      }
      return i < seq.length;
    }
    $$('[data-mode]', w).forEach(function (b) { b.addEventListener('click', function () { mode = b.getAttribute('data-mode'); $$('[data-mode]', w).forEach(function (x) { x.classList.toggle('on', x === b); }); reset(); }); });
    $('[data-next]', w).addEventListener('click', step);
    $('[data-reset]', w).addEventListener('click', reset);
    $('[data-auto]', w).addEventListener('click', function () { reset(); timer = setInterval(function () { if (!step()) { clearInterval(timer); } }, 650); });
    paint();
  };

  /* 2. a stop flag across two cores */
  W.visibility = function (w) {
    var vol = TD.lang() === 'cpp' ? 'std::atomic<bool>' : 'volatile';
    w.innerHTML = head('Send a stop signal across two cores', 'The reader loops while (!stop). The writer sets stop = true. Does the reader ever see it?') +
      '<div class="wrow"><button type="button" class="chip on" data-v="plain">plain bool</button><button type="button" class="chip" data-v="vol">' + esc(vol) + '</button><button type="button" class="chip" data-v="lock">read and write under one lock</button></div>' +
      '<div class="wgrid"><div class="wbox"><div class="wl">Writer core sees</div><div class="wv" data-w>false</div></div><div class="wbox hot"><div class="wl">Memory</div><div class="wv" data-m>false</div></div><div class="wbox"><div class="wl">Reader core sees</div><div class="wv" data-r>false</div></div></div>' +
      '<div class="wrow"><button type="button" class="btn small" data-write>Writer: stop = true</button><button type="button" class="btn ghost small" data-read>Reader: check again</button><button type="button" class="btn ghost small" data-reset>Reset</button></div><div class="wnote" data-note>No happens-before edge yet.</div>';
    var mode = 'plain', wrote = false;
    function paint(msg, cls) { $('[data-note]', w).textContent = msg; $('[data-note]', w).className = 'wnote ' + (cls || ''); }
    function reset() { wrote = false; $('[data-w]', w).textContent = 'false'; $('[data-m]', w).textContent = 'false'; $('[data-r]', w).textContent = 'false'; paint(mode === 'plain' ? 'Plain field: there is no happens-before edge between the write and the read.' : 'The write and the read will be connected by a happens-before edge.'); }
    $$('[data-v]', w).forEach(function (b) { b.addEventListener('click', function () { mode = b.getAttribute('data-v'); $$('[data-v]', w).forEach(function (x) { x.classList.toggle('on', x === b); }); reset(); }); });
    $('[data-write]', w).addEventListener('click', function () { wrote = true; $('[data-w]', w).textContent = 'true'; $('[data-m]', w).textContent = 'true'; paint('The writer stored true. Whether the reader must see it depends only on synchronization, not on time.'); });
    $('[data-read]', w).addEventListener('click', function () {
      var sees = wrote && mode !== 'plain';
      $('[data-r]', w).textContent = sees ? 'true' : 'false';
      if (sees) { paint('The reader sees true and stops: the ' + (mode === 'lock' ? 'unlock to lock' : vol + ' write to read') + ' edge guarantees it.', 'good'); }
      else if (wrote) { paint('The reader may keep seeing false forever: the compiler may hoist the read out of the loop, and nothing forces a fresh one. Waiting longer does not help.', 'bad'); }
      else { paint('Nothing written yet.'); }
    });
    $('[data-reset]', w).addEventListener('click', reset);
    reset();
  };

  /* 3. Little's law */
  W['littles-law'] = function (w) {
    w.innerHTML = head('Little\'s law: how much work is in flight', 'In flight = arrival rate x time in system. It is always true in a steady state.') +
      slider('rate', 'Arrivals per second', 50, 5000, 50, 1000) + slider('lat', 'Time in system (ms)', 5, 2000, 5, 80) +
      '<div class="wgrid"><div class="wbox hot"><div class="wl">In flight</div><div class="wv" data-inf></div></div><div class="wbox"><div class="wl">Threads if each holds one</div><div class="wv" data-thr></div></div><div class="wbox"><div class="wl">Stack memory at 1 MB each</div><div class="wv" data-mem></div></div></div><div class="wdots" data-dots></div><div class="wnote" data-note></div>';
    function paint() {
      var r = val(w, 'rate'), l = val(w, 'lat'), inf = r * l / 1000;
      out(w, 'rate', fmt(r) + ' /s'); out(w, 'lat', l + ' ms');
      $('[data-inf]', w).textContent = fmt(inf); $('[data-thr]', w).textContent = fmt(Math.ceil(inf)); $('[data-mem]', w).textContent = inf >= 1024 ? (inf / 1024).toFixed(1) + ' GB' : fmt(inf) + ' MB';
      var shown = Math.min(160, Math.ceil(inf)); $('[data-dots]', w).innerHTML = new Array(shown + 1).join('<i></i>');
      $('[data-note]', w).textContent = 'If the downstream slows from ' + l + ' ms to ' + (l * 4) + ' ms at the same arrival rate, in flight work grows to ' + fmt(inf * 4) + '. That is why a slow dependency fills your thread pool.';
    }
    $$('input', w).forEach(function (x) { x.addEventListener('input', paint); }); paint();
  };

  /* 4. the utilization hockey stick */
  W.utilization = function (w) {
    w.innerHTML = head('Why latency explodes near 100 percent', 'For a single queue with random arrivals: waiting = service x rho / (1 - rho). Drag utilization.') +
      slider('u', 'Utilization of the bottleneck', 10, 98, 1, 70) +
      '<svg class="wcurve" viewBox="0 0 600 220"><line class="ax" x1="40" y1="190" x2="580" y2="190"/><line class="ax" x1="40" y1="10" x2="40" y2="190"/><path class="curve" data-c/><circle r="7" data-p/><text x="44" y="210">0%</text><text x="548" y="210">100%</text><text x="46" y="22">waiting time</text></svg>' +
      '<div class="wgrid"><div class="wbox"><div class="wl">Waiting, in service times</div><div class="wv" data-wait></div></div><div class="wbox hot"><div class="wl">Total time in system</div><div class="wv" data-tot></div></div><div class="wbox"><div class="wl">At 10 ms of service</div><div class="wv" data-ms></div></div></div><div class="wnote" data-note></div>';
    var pts = [];
    for (var k = 0; k <= 98; k += 1) { var r = k / 100, y = r / (1 - r); pts.push((40 + r * 540).toFixed(1) + ',' + (190 - Math.min(180, y * 3.6)).toFixed(1)); }
    $('[data-c]', w).setAttribute('d', 'M' + pts.join(' L'));
    function paint() {
      var u = val(w, 'u') / 100, wt = u / (1 - u);
      out(w, 'u', Math.round(u * 100) + '%');
      var c = $('[data-p]', w); c.setAttribute('cx', (40 + u * 540).toFixed(1)); c.setAttribute('cy', (190 - Math.min(180, wt * 3.6)).toFixed(1));
      $('[data-wait]', w).textContent = wt.toFixed(1) + 'x'; $('[data-tot]', w).textContent = (1 + wt).toFixed(1) + 'x'; $('[data-ms]', w).textContent = Math.round(10 * (1 + wt)) + ' ms';
      var n = $('[data-note]', w);
      n.className = 'wnote ' + (u > 0.85 ? 'bad' : u > 0.7 ? '' : 'good');
      n.textContent = u > 0.85 ? 'Past about 85 percent, small bursts create long queues and p99 explodes. Keep headroom or shed load.' : u > 0.7 ? 'The knee of the curve: still fine on average, but the tail is starting to move.' : 'Plenty of headroom: queues stay short.';
    }
    $$('input', w).forEach(function (x) { x.addEventListener('input', paint); }); paint();
  };

  /* 5. size a pool against a slow dependency */
  W['pool-sim'] = function (w) {
    w.innerHTML = head('Size a thread pool, then make the database slow', 'A request computes, then waits on a database that can serve a limited number of queries at once.') +
      slider('cores', 'CPU cores', 2, 32, 1, 8) + slider('cpu', 'CPU per request (ms)', 1, 50, 1, 5) + slider('wait', 'Database wait (ms)', 1, 1000, 1, 95) +
      slider('workers', 'Pool threads', 4, 400, 4, 64) + slider('rate', 'Arrivals per second', 50, 6000, 50, 800) + slider('db', 'Database concurrency limit', 10, 400, 10, 100) +
      '<div class="wgrid"><div class="wbox"><div class="wl">Formula start point</div><div class="wv" data-f></div></div><div class="wbox"><div class="wl">Needed in flight</div><div class="wv" data-l></div></div><div class="wbox hot"><div class="wl">Sustainable rate</div><div class="wv" data-c></div></div><div class="wbox" data-gb><div class="wl">Queue growth</div><div class="wv" data-g></div></div></div><div class="wnote" data-note></div>';
    function paint() {
      var cores = val(w, 'cores'), cpu = val(w, 'cpu'), wt = val(w, 'wait'), workers = val(w, 'workers'), rate = val(w, 'rate'), db = val(w, 'db');
      out(w, 'cores', cores); out(w, 'cpu', cpu + ' ms'); out(w, 'wait', wt + ' ms'); out(w, 'workers', workers); out(w, 'rate', fmt(rate) + ' /s'); out(w, 'db', db);
      var total = cpu + wt, formula = cores * (1 + wt / cpu), inflight = rate * total / 1000;
      var capWorkers = workers * 1000 / total, capCpu = cores * 1000 / cpu, capDb = db * 1000 / wt, cap = Math.min(capWorkers, capCpu, capDb);
      var growth = Math.max(0, rate - cap), limit = cap === capDb ? 'the database' : cap === capCpu ? 'the CPUs' : 'the pool size';
      $('[data-f]', w).textContent = fmt(formula) + ' threads'; $('[data-l]', w).textContent = fmt(inflight); $('[data-c]', w).textContent = fmt(cap) + ' /s';
      $('[data-g]', w).textContent = growth ? '+' + fmt(growth) + ' /s' : 'none'; $('[data-gb]', w).className = 'wbox ' + (growth ? 'bad' : 'good');
      var n = $('[data-note]', w);
      if (growth) { n.className = 'wnote bad'; n.textContent = 'Overloaded: ' + limit + ' caps you at ' + fmt(cap) + ' requests a second. ' + (cap === capDb ? 'Adding threads only sends more queries at a database that is already full. Cap database calls with a semaphore and shed the excess early.' : 'Queues grow every second; bound the queue and reject early rather than time out late.'); }
      else { n.className = 'wnote good'; n.textContent = 'Stable, with ' + fmt(cap - rate) + ' requests a second of headroom. The first limit you would hit is ' + limit + '.'; }
    }
    $$('input', w).forEach(function (x) { x.addEventListener('input', paint); }); paint();
  };

  /* 6. a deadlock lab */
  W['deadlock-lab'] = function (w) {
    w.innerHTML = head('Build a deadlock, then remove one condition', 'Two transfers run at once: A to B and B to A. Each locks the source account, then the destination.') +
      '<div class="wrow"><button type="button" class="chip on" data-m="unsafe">Lock in argument order</button><button type="button" class="chip" data-m="ordered">Lock in id order</button></div>' +
      '<div class="wlocks"><div class="wlock" data-lk="A">Lock on account A<small data-own="A">free</small></div><div class="wlock" data-lk="B">Lock on account B<small data-own="B">free</small></div></div>' +
      '<div class="wgrid"><div class="wbox"><div class="wl">Thread 1: A to B</div><div class="wv" data-t1>ready</div></div><div class="wbox"><div class="wl">Thread 2: B to A</div><div class="wv" data-t2>ready</div></div></div>' +
      '<div class="wrow"><button type="button" class="btn small" data-step>Next step</button><button type="button" class="btn ghost small" data-reset>Reset</button></div><div class="wnote" data-note></div>';
    var mode = 'unsafe', k = 0;
    function own(l, who) { $('[data-own="' + l + '"]', w).textContent = who || 'free'; $('[data-lk="' + l + '"]', w).classList.toggle('held', !!who); }
    function set(t1, t2, note, cls) { if (t1) { $('[data-t1]', w).textContent = t1; } if (t2) { $('[data-t2]', w).textContent = t2; } $('[data-note]', w).textContent = note; $('[data-note]', w).className = 'wnote ' + (cls || ''); }
    function reset() { k = 0; own('A'); own('B'); set('ready', 'ready', mode === 'unsafe' ? 'Each thread will lock its own source first.' : 'Both threads will lock the lower id first: A, then B.'); }
    var STEPS = {
      unsafe: [function () { own('A', 'thread 1'); set('holds A', null, 'Thread 1 locks A.'); }, function () { own('B', 'thread 2'); set(null, 'holds B', 'Thread 2 locks B.'); },
        function () { set('waits for B', 'waits for A', 'Each holds what the other needs. Mutual exclusion, hold and wait, no preemption, circular wait: all four hold. Nobody can move, forever.', 'bad'); }],
      ordered: [function () { own('A', 'thread 1'); set('holds A', null, 'Thread 1 locks A, the lower id.'); }, function () { set(null, 'waits for A', 'Thread 2 also starts with A, so it waits while holding nothing.'); },
        function () { own('B', 'thread 1'); set('holds A and B', null, 'Thread 1 takes B, transfers, and releases both.'); },
        function () { own('A', 'thread 2'); own('B', 'thread 2'); set('done', 'holds A and B', 'Thread 2 proceeds. A global lock order makes a cycle impossible.', 'good'); }]
    };
    $$('[data-m]', w).forEach(function (b) { b.addEventListener('click', function () { mode = b.getAttribute('data-m'); $$('[data-m]', w).forEach(function (x) { x.classList.toggle('on', x === b); }); reset(); }); });
    $('[data-step]', w).addEventListener('click', function () { if (k < STEPS[mode].length) { STEPS[mode][k](); k += 1; } });
    $('[data-reset]', w).addEventListener('click', reset);
    reset();
  };

  /* 7. threads versus cores */
  W.scheduler = function (w) {
    w.innerHTML = head('Threads versus cores', 'Only one thread per core runs at any instant. The rest wait in the run queue or are parked on I/O.') +
      '<div class="wrow"><button type="button" class="chip on" data-k="kernel">Kernel threads</button><button type="button" class="chip" data-k="virtual">Virtual threads or goroutines</button></div>' +
      slider('cores', 'Cores', 1, 16, 1, 8) + slider('threads', 'Threads', 1, 2000, 1, 64) + slider('wait', 'Time each thread waits on I/O', 0, 99, 1, 80) +
      '<div class="wcores" data-cores></div><div class="wgrid"><div class="wbox"><div class="wl">Runnable per core</div><div class="wv" data-p></div></div><div class="wbox hot"><div class="wl">Useful CPU</div><div class="wv" data-u></div></div><div class="wbox"><div class="wl">Stack memory</div><div class="wv" data-m></div></div></div><div class="wnote" data-note></div>';
    var kind = 'kernel';
    function paint() {
      var cores = val(w, 'cores'), th = val(w, 'threads'), wait = val(w, 'wait') / 100;
      out(w, 'cores', cores); out(w, 'threads', fmt(th)); out(w, 'wait', Math.round(wait * 100) + '%');
      var runnable = Math.max(0.01, th * (1 - wait)), pressure = runnable / cores;
      var tax = clamp((pressure - 1) * (kind === 'kernel' ? 0.035 : 0.012), 0, kind === 'kernel' ? 0.45 : 0.15);
      var useful = clamp(runnable / cores, 0, 1) * (1 - tax), mb = kind === 'kernel' ? th : th * 0.004;
      $('[data-p]', w).textContent = pressure.toFixed(1); $('[data-u]', w).textContent = Math.round(useful * 100) + '%';
      $('[data-m]', w).textContent = mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb >= 1 ? Math.round(mb) + ' MB' : Math.round(mb * 1024) + ' KB';
      var html = ''; for (var c = 0; c < cores; c += 1) { html += '<div>core ' + (c + 1) + '<i style="height:' + Math.round(clamp(runnable - c, 0, 1) * 100) + '%"></i></div>'; }
      $('[data-cores]', w).innerHTML = html;
      $('[data-note]', w).textContent = pressure < 0.8 ? 'Cores sit idle: this I/O heavy work could use more concurrency.' : pressure < 1.5 ? 'About right: every core has work without a long run queue.' : 'Runnable work far exceeds cores: extra threads add context switches and cache misses, not throughput.' + (kind === 'virtual' ? ' Cheap threads cut memory and switching cost, but not the CPU limit.' : '');
    }
    $$('[data-k]', w).forEach(function (b) { b.addEventListener('click', function () { kind = b.getAttribute('data-k'); $$('[data-k]', w).forEach(function (x) { x.classList.toggle('on', x === b); }); paint(); }); });
    $$('input', w).forEach(function (x) { x.addEventListener('input', paint); }); paint();
  };

  $$('.widget[data-widget]').forEach(function (w) { var f = W[w.getAttribute('data-widget')]; if (f) { try { f(w); } catch (e) { w.innerHTML = '<div class="wload">This simulator could not start.</div>'; } } });
})();

/* pages.js */
/* Tandem front end, pages: hub lanes, the section home, track pages, practice, Logbook page, progress, interview room. */
(function () {
  'use strict';
  var TD = window.Tandem, $ = TD.$, $$ = TD.$$, esc = TD.esc, body = document.body, T = TD.data;

  function laneHTML(who, compact) {
    var s = TD.stats(who), info = TD.LEARNERS[who], nx = TD.nextLesson(who);
    var tracks = T.tracks || [], href = (body.classList.contains('page-hub') ? 'concurrency/' : '');
    if (compact) { return '<div class="sclane l-' + who + '"><span>' + info.name + '</span><div class="bar"><i style="width:' + s.pct + '%"></i></div><span>' + s.pct + '%</span></div>'; }
    void tracks;
    return '<div class="lane l-' + who + '"><div class="lhd"><span class="lname">' + info.name + '</span><span class="llang">learns in ' + info.langName + '</span><span class="lpct">' + s.pct + '%</span></div>' +
      '<div class="bar"><i style="width:' + s.pct + '%"></i></div><div class="lnext">' + (nx ? 'Next: <a href="' + href + nx.slug + '.html">' + esc(nx.title) + '</a>' : (s.total ? 'Every lesson done. Keep drilling in Practice.' : 'Lessons are on their way.')) +
      ' · ' + s.solved + ' problems solved' + (s.mcqAll ? ' · ' + Math.round(100 * s.mcqRight / s.mcqAll) + '% on quick checks' : '') + '</div></div>';
  }
  function paintHub() {
    var lanes = $('[data-hub-lanes]'); if (lanes) { lanes.innerHTML = laneHTML('piyush') + laneHTML('shubhi'); }
    $$('[data-lanes]').forEach(function (e) { e.innerHTML = laneHTML('piyush', true) + laneHTML('shubhi', true); });
  }
  if (body.classList.contains('page-hub')) { paintHub(); TD.on('progress', paintHub); TD.on('learner', paintHub); }

  /* section home and track pages */
  function paintBars() {
    var s = TD.stats();
    $$('[data-trackbar]').forEach(function (e) { var v = s.byTrack[e.getAttribute('data-trackbar')] || [0, 0]; e.style.width = (v[1] ? 100 * v[0] / v[1] : 0) + '%'; });
    $$('[data-trackpct]').forEach(function (e) { var v = s.byTrack[e.getAttribute('data-trackpct')] || [0, 0]; e.textContent = (v[1] ? Math.round(100 * v[0] / v[1]) : 0) + '%'; });
    $$('[data-modbar]').forEach(function (e) { var v = s.byMod[e.getAttribute('data-modbar')] || [0, 0]; e.style.width = (v[1] ? 100 * v[0] / v[1] : 0) + '%'; });
    $$('[data-modcount]').forEach(function (e) { var v = s.byMod[e.getAttribute('data-modcount')]; if (v) { e.textContent = v[0] ? v[0] + ' of ' + v[1] + ' done' : v[1] + ' lessons'; } });
    $$('[data-modkey]').forEach(function (e) { var v = s.byMod[e.getAttribute('data-modkey')]; e.classList.toggle('done', !!(v && v[1] && v[0] === v[1])); });
    var done = TD.prog('done');
    $$('.llist a[data-slug]').forEach(function (a) { a.parentNode.classList.toggle('done', !!done[a.getAttribute('data-slug')]); });
    var st = $('[data-stat="lessons"]'); if (st) { st.textContent = s.pct + '%'; }
    var mq = $('[data-stat="mcq"]'); if (mq) { mq.textContent = s.mcqAll ? Math.round(100 * s.mcqRight / s.mcqAll) + '%' : 'none yet'; }
    var so = $('[data-stat="solved"]'); if (so) { so.textContent = s.solved; }
    $$('[data-continue]').forEach(function (a) {
      var nx = TD.nextLesson();
      if (nx) { a.href = nx.slug + '.html'; a.textContent = (s.done ? 'Continue: ' : 'Start: ') + nx.title; }
      else if (s.total) { a.href = 'practice.html'; a.textContent = 'Every lesson done. Go to practice'; }
    });
  }
  if (body.classList.contains('page-section') || body.classList.contains('page-track')) {
    paintBars(); TD.on('progress', paintBars); TD.on('learner', paintBars);
    TD.on('due', function (n) { var d = $('[data-stat="due"]'); if (d) { d.textContent = n || 0; } });
  }
  if (body.classList.contains('page-section') && TD.server) {
    var paintToday = function () {
      var box = $('[data-today]'), who = TD.learner();
      Promise.all([TD.getJSON('notes?user=' + who).catch(function () { return {}; }), TD.getJSON('weak?user=' + who).catch(function () { return {}; })]).then(function (r) {
        var due = r[0].due || [], weak = r[1].weak || [], html = '';
        if (due.length) {
          html += '<div class="todaycard"><h3>Revise today <span class="badge">' + due.length + '</span></h3><ul>' + due.slice(0, 6).map(function (n) { return '<li>' + esc(n.title) + '</li>'; }).join('') +
            '</ul><p><button type="button" class="btn small" data-qn>Quiz me on these</button> <a class="btn ghost small" href="logbook.html">Open Logbook</a></p></div>';
        }
        if (weak.length) {
          html += '<div class="todaycard"><h3>Bar Raiser says: work on</h3><ul>' + weak.slice(0, 6).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
            '</ul><p><button type="button" class="btn small" data-dw>Drill my weak spots</button></p></div>';
        }
        box.innerHTML = html; box.hidden = !html;
        var qn = $('[data-qn]', box); if (qn) { qn.addEventListener('click', function () { TD.quizNotes(due); }); }
        var dw = $('[data-dw]', box); if (dw) { dw.addEventListener('click', function () { TD.askBarRaiser('Drill my weak spots, starting with the weakest. One question at a time; mark each answer.'); }); }
      });
    };
    paintToday(); TD.on('learner', paintToday); TD.on('notes', paintToday);
  }

  /* practice page: filters and status */
  if (body.classList.contains('page-practice')) {
    var f = { kind: '', diff: '', co: '', stat: '' };
    var applyP = function () {
      var prob = TD.prog('prob'), shown = 0;
      $$('.prow').forEach(function (r) {
        var sl = r.getAttribute('data-problem'), st = prob[sl] ? prob[sl].st : '';
        r.classList.toggle('solved', st === 'solved'); r.classList.toggle('tried', st === 'tried');
        var ok = (!f.kind || r.getAttribute('data-kind') === f.kind) && (!f.diff || r.getAttribute('data-diff') === f.diff) &&
          (!f.co || (' ' + r.getAttribute('data-cos') + ' ').indexOf(' ' + f.co + ' ') >= 0) && (!f.stat || (f.stat === 'solved' ? st === 'solved' : st !== 'solved'));
        r.hidden = !ok; if (ok) { shown += 1; }
      });
      $('#pempty').hidden = shown > 0;
      var tests = TD.prog('test');
      $$('[data-testbest]').forEach(function (e) { var b = tests[e.getAttribute('data-testbest')]; e.textContent = b ? 'Best: ' + b.pct + '%' : ''; });
      var th = TD.prog('theory');
      $$('[data-theorydone]').forEach(function (e) { var n = Object.keys(th).filter(function (k) { return k.indexOf(e.getAttribute('data-theorydone') + '.') === 0; }).length; e.textContent = n ? n + ' known' : ''; });
    };
    [['kind', 'data-fkind'], ['diff', 'data-fdiff'], ['co', 'data-fco'], ['stat', 'data-fstat']].forEach(function (p) {
      $$('[' + p[1] + ']').forEach(function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute(p[1]); f[p[0]] = f[p[0]] === v ? '' : v;
          $$('[' + p[1] + ']').forEach(function (x) { x.classList.toggle('on', x.getAttribute(p[1]) === f[p[0]]); });
          applyP();
        });
      });
    });
    var hk = /kind=(\w+)/.exec(location.hash); if (hk) { f.kind = hk[1]; $$('[data-fkind]').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-fkind') === f.kind); }); }
    applyP(); TD.on('learner', applyP); TD.on('progress', applyP);
  }
  $$('.pcard[data-problem]').forEach(function (c) { var p = TD.prog('prob')[c.getAttribute('data-problem')]; if (p) { c.classList.add(p.st); } });

  /* the Logbook page */
  if (body.classList.contains('page-logbook')) {
    var TYPE = TD.NOTE_TYPES || { note: 'Note', revise: 'Revise', doubt: 'Doubt', mistake: 'Mistake', line: 'Interview line' };
    var state = { items: [], due: [], type: '', tag: '', q: '', editing: null }, listEl = $('#nlist'), revEl = $('#nrevise');
    var fmtDate = function (iso) { var d = new Date(iso.length > 10 ? iso : iso + 'T00:00:00'); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + (iso.length > 10 ? ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''); };
    var reload = function () {
      $$('[data-notes-owner]').forEach(function (e) { e.textContent = TD.who().name + '\'s Logbook'; });
      if (!TD.server) { listEl.innerHTML = '<div class="empty">' + TD.offlineText + '</div>'; return; }
      TD.getJSON('notes?user=' + TD.learner()).then(function (j) { state.items = j.items || []; state.due = j.due || []; TD.paintDue && TD.paintDue(state.due.length); render(); });
      TD.getJSON('notes/digests?user=' + TD.learner()).then(function (j) {
        var past = $('#npast'); past.hidden = !(j.digests || []).length;
        $('#npastlist').innerHTML = (j.digests || []).map(function (d) { return '<div class="digest"><p class="qmeta">' + esc(d.name.replace('_week.md', '')) + '</p>' + TD.md(d.text) + '</div>'; }).join('');
      }).catch(function () {});
    };
    var render = function () {
      var counts = {}, tags = {};
      state.items.forEach(function (n) { counts[n.type] = (counts[n.type] || 0) + 1; (n.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
      $('#ntypes').innerHTML = '<button class="chip' + (state.type ? '' : ' on') + '" data-type="">All<span class="ct">' + state.items.length + '</span></button>' +
        Object.keys(TYPE).map(function (t) { return '<button class="chip' + (state.type === t ? ' on' : '') + '" data-type="' + t + '">' + TYPE[t] + '<span class="ct">' + (counts[t] || 0) + '</span></button>'; }).join('');
      $('#ntags').innerHTML = Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 30).map(function (t) { return '<button class="chip' + (state.tag === t ? ' on' : '') + '" data-tag="' + esc(t) + '">#' + esc(t) + '<span class="ct">' + tags[t] + '</span></button>'; }).join('');
      $$('#ntypes [data-type]').forEach(function (b) { b.addEventListener('click', function () { state.type = b.getAttribute('data-type'); render(); }); });
      $$('#ntags [data-tag]').forEach(function (b) { b.addEventListener('click', function () { state.tag = state.tag === b.getAttribute('data-tag') ? '' : b.getAttribute('data-tag'); render(); }); });
      revEl.hidden = !state.due.length;
      if (state.due.length) {
        revEl.innerHTML = '<h2>Revise today</h2><p class="qmeta">Revise notes come back 1, 3, 7 and 21 days after you make them. Read each one, then press Revised, or let Bar Raiser quiz you.</p>' +
          state.due.map(function (n) { return '<div class="ritem"><div><b>' + esc(n.title) + '</b><small>' + esc(n.text) + '</small></div><button class="btn ghost small" data-rev="' + n.id + '">Revised</button></div>'; }).join('') +
          '<div class="ractions"><button class="btn small" data-quizall>Quiz me on these</button></div>';
        $$('[data-rev]', revEl).forEach(function (b) { b.addEventListener('click', function () { b.disabled = true; TD.api('notes/revised', { user: TD.learner(), id: b.getAttribute('data-rev') }).then(reload); }); });
        $('[data-quizall]', revEl).addEventListener('click', function () { TD.quizNotes(state.due); });
      }
      var q = state.q.toLowerCase();
      var shown = state.items.filter(function (n) {
        return (!state.type || n.type === state.type) && (!state.tag || (n.tags || []).indexOf(state.tag) >= 0) &&
          (!q || (n.title + ' ' + n.text + ' ' + (n.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0);
      });
      if (!state.items.length) { listEl.innerHTML = '<div class="empty">No notes yet. Open the side panel (Cmd K), choose Logbook, and type or speak your first note.</div>'; return; }
      listEl.innerHTML = shown.length ? '' : '<div class="empty">No note matches this filter.</div>';
      shown.forEach(function (n) { listEl.appendChild(card(n)); });
    };
    var card = function (n) {
      var c = document.createElement('article'), isDue = state.due.some(function (d) { return d.id === n.id; });
      c.className = 'ncard' + (isDue ? ' due' : '');
      if (state.editing === n.id) {
        c.innerHTML = '<form><select name="type">' + Object.keys(TYPE).map(function (t) { return '<option value="' + t + '"' + (t === n.type ? ' selected' : '') + '>' + TYPE[t] + '</option>'; }).join('') + '</select>' +
          '<input name="title" value="' + esc(n.title) + '"><textarea name="text">' + esc(n.text) + '</textarea><input name="tags" placeholder="tags, separated by commas" value="' + esc((n.tags || []).join(', ')) + '">' +
          '<div class="nact"><button type="submit">Save</button><button type="button" data-cancel>Cancel</button></div></form>';
        $('form', c).addEventListener('submit', function (e) {
          e.preventDefault(); var fm = e.target;
          TD.api('notes/edit', { user: TD.learner(), id: n.id, fields: { type: fm.type.value, title: fm.title.value, text: fm.text.value, tags: fm.tags.value.split(',') } }).then(function () { state.editing = null; reload(); }).catch(function (er) { TD.toast(er.message); });
        });
        $('[data-cancel]', c).addEventListener('click', function () { state.editing = null; render(); });
        return c;
      }
      var status = n.type === 'revise' ? (n.revise_done ? 'Fully revised on ' + fmtDate(n.revise_done) : (isDue ? 'Due today, round ' + ((n.revise_stage || 0) + 1) + ' of 4' : 'Next revision ' + fmtDate(n.revise_due) + ', round ' + ((n.revise_stage || 0) + 1) + ' of 4')) : '';
      var les = n.lesson && TD.lessonBySlug[n.lesson];
      c.innerHTML = '<div class="nhead"><span class="tpill tp-' + n.type + '">' + TYPE[n.type] + '</span>' + (n.via === 'voice' ? '<span>spoken</span>' : '') + '<span class="when">' + fmtDate(n.created) + (n.edited ? ' · edited' : '') + '</span></div>' +
        '<h3>' + esc(n.title) + '</h3><p>' + esc(n.text) + '</p>' +
        (les ? '<div class="lessonlink">Explained in: <a href="' + n.lesson + '.html">' + esc(les.title) + '</a></div>' : '') +
        (status ? '<div class="meta">' + status + '</div>' : '') +
        (n.source ? '<div class="meta">Noted on: ' + (n.source_slug ? '<a href="' + n.source_slug + '.html">' + esc(n.source) + '</a>' : esc(n.source)) + '</div>' : '') +
        ((n.tags || []).length ? '<div class="ntags">' + n.tags.map(function (t) { return '<span data-t="' + esc(t) + '">#' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
        '<div class="nact">' + (isDue ? '<button data-a="revised">Revised</button>' : '') + (n.type === 'doubt' || n.type === 'mistake' ? '<button data-a="ask">Ask Navigator</button><button data-a="drill">Drill it with Bar Raiser</button>' : '') +
        '<button data-a="edit">Edit</button><button data-a="delete" class="danger">Delete</button></div>';
      $$('[data-t]', c).forEach(function (s) { s.addEventListener('click', function () { state.tag = s.getAttribute('data-t'); render(); }); });
      $$('[data-a]', c).forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.getAttribute('data-a');
          if (a === 'edit') { state.editing = n.id; render(); return; }
          if (a === 'ask') { TD.askNavigator('I noted this ' + n.type + ': "' + n.text + '". Explain it to me simply, then precisely, with code in my language.'); return; }
          if (a === 'drill') { TD.askBarRaiser('Drill me on this, from my Logbook: "' + n.text + '". Fresh questions, one at a time, and mark each answer.'); return; }
          if (a === 'delete' && !confirm('Delete this note for good?\n\n' + n.title)) { return; }
          b.disabled = true;
          TD.api(a === 'revised' ? 'notes/revised' : 'notes/delete', { user: TD.learner(), id: n.id }).then(reload).catch(function (er) { b.disabled = false; TD.toast(er.message); });
        });
      });
      return c;
    };
    $('#nq').addEventListener('input', function (e) { state.q = e.target.value; render(); });
    $('#nadd').addEventListener('click', function () { TD.noteThis(''); });
    $('#ndigest').addEventListener('click', function () {
      var bx = $('#ndigestbox'), b = $('#ndigest'); if (!TD.server) { return; }
      b.disabled = true; bx.hidden = false;
      bx.innerHTML = '<h2>Your weekly digest</h2><div class="thinking"><i></i><i></i><i></i><span>Reading this week\'s notes</span></div>';
      TD.api('notes/digest', { user: TD.learner() }).then(function (j) { bx.innerHTML = '<h2>Your weekly digest</h2><p class="qmeta">Saved as ' + esc(j.path) + ', from ' + j.notes + ' notes.</p><div class="digest">' + TD.md(j.digest) + '</div>'; reload(); })
        .catch(function (er) { bx.innerHTML = '<h2>Your weekly digest</h2><p>' + esc(er.message) + '</p>'; }).then(function () { b.disabled = false; });
    });
    TD.on('learner', reload); TD.on('notes', reload);
    reload();
  }

  /* progress page: both lanes side by side */
  if (body.classList.contains('page-progress')) {
    var paintProg = function () {
      $('#progress').innerHTML = ['piyush', 'shubhi'].map(function (who) {
        var s = TD.stats(who), info = TD.LEARNERS[who], tests = TD.prog('test', who);
        var rows = (T.tracks || []).filter(function (t) { return t.id === 'core' || t.id === info.lang; }).map(function (t) {
          var v = s.byTrack[t.id] || [0, 0]; return '<div class="prow2"><span>' + esc(t.title) + '</span><div class="bar"><i style="width:' + (v[1] ? 100 * v[0] / v[1] : 0) + '%"></i></div><span>' + v[0] + ' of ' + v[1] + '</span></div>';
        }).join('');
        var tl = Object.keys(tests).map(function (k) { var tt = (T.tests || []).filter(function (x) { return x.id === k; })[0]; return '<li>' + esc(tt ? tt.title : k) + ': ' + tests[k].pct + '%</li>'; }).join('');
        return '<div class="plane l-' + who + '"><h2><span class="dot"></span>' + info.name + ' <small class="qmeta">' + info.langName + '</small></h2>' + rows +
          '<div class="prow2"><span>Quick checks</span><div class="bar"><i style="width:' + (s.mcqAll ? 100 * s.mcqRight / s.mcqAll : 0) + '%"></i></div><span>' + s.mcqRight + ' of ' + s.mcqAll + '</span></div>' +
          '<div class="prow2"><span>Problems solved</span><div class="bar"><i style="width:' + ((T.problems || []).length ? 100 * s.solved / T.problems.length : 0) + '%"></i></div><span>' + s.solved + ' of ' + (T.problems || []).length + '</span></div>' +
          (tl ? '<h3>Module tests, best scores</h3><ul>' + tl + '</ul>' : '') + '<div class="weak" data-weak="' + who + '">Bar Raiser\'s notes on weak spots appear here.</div></div>';
      }).join('');
      if (TD.server) {
        ['piyush', 'shubhi'].forEach(function (who) {
          TD.getJSON('weak?user=' + who).then(function (j) { var e = $('[data-weak="' + who + '"]'); if (e && (j.weak || []).length) { e.innerHTML = '<strong>Bar Raiser says work on:</strong> ' + j.weak.map(esc).join('; '); } }).catch(function () {});
        });
      }
    };
    paintProg(); TD.on('progress', paintProg);
  }

  /* interview room */
  if (body.classList.contains('page-interview')) {
    var mb = $('[data-mock]');
    var hist = function () {
      var m = TD.store.get('mocks.' + TD.learner(), []);
      $('#mockhist').innerHTML = m.length ? m.slice(-10).reverse().map(function (x) { return '<div class="mh">' + esc(x.when) + ': ' + esc(x.co) + ', ' + esc(x.focus) + ', ' + x.len + ' minutes</div>'; }).join('') : 'None yet.';
    };
    mb.addEventListener('click', function () {
      var co = $('#mco').value, len = +$('#mlen').value, focus = $('#mfocus').value, fl = $('#mfocus').selectedOptions[0].textContent;
      var m = TD.store.get('mocks.' + TD.learner(), []); m.push({ when: new Date().toLocaleString('en-IN'), co: co, len: len, focus: fl }); TD.store.set('mocks.' + TD.learner(), m); hist();
      TD.askBarRaiser('[MOCK INTERVIEW] Run a ' + len + ' minute mock interview round now, in the style of ' + co + ', focus: ' + fl + ', at senior (L5) level, in ' + TD.who().langName + '. ' +
        'Behave exactly like the real interviewer: brief intro, then one question at a time, wait for my answers, push with follow ups, keep time. ' +
        'At the end give a scorecard: hire signal, strengths, gaps, and the follow ups I missed. Start now.',
        { show: 'Start a ' + len + ' minute mock: ' + co + ', ' + fl + '.', mock: { co: co, minutes: len, focus: focus } });
    });
    hist(); TD.on('learner', hist);
  }
})();
