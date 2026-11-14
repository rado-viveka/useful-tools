// Numbers each block in the Markdown preview with its 1-based source line,
// and follows links with a line fragment such as file.md#L163.
// The preview marks each element with its source offsets ("from..to"), not its line.
// The IDE side (LineNumbersExtension) sends the offsets at which the lines start.
(function () {
  var REQUEST = 'mdLineNumbers/request';
  var LINE_STARTS = 'mdLineNumbers/lineStarts';
  var OPEN = 'mdLineNumbers/open';
  var JUMP = 'mdLineNumbers/jump';
  // Table cells share the line of their row; the row carries the number.
  var NOT_A_BLOCK = { TD: 1, TH: 1, BODY: 1, HTML: 1 };
  var lineStarts = null;
  var pending = false;
  var targetLine = null;
  var lastJumpId = null;
  var meta = document.querySelector('meta[name="markdown-position-attribute-name"]');
  var POS = (meta && meta.content) || 'md-src-pos';

  function log() {
    console.log.apply(console, ['[md-line-numbers]'].concat([].slice.call(arguments)));
  }

  function px(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function pipe() {
    var tools = window.__IntelliJTools;
    return tools && tools.messagePipe;
  }

  // The pipe can post only after the IDE injected its function ("IdeReady").
  function request() {
    var tools = window.__IntelliJTools;
    if (tools && tools.messagePipe && tools.___jcefMessagePipePostToIdeFunction) {
      tools.messagePipe.post(REQUEST, '');
    }
  }

  // 1-based line of a source offset: the last line that starts at or before it.
  function lineOf(offset) {
    var lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  // The box an absolutely positioned ::before of el is placed against.
  // (offsetParent is wrong for table rows: it returns the table.)
  function positionedBox(el) {
    for (var p = el; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).position !== 'static') return p;
    }
    return document.body;
  }

  function number() {
    pending = false;
    if (!lineStarts || !document.body) return;
    // Candidates: block elements with a source position. The document root is not one.
    var blocks = [];
    var lineByEl = new Map();
    document.body.querySelectorAll('[' + POS + ']').forEach(function (el) {
      if (NOT_A_BLOCK[el.tagName] || el.parentElement === document.body) return;
      var display = getComputedStyle(el).display;
      if (display === 'none' || display === 'contents' || display.indexOf('inline') === 0) return;
      var from = parseInt(el.getAttribute(POS), 10);
      if (isNaN(from)) return;
      var empty = !el.textContent.trim() && !el.querySelector('img, svg, video, hr') && el.tagName !== 'HR';
      if (empty) return;
      blocks.push(el);
      lineByEl.set(el, lineOf(from));
    });
    // A container (list, quote, table, list item with a paragraph) starts on the line of
    // its first child. Only the innermost block shows the number.
    var covered = new Set();
    blocks.forEach(function (el) {
      var line = lineByEl.get(el);
      for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (lineByEl.get(p) === line) covered.add(p);
      }
    });
    var keep = new Set();
    var fs = px(getComputedStyle(document.body).fontSize, 14) * 0.75;
    var bodyLeft = document.body.getBoundingClientRect().left + document.body.clientLeft;
    var width = px(getComputedStyle(document.body).paddingLeft, 30) - fs;
    blocks.forEach(function (el) {
      if (covered.has(el)) return;
      keep.add(el);
      // Align the number with the block's first text line.
      var target = el.tagName === 'TR' && el.firstElementChild ? el.firstElementChild : el;
      var cs = getComputedStyle(target);
      var lh = cs.lineHeight === 'normal' ? px(cs.fontSize, 14) * 1.2 : px(cs.lineHeight, 20);
      // The number starts at the top of the block's content box. A table row has no
      // padding of its own, so add the padding of its first cell.
      var top = target === el ? 0 : px(cs.paddingTop, 0) + px(cs.borderTopWidth, 0);
      el.style.setProperty('--ln-lh', lh + 'px');
      el.style.setProperty('--ln-top', top + 'px');
      el.style.setProperty('--ln-fs', fs + 'px');
      el.style.setProperty('--ln-width', width + 'px');
      // The number is positioned against the nearest positioned box.
      // Shift it back to the body's left edge (the gutter).
      var box = positionedBox(el);
      var left = bodyLeft - (box.getBoundingClientRect().left + box.clientLeft);
      el.style.setProperty('--ln-left', left + 'px');
      el.setAttribute('data-ln', String(lineByEl.get(el)));
    });
    document.querySelectorAll('[data-ln]').forEach(function (el) {
      if (!keep.has(el)) el.removeAttribute('data-ln');
    });
    if (targetLine !== null) revealTarget();
  }

  // "L163", "L163,5", "L163:5" or "L163-L170" -> {line: 163, column: 5}. Null for other fragments.
  function parseFragment(frag) {
    var text;
    try { text = decodeURIComponent(frag || ''); } catch (e) { return null; }
    var m = /^L(\d+)(?:[,:](\d+))?(?:-L?\d+)?$/i.exec(text);
    return m ? { line: Number(m[1]), column: m[2] ? Number(m[2]) : 1 } : null;
  }

  // Clicks on links with a #L<line> fragment. This runs before the preview's own link handler.
  window.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var hash = href.indexOf('#');
    var pos = hash === -1 ? null : parseFragment(href.slice(hash + 1));
    if (!pos) return;
    var path = href.slice(0, hash);
    // Web links (https://host/file.md#L10) stay with the preview's own handler.
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^file:/i.test(path)) return;
    // A heading whose anchor looks like a line fragment wins.
    if (!path && document.getElementById(href.slice(hash + 1).toLowerCase())) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!path) {
      // Same file: scroll here.
      targetLine = pos.line;
      revealTarget();
      return;
    }
    var p = pipe();
    if (p) p.post(OPEN, JSON.stringify({ path: path, line: pos.line, column: pos.column }));
  }, true);

  // Scroll to the block that contains the target line: the last block starting at or before it.
  function revealTarget() {
    var best = null, bestLine = -1;
    document.querySelectorAll('[data-ln]').forEach(function (el) {
      var ln = Number(el.getAttribute('data-ln'));
      if (ln <= targetLine && ln >= bestLine) { best = el; bestLine = ln; }
    });
    if (!best) return;
    log('jumping to line', targetLine, '-> block at line', bestLine);
    targetLine = null;
    // The preview may scroll on its own right after the jump (scroll sync with the editor,
    // late images). Re-apply the jump a few times, until the user scrolls by hand.
    var userScrolled = false;
    function stop() { userScrolled = true; }
    ['wheel', 'keydown', 'mousedown', 'touchstart'].forEach(function (t) {
      window.addEventListener(t, stop, { once: true, passive: true });
    });
    function go() {
      // Leave a fifth of the view above the target, so the heading before it stays visible.
      var margin = Math.max(40, window.innerHeight * 0.2);
      if (!userScrolled && best.isConnected) {
        window.scrollTo(0, best.getBoundingClientRect().top + window.scrollY - margin);
      }
    }
    go();
    [100, 300, 700, 1500].forEach(function (ms) { setTimeout(go, ms); });
    // Keep the highlight until the next jump.
    document.querySelectorAll('.ln-target').forEach(function (el) { el.classList.remove('ln-target'); });
    best.classList.add('ln-target');
  }

  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(number); }
  }

  // After each content change the lines can shift: ask for the line starts again.
  var requested = false;
  function refresh() {
    if (requested) return;
    requested = true;
    requestAnimationFrame(function () { requested = false; request(); });
  }

  function subscribe() {
    var p = pipe();
    if (!p) { log('no message pipe'); return; }
    p.subscribe(LINE_STARTS, function (data) {
      try {
        lineStarts = JSON.parse(data);
      } catch (e) {
        log('bad line starts:', e);
        return;
      }
      schedule();
    });
    // "<line>:<id>": a link in another preview (or in this one) points at a line of this file.
    p.subscribe(JUMP, function (data) {
      var parts = String(data).split(':');
      if (parts[1] === lastJumpId) return;
      lastJumpId = parts[1];
      targetLine = Number(parts[0]);
      schedule();
    });
  }

  subscribe();
  refresh();
  window.addEventListener('IdeReady', refresh);
  window.addEventListener('load', refresh);
  window.addEventListener('resize', schedule);
  if (window.IncrementalDOM && IncrementalDOM.notifications && IncrementalDOM.notifications.afterPatchListeners) {
    IncrementalDOM.notifications.afterPatchListeners.push(refresh);
  }
  new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });
})();
