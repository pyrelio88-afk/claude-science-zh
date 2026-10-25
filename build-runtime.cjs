// build-runtime.cjs — 生成运行时翻译层资源，并注入 <script>
//   1) 合并所有词典 → <web-dist>/assets/zh-cn.json
//   2) 复制 zh-runtime.js → <web-dist>/assets/zh-runtime.js
//   3) 在 index.html 的 </head> 前插入 <script src="./assets/zh-runtime.js?vN" defer></script>（幂等）
//
// 用法：
//   node build-runtime.cjs                          # 自动探测 ~/.claude-science/runtime/*/web-dist
//   node build-runtime.cjs "D:\path\to\web-dist"    # 指定一个或多个
//   CS_WEB_DIST="a;b" node build-runtime.cjs        # 环境变量（Windows 用 ; 分隔）
//
// 改运行时代码时把 RUNTIME_VER +1：URL 变化即绕过浏览器缓存，否则 F5 仍吃旧脚本。
const fs = require('fs');
const path = require('path');
const os = require('os');
const dicts = require('./dicts.cjs');

const RUNTIME_VER = 'v5';
const TAG = `<script src="./assets/zh-runtime.js?${RUNTIME_VER}" defer></script>`;
const TAG_RE = /<script src="\.\/assets\/zh-runtime\.js[^"]*"[^>]*><\/script>/;

/** 自动探测：~/.claude-science/runtime/<版本>/web-dist */
function detectTargets() {
  const out = [];
  const root = path.join(os.homedir(), '.claude-science', 'runtime');
  let versions = [];
  try { versions = fs.readdirSync(root); } catch { return out; }
  for (const v of versions) {
    const wd = path.join(root, v, 'web-dist');
    if (fs.existsSync(path.join(wd, 'index.html'))) out.push(wd);
  }
  return out;
}

const fromArgv = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const fromEnv = process.env.CS_WEB_DIST
  ? process.env.CS_WEB_DIST.split(path.delimiter).filter(Boolean)
  : [];
const TARGETS = fromArgv.length ? fromArgv : fromEnv.length ? fromEnv : detectTargets();

if (!TARGETS.length) {
  console.error('[!] 未找到 web-dist。用法: node build-runtime.cjs <web-dist 路径>，或设置 CS_WEB_DIST');
  console.error('    典型路径: %USERPROFILE%\\.claude-science\\runtime\\<版本>\\web-dist');
  process.exit(1);
}

const all = dicts.load();
const entryCount = Object.keys(all).length;
const json = JSON.stringify(all, null, 0);
const runtime = fs.readFileSync(path.join(__dirname, 'zh-runtime.js'), 'utf8');

const out = [];
for (const ROOT of TARGETS) {
  if (!fs.existsSync(ROOT)) { out.push({ root: ROOT, skipped: 'missing' }); continue; }
  const assets = path.join(ROOT, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'zh-cn.json'), json);
  fs.writeFileSync(path.join(assets, 'zh-runtime.js'), runtime);

  const idx = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(idx, 'utf8');
  let injected = false;
  if (TAG_RE.test(html)) {
    if (html.match(TAG_RE)[0] !== TAG) { html = html.replace(TAG_RE, TAG); injected = true; }
  } else {
    html = html.replace('</head>', TAG + '\n  </head>');
    injected = true;
  }
  // 语言状态由运行时层按 localStorage 决定，这里不写死 lang
  if (injected) fs.writeFileSync(idx, html);

  out.push({ root: ROOT, dictEntries: entryCount, dictBytes: json.length, injected });
}
console.log(JSON.stringify(out, null, 1));
