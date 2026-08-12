# Changelog

## [2.0.0] - 2026-08-10

### v2.0 重构 — 全面修复清单

#### P0 — 阻断性修复
- **server 启动自动 seed 数据文件**：外人克隆后 `node dashboard/server.js` 即可使用，不再 404。服务启动时检测 `job_pool.csv`、`follow_up.csv`、`activity_log.jsonl` 是否存在，不存在则从 `templates/` 复制空模板。同时自动初始化 `config/user_profile.json`。
- **隐私泄露防护**：`.gitignore` 新增 `config/` 目录保护用户画像；移除 `application_log.csv` 死文件引用。用户数据文件和配置文件均不提交 Git。
- **去除硬编码作者画像**：`getSearchTargets()` 和搜索关键词不再写死特定公司/岗位，改为从 `config/user_profile.json` 读取用户配置驱动。

#### P1 — 功能与诚实性
- **匹配度真正实现**：新增 `computeMatchStatus()` 函数，基于用户 keywords × 岗位文本（公司+岗位+类别+备注）的关键词匹配率计算：高度匹配 ≥50% / 中度匹配 ≥25% / 可以尝试 >0%。导入、编辑、状态更新时自动写入 `cohort_match_status`。
- **搜索方法升级**：岗位获取改为 Playwright MCP 浏览器自动化 + 官网 API 直接调用，岗位 100% 真实，链接直达 JD 详情页。
- **CSV 解析支持引号内换行**：重写 `parseCSV()` 为 state-machine parser，正确处理引号内的换行符、逗号、转义引号，不再静默损坏数据。
- **时区修复**：用 `getLocalDate()` 替代 `toISOString().split('T')[0]`，中国用户深夜添加岗位不再"少一天"。

#### P2 — 加固与打磨
- **前端 XSS 加固**：新增 `escapeHtml()` 和 `safeUrl()` 函数，所有用户数据（公司名、岗位名、城市、备注、日志消息、搜索目标等）渲染前全部转义。URL 链接校验只允许 `http/https` 协议，阻止 `javascript:` 注入。
- **请求体大小限制**：`readJSON()` 添加 1MB 上限，防止超大 POST 打挂服务。
- **移除 exec() 调用**：不再使用 `child_process.exec()`，消除代码异味。
- **端口冲突友好报错**：`EADDRINUSE` 时给出清晰提示和解决方法，不再直接崩溃。
- **清理死文件**：移除 `templates/dashboard/application_log.csv`（服务端实际使用 `activity_log.jsonl`）。
- **修复 start.sh**：补全末尾换行符。
- **冒烟测试**：新增 `test/smoke-test.js`，33 项检查覆盖文件存在性、.gitignore、package.json、server.js 代码质量、dashboard.html XSS 防护、API 功能测试、路径遍历防护。

#### 其他
- 更新 SKILL.md：新增用户配置章节，移除 Playwright 引用
- 更新 README.md：移除 scraper.js，更新项目结构
- 更新 AGENTS.md：新增 v2.0 修复清单、开发约定、启动流程

---

## [1.0.0] - 2026-08-09

### 新增
- 求职看板（dashboard.html）：单页应用，支持岗位管理、进度追踪、时间线视图
- Node.js HTTP 服务端（server.js）：零外部依赖，纯内置模块
- AI Agent 岗位搜索：Playwright MCP 浏览器自动化驱动，直达校招官网
- 日间/夜间主题切换
- 多维度筛选：类别、城市、匹配度、状态
- 操作日志：可编辑、可备注、时间线展示
- 岗位导入/编辑/进度更新
- 刷新按钮：触发 Agent 搜索最新岗位
- SKILL.md：AI Agent 操作指令
- AGENTS.md：项目架构与开发约定
