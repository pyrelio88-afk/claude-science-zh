# claude-science-zh

**Claude Science 桌面端汉化补丁** —— 运行时翻译层 + 语言开关，英文基线可精确还原。

> 面向 Claude Science `0.1.70` 原生 Windows 安装
> （`claude-science.exe` + `~/.claude-science/runtime/<版本>/web-dist`）。

---

## 一、为什么不是「翻译一下 chunk」那么简单

这个应用**没有任何 i18n 框架**。在 `web-dist`（110 个 JS，约 9 MB）全量取证：

| 检索项 | 命中 | 含义 |
|---|---|---|
| `useTranslation` / `i18next` / `translations` / 消息目录 | **0** | 没有 i18n |
| `navigator.language` | 7 | 只用于 `Intl` 数字/日期格式化 |
| `locale` | 298 | 几乎全是 `localeCompare()` 排序 |
| `index.html` | — | `lang="en" translate="no"` + `<meta name="google" content="notranslate">` |

`index.html` 的注释写明了原因：整页自动翻译会把文本节点包进 `<font>`，导致 React commit 阶段
`removeChild/insertBefore` 抛 `NotFoundError`，整个页面崩到错误边界（facebook/react#11538）。

所以没有「切换语言」的现成路径。本方案**只做唯一一处改动**：往 `index.html` 注入一个
`<script>`，其余全在运行时完成。

---

## 二、架构：英文基线 + 运行时替换

```
原始包保持英文（不重打包 chunk）
  └─ index.html 注入 <script src="./assets/zh-runtime.js?vN" defer>   ← 唯一改动
       ├─ 词典   assets/zh-cn.json        改完 F5 即生效，不必重打包
       ├─ 翻译   文本节点 + placeholder/title/aria-label/alt
       ├─ 还原   记录被改的节点/属性 → 切英文时逐字段精确还原
       └─ 开关   右下角常驻「🌐 语言」按钮 → 中文（简体） / English
```

| 改动点 | 构建期补丁（v1） | 运行时 + 开关（本方案） |
|---|---|---|
| 英文模式 | 无法还原（chunk 已被改成中文） | ✅ 精确还原（记录原文） |
| 新建项目/新面板 | 依赖 chunk 是否被打过 | ✅ 自动覆盖 |
| 加词 | 要重跑 apply + 硬刷新 | ✅ 改词典 + F5 |
| React 风险 | 改模块字面量（曾触发 #321） | ✅ 不碰模块，结构上安全 |
| 首屏 | 直接中文 | 有极短英文闪烁（通常 <100ms） |

`apply.cjs`（静态补丁）**保留但默认不用**；只在想彻底去掉首屏闪烁时才跑，跑完记得
`node build-runtime.cjs` 把 `<script>` 插回去。

---

## 三、安装

```powershell
# 1) 取依赖（apply.cjs 需要 acorn）
npm install

# 2) 注入运行时层（自动探测 ~/.claude-science/runtime/*/web-dist）
node build-runtime.cjs
```

指定路径时：

```powershell
node build-runtime.cjs "C:\Users\<你>\.claude-science\runtime\0.1.70-release\web-dist"
# 或
$env:CS_WEB_DIST = "D:\...\web-dist;C:\...\web-dist"; node build-runtime.cjs
```

注入后**刷新窗口**（`Ctrl+R`；若之前跑过 apply 用 `Ctrl+Shift+R`）即可看到中文。
右下角出现「🌐 语言」按钮，可随时切回 English。

---

## 四、加词（改完 F5 即生效）

```powershell
# 1) 往任一词典文件加条目：键 = 英文原文，值 = 中文（碎片词用 trim 后的形式）
#    zh-CN-0.1.70.json / zh-cn-longtail.json / zh-cn-b2..b10.json 任选

# 2) 只更新运行时词典（日常够用）
node build-runtime.cjs

# 3) 想让首屏也是中文（可选，会重打 chunk）
node apply.cjs ; node build-runtime.cjs
```

**顺序很重要**：`apply.cjs` 会从英文原文重写 `index.html`，`build-runtime.cjs` 负责把
`<script>` 再插回去 —— 所以**先 apply 后 build-runtime**。

**改运行时代码时**：把 `build-runtime.cjs` 里的 `RUNTIME_VER` 加一。URL 变化即绕过浏览器缓存，
否则 F5 仍会吃旧脚本（这个坑实测踩过）。

批量体检：

```powershell
node extract4.cjs 80     # 在英文原文上统计还没翻的 UI 文案（top 80）
```

---

## 五、回滚

三种粒度，任选：

1. **界面内切回英文**：点「🌐 语言」→ English（保留补丁，只是显示英文）。
2. **摘掉注入**：删 `index.html` 里那行 `<script src="./assets/zh-runtime.js?vN" defer>`。
3. **完整还原**：`node restore.cjs`（从 `.backup/` 还原被 apply.cjs 改过的 chunk）。

---

## 六、踩过的坑（重要）

| 坑 | 现象 | 原因 | 修法 |
|---|---|---|---|
| 给模块 import 加 `?locale=` | 点设置里「记忆/权限/存储」→ **React error #321（Invalid hook call）** | 同一模块出现两个 URL，懒加载面板把 React 加载两份 | **永不改 import、永不加查询参数**；缓存问题用硬刷新 |
| 只改 `children` 等属性位 | 面板标题中文、正文英文 | 大量文案在 `hint/sub/benefit/detail` 等非白名单键里 | 扩展 UI 键集合（apply v4） |
| 只靠 MutationObserver | 首屏后批量挂载的文案漏翻 | 某些渲染时序下 observer 回调不触发 | 加**轮询补扫**（前 60 秒每 1.5 秒，之后每 10 秒） |
| 只翻整句 | `aria-label`（"Search"/"New project"）仍英文 | 属性不在文本节点里 | 运行时层增加属性替换 |
| 注入脚本无版本号 | 换了新脚本，界面还是旧的 | 浏览器缓存喂旧脚本 | `<script src>` 带 `?vN`（`RUNTIME_VER`） |

---

## 七、覆盖状态（v5 实测，2026-10-26）

| 区域 | 结果 |
|---|---|
| 主界面（项目列表） | 只剩品牌名 `Claude Science`（有意保留） |
| 侧栏/按钮 `aria-label` | 已译（`Search`→搜索、`New project`→新建项目、`Customize`→自定义…） |
| 设置/自定义面板 | 导航全中文：技能 / 连接器 / 专业助手 / 记忆 / 计算资源 / 网络 / 权限 / 凭据 / 存储 / 用量 / 常规 |
| 网络面板 | `Proxy address`→代理地址、`Leave blank to connect directly…`→留空则直接连接… |
| 项目对话框 | 名称 / 描述 / 给 Claude 的指令 / 占位符 / 示例句 全中文 |

**有意保留英文的部分**：
1. 会话正文、技能正文、图表标注、文件名 —— 这是**数据**，不该翻；
2. 品牌名 / 字体名 / 套餐名（`Claude Science`、`Anthropic Sans`、`Max`）；
3. daemon 自己生成的 HTML（daemon 内嵌的 "Sign in — Claude Science" 中转页、错误页），
   不在 `web-dist` 里，需另一层处理。

---

## 八、文件清单

| 文件 | 作用 |
|---|---|
| `zh-runtime.js` | **运行时翻译层源码**（核心） |
| `build-runtime.cjs` | 合并词典 → 写 `assets/zh-cn.json` + `zh-runtime.js` + 注入 `<script>` |
| `dicts.cjs` | 词典合并入口（所有批次） |
| `apply.cjs` | 静态补丁（可选；从英文原文重打，幂等，写盘前语法校验） |
| `extract4.cjs` | 在英文原文上统计未译文案（数据驱动下一批） |
| `restore.cjs` | 从 `.backup/` 还原英文 |
| `zh-CN-0.1.70.json` / `zh-cn-longtail.json` / `zh-cn-b2..b10.json` | 分批评词 |
| `kit/zh-CN.json`、`kit/zh-CN-extra.json` | 早期积累的基础词条 |
| `docs/汉化工作流.md` | 完整工作流与实测记录 |

---

## 九、说明

- 本项目只在本机读写 `~/.claude-science/runtime/<版本>/web-dist`，不联网、不动应用可执行文件。
- 原始包保持英文，任何时刻可通过界面开关或删除注入行回到英文。
- 词条是人工整理的；技术名词（`SQL`、`API`、`token` 等）按语境保留。

## License

MIT
