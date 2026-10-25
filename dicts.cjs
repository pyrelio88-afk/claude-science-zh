// dicts.cjs — 词典合并（所有批次统一入口）
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const FILES = [
  // 早期基础词条
  'kit/zh-CN.json',
  'kit/zh-CN-extra.json',
  // 主线核心词典（对应 Claude Science 0.1.70）
  'zh-CN-0.1.70.json',
  // 语义批次（按 UI 区域划分）
  'zh-CN-config.json',       // 配置 / 凭据 / 镜像
  'zh-CN-connectors.json',   // 连接器 / 技能来源
  'zh-CN-model-auth.json',   // 模型授权 / 审批 / 努力级别
  'zh-CN-session.json',      // 代理 / 会话 / 示例会话
  // 杂项补丁批次
  'zh-CN-misc-6.json',
  'zh-CN-misc-7.json',
  'zh-CN-misc-8.json',
  'zh-CN-misc-9.json',
  'zh-CN-misc-10.json',
  // 长尾补词
  'zh-CN-longtail.json',
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
