// restore.cjs — 从 .backup/ 还原英文原件（apply.cjs 的逆操作）
//
// 用法：
//   node restore.cjs                        # 自动探测 ~/.claude-science/runtime/*/web-dist
//   node restore.cjs "D:\path\to\web-dist"  # 指定单个目标
//
// 目录约定：apply.cjs 按目标顺序把原件存到 .backup/0、.backup/1 …
// 还原时按同一顺序取回；若不想动备份，也可直接删 index.html 里的 <script> 行。
const fs = require('fs');
const path = require('path');
const os = require('os');

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
const BACKUP_ROOT = path.join(__dirname, '.backup');

if (!fs.existsSync(BACKUP_ROOT)) {
  console.error('[!] 没有备份目录：' + BACKUP_ROOT);
  console.error('    说明没跑过 apply.cjs —— 只需删掉 index.html 里的 <script src="./assets/zh-runtime.js..."> 即可回到英文。');
  process.exit(1);
}

function walk(dir, rel = '') {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel ? path.join(rel, name) : name;
    if (fs.statSync(full).isDirectory()) walk(full, r);
    else out.push({ rel: r, from: full });
  }
}

let restored = 0;
TARGETS.forEach((ROOT, i) => {
  const BACKUP = path.join(BACKUP_ROOT, String(i));
  if (!fs.existsSync(BACKUP)) { console.log('skip (no backup #' + i + '):', ROOT); return; }
  const out = [];
  walk(BACKUP);
  for (const it of out) {
    const dst = path.join(ROOT, it.rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(it.from, dst);
    restored++;
  }
  console.log('restored', out.length, 'file(s) →', ROOT);
});

console.log('done,', restored, 'file(s) total.');
