// Vim-style navigation layer for terminal-browser pages.
// Installed with Page.addScriptToEvaluateOnNewDocument over CDP, so it
// survives navigation and soft reloads. Safe to inject more than once.
(() => {
  if (window.__tbVim) return "already-installed";

  const SCROLL = 70;
  const HINT_CHARS = "asdfghjkl";

  let pending = "";
  let pendingTimer = 0;
  let hintState = null;
  let helpEl = null;
  let findEl = null;
  let findQuery = "";
  let styleEl = null;

  const isEditable = (el) =>
    !!el &&
    (el.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ""));

  const scrollBy = (dx, dy) => window.scrollBy({ left: dx, top: dy, behavior: "instant" });
  const goTop = () => window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  const goBottom = () =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });

  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return;
    styleEl = document.createElement("style");
    styleEl.textContent = `
      .tbvim-hint {
        position: fixed; z-index: 2147483647; pointer-events: none;
        font: 700 11px/1.4 ui-monospace, monospace;
        background: #c8a24a; color: #101010;
        border: 1px solid #101010; border-radius: 3px;
        padding: 0 3px; box-shadow: 0 0 0 1px #fff3;
      }
      .tbvim-hint.dim { opacity: .45; }
      .tbvim-panel {
        position: fixed; z-index: 2147483647;
        font: 12px/1.6 ui-monospace, monospace;
        background: #1d2021; color: #ebdbb2;
        border: 1px solid #665c54; border-radius: 4px;
        padding: 10px 14px; box-shadow: 0 8px 24px #0008;
      }
      #tbvim-help { right: 16px; bottom: 16px; white-space: pre; }
      #tbvim-find { left: 50%; top: 10%; transform: translateX(-50%); }
      #tbvim-find input {
        font: 13px/1.4 ui-monospace, monospace; background: #282828;
        color: #ebdbb2; border: 1px solid #665c54; border-radius: 3px;
        padding: 3px 6px; width: 260px; outline: none;
      }
    `;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  /* ---------- link hints ---------- */

  function hintTargets() {
    const sel =
      'a[href], area[href], button, [role="button"], [role="link"],' +
      ' input[type="submit"], input[type="button"], summary';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      if (r.right < 0 || r.left > innerWidth) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") continue;
      if (s.pointerEvents === "none" && s.position !== "static") continue;
      out.push({ el, r });
    }
    return out;
  }

  function makeLabels(n) {
    const base = HINT_CHARS.length;
    let len = 1;
    while (Math.pow(base, len) < n) len++;
    const out = [];
    for (let i = 0; i < n; i++) {
      let x = i;
      let s = "";
      for (let j = 0; j < len; j++) {
        s = HINT_CHARS[x % base] + s;
        x = Math.floor(x / base);
      }
      out.push(s);
    }
    return out;
  }

  function clearHints() {
    if (hintState) hintState.nodes.forEach((n) => n.remove());
    hintState = null;
  }

  function startHints(newTab) {
    clearHints();
    closePanels();
    ensureStyle();
    const targets = hintTargets();
    if (!targets.length) return "no-hints";
    const labels = makeLabels(targets.length);
    const nodes = targets.map((t, i) => {
      const b = document.createElement("div");
      b.className = "tbvim-hint";
      b.textContent = labels[i];
      b.style.left = Math.max(0, Math.min(innerWidth - 24, t.r.left)) + "px";
      b.style.top = Math.max(0, Math.min(innerHeight - 16, t.r.top)) + "px";
      document.documentElement.appendChild(b);
      return b;
    });
    hintState = { targets, labels, nodes, typed: "", newTab: !!newTab };
    return "hints";
  }

  function activateHint(i) {
    const t = hintState.targets[i];
    const newTab = hintState.newTab;
    clearHints();
    if (newTab) {
      const href = t.el.href || t.el.getAttribute("href");
      if (href) window.open(href, "_blank");
      else t.el.click();
    } else {
      if (t.el.focus) t.el.focus();
      t.el.click();
    }
  }

  function hintKey(e) {
    if (e.key === "Escape") {
      clearHints();
      e.preventDefault();
      return;
    }
    if (e.key.length !== 1) return;
    const typed = hintState.typed + e.key.toLowerCase();
    const matches = hintState.labels
      .map((l, i) => (l.startsWith(typed) ? i : -1))
      .filter((i) => i >= 0);
    if (!matches.length) {
      clearHints();
      e.preventDefault();
      return;
    }
    e.preventDefault();
    if (matches.length === 1 && hintState.labels[matches[0]] === typed) {
      activateHint(matches[0]);
      return;
    }
    hintState.typed = typed;
    hintState.nodes.forEach((n, i) => {
      const l = hintState.labels[i];
      n.classList.toggle("dim", !l.startsWith(typed));
      n.textContent = l.slice(typed.length) || l;
    });
  }

  /* ---------- find ---------- */

  function openFind() {
    closePanels();
    ensureStyle();
    findEl = document.createElement("div");
    findEl.className = "tbvim-panel";
    findEl.id = "tbvim-find";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "find in page  (enter, esc)";
    input.value = findQuery;
    findEl.appendChild(input);
    document.documentElement.appendChild(findEl);
    input.focus();
    input.select();
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        closePanels();
        e.preventDefault();
      } else if (e.key === "Enter") {
        findQuery = input.value;
        closePanels();
        if (findQuery) window.find(findQuery, false, false, true);
        e.preventDefault();
      }
    });
  }

  function nextMatch(backwards) {
    if (!findQuery) return;
    window.find(findQuery, false, !!backwards, true);
  }

  /* ---------- help ---------- */

  function toggleHelp() {
    if (helpEl) {
      closePanels();
      return;
    }
    closePanels();
    ensureStyle();
    helpEl = document.createElement("div");
    helpEl.className = "tbvim-panel";
    helpEl.id = "tbvim-help";
    helpEl.textContent = [
      "tb-vim  (page layer)",
      "",
      "j / k   scroll down / up",
      "h / l   scroll left / right",
      "d / u   half page down / up",
      "gg / G  top / bottom",
      "f / F   link hints / new tab",
      "/       find in page",
      "n / N   next / previous match",
      "H / L   history back / forward",
      "r       reload",
      "?       this help",
    ].join("\n");
    document.documentElement.appendChild(helpEl);
  }

  function closePanels() {
    if (helpEl) helpEl.remove();
    if (findEl) findEl.remove();
    helpEl = null;
    findEl = null;
  }

  /* ---------- keys ---------- */

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (hintState) {
      hintKey(e);
      return;
    }
    if (findEl) return;
    if (isEditable(e.target)) return;

    if (pending === "g") {
      clearTimeout(pendingTimer);
      pending = "";
      if (e.key === "g") {
        goTop();
        e.preventDefault();
        return;
      }
    }
    if (e.key === "g") {
      pending = "g";
      pendingTimer = setTimeout(() => (pending = ""), 900);
      e.preventDefault();
      return;
    }

    const k = e.key;
    let handled = true;
    switch (k) {
      case "j": scrollBy(0, SCROLL); break;
      case "k": scrollBy(0, -SCROLL); break;
      case "h": scrollBy(-SCROLL, 0); break;
      case "l": scrollBy(SCROLL, 0); break;
      case "d": scrollBy(0, innerHeight * 0.9); break;
      case "u": scrollBy(0, -innerHeight * 0.9); break;
      case "G": goBottom(); break;
      case "f": startHints(false); break;
      case "F": startHints(true); break;
      case "/": openFind(); break;
      case "n": nextMatch(false); break;
      case "N": nextMatch(true); break;
      case "H": history.back(); break;
      case "L": history.forward(); break;
      case "r": location.reload(); break;
      case "?": toggleHelp(); break;
      case "Escape": closePanels(); clearHints(); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  window.addEventListener("keydown", onKeyDown, true);
  ensureStyle();
  return "installed";
})();
