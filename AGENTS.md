# AGENTS.md

## 项目概述

CareerSail（职航）是一个 AI Agent 驱动的本地求职看板。用户在浏览器中打开看板管理岗位，通过自然语言与 AI Agent 对话来搜索岗位、追踪进度。

## 核心架构

```
用户 ──自然语言──▶ AI Agent ──Playwright MCP──▶ 公司校招官网
                         │       浏览器自动化
                         ▼
               config/user_profile.json    ← Agent 写入用户画像
                         │
                         ▼
                    job_pool.csv ←── 看板（dashboard.html）展示
                         │                ↑ 匹配度自动计算
                         ▼
                    用户筛选 ──▶ 点击网申链接 ──▶ 投递 ──▶ 更新进度
```

## Agent 职责

1. **收集用户画像**：首次对话时了解用户背景（专业、学历、目标城市、岗位方向），写入 `config/user_profile.json`
2. **岗位搜索**：根据用户配置使用 Playwright MCP 浏览器自动化直接访问公司校招官网，调用公开 API 获取真实岗位
3. **匹配度计算**：服务端自动基于用户 keywords × 岗位文本计算匹配度（高度/中度/可以尝试）
4. **数据管理**：读写 `dashboard/job_pool.csv`、`follow_up.csv`、`activity_log.jsonl`
5. **进度追踪**：更新投递状态和面试阶段
6. **简历引导**：引导用户安装 personal-career-os Skill 来定制简历

## 技术栈

- 前端：单页 HTML/CSS/JS（dashboard.html）
- 后端：Node.js 零依赖 HTTP 服务（server.js）
- 数据：CSV + JSONL 文件存储
- 搜索：Playwright MCP 浏览器自动化 + 官网 API 直接调用
- 配置：JSON 文件（config/user_profile.json）

## 文件结构

```
CareerSail/
├── dashboard/              # 看板核心
│   ├── dashboard.html      # 单页应用前端
│   ├── server.js           # HTTP 服务端（零依赖）
│   ├── start.bat/sh        # 启动脚本
│   ├── job_pool.csv        # 岗位池（运行时生成）
│   ├── follow_up.csv       # 跟进记录（运行时生成）
│   └── activity_log.jsonl  # 操作日志（运行时生成）
├── lib/                    # 搜索核心库
│   ├── search_jobs.js      # 搜索主入口 + CLI 工具
│   ├── csv_utils.js        # CSV 解析/写入工具
│   └── recruiters/         # 招聘系统适配器
├── config/
│   └── user_profile.json   # 用户画像（运行时生成）
├── templates/              # 空模板（仅表头）
│   ├── dashboard/          # CSV 模板
│   └── config/             # 用户配置模板
├── test/
│   └── smoke-test.js       # 冒烟测试
├── SKILL.md                # Agent 操作指令
├── package.json            # 零依赖
└── .gitignore
```

## 启动流程

1. `node dashboard/server.js` 启动服务
2. 服务自动检测 `dashboard/` 下是否有数据文件，没有则从 `templates/` 复制空模板
3. 服务自动检测 `config/user_profile.json` 是否存在，没有则从模板复制
4. 默认端口 8430，端口被占用时报错并提示解决方法

## 开发约定

- 数据文件（*.csv, *.jsonl）和用户配置（config/）在 .gitignore 中，不提交 Git
- 模板文件在 templates/ 下，仅含表头
- 服务默认端口 8430，可通过 PORT 环境变量修改
- 所有 Agent 操作通过自然语言触发，无命令行接口
- 不硬编码任何特定用户的求职画像
- 岗位搜索通过 Playwright MCP 浏览器自动化直接访问公司校招官网，不依赖搜索引擎
- 搜索逻辑在 `lib/` 目录下，Agent 调用脚本即可，无需重写搜索逻辑
- CSV 解析使用 state-machine parser，支持引号内换行
- 所有日期使用本地时区（getLocalDate），不用 toISOString()
- 前端所有用户数据渲染经过 escapeHtml 转义，URL 经过 safeUrl 校验
- 冒烟测试：`node test/smoke-test.js`

## v2.0 修复清单

| 编号 | 问题 | 修复 |
|------|------|------|
| P0-1 | 外人克隆后无数据文件，404 | server 启动自动 seed |
| P0-2 | 个人数据泄露风险 | .gitignore 加固 + config/ 保护 |
| P0-3 | 硬编码作者求职画像 | 改为 config/user_profile.json 驱动 |
| P1-4 | 匹配度是空头支票 | 实现 computeMatchStatus() |
| P1-5 | 搜索方法不准确 | 改用 Playwright MCP 浏览器自动化 + 官网 API 直接调用 |
| P1-6 | CSV 多行解析损坏 | 改用 state-machine parser |
| P1-7 | 时区 bug | 用 getLocalDate() 替代 toISOString() |
| P2-8 | innerHTML XSS 风险 | escapeHtml + safeUrl 全覆盖 |
| P2-9 | 请求体无大小限制 | 添加 1MB 上限 |
| P2-10 | exec() 字符串拼接 | 移除 exec，不再启动外部进程 |
| P2-11 | 端口冲突直接崩溃 | EADDRINUSE 友好报错 |
| P2-12 | 死文件/缺换行/无测试 | 清理 + 修 start.sh + 加冒烟测试 |