// extract4.cjs — 在「英文原文」上统计还没翻译的 UI 文案，供下一批翻译使用
//
// 用法：
//   node extract4.cjs [topN]                       # 默认从 .backup/0 取英文基线
//   node extract4.cjs 80 "D:\path\to\web-dist"     # 指定要统计的 web-dist
//   CS_WEB_DIST="D:\...\web-dist" node extract4.cjs 80
//
// 英文基线优先级：命令行/环境变量 → .backup/0（apply.cjs 存的原始英文）→ 实时 web-dist（会偏）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const acorn = require('acorn');
const dicts = require('./dicts.cjs');

const SKIP = /^(vendor|3Dmol|RDKit|katex|syntaxHighlighter|LatexContent|MarkdownDiffView|pdf|LottiePlayer)/;
const UI_KEYS = new Set([
  'children', 'label', 'title', 'placeholder', 'description', 'hint', 'sub', 'benefit', 'detail', 'details',
  'note', 'notes', 'text', 'message', 'help', 'summary', 'caption', 'empty', 'emptyText', 'tooltip', 'alt',
  'heading', 'body', 'footer', 'error', 'warning', 'confirm', 'actionLabel', 'labelText', 'ariaLabel',
  'subtitle', 'prompt', 'reason', 'statusText', 'confirmText', 'cancelText', 'emptyMessage', 'helperText',
  'errorMessage', 'successMessage', 'infoText', 'placeholderText', 'desc',
]);

function detectWebDist() {
  const root = path.join(os.homedir(), '.claude-science', 'runtime');
  let versions = [];
  try { versions = fs.readdirSync(root); } catch { return null; }
  for (const v of versions) {
    const wd = path.join(root, v, 'web-dist');
    if (fs.existsSync(path.join(wd, 'index.html'))) return wd;
  }
  return null;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const topN = parseInt(args[0] || '150', 10);
const explicit = args[1] || process.env.CS_WEB_DIST || null;
const pristine = path.join(__dirname, '.backup', '0');

let ROOT, source;
if (explicit && fs.existsSync(explicit)) { ROOT = explicit; source = 'explicit'; }
else if (fs.existsSync(path.join(pristine, 'assets'))) { ROOT = pristine; source = '.backup/0 (英文基线)'; }
else {
  ROOT = detectWebDist();
  source = 'live web-dist (含已汉化，统计会偏)';
  if (!ROOT) { console.error('[!] 找不到要统计的 web-dist。'); process.exit(1); }
}

const ASSETS = path.join(ROOT, 'assets');
const known = new Set(Object.keys(dicts.load()));

const counts = new Map();
const add = (s) => {
  if (typeof s !== 'string') return;
  const t = s.trim();
  if (t.length < 2 || t.length > 600 || !/[A-Za-z]/.test(t)) return;
  if (/^(https?:|wss?:)/i.test(t)) return;
  counts.set(s, (counts.get(s) || 0) + 1);
};
const uiNode = (n) => {
  if (!n) return;
  if (n.type === 'Literal' && typeof n.value === 'string') add(n.value);
  else if (n.type === 'ArrayExpression') n.elements.forEach(uiNode);
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

let parsed = 0;
for (const f of fs.readdirSync(ASSETS).filter((x) => x.endsWith('.js') && !SKIP.test(x))) {
  const src = fs.readFileSync(path.join(ASSETS, f), 'utf8');
  try { walk(acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })); parsed++; } catch { /* 解析失败即跳过 */ }
}
const missing = [...counts.entries()].filter(([s]) => !known.has(s)).sort((a, b) => b[1] - a[1]);
fs.writeFileSync(path.join(__dirname, 'todo4.json'), JSON.stringify(missing.map(([s]) => s), null, 1));
console.log(JSON.stringify({ root: ROOT, baseline: source, parsed, unique: counts.size, known: counts.size - missing.length, missing: missing.length }, null, 1));
console.log('--- top', topN);
for (const [s, n] of missing.slice(0, topN)) console.log(n + '\t' + s);
