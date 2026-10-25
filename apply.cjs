// apply.cjs — 静态补丁（可选）：把中文直接写进 chunk，消掉首屏英文闪烁
//
// 教训（2026-10-26）：给模块 import 加 ?locale= 查询串会让同一模块出现两个 URL，
// 懒加载面板里 React 被加载两份 → "Minified React error #321 (Invalid hook call)"。
// 因此本脚本：① 不动 import/export ② 不动模板字符串 ③ 不加查询参数 ④ 只改 UI 键位的字符串字面量。
//
// 用法：
//   node apply.cjs                        # 自动探测 ~/.claude-science/runtime/*/web-dist
//   node apply.cjs "D:\path\to\web-dist"  # 指定
// 注意：跑完 apply 必须再跑一次 `node build-runtime.cjs` 把 <script> 标签插回去。
// 依赖：npm i（acorn）
const fs = require('fs');
const path = require('path');
const os = require('os');
const acorn = require('acorn');

const SKIP = /^(vendor|3Dmol|RDKit|katex|syntaxHighlighter|LatexContent|MarkdownDiffView|pdf|LottiePlayer)/;

const UI_KEYS = new Set([
  'children', 'label', 'title', 'placeholder', 'description', 'hint', 'sub', 'benefit', 'detail', 'details',
  'note', 'notes', 'text', 'message', 'help', 'summary', 'caption', 'empty', 'emptyText', 'tooltip', 'alt',
  'heading', 'body', 'footer', 'error', 'warning', 'confirm', 'actionLabel', 'labelText', 'ariaLabel',
  'subtitle', 'prompt', 'reason', 'statusText', 'confirmText', 'cancelText', 'emptyMessage', 'helperText',
  'errorMessage', 'successMessage', 'infoText', 'placeholderText', 'desc',
]);

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
  console.error('[!] 未找到 web-dist。用法: node apply.cjs <web-dist 路径>，或设置 CS_WEB_DIST');
  process.exit(1);
}

const dict = require('./dicts.cjs').load();
const BACKUP_ROOT = path.join(__dirname, '.backup');
const summary = [];

TARGETS.forEach((ROOT, i) => {
  if (!fs.existsSync(ROOT)) { console.log('skip (missing):', ROOT); return; }
  const BACKUP = path.join(BACKUP_ROOT, String(i));

  const saveBackup = (rel) => {
    const src = path.join(ROOT, rel), dst = path.join(BACKUP, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  };
  const dropCompressed = (rel) => {
    for (const ext of ['.br', '.gz']) {
      const p = path.join(ROOT, rel + ext);
      if (fs.existsSync(p)) { saveBackup(rel + ext); fs.unlinkSync(p); }
    }
  };

  const report = [];
  for (const name of fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.js') && !SKIP.test(f))) {
    const rel = 'assets/' + name;
    const p = path.join(ROOT, rel);
    const original = path.join(BACKUP, rel);
    const source = fs.readFileSync(fs.existsSync(original) ? original : p, 'utf8');
    let ast;
    try { ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); } catch { continue; }

    const changes = new Map();
    const add = (start, end, text) => changes.set(start, { start, end, text });
    const uiNode = (n) => {
      if (!n) return;
      if (n.type === 'Literal' && typeof n.value === 'string' && dict[n.value] !== undefined) {
        add(n.start, n.end, JSON.stringify(dict[n.value]));
      } else if (n.type === 'ArrayExpression') n.elements.forEach(uiNode);
      else if (n.type === 'ConditionalExpression') { uiNode(n.consequent); uiNode(n.alternate); }
      else if (n.type === 'LogicalExpression') uiNode(n.right);
    };
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'Property' && !n.computed) {
        const k = n.key && (n.key.name || n.key.value);
        if (typeof k === 'string' && UI_KEYS.has(k)) uiNode(n.value);
      }
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(ast);
    if (!changes.size) continue;

    let out = source;
    for (const c of [...changes.values()].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, c.start) + c.text + out.slice(c.end);
    }
    try { acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'module' }); }
    catch (e) { console.error('SKIP (would break):', rel, e.message); continue; }

    saveBackup(rel);
    fs.writeFileSync(p, out);
    dropCompressed(rel);
    report.push({ file: rel, replacements: changes.size });
  }

  // 只改 <html lang>，不加查询参数
  saveBackup('index.html');
  let html = fs.readFileSync(path.join(BACKUP, 'index.html'), 'utf8');
  html = html.replace(/lang="[^"]*"/, 'lang="zh-CN"');
  fs.writeFileSync(path.join(ROOT, 'index.html'), html);

  const total = report.reduce((n, r) => n + r.replacements, 0);
  summary.push({ root: ROOT, files: report.length, replacements: total, backup: BACKUP });
});

console.log(JSON.stringify(summary, null, 1));
console.log('\n提示：接着跑 node build-runtime.cjs 把 <script> 标签插回去。');
