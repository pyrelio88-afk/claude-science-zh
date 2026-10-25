// dicts.cjs — 词典合并（所有批次统一入口）
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const FILES = [
  'kit/zh-CN.json',
  'kit/zh-CN-extra.json',
  'zh-CN-0.1.70.json',
  'zh-CN-b2.json',
  'zh-CN-b3.json',
  'zh-CN-b4.json',
  'zh-CN-b5.json',
  'zh-cn-longtail.json',
  'zh-cn-b6.json',
  'zh-cn-b7.json',
  'zh-cn-b8.json',
  'zh-cn-b9.json',
  'zh-cn-b10.json',
];
function load() {
  const out = {};
  for (const f of FILES) {
    const p = path.join(DIR, f);
    if (!fs.existsSync(p)) continue;
    try { Object.assign(out, JSON.parse(fs.readFileSync(p, 'utf8'))); } catch (e) { console.error('dict parse failed:', f, e.message); }
  }
  return out;
}
module.exports = { load, FILES };
