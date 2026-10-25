// extract4.cjs — 在"英文原文"（备份）上统计还没翻译的 UI 文案，供下一批翻译使用
// 用法: node extract4.cjs [topN]
const fs = require('fs');
const path = require('path');
const acorn = require('D:/Software/ClaudeScienceNative/localization/kit/node_modules/acorn');
const dicts = require('./dicts.cjs');

const ROOT = 'D:\\Software\\ClaudeScienceNative\\localization\\backup-native-0.1.70-data'; // 她保存的是 pristine 英文
const ASSETS = path.join(ROOT, 'assets');
const SKIP = /^(vendor|3Dmol|RDKit|katex|syntaxHighlighter|LatexContent|MarkdownDiffView|pdf|LottiePlayer)/;
const UI_KEYS = new Set([
  'children','label','title','placeholder','description','hint','sub','benefit','detail','details',
  'note','notes','text','message','help','summary','caption','empty','emptyText','tooltip','alt',
  'heading','body','footer','error','warning','confirm','actionLabel','labelText','ariaLabel',
  'subtitle','prompt','reason','statusText','confirmText','cancelText','emptyMessage','helperText',
  'errorMessage','successMessage','infoText','placeholderText','desc',
]);
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
for (const f of fs.readdirSync(ASSETS).filter(x => x.endsWith('.js') && !SKIP.test(x))) {
  const src = fs.readFileSync(path.join(ASSETS, f), 'utf8');
  try { walk(acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })); parsed++; } catch {}
}
const missing = [...counts.entries()].filter(([s]) => !known.has(s)).sort((a, b) => b[1] - a[1]);
fs.writeFileSync(path.join(__dirname, 'todo4.json'), JSON.stringify(missing.map(([s]) => s), null, 1));
console.log(JSON.stringify({ parsed, unique: counts.size, known: counts.size - missing.length, missing: missing.length }, null, 1));
const topN = parseInt(process.argv[2] || '150', 10);
console.log('--- top', topN);
for (const [s, n] of missing.slice(0, topN)) console.log(n + '\t' + s);
