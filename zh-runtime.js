/* zh-runtime.js — Claude Science 中英双语运行时层（v3）
 *
 * v3 变更（针对"补丁不稳定"和"图标不好看"）：
 *   稳定性：
 *     · characterData 变更**立即**翻译（不再等 60ms 去抖）→ 消除 React 重渲染后的英文闪回
 *     · 新增节点用 requestAnimationFrame 批处理，并在 0/120/400/900ms 做 4 次"落定"补扫
 *     · 监听 SPA 路由变化（pushState/replaceState/popstate/hashchange）→ 立即整页补扫
 *     · 2 秒兜底轮询不变（成本 = 每文本节点一次 Map 查询）
 *   外观：
 *     · 语言按钮使用应用自身的 CSS 变量（--surface-2 / --text-primary / --card-shadow）→ 自动适配明暗主题
 *     · 图标用应用内同类图标库（lucide）的 languages 几何，描边取品牌陶土色 #D97757
 *   安全：不插删 React 管理的节点、不改模块、不加 URL 参数。
 */
(function () {
  'use strict';
  var DICT_URL = './assets/zh-cn.json';
  var LS_KEY = 'operon:zh-lang';
  var ACCENT = '#D97757';                       // 品牌陶土色（与 index.html 的 theme-color 一致）
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, KBD: 1, SAMP: 1, TEXTAREA: 1, NOSCRIPT: 1, SVG: 1, MATH: 1, CANVAS: 1 };
  var SKIP_CLASS = /(?:^|\s)(?:monaco-editor|cm-editor|katex|katex-display|hljs|code-tint|zh-skip)(?:\s|$)/;
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var SETTLE = [0, 120, 400, 900];

  var dict = {}, lookup = new Map();
  var stats = { nodes: 0, attrs: 0, hits: 0, misses: 0, lastRun: null, lang: 'zh' };
  var changedText = new Map();
  var changedAttr = new Map();

  function isZh() { return stats.lang !== 'en'; }

  /* ---------------- 规则 ---------------- */
  var TIME = { m: ' 分钟', h: ' 小时', d: ' 天' };
  var PATTERNS = [
    [/^active now$/, function () { return '刚刚活跃'; }],
    [/^active (\d+)(m|h|d) ago$/i, function (m) { return m[1] + TIME[m[2].toLowerCase()] + '前活跃'; }],
    [/^(\d+)(m|h|d) ago$/i, function (m) { return m[1] + TIME[m[2].toLowerCase()] + '前'; }],
    [/^now$/, function () { return '刚刚'; }],
    [/^All \((\d+)\)$/, function (m) { return '全部（' + m[1] + '）'; }],
    [/^Showing (\d+) of (\d+)$/, function (m) { return '显示 ' + m[1] + ' / ' + m[2]; }],
    [/^(\d+) lines? of output$/, function (m) { return m[1] + ' 行输出'; }],
    [/^(\d+) lines? of code$/, function (m) { return m[1] + ' 行代码'; }],
    [/^(\d+) artifacts?$/, function (m) { return m[1] + ' 个成果文件'; }],
    [/^(\d+) sessions?$/, function (m) { return m[1] + ' 个会话'; }],
    [/^(\d+) steps?$/, function (m) { return m[1] + ' 个步骤'; }],
    [/^(\d+) new$/, function (m) { return m[1] + ' 条新'; }],
    [/^GENERATED( · (\d+))?$/, function (m) { return '已生成' + (m[2] ? ' · ' + m[2] : ''); }],
    [/^Last checked (.+)$/, function (m) { return '上次检查 ' + (translate(m[1]) || m[1]); }],
    [/^(.+) permanently removes the project and all its data\. This cannot be undone\.$/, function (m) { return '将永久删除该项目及其全部数据。此操作无法撤销。'; }],
    [/^Ask anything — (.+)$/, function () { return '问点什么 —— @ 引用成果文件，# 引用会话，/ 使用技能，Ctrl+K 搜索'; }],
    [/^No session activity in the last (.+)\.$/, function (m) { return '最近 ' + (translate(m[1]) || m[1]) + '没有会话活动。'; }],
    [/^No (.+?) yet\.?$/, '暂无$1。'],
    [/^Couldn'?t load (.+?)\.?$/, '无法加载$1。'],
    [/^Failed to load (.+?)\.?$/, '加载$1失败。'],
    [/^Failed to save (.+?)\.?$/, '保存$1失败。'],
    [/^Unable to (.+?)\.?$/, '无法$1。'],
    [/^Open (.+)$/, '打开$1'],
    [/^Add (.+)$/, '添加$1'],
    [/^Remove (.+)$/, '移除$1'],
    [/^Delete (.+)$/, '删除$1'],
    [/^Show (.+)$/, '显示$1'],
    [/^Hide (.+)$/, '隐藏$1'],
    [/^Close (.+)$/, '关闭$1'],
    [/^Copy (.+)$/, '复制$1'],
    [/^Download (.+)$/, '下载$1'],
    [/^Upload (.+)$/, '上传$1'],
    [/^Edit (.+)$/, '编辑$1'],
    [/^Rename (.+)$/, '重命名$1'],
    [/^Refresh (.+)$/, '刷新$1'],
    [/^Retry (.+)$/, '重试$1'],
    [/^Save (.+)$/, '保存$1'],
    [/^Start (.+)$/, '启动$1'],
    [/^Stop (.+)$/, '停止$1'],
    [/^Restart (.+)$/, '重启$1'],
    [/^(.+?) failed\.?$/, '$1 失败。'],
    [/^(.+?) is required\.?$/, '$1 为必填项。'],
    [/^(.+?) not found\.?$/, '未找到$1。'],
    [/^(.+?) unavailable\.?$/, '$1 不可用。'],
    [/^(.+?) settings$/, '$1设置'],
    [/^(.+?) details$/, '$1详情'],
    [/^Account menu — (.+)$/, '账户菜单 — $1'],
    [/^Account menu$/, '账户菜单'],
    [/^Open project (.+)$/, '打开项目 $1'],
    [/^Switch to (.+)$/, '切换到 $1'],
    [/^View (.+)$/, '查看$1'],
    [/^New (.+)$/, '新建$1']
  ];
  function nounish(s) {
    if (!s) return false;
    if (lookup.has(s)) return true;
    return /^[A-Z][A-Za-z0-9.\-_]*(?: [A-Za-z0-9.\-_]+){0,3}$/.test(s);
  }
  function translate(s) {
    if (!s || s.length < 2 || !/[A-Za-z]/.test(s)) return null;
    if (lookup.has(s)) return lookup.get(s);
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = PATTERNS[i][0].exec(s);
      if (!m) continue;
      var tpl = PATTERNS[i][1];
      if (typeof tpl === 'function') { try { return tpl(m); } catch (e) { continue; } }
      if (!nounish(m[1])) continue;
      var out = tpl;
      for (var g = 1; g < m.length; g++) out = out.replace('$' + g, translate(m[g]) || m[g]);
      return out;
    }
    return null;
  }

  /* ---------------- DOM ---------------- */
  function skipped(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS[el.tagName]) return true;
    if (el.isContentEditable) return true;
    var cn = el.className;
    if (typeof cn === 'string' && SKIP_CLASS.test(cn)) return true;
    try { if (el.closest && el.closest('code, pre, kbd, samp, .monaco-editor, .cm-editor, .katex, [data-zh-skip]')) return true; } catch (e) {}
    return false;
  }
  function doText(node) {
    if (!isZh() || !node) return;
    var raw = node.nodeValue;
    if (!raw) return;
    var trimmed = raw.trim();
    if (trimmed.length < 2) return;
    stats.nodes++;
    var known = changedText.has(node);
    var hit = translate(trimmed);
    if (!hit) { if (!known) stats.misses++; return; }
    var at = raw.indexOf(trimmed);
    var next = raw.slice(0, at) + hit + raw.slice(at + trimmed.length);
    if (next === raw) return;
    if (!known) changedText.set(node, raw);
    node.nodeValue = next;
    stats.hits++;
  }
  function doAttr(el, attr) {
    if (!isZh() || !el || !el.getAttribute) return;
    var v = el.getAttribute(attr);
    if (!v) return;
    stats.attrs++;
    var hit = translate(v.trim());
    if (!hit || hit === v) return;
    if (!changedAttr.has(el)) changedAttr.set(el, {});
    var rec = changedAttr.get(el);
    if (!(attr in rec)) rec[attr] = v;
    el.setAttribute(attr, hit);
  }
  function scan(root) {
    if (!root || !isZh()) return;
    try {
      if (root.nodeType === 3) { if (!skipped(root.parentElement)) doText(root); return; }
      if (root.nodeType !== 1) return;
      if (skipped(root)) return;
      for (var i = 0; i < ATTRS.length; i++) if (root.hasAttribute && root.hasAttribute(ATTRS[i])) doAttr(root, ATTRS[i]);
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
      var n;
      while ((n = w.nextNode())) {
        if (n.nodeType === 3) { if (!skipped(n.parentElement)) doText(n); }
        else if (n.nodeType === 1 && !skipped(n)) {
          for (var j = 0; j < ATTRS.length; j++) if (n.hasAttribute(ATTRS[j])) doAttr(n, ATTRS[j]);
        }
      }
      stats.lastRun = new Date().toISOString();
    } catch (e) {}
  }
  function restoreAll() {
    changedText.forEach(function (orig, node) { try { node.nodeValue = orig; } catch (e) {} });
    changedAttr.forEach(function (rec, el) { for (var a in rec) { try { el.setAttribute(a, rec[a]); } catch (e) {} } });
    changedText.clear(); changedAttr.clear();
  }

  /* 批处理：新节点用 rAF 合并，随后 4 次落定补扫 */
  var pending = [];
  var rafPending = false;
  function flush() {
    rafPending = false;
    if (!isZh()) { pending.length = 0; return; }
    var items = pending.splice(0, pending.length);
    for (var i = 0; i < items.length; i++) scan(items[i]);
    SETTLE.forEach(function (ms) { setTimeout(function () { if (isZh()) scan(document.body); }, ms); });
  }
  function queue(node) {
    if (!isZh()) return;
    pending.push(node);
    if (!rafPending) {
      rafPending = true;
      if (window.requestAnimationFrame) requestAnimationFrame(flush); else setTimeout(flush, 16);
    }
  }

  /* ---------------- 语言按钮 ---------------- */
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      v = (v || '').trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  var LANG_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';

  function buildSwitch() {
    var old = document.getElementById('zh-lang-switch');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!document.body) return;
    var surface = cssVar('--surface-2', '#2c2c2a');
    var text = cssVar('--text-primary', '#ffffff');
    var muted = cssVar('--text-secondary', '#c3c2b7');
    var ring = cssVar('--card-shadow', '0 0 0 1px rgb(255 255 255 / 0.1), 0 1px 2px rgb(0 0 0 / 0.24)');

    var wrap = document.createElement('div');
    wrap.id = 'zh-lang-switch';
    wrap.className = 'zh-skip';
    wrap.style.cssText = 'position:fixed;right:16px;bottom:20px;z-index:2147483000;' +
      'font:500 12px/1 "Anthropic Sans",system-ui,"Segoe UI",Roboto,sans-serif;';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Language / 语言');
    btn.setAttribute('title', 'Language / 语言');
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border:0;border-radius:999px;' +
      'cursor:pointer;background:' + surface + ';color:' + text + ';box-shadow:' + ring + ';transition:filter .12s ease';
    btn.onmouseenter = function () { btn.style.filter = 'brightness(1.12)'; };
    btn.onmouseleave = function () { btn.style.filter = 'none'; };

    var icon = document.createElement('span');
    icon.style.cssText = 'display:inline-flex;color:' + ACCENT;   // 品牌陶土色
    icon.innerHTML = LANG_SVG;
    var label = document.createElement('span');
    label.style.cssText = 'letter-spacing:.01em';
    label.textContent = (stats.lang === 'en' ? 'English' : '中文');
    var caret = document.createElement('span');
    caret.textContent = '▾';
    caret.style.cssText = 'color:' + muted + ';font-size:10px;margin-left:1px';

    var menu = document.createElement('div');
    menu.style.cssText = 'display:none;position:absolute;right:0;bottom:42px;min-width:196px;padding:6px;border-radius:14px;' +
      'background:' + surface + ';box-shadow:' + ring + ';overflow:hidden';

    function render() {
      label.textContent = (stats.lang === 'en' ? 'English' : '中文');
      menu.innerHTML = '';
      [['zh', '中文（简体）', 'Chinese (Simplified)'], ['en', 'English', 'English']].forEach(function (row) {
        var it = document.createElement('button');
        it.type = 'button';
        it.style.cssText = 'display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;' +
          'padding:9px 10px;border:0;border-radius:9px;background:transparent;color:' + text + ';cursor:pointer;' +
          'text-align:left;font:inherit';
        var left = document.createElement('span');
        left.textContent = row[1];
        var right = document.createElement('span');
        right.style.cssText = 'font-size:11px;' + (stats.lang === row[0] ? 'color:' + ACCENT : 'color:' + muted);
        right.textContent = stats.lang === row[0] ? '✓' : row[2];
        it.appendChild(left); it.appendChild(right);
        it.onmouseenter = function () { it.style.background = 'rgba(217,119,87,.14)'; };
        it.onmouseleave = function () { it.style.background = 'transparent'; };
        it.onclick = function (ev) { ev.stopPropagation(); setLang(row[0]); menu.style.display = 'none'; };
        menu.appendChild(it);
      });
    }
    btn.appendChild(icon); btn.appendChild(label); btn.appendChild(caret);
    btn.onclick = function (ev) {
      ev.stopPropagation();
      var open = menu.style.display === 'block';
      if (!open) render();
      menu.style.display = open ? 'none' : 'block';
    };
    document.addEventListener('click', function () { menu.style.display = 'none'; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') menu.style.display = 'none'; });
    wrap.appendChild(menu); wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }

  /* ---------------- 语言切换 ---------------- */
  function setLang(lang) {
    stats.lang = lang === 'en' ? 'en' : 'zh';
    try { localStorage.setItem(LS_KEY, stats.lang); } catch (e) {}
    try { document.documentElement.lang = stats.lang === 'en' ? 'en' : 'zh-CN'; } catch (e) {}
    if (stats.lang === 'en') restoreAll(); else { scan(document.body); SETTLE.forEach(function (ms) { setTimeout(function () { scan(document.body); }, ms); }); }
    buildSwitch();
    return stats;
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    try { stats.lang = localStorage.getItem(LS_KEY) === 'en' ? 'en' : 'zh'; } catch (e) { stats.lang = 'zh'; }
    fetch(DICT_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { dict = j || {}; })
      .catch(function () { dict = {}; })
      .then(function () {
        lookup = new Map();
        for (var k in dict) if (Object.prototype.hasOwnProperty.call(dict, k)) lookup.set(k, dict[k]);

        function run() {
          try { document.documentElement.lang = stats.lang === 'en' ? 'en' : 'zh-CN'; } catch (e) {}
          buildSwitch();
          scan(document.body);
          SETTLE.forEach(function (ms) { setTimeout(function () { scan(document.body); }, ms); });

          try {
            new MutationObserver(function (muts) {
              if (!isZh()) return;
              try {
                for (var i = 0; i < muts.length; i++) {
                  var m = muts[i];
                  if (m.type === 'characterData') { doText(m.target); }              // 立即，防闪回
                  else if (m.type === 'attributes') { doAttr(m.target, m.attributeName); }
                  else if (m.addedNodes) {
                    for (var j = 0; j < m.addedNodes.length; j++) {
                      var n = m.addedNodes[j];
                      queue(n.nodeType === 1 ? n : document.body);
                    }
                  }
                }
              } catch (e) {}
            }).observe(document.documentElement, {
              childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS
            });
          } catch (e) {}

          // SPA 路由变化 → 立即补扫
          ['pushState', 'replaceState'].forEach(function (fn) {
            try {
              var orig = history[fn];
              history[fn] = function () { var r = orig.apply(this, arguments); setTimeout(function () { scan(document.body); }, 60); return r; };
            } catch (e) {}
          });
          window.addEventListener('popstate', function () { setTimeout(function () { scan(document.body); }, 60); });
          window.addEventListener('hashchange', function () { setTimeout(function () { scan(document.body); }, 60); });

          // 兜底轮询
          setInterval(function () { scan(document.body); }, 2000);

          window.__zhVersion = 'v5';
          window.__zhStats = stats;
          window.__zhSetLang = setLang;
          window.__zhRetranslate = function () { scan(document.body); return stats; };
          try { console.log('[zh] v3 ready · dict=' + lookup.size + ' · lang=' + stats.lang); } catch (e) {}
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
      });
  }
  boot();
})();
