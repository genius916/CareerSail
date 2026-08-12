# ⛵ CareerSail · 职航

> AI Agent 驱动的求职看板 —— 岗位智能发现、进度追踪、一键投递。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 快速开始

### 方式一：跟 AI Agent 对话（推荐）

把下面这句话发给 AI Agent（点击右上角复制）：

```
帮我安装这个求职看板：https://github.com/genius916/CareerSail-v2 —— 克隆仓库，启动服务，立即主动安装 lark-cli 并同步飞书秋招公司库（不要等我点击发现是空的再装），然后问我背景信息帮我搜岗位。
如果中途遇到需要安装的依赖（如 Node.js）、MCP 服务（如 Playwright MCP）、飞书同步工具（如 lark-cli）、浏览器自动化工具（如 /browser_use、Chrome DevTools MCP）、或者需要授权（如飞书登录、GitHub 授权），请直接教我怎么装，或者能装的就帮我装上，不要跳过这些步骤。
```

Agent 拿到仓库地址后会直接克隆、启动、初始化数据，遇到任何依赖缺失会主动引导你安装或代为安装，然后主动了解你的背景（专业、学历、目标城市、岗位方向），搜索匹配岗位写入看板，最后把看板链接发给你。一步到位，不用你操心中间步骤。

> 💡 **不同 Agent 的浏览器自动化方案不一样**（搜索岗位必备），详见下方「不同 AI Agent 下的浏览器自动化」章节。

### 方式二：终端手动安装

适合 Claude Code 等终端用户：

```bash
git clone https://github.com/genius916/CareerSail-v2.git
cd CareerSail-v2
node dashboard/server.js
```

启动后，同样在 AI Agent 对话中说"帮我搜岗位"，Agent 会引导你完成后续流程。

> **💡 以后重新打开**：双击仓库根目录的 `start.bat`（Windows）即可一键启动，不需要重新克隆或安装任何东西。

> **💡 开机自启动（Windows）**：双击 `install-startup.bat` 安装，以后每次登录电脑后服务自动在后台静默运行，不弹窗不跳转。需要时浏览器访问 `http://localhost:8430/dashboard.html` 即可。取消自启请双击 `uninstall-startup.bat`。

> 需要 [Node.js](https://nodejs.org/) v14+。端口被占用时设环境变量 `PORT` 换一个。

---

## 外部依赖（重要！）

CareerSail 的两个核心功能依赖外部工具，**新用户必须先安装才能完整使用**：

### 1. Playwright MCP — 岗位搜索（核心功能）

**用途**：`/api/search-jobs` 通过浏览器自动化直接访问公司校招官网，获取真实岗位和 JD 详情页链接。

**为什么需要**：岗位搜索不是内置爬虫，而是通过 Playwright MCP 驱动浏览器访问官网 API。没有这个工具，搜索 API 会返回空结果。

**安装方法**：

在你的 AI 编程 Agent（如 Trae、Claude Code、Codex 等）中安装 Playwright MCP 服务：

```json
// 以 Trae 为例，在 MCP 配置中添加：
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

> 安装后 Agent 会具备 `browser_navigate`、`browser_click`、`browser_evaluate` 等浏览器操作能力，CareerSail 的搜索功能才能正常工作。

**验证**：对 Agent 说"打开 https://example.com 并截图"，如果 Agent 能成功操作浏览器，说明 Playwright MCP 已就绪。

### 2. lark-cli — 秋招公司库同步（核心功能）

**用途**：从飞书多维表格同步海量秋招公司到本地仪表盘。

**为什么需要**：秋招公司库的数据来自飞书 Base 多维表格，同步功能通过 lark-cli 命令行工具拉取。没有这个工具，秋招公司库会显示 0 条。

**安装方法**（三选一，按你的 Agent 环境选最简路径）：

#### 方式 A：飞书官方 lark-cli（推荐，跨 Agent 通用）

lark-cli 是飞书官方开源的命令行工具（[github.com/larksuite/cli](https://github.com/larksuite/cli)），不依赖任何 IDE 插件，任何 Agent 环境都能用：

```bash
# 1. 安装
npx @larksuite/cli@latest install

# 2. 配置飞书应用（按提示在浏览器完成应用创建）
lark-cli config init --new

# 3. 登录授权
lark-cli auth login --recommend

# 4. 验证
lark-cli auth status
```

#### 方式 B：用你 Agent 的飞书插件/技能

不同 Agent 有等价的飞书集成方案，效果相同：

| Agent | 飞书集成方案 |
|-------|-------------|
| **Trae IDE** | 安装 `trae-remote-official:lark` 插件（内部也是基于 lark-cli） |
| **WorkBuddy** | 使用内置 `lark-unified` 技能 + 飞书连接器 |
| **Claude Code / Codex / Cursor** | 安装 lark-cli（同方式 A） |
| **其他 Agent** | 有飞书 MCP/插件就用，没有就走方式 A |

装好后对 Agent 说："登录飞书，然后同步飞书秋招公司库到 CareerSail"。

> **重要**：lark-cli 不是 Trae IDE 专属工具，它是飞书官方开源的命令行工具，任何 Agent（Claude Code、Codex、Cursor、WorkBuddy 等）都能用 npm 一行安装。

---

## 不同 AI Agent 下的浏览器自动化

CareerSail 的岗位搜索靠浏览器自动化访问公司校招官网，**不同 Agent 的方案不一样**。下面按平台分别说明，按你用的 Agent 选一种即可。

### 🚀 Trae（推荐 · 最简单）

Trae 内置了 `/browser_use` 命令，开箱即用，无需配置 MCP：

1. **直接在对话里输入 `/browser_use`**，Trae 会启动一个浏览器子 Agent，能自动打开网页、点击、填表、截图、读取内容
2. 首次使用时 Trae 会引导你打开一个已登录的 Chrome 窗口（建议用你平时求职用的、已登录牛客/公司官网的浏览器），后续搜索岗位就能直接复用你的登录态
3. 对话里说："用 /browser_use 打开字节跳动校招官网，搜索 2027 届 AI 产品经理岗位，把岗位列表和 JD 链接写进看板"

**进阶：Chrome DevTools MCP 插件**

如果想要更强的调试能力（Network 抓包、Console 日志、性能分析），可在 Trae 插件市场安装 `trae-remote-official:chrome-devtools` 插件，安装后 Agent 会获得 `click`、`navigate_page`、`evaluate_script`、`take_screenshot`、`list_network_requests` 等工具，能直接调用公司校招系统的 API（如北森的 `GetJobAdSearch`）。

> Trae 用户不需要单独装 Playwright MCP，`/browser_use` + chrome-devtools 插件已经覆盖所有场景。

### 💻 Claude Code

Claude Code 没有 `/browser_use`，需要装 **Playwright MCP**：

```json
// ~/.claude.json 或项目级 .mcp.json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

装好后对 Claude Code 说："用 playwright MCP 打开 https://campus.sany.com.cn 搜索 2027 届机械工程师岗位"，Agent 会调用 `browser_navigate`、`browser_click`、`browser_evaluate` 等工具完成搜索。

### 🎨 Codex / Cursor / Windsurf 等其他 Agent

这些 Agent 的浏览器自动化方案：

| Agent | 推荐方案 | 备注 |
|-------|---------|------|
| **Codex** | Playwright MCP（配置同 Claude Code） | OpenAI 官方支持 MCP |
| **Cursor** | Playwright MCP / Chrome DevTools MCP | 在 Settings → MCP 中添加 |
| **Windsurf** | Playwright MCP | Cascade 支持 MCP 调用 |
| **WorkBuddy** | 内置浏览器工具 | 直接对话即可 |
| **其他不支持 MCP 的 Agent** | 手动模式 | Agent 给你搜索关键词，你自己打开官网搜，把 JD 链接贴回来 |

### 🌐 通用万能方案：Playwright MCP

如果你不确定用哪个，或者想让仓库跨 Agent 通用，就装 **Playwright MCP**——它是跨平台标准，几乎所有支持 MCP 的 Agent 都能用：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

**验证**：对 Agent 说"打开 https://example.com 并截图"，能成功截图说明配置成功。

### 🔧 如果 Agent 既没有 `/browser_use` 也没装 MCP 怎么办？

CareerSail 仍可用，但需要**手动搜索模式**：

1. 在看板点击「🔄 刷新」按钮，Agent 会基于你的画像生成搜索关键词和目标公司列表
2. 你手动打开公司校招官网，按关键词搜索
3. 把找到的岗位链接复制粘贴给 Agent，Agent 会写入看板并计算匹配度

虽然慢一点，但功能完整，不会因为缺工具而用不了。

---

## 怎么用

**只需跟 AI Agent 对话。** 就像现在这样，用自然语言告诉它你的情况，Agent 会帮你搜岗位、管进度、记录每一步。

### 你告诉 Agent 你的情况，Agent 来搜

不用记命令，也不用写代码。Agent 会像这样问你、引导你：

> "你想找什么方向的岗位？有偏好的城市吗？跟我说说你的专业背景和经历，我来帮你搜。你也可以丢给我几份你已有的简历，我帮你分析、推荐方向、查找匹配的岗位。"

你只需要回答就行。Agent 会根据你的回答，自动搜索公司校招官网，把岗位信息写入看板。你刷新页面就能看到。

**城市和岗位类型都不设限。** 你偏好的城市会优先展示，但其他城市的岗位也会搜到，你可以在看板里按城市、类别、匹配度自由筛选。

### 完整投递流程

```
 Agent 搜索所有匹配岗位
        │
        ▼
 看板展示岗位卡片（含公司、岗位、城市、网申链接、匹配度）
        │
        ▼
 你点击「🔗 网申」链接 → 浏览器打开校招官网
        │
        ├── 截图或复制 JD 内容
        │
        ▼
 发送给 Agent → Agent 用 personal-career-os 按 JD 生成定制简历
        │
        ▼
 在网申页面用「牛客网申助手」插件一键填表 + 上传简历 → 提交
        │
        ▼
 回到看板，点击「更新进度」记录状态
```

**推荐工具：**

| 工具 | 用途 | 获取 |
|------|------|------|
| [personal-career-os](https://github.com/Pluto-Mo/personal-career-os) | AI 定制简历（Word/PDF/PNG）+ 投递正文 | 在 AI Agent 中安装 Skill |
| [牛客网申助手](https://www.nowcoder.com/my/resume-plugin-intro) | 浏览器插件，一键填充网申表单 | 官网下载安装包 或 浏览器插件市场安装 |

### 进度管理

看板用时间线记录每个岗位的投递进度：简历筛选 → AI测评 → 一面 → 二面 → HR面 → Offer。每次状态变更自动记录，可随时查看和编辑。

**看板功能一览：**
- 按类别、城市、匹配度筛选岗位
- 日间/夜间主题切换
- 操作日志（可编辑、可备注、时间线展示）
- 点击「🔄 刷新」触发 Agent 搜索最新岗位
- 岗位卡片支持编辑、标记优先级、更新进度

---

## 项目结构

```
CareerSail/
├── dashboard/                # 看板核心
│   ├── dashboard.html        # 单页应用
│   ├── server.js             # Node.js HTTP 服务端（零外部依赖）
│   ├── start.bat / start.sh  # 启动脚本（双击即可）
│   ├── job_pool.csv          # 岗位池（运行时自动生成，不提交 Git）
│   ├── follow_up.csv         # 跟进记录（运行时自动生成，不提交 Git）
│   └── activity_log.jsonl    # 操作日志（运行时自动生成，不提交 Git）
├── lib/                      # 搜索核心库（Playwright MCP 浏览器自动化）
│   ├── search_jobs.js        # 搜索主入口 + CLI 工具
│   ├── csv_utils.js          # CSV 解析/写入工具
│   └── recruiters/           # 招聘系统适配器
│       ├── base.js           # 适配器基类
│       ├── beisen.js         # 北森系统适配器（科大讯飞、长鑫存储等）
│       └── index.js          # 统一入口 + 公司映射表
├── config/                   # 用户配置（运行时自动生成，不提交 Git）
│   └── user_profile.json     # 用户画像（驱动搜索目标和匹配度计算）
├── templates/                # 空模板（仅表头，供首次初始化）
│   ├── dashboard/            # CSV 模板
│   └── config/               # 用户配置模板
├── test/
│   └── smoke-test.js         # 冒烟测试（运行: node test/smoke-test.js）
├── SKILL.md                  # AI Agent 操作指令（核心文档）
├── package.json              # 零依赖
└── .gitignore                # 所有个人数据文件不会被提交
```

### 数据格式

所有数据以 CSV 存储，可用 Excel 直接打开编辑。

**job_pool.csv**

| 字段 | 说明 | 示例 |
|------|------|------|
| date_found | 发现日期 | 2026-08-09 |
| company | 公司名称 | 字节跳动 |
| job_title | 岗位名称 | AI产品经理 |
| role_family | 岗位类别 | AI产品经理 |
| location | 工作城市 | 北京 |
| job_url | 网申链接 | https://... |
| priority | 优先级 | 最高 / High / Medium / 低 |
| status | 投递状态 | Pending / Submitted / Offer / Rejected / Excluded |
| notes | 备注 | 内推码、截止日期 |
| current_stage | 当前阶段 | 简历筛选 / AI测评 / 一面 / 二面 / HR面 |

---

## 核心原理

### 浏览器自动化 + 官网 API 直达

Playwright MCP 浏览器自动化直接访问公司校招官网，调用公开 API 获取真实岗位，链接直达 JD 详情页。

```
读取用户配置 → Playwright 浏览器打开校招官网 → 调用官网 API / 提取页面数据 → 岗位 + JD详情页URL → 写入 CSV → 看板展示
```

**特点：**
- ✅ 岗位绝对真实（从官网直接获取）
- ✅ 网申链接直达具体岗位的 JD 详情页
- ✅ 届别精准（只搜对应届别校园招聘）
- ✅ 一键搜索导入，速度快

**已支持的招聘系统：**

| 系统 | 代表公司 | 状态 |
|------|---------|------|
| 北森系统 | 科大讯飞、长鑫存储、鱼跃医疗、欧普照明、创维集团等 | ✅ 已适配 |
| 字节跳动自研 | 字节跳动/小荷健康 | 🔧 适配中 |
| 阿里自研 | 阿里巴巴/阿里健康 | 🔧 适配中 |
| 京东自研 | 京东/京东健康 | 🔧 适配中 |
| 飞书招聘 | MiniMax、智元机器人等 | 📋 计划中 |

> 更多系统持续适配中。未适配的公司通过浏览器手动访问官网获取岗位。

---

## 常见问题

**Q: 数据在哪？安全吗？**
A: 存在 `dashboard/` 下的 CSV 文件里，纯文本，可用 Excel 编辑。这些文件在 `.gitignore` 中，不会被提交到 GitHub。

**Q: 需要会编程吗？**
A: 不需要。装好 Node.js，双击 `start.bat` 启动，然后跟 AI Agent 对话就行。

**Q: 岗位数据会自动更新吗？**
A: 需要你主动触发。对 Agent 说"帮我刷新岗位"或点击看板上的刷新按钮。每次搜索都是实时执行，确保数据时效性。

**Q: 怎么定制简历？**
A: 在看板里找到心仪岗位 → 点击网申链接查看 JD → 截图或复制 JD 内容 → 发给 Agent，说"安装 personal-career-os，按这个 JD 生成投递包" → Agent 自动生成定制简历。

**Q: 网申链接是直达岗位详情页吗？**
A: Playwright 浏览器自动化模式下的公司（北森系统等）都是直达 JD 详情页的真实链接。其他公司根据适配程度提供官网链接或列表页链接。链接质量在 `SKILL.md` 中有明确标准。

**Q: 换一个 AI Agent 还能用吗？**
A: 可以。CareerSail 设计为跨 Agent 兼容：
- 搜索逻辑在 `lib/` 目录下的 Node.js 脚本中，任何 Agent 都能调用
- `SKILL.md` 提供了标准化的操作指令
- 数据格式是通用 CSV，所有 Agent 都能读写
- 已验证：Trae、WorkBuddy、Claude Code、Codex 等均可使用

---

## 开源协议

MIT License — 详见 [LICENSE](LICENSE)

---

<p align="center">
  <b>⛵ 扬帆启航，Offer 在望</b>
</p>