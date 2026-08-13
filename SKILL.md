# CareerSail · 职航

AI Agent 驱动的求职操作系统 —— 岗位智能发现、进度追踪、一键投递。

## 这是什么

CareerSail 是一个本地求职看板，运行在用户的电脑上。它由三部分组成：
1. **看板（dashboard）**：一个 Web 页面，用于展示和管理岗位
2. **AI Agent 操作指令**：本文件，告诉 Agent 如何搜索岗位、管理数据
3. **搜索脚本（search_jobs.js）**：基于浏览器自动化 + API 的真实岗位搜索模块

用户通过自然语言跟 Agent 对话，Agent 搜索岗位写入 CSV，用户在看板中查看和管理。

## 核心设计理念

采用「Playwright MCP 浏览器自动化 + 官网 API 直接调用」的方式，确保：
- ✅ 岗位 100% 真实存在（从官网直接获取）
- ✅ 链接直达 JD 详情页（而非公司首页）
- ✅ 届别严格匹配（2027届就是2027届校园招聘）
- ✅ 跨 Agent 可复现（标准化流程，换 Claude/WorkBuddy/Codex 都能跑）

## 安装与启动

CareerSail 支持两种安装方式：

**方式一：AI Agent 自动安装（推荐）** — 用户把仓库地址发给 Agent 即可：
"帮我安装这个求职看板：https://github.com/genius916/CareerSail —— 克隆仓库，启动服务，**立即主动安装 lark-cli 并同步飞书秋招公司库**（不要等我点击发现是空的再装），然后问我背景信息帮我搜岗位。如果中途遇到需要安装的依赖（Node.js）、MCP 服务（Playwright MCP）、飞书同步工具（lark-cli）、浏览器自动化工具（/browser_use、Chrome DevTools MCP）、或需要授权（飞书、GitHub），请直接教我怎么装，或者能装的就帮我装上，不要跳过。"
Agent 负责克隆仓库、启动服务、初始化数据文件（从 `templates/dashboard/` 复制空模板），并主动引导用户完成依赖安装。

**方式二：终端手动安装** — 适合 Claude Code 等终端用户：
```bash
git clone https://github.com/genius916/CareerSail.git
cd CareerSail
node dashboard/server.js
```

服务启动时会自动从 `templates/` 初始化数据文件（CSV 模板 + 用户配置模板），外人克隆即可使用，不会遇到 404。

默认端口 8430，可通过 `PORT` 环境变量修改。启动后 Agent 给用户发送看板链接，用户点击打开。

**启动后必须告诉用户**：以后想重新打开看板，双击仓库根目录的 `start.bat`（Windows）或在终端执行 `node dashboard/server.js` 即可，不需要重新克隆或安装任何东西。

**重要：启动后不要直接给链接。** 先了解用户背景（专业、学历、目标城市、岗位方向），写入 `config/user_profile.json`，再搜索匹配岗位写入 CSV，最后才说"看板已就绪，点击链接查看"并发送链接。

### ⚠️ 强制流程：服务启动后立即装 lark-cli 并同步飞书秋招公司库

**v3.12 优化**：Agent 启动 `node dashboard/server.js` 后，**lark-cli 安装和画像询问可以并行进行**，不要串行等一个完了再另一个——这样用户等待时间减半。

执行顺序：

1. **启动服务**：`node dashboard/server.js`，确认看板可访问
2. **并行执行两件事**（不要串行）：
   - **A 路：装 lark-cli + 同步**（后台进行，用户不用等）
     - 检查 `lark-cli --version`，未装则 `npx @larksuite/cli@latest install`
     - 若未授权，引导用户 `lark-cli auth login --recommend`（浏览器弹窗确认，只需几秒）
     - 调 `POST http://localhost:8430/api/sync-external` 触发同步
   - **B 路：问用户画像**（同步进行，用户回答的同时 A 路在后台跑）
     - 问专业、毕业年份、意向岗位、城市、技能、简历
     - 写入 `config/user_profile.json`
3. **A 路完成后**：验证 `GET /api/external-companies` 返回 > 400 条
4. **如果同步成功**：告诉用户"飞书秋招公司库已同步完成"
5. **如果同步失败**：不阻塞，告诉用户"飞书同步暂未完成，可点击看板「🔄 同步飞书」按钮手动触发，不影响搜索岗位"
6. **最后**：给用户看板链接，并告诉用户"以后双击 `start.bat` 即可重新启动看板"

> **关键**：lark-cli 是飞书官方开源工具（[github.com/larksuite/cli](https://github.com/larksuite/cli)），npm 一行装，跨 Agent 通用。如果 Agent 自带飞书插件/技能，用对应的即可。不要因为"没有某 IDE 插件"就放弃同步。

## 用户配置

### ⚠️ 强制流程：首次启动必须先填写画像

**v3.9 强制规则**：Agent 启动服务后必须先检查 `config/user_profile.json` 是否为空模板，若为空**禁止直接给看板链接**，必须按下面顺序引导用户填写画像：

1. **询问基本信息**（按这个顺序问，一次问全，不要挤牙膏；候选岗位跨专业，不限计算机）：
   ```
   "为了帮你精准搜岗位，告诉我这几件事：
    1) 你的专业是什么？（如：机械工程 / 临床医学 / 金融学 / 化学工程 / 土木工程 / 计算机 / 会计学 / 工业设计）
    2) 你是哪一届毕业？（如：2027届）
    3) 想找什么方向的岗位？可多选，下面是候选参考，也可自己写：
       - 计算机/互联网：AI产品经理 / 算法工程师 / 后端开发 / 数据分析师 / 产品运营
       - 机械/制造：机械工程师 / 结构工程师 / 制造工程师 / 工艺工程师 / 机电一体化
       - 医学/医药：临床研发 / 医学事务 / 医疗产品经理 / 药品注册 / 临床监查员CRA
       - 金融/财务：投资分析师 / 行业研究员 / 风控工程师 / 财务管培生 / 量化研究员
       - 土木/建筑：结构设计 / 施工管理 / 造价工程师 / 建筑设计 / 市政工程师
       - 化工/材料：工艺研发 / 材料工程师 / 配方工程师 / 安全工程师 / 质量工程师
       - 设计/创意：UI/UX设计师 / 工业设计 / 视觉设计 / 交互设计 / 品牌策划
       - 运营/市场：用户运营 / 内容运营 / 市场管培生 / 品牌运营 / 电商运营
       - 其他：人力资源 / 供应链管理 / 法务合规 / 战略咨询 / 销售管培生
    4) 意向城市有哪些？仅作优先级参考，不限制搜索范围（如：上海 / 北京 / 合肥 / 长沙 / 南昌 都行，后期可改）
    5) 有什么技能或研究方向？（如：SolidWorks / 有限元分析 / Python / 临床诊断 / 财务建模）
    6) 如果你有现成简历（PDF/Word/Markdown），发给我，我帮你提取关键词补充到画像。没有就跳过。
    回答完我帮你写入配置，然后开始搜岗位。"
   ```
2. 把用户回答写入 `config/user_profile.json`（保留模板里其他字段默认值）
3. **v3.11 重要**：搜索时**不要**把 `target_cities` 写进搜索关键词——城市只用于结果排序，不能因为用户没选某城市就漏掉那里的岗位。搜索关键词只用 `job_type + cohort + target_roles + skills`
4. 验证画像非空后，**才**开始搜岗位
5. 最后才给用户看板链接

> 前端 dashboard 启动时也会自动检测空画像并弹引导框，但 Agent 侧的主动询问才是主流程。

### 画像字段说明

```json
{
  "name": "用户姓名",
  "education": "学校",
  "major": "专业",
  "degree": "学历",
  "graduation_year": "2027",
  "research_direction": "研究方向（如：医疗大模型、机器人控制）",
  "internship_experience": "实习经历简述（如：某互联网公司产品实习）",
  "skills": ["Python", "FastAPI", "Prompt工程"],
  "job_type": "full-time",
  "target_cities": ["北京", "上海"],
  "target_roles": ["AI产品经理", "产品运营"],
  "keywords": ["AI", "产品", "大模型"],
  "search_targets": [
    { "company": "字节跳动", "keywords": "AI产品 校招", "campus_url": "https://jobs.bytedance.com/campus" },
    { "company": "腾讯", "keywords": "产品经理 校招", "campus_url": "https://join.qq.com" }
  ]
}
```

- `graduation_year`：**届别精准的核心**。设为 "2027" 即只搜 2027 届校招，搜索关键词自动带 "2027届"
- `job_type`：`full-time`（默认，全职校招，排除实习）或 `internship`（收实习）
- `research_direction` / `internship_experience` / `skills`：驱动**公司发现计划**的四维度关键词簇推导（见下文「公司发现方法」），不限专业
- `keywords`：用于自动计算岗位匹配度（高度匹配 / 中度匹配 / 可以尝试）。**v3.9 起支持 2-gram 碎片匹配**，"结构设计"能匹配"结构工程师"，用户不必精确拆词
- `search_targets`：驱动 Agent 搜索目标公司，每一项包含公司名、搜索关键词、校招官网URL
- `target_cities`：**仅作优先级参考，不作为搜索筛选限制**（v3.11）。意向城市命中的岗位排到前面，但合适的岗位无论在哪个城市都会被搜出来。原因是用户主观意向会变化，不能因为没选某城市就漏掉那里的好岗位。Agent 搜索时不要把城市写进搜索关键词，只用于结果排序
- `target_roles`：用于生成搜索关键词和匹配度计算，跨专业通用（机械/医学/金融/土木/化工/设计等均有候选，不限计算机）

## 路由任务

先判断用户意图，再执行对应操作：

| 用户意图 | 触发词 | 执行动作 |
|---------|--------|---------|
| 搜索岗位 | "帮我搜岗位""找校招""有什么岗位""刷新" | 使用浏览器自动化搜索真实岗位，写入 job_pool.csv |
| 查看岗位 | "看岗位""打开看板""dashboard" | 读取 job_pool.csv 展示摘要，提醒用户打开看板查看完整信息 |
| 管理进度 | "更新进度""标记状态""投了""面试" | 更新对应岗位的 status/current_stage 字段，写入 follow_up.csv |
| 导入岗位 | "导入""添加岗位""加入看板" | 追加写入 job_pool.csv |
| 标记剔除 | "不投了""剔除""删掉" | 将 status 改为 Excluded |
| 定制简历 | "按 JD 生成简历""定制简历""生成投递包" | 引导用户安装 personal-career-os Skill，然后按 JD 生成 |
| 更新配置 | "改我的背景""更新画像""换目标城市" | 更新 config/user_profile.json |

## 岗位搜索方法（Playwright MCP 浏览器自动化）

### 核心原则

1. **直达官网**：永远从公司校招官网获取岗位，不依赖搜索引擎的模糊结果
2. **届别精准**：用户是 N 届就只搜 N 届校园招聘，不混入 N-1 届。必须复核目标职位/届次的招聘周期确实处于**开放状态**，而不仅仅是"公司有一个职业发展页面"。先访问公司校园门户找到**该届的申请入口**（而非首页），再通过网络搜索核实招聘信息是否仍有效
3. **全职优先**：默认只收全职校园招聘，自动排除实习岗位。仅当用户在 `user_profile.json` 把 `job_type` 设为 `internship` 时才收实习。警惕"实习已开放但全职未定"陷阱，以及"职位描述的届/年标注与实际可选时间窗口不一致"陷阱
4. **JD 直链**：网申链接必须是岗位详情页 URL，不能只是公司首页
5. **新鲜度复核**：发布时间超过 6 个月、或无发布时间的岗位，必须进入官网复核招聘是否仍开放，不要用模糊措辞标注"是否确定"
6. **真实优先**：能拿到具体JD链接就给JD链接，实在拿不到给公司校招官网（必须真实存在）

### 标准搜索流程（六步）

**第一步：读取用户配置**
- 从 `config/user_profile.json` 获取毕业年份、`job_type`、目标岗位、搜索目标公司列表
- 确定本届关键词（如 `2027届校园招聘`）。若未配置 `graduation_year`，先向用户确认毕业届别再继续

**第二步：逐家访问公司校招官网**
- 从 `search_targets[].campus_url` 直接导航到校招页面
- **届别入口验证**：不要停在首页/职业发展页，要进入**该届的申请入口**（如 "2027届校园招聘" 专属页）。确认页面标题/导航含正确届别年份
- **开放状态复核**：通过 WebSearch 核实该公司该届招聘是否仍在进行中（是否已发截止公告/补录结束）。若已结束，标记为"已结束"并跳过
- 若URL失效，手动访问官网找最新校招页面并更新配置

**第三步：筛选目标岗位 + 实习/全职区分**
- 使用页面筛选功能：按"校园招聘"→"2027届"→ 岗位类别（产品/运营/市场等）
- 或使用官网搜索框：输入用户的目标岗位关键词
- 或调用官网 API（如北森系统的 `GetJobAdPageList`）
- **实习排除**：默认只收全职校招。岗位标题/描述含"实习/实习生/日常实习/寒暑假实习/intern"的，除非用户 `job_type=internship`，否则跳过
- **届别文本核对**：岗位文本若明确标注了届别（如"2026届"），与用户目标届不符则跳过；未标注届别的保留但备注"届别待官网复核"

**第四步：提取岗位信息 + JD详情页URL**
- 每个岗位必须提取：公司名、岗位名、城市、JD详情页URL、发布时间
- **JD详情页URL格式示例**：
  - 字节跳动：`https://jobs.bytedance.com/campus/position/{id}/detail`
  - 阿里巴巴：`https://campus-talent.alibaba.com/campus/position/{id}?deptCodes=`
  - 京东：`https://campus.jd.com/#/details?id={id}`
  - 科大讯飞（北森系统）：`https://{company}.zhiye.com/campus/detail?jobAdId={guid}`
  - 飞书招聘系统：`https://{xxx}.jobs.feishu.cn/{xxx}/m/position/{id}/detail`
- 若无法获取具体JD链接（纯前端渲染且无API），给公司校招官网列表页URL（必须真实可访问）

**第五步：新鲜度复核**
- 发布时间超过 6 个月、或无发布时间的岗位：进入 JD 详情页确认"立即申请/投递"按钮可点击且未置灰，否则跳过
- 搜索摘要中**不要用模糊措辞**标注职位是否确定；准确记录实际的资格要求与届别

**第六步：写入 job_pool.csv**
- 检查去重：同一公司同一岗位不重复添加
- 匹配度计算：基于 `keywords` 与岗位文本的关键词匹配率，写入 `match_degree`
- 届别状态：写入 `cohort_match_status`（Yes/No/Unverified）
- 优先级标注：根据匹配度和用户偏好自动标注

### 各招聘系统的URL模式（速查表）

| 招聘系统 | 公司示例 | 职位列表URL模式 | 职位详情URL模式 | API可用性 |
|---------|---------|---------------|---------------|----------|
| 字节跳动自研 | 字节跳动 | `https://jobs.bytedance.com/campus/position` | `/campus/position/{id}/detail` | 有（带签名） |
| 阿里自研 | 阿里巴巴/阿里健康 | `https://campus-talent.alibaba.com/campus/position` | `/campus/position/{id}?deptCodes=` | 有 |
| 京东自研 | 京东/京东健康 | `https://campus.jd.com/#/jobs` | `/#/details?id={id}` | 有 |
| 北森系统 | 科大讯飞/长鑫存储/鱼跃等 | `https://{company}.zhiye.com/campus/jobs` | `/campus/detail?jobAdId={guid}` | 有（Post API） |
| 飞书招聘 | MiniMax/智元机器人等 | `https://{xxx}.jobs.feishu.cn/{code}` | `/m/position/{id}/detail` | 有限 |
| B站自研 | 哔哩哔哩 | `https://jobs.bilibili.com/campus/positions` | `/campus/positions/{id}` | 有 |
| Moka系统 | 部分创业公司 | `https://{company}.mokahr.com/` | 各异 | 有限 |

### 提取JD详情页URL的优先级策略

1. **API 直接提取**（最高效）：如果招聘系统有公开API，直接调用获取职位ID列表
   - 北森系统：`POST /api/Jobad/GetJobAdPageList` 返回所有职位的 `Id`（GUID）
   - 阿里校招：页面渲染时可从DOM直接提取所有 `position/{id}` 链接
   
2. **DOM 提取**：在职位列表页，用 `document.querySelectorAll('a[href*="position"]')` 提取所有链接
   
3. **点击跳转**：点击职位卡片进入详情页，从地址栏获取URL（最慢，但最可靠）

4. **官网列表页兜底**：如果以上都不行，给公司校招官网的筛选后列表页URL

## 公司发现方法（通用，不限专业）

### 核心原则：公司池由用户画像驱动，不硬编码行业列表

CareerSail 开源后用户专业五花八门（机械、计算机、金融、化工、设计……），**不能预置"某行业的公司列表"**。公司发现必须是一套**方法**，由 `user_profile`（专业 / 目标岗位 / 城市 / 关键词 / 实习经历 / 研究方向 / 经验 / 能力 / 简历已有内容等）动态驱动。

公司发现有三条路径，Agent 应**优先走路径 A（已有线索，最快最可靠）**，路径 A 不足时再走路径 B（关键词派生），路径 B 仍不足时走路径 C（全量兜底）：

- **路径 A：外部公司库线索**（v4.2 新增，最快最可靠）— 已同步的飞书秋招公司库含 400+ 家真实招聘公司，每家带 `career_url`（校招官网直链）。Agent 调 `GET /api/external-clues` 获取基于用户画像精排的 Top 30 匹配公司，直接浏览这些公司的校招官网搜索岗位。**不需要 WebSearch 发现公司，线索已经在了，直接去搜岗位**
- **路径 B：四维度关键词派生**（通用方法）— 从用户画像派生本体/上游/下游/交叉四个层面的关键词簇，通过 WebSearch 发现新公司
- **路径 C：全量兜底** — 路径 A 和 B 都不足时，分批遍历外部公司库剩余公司

### 路径 A：外部公司库线索（优先执行）

外部公司库已同步 400+ 家真实招聘公司，每家含 `career_url`（校招官网直链）、岗位类别、城市、批次等信息。**这是最快最可靠的岗位发现路径，Agent 应优先执行。**

**执行步骤：**

1. **获取精排线索**：调 `GET http://localhost:8430/api/external-clues`，接口基于用户画像（target_roles × target_cities × keywords）打分精排，返回 Top 30 最匹配的公司，每家带 `career_url`、`match_reasons`（匹配原因）、`job_categories`（岗位类别）
2. **逐家浏览搜索**：对每家匹配公司，用浏览器自动化（`/browser_use` 或 Playwright MCP）打开其 `career_url`，按用户 `target_roles` 筛选岗位
3. **提取岗位 + JD 链接**：走标准搜索流程第三~五步（筛选岗位 → 提取 JD 详情页 URL → 新鲜度复核）
4. **批量导入**：通过 `POST /api/import-batch` 写入 job_pool.csv
5. **若 30 家搜完岗位仍不足**：继续走路径 B

> **关键**：路径 A 不需要 WebSearch 发现公司——公司线索已由外部公司库提供（都是真实在招的公司），Agent 只需直接打开 `career_url` 搜索岗位。每家公司的 `career_url` 是校招官网直链，省去了"先搜索发现公司再找官网"的步骤。

### 路径 B：四维度关键词派生（扩展搜索）

**第一步：领域扩展（从用户画像派生搜索面）**

Agent 根据用户专业 + 目标岗位，自动推导 **4 个层面**的搜索关键词簇：

- **本体行业**：目标岗位直接对应的行业
- **上游**：零部件 / 算法 / 材料 / 工具供应商
- **下游**：应用场景行业
- **交叉领域**：与其他技术结合的领域

> 举例（仅为说明方法，不是硬编码）：
>
> - 机械 + 机器人方向 → 本体(机器人公司) + 上游(减速器/电机/传感器) + 下游(制造/物流/医疗设备) + 交叉(机电/智能硬件)
> - 计算机 + AI 方向 → 本体(互联网/AI公司) + 上游(云计算/芯片) + 下游(金融科技/自动驾驶) + 交叉(AI+医疗/AI+教育)
> - 医学 + AI产品方向 → 本体(医疗AI/互联网医疗) + 上游(大模型/数据平台) + 下游(医院/药企/健康管理) + 交叉(AI+医疗/智慧医疗)
>
> 方法相同，关键词簇随用户画像不同而不同。换任何专业都跑这套推导。

**第二步：逐层发现公司**

对每一层，用该层关键词 + `{届}校招` + 城市偏好，通过 WebSearch / 浏览器访问公司校招官网，发现真实公司。

**第三步：开放状态复核（同标准搜索流程第二步）**

确认该公司确有面向 `{届}` 的 `{全职校招/实习}` 岗位且**正在开放**（而非仅有职业发展页面）。警惕"实习已开放但全职未定"陷阱。

**第四步：写入 search_targets**

把通过复核的公司以 `{ company, keywords, campus_url }` 追加到 `config/user_profile.json` 的 `search_targets`，再走标准搜索流程提取岗位。

### 路径 C：全量兜底（深度搜索）

若路径 A（30 家精排公司）和路径 B（四维度关键词）搜完岗位仍不足：
1. 调 `GET http://localhost:8430/api/external-companies` 获取全量外部公司库
2. 排除路径 A 已搜索的公司（通过 `source_record_id` 去重）
3. 分批搜索剩余公司（每批 10-15 家），按批次逐家浏览 `career_url` 搜索岗位
4. 每搜完一批即导入 job_pool.csv，不要等全搜完再批量导入

### Agent 发现公司时的红线

- 不凭空捏造公司名，所有公司必须来自搜索/官网真实结果或外部公司库
- 不硬编码"某专业对应某公司清单"，公司由画像派生的关键词簇或外部公司库驱动
- 发现的公司必须能打开校招官网，且该届申请入口可访问
- 实习/全职状态按用户 `job_type` 严格区分

## 仪表盘刷新功能

**用户点击「🔄 刷新」时，Agent 必须执行真实搜索，不能只重载数据。**

正确行为（Agent 侧）：
1. 用户点击刷新 → 看板调 `/api/search-targets` 返回搜索目标和渐进式计划
2. **Agent 收到搜索目标后，立即启动浏览器自动化搜索**：
   - 优先走路径 A：调 `/api/external-clues` 获取 Top 30 匹配公司，逐家浏览其 `career_url` 搜索岗位
   - 路径 A 不足时走路径 B：用四维度关键词通过 WebSearch 发现新公司
3. **搜索过程中**：每搜完一家公司就通过 `/api/import-batch` 导入岗位，用户能在看板实时看到新增
4. **搜索完成后**：告诉用户新增了多少岗位、跳过了多少、还有多少家公司未搜

**错误行为**：
- ❌ 刷新只重载 CSV 数据，不触发搜索
- ❌ 告诉用户"点击搜索按钮"但没有实际搜索
- ❌ 1 秒就刷新完，没有实际浏览任何网站

## 数据文件

所有数据存储在 `dashboard/` 下的 CSV/JSONL 文件中：

- `job_pool.csv`：岗位池（公司、岗位、城市、链接、优先级、状态、阶段、匹配度）
- `follow_up.csv`：跟进记录（公司、岗位、阶段、日期、下一步、备注）
- `activity_log.jsonl`：操作日志（时间、消息、类型）

用户配置存储在 `config/user_profile.json`。

这些文件在 `.gitignore` 中，不会提交到 Git。

### CSV 字段说明（job_pool.csv）

| 字段 | 说明 | 示例 |
|------|------|------|
| date_found | 发现日期 | 2026-08-09 |
| company | 公司名称 | 小荷健康（字节跳动） |
| job_title | 岗位名称 | AI产品经理（医疗大模型训练方向） |
| role_family | 岗位大类 | AI产品经理 |
| level | 招聘类型 | 校招/实习/社招 |
| location | 工作地点 | 北京 |
| remote_policy | 远程政策 | onsite/hybrid/remote |
| source | 来源 | 字节校招官网（已验证） |
| job_url | 网申链接（JD详情页） | https://jobs.bytedance.com/campus/position/7669685095146457397/detail |
| posted_date | 发布日期 | 2026-08-03 |
| priority | 优先级 | 最高/High/Medium/Low |
| status | 状态 | Pending/Submitted/Excluded/Rejected |
| resume_variant | 简历版本 | AI产品经理版 |
| notes | 备注 | 医学背景+AI产品经验匹配 |
| cohort_match_status | 届别匹配 | Yes/No |
| current_stage | 当前阶段 | 简历筛选/AI面试/终面 |

**job_url 质量标准**：
- 🟢 优质：直接跳转到具体岗位的JD详情页（如 `/position/12345/detail`）
- 🟡 合格：跳转到公司校招官网且有明确的岗位列表筛选
- 🔴 不合格：只跳转到公司首页或招聘首页，无法找到具体岗位

## 与 personal-career-os 配合

当用户看中某个岗位需要定制简历时：
1. 用户从看板点击网申链接查看 JD
2. 用户截图或复制 JD 内容发给 Agent
3. 引导用户安装 [personal-career-os](https://github.com/Pluto-Mo/personal-career-os) Skill
4. 在 personal-career-os 中按 JD 生成定制简历（Word/PDF/PNG）
5. 用户用牛客网申助手插件在网申页面填表上传

## 跨 Agent 兼容性说明

本项目设计为在任何支持以下能力的 AI Agent 上均可运行：
- 文件读写（CSV/JSON）
- 浏览器自动化（Playwright/Puppeteer/浏览器插件）
- 网络请求（fetch/XHR）
- 执行 Node.js 脚本

不同 Agent 的浏览器自动化方案：
- **Trae**：优先用 `/browser_use` 斜杠命令（开箱即用，复用用户已登录的 Chrome）；进阶可装 `trae-remote-official:chrome-devtools` 插件获得 `click`/`navigate_page`/`evaluate_script`/`list_network_requests` 等工具
- **WorkBuddy**：使用内置浏览器自动化工具（TRAE-browseruse skill）
- **Claude Code / Codex / Cursor / Windsurf**：使用 Playwright MCP（配置 `npx @playwright/mcp@latest`），调用 `browser_navigate`/`browser_click`/`browser_evaluate` 等工具
- **OpenClaw**：使用 browser_use 插件
- **其他不支持 MCP 的 Agent**：手动模式，Agent 给出搜索关键词和公司列表，用户手动打开官网搜索后回贴 JD 链接

搜索逻辑在 `lib/` 目录下的 Node.js 脚本中实现，Agent 只需调用脚本即可，无需重写搜索逻辑。

### Agent 遇到依赖缺失时的处理规范

1. **Node.js 缺失**：引导用户从 https://nodejs.org/ 下载 v14+ 安装
2. **浏览器自动化不可用**：
   - Trae 环境：提示用户输入 `/browser_use` 命令激活浏览器子 Agent
   - 其他环境：教用户配置 Playwright MCP（给出 JSON 配置）
   - 都不可用：降级为手动搜索模式，仍可使用看板
3. **飞书同步失败（秋招公司库显示 0 条）**：按以下优先级引导用户（不要硬绑特定 IDE 插件）：
   - **方案 A（通用推荐）**：安装飞书官方 `lark-cli`（`npx @larksuite/cli@latest install`），跨 Agent 通用，无 IDE 依赖。然后 `lark-cli config init --new` 配置飞书应用，`lark-cli auth login --recommend` 完成授权，最后调本服务 `POST /api/sync-external` 触发同步
   - **方案 B（用 Agent 自带的飞书集成）**：若 Agent 已有等价的飞书插件/技能/MCP（如 Trae 的 `trae-remote-official:lark`、WorkBuddy 的 `lark-unified`、OpenClaw 的 lark MCP 等），直接用即可，目标都是能调飞书 Base API 拉取多维表格记录
   - **方案 C（兜底）**：提示用户手动编辑 `dashboard/external_companies.csv` 添加公司记录，或从飞书原始表格（`https://y00b74dmx5n.feishu.cn/wiki/O6d1wk0UNiJq90kIsQfcRS9An1p`）复制粘贴
   - **重要**：不要把方案 A 和方案 B 对立——lark-cli 是飞书官方开源的命令行工具（`https://github.com/larksuite/cli`），不是 Trae 专属；任何 Agent 环境都能用 npm 装。Agent 应根据自身环境选最简路径，不要因"没有某插件"就放弃同步
4. **GitHub 推送需要授权**：调用 RequestAuthorization 工具或引导用户 `gh auth login`
5. **任何授权失败**：明确告诉用户需要授权什么、为什么要授权、授权后能做什么，不要静默跳过

## 行为红线

- 不代替用户实际投递、发送、发布或 git push
- 不修改 templates/ 下的模板文件
- 不删除用户的数据文件
- 遇到反爬立即停止，不尝试绕过
- 不硬编码特定用户的求职画像，所有目标由 config/user_profile.json 驱动
- 不伪造岗位或岗位链接，所有数据必须来自官方渠道
