// Numbers each block in the Markdown preview with its 1-based source line,
// and scrolls to the line named in a link fragment such as file.md#L163.
// The preview's own data-line attribute is 0-based.
//
// Why the click handling below: when the preview is the "Markdown Preview" custom editor,
// VS Code drops the #L163 fragment before the new preview loads. So the preview that is
// clicked stores the target in localStorage (previews of the same kind share an origin),
// and the preview that opens reads it.
(function () {
  // Containers whose first child carries its own number; numbering them causes overlaps.
  var SKIP = { TABLE: 1, THEAD: 1, TBODY: 1, UL: 1, OL: 1, BLOCKQUOTE: 1 };
  var JUMP_KEY = 'md-line-numbers.jump';
  var JUMP_MAX_AGE_MS = 15000;
  var pending = false;
  var settings = readSettings();
  var sourcePath = pathOf(settings.source);
  var targetLine = lineFromFragment(settings.fragment) || takeStoredJump();

  function log() {
    console.log.apply(console, ['[md-line-numbers]'].concat([].slice.call(arguments)));
  }

  function px(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function readSettings() {
    try {
      var data = document.getElementById('vscode-markdown-preview-data');
      return JSON.parse(data.getAttribute('data-settings')) || {};
    } catch (e) {
      log('could not read settings:', e);
      return {};
    }
  }

  // Decoded file path of a URL, without query or fragment. Null if it cannot be parsed.
  function pathOf(url, base) {
    try {
      return decodeURIComponent(new URL(url, base).pathname);
    } catch (e) {
      return null;
    }
  }

  // "L163", "L163,5" or "L163-L170" -> 163.
  function lineFromFragment(frag) {
    var m = /^L(\d+)/i.exec(decodeURIComponent(frag || ''));
    return m ? Number(m[1]) : null;
  }

  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  // A jump stored by the preview whose link opened this file.
  function takeStoredJump() {
    var ls = storage();
    if (!ls || !sourcePath) return null;
    try {
      var jump = JSON.parse(ls.getItem(JUMP_KEY) || 'null');
      if (!jump || jump.path !== sourcePath) return null;
      ls.removeItem(JUMP_KEY);
      if (Date.now() - jump.time > JUMP_MAX_AGE_MS) return null;
      log('stored jump for this file: line', jump.line);
      return jump.line;
    } catch (e) {
      return null;
    }
  }

  // Clicks on links with a #L<line> fragment.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('data-href') || a.getAttribute('href') || '';
    var hash = href.indexOf('#');
    var line = hash === -1 ? null : lineFromFragment(href.slice(hash + 1));
    if (!line) return;
    var target = href.slice(0, hash);
    var targetPath = target ? pathOf(target, settings.source) : sourcePath;
    if (targetPath && targetPath === sourcePath) {
      // Same file: scroll here, no navigation needed.
      e.preventDefault();
      e.stopPropagation();
      targetLine = line;
      revealTarget();
      return;
    }
    var ls = storage();
    if (ls && targetPath) {
      try {
        ls.setItem(JUMP_KEY, JSON.stringify({ path: targetPath, line: line, time: Date.now() }));
        log('stored jump:', targetPath, 'line', line);
      } catch (err) {
        log('could not store jump:', err);
      }
    }
  }, true);

  // A preview that was already open is only revealed, not reloaded: check on focus too.
  function checkStoredJump() {
    var line = takeStoredJump();
    if (line) { targetLine = line; schedule(); }
  }
  window.addEventListener('focus', checkStoredJump);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkStoredJump();
  });

  function number() {
    pending = false;
    var fs = px(getComputedStyle(document.body).fontSize, 14) * 0.6;
    document.querySelectorAll('.code-line[data-line]').forEach(function (el) {
      var line = el.getAttribute('data-line');
      if (SKIP[el.tagName] || el.querySelector('.code-line[data-line="' + line + '"]')) {
        el.removeAttribute('data-ln');
        return;
      }
      // Align the number with the block's first text line.
      var target = el.tagName === 'TR' && el.firstElementChild ? el.firstElementChild : el;
      var cs = getComputedStyle(target);
      var lh = cs.lineHeight === 'normal' ? px(cs.fontSize, 14) * 1.2 : px(cs.lineHeight, 20);
      var top = px(cs.paddingTop, 0) + px(cs.borderTopWidth, 0);
      el.style.setProperty('--ln-lh', lh + 'px');
      el.style.setProperty('--ln-top', top + 'px');
      el.style.setProperty('--ln-fs', fs + 'px');
      el.setAttribute('data-ln', String(Number(line) + 1));
    });
    if (targetLine !== null) revealTarget();
  }

  // Scroll to the block that contains the target line: the last block starting at or before it.
  function revealTarget() {
    var best = null, bestLine = -1;
    document.querySelectorAll('.code-line[data-ln]').forEach(function (el) {
      var ln = Number(el.getAttribute('data-ln'));
      if (ln <= targetLine && ln >= bestLine) { best = el; bestLine = ln; }
    });
    if (!best) return;
    log('jumping to line', targetLine, '-> block at line', bestLine);
    targetLine = null;
    // The preview may scroll on its own right after load (scroll sync, late images).
    // Re-apply the jump a few times, until the user scrolls by hand.
    var userScrolled = false;
    function stop() { userScrolled = true; }
    ['wheel', 'keydown', 'mousedown', 'touchstart'].forEach(function (t) {
      window.addEventListener(t, stop, { once: true, passive: true });
    });
    function go() {
      if (!userScrolled) window.scrollTo(0, best.getBoundingClientRect().top + window.scrollY - 40);
    }
    go();
    [100, 300, 700, 1500].forEach(function (ms) { setTimeout(go, ms); });
    if (document.readyState !== 'complete') window.addEventListener('load', go, { once: true });
    best.classList.add('ln-target');
    setTimeout(function () { best.classList.remove('ln-target'); }, 2000);
  }

  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(number); }
  }

  schedule();
  window.addEventListener('vscode.markdown.updateContent', schedule);
  window.addEventListener('resize', schedule);
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['data-line']
  });
})();
