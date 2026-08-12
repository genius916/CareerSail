/**
 * CareerSail 冒烟测试 — 验证核心功能是否正常
 * 运行: node test/smoke-test.js
 *
 * 测试覆盖：
 *   1. 核心文件存在（含 templates/config/user_profile.json 模板）
 *   2. .gitignore 保护
 *   3. package.json 零依赖
 *   4. server.js 代码质量（含 cohort / 实习过滤 / 发现端点）
 *   5. dashboard.html XSS 防护
 *   6. lib/job_filters.js 单元测试（届别 / 实习 / 新鲜度 / 匹配度）
 *   7. lib/company_discovery.js 单元测试（四维度发现，跨专业通用性）
 *   8. lib/recruiters 适配器单元测试（v3.4 新增：beisen/feishu/moka/aggregate/generic + URL 自动路由）
 *   9. HTTP API（含 /api/discover-plan、/api/supported-companies、实习过滤、届别筛选）
 *   10. v3.12 新增：displayIndex 序号从 1 开始、start.bat 一键启动、SKILL.md 并行安装流程
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.TEST_PORT || 8431;
const SERVER_PATH = path.join(__dirname, '..', 'dashboard', 'server.js');
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

async function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  console.log('');
  console.log('  ⛵ CareerSail 冒烟测试');
  console.log('  ───────────────────────────');
  console.log('');

  // 1. 检查核心文件存在
  console.log('  [1/9] 检查核心文件...');
  assert(fs.existsSync(SERVER_PATH), 'server.js 存在');
  assert(fs.existsSync(path.join(__dirname, '..', 'dashboard', 'dashboard.html')), 'dashboard.html 存在');
  assert(fs.existsSync(path.join(__dirname, '..', 'templates', 'dashboard', 'job_pool.csv')), 'job_pool.csv 模板存在');
  assert(fs.existsSync(path.join(__dirname, '..', 'templates', 'dashboard', 'follow_up.csv')), 'follow_up.csv 模板存在');
  assert(fs.existsSync(path.join(__dirname, '..', 'templates', 'config', 'user_profile.json')), 'user_profile.json 模板存在（修复：原先缺失）');
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'job_filters.js')), 'lib/job_filters.js 存在（届别/实习过滤核心）');
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'company_discovery.js')), 'lib/company_discovery.js 存在（四维度公司发现）');
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'search_jobs.js')), 'lib/search_jobs.js 存在');
  // v3.4 适配器文件
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'recruiters', 'beisen.js')), 'lib/recruiters/beisen.js 存在（北森适配器）');
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'recruiters', 'feishu.js')), 'lib/recruiters/feishu.js 存在（飞书适配器 v3.4）');
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'recruiters', 'moka.js')), 'lib/recruiters/moka.js 存在（Moka 适配器 v3.4）');
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'recruiters', 'aggregate.js')), 'lib/recruiters/aggregate.js 存在（聚合源适配器 v3.4）');
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'recruiters', 'generic.js')), 'lib/recruiters/generic.js 存在（通用兜底适配器 v3.4）');
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'recruiters', 'index.js')), 'lib/recruiters/index.js 存在（适配器入口）');
  // v3.5 外部公司库文件
  assert(fs.existsSync(path.join(__dirname, '..', 'lib', 'feishu_source.js')), 'lib/feishu_source.js 存在（飞书 Base 同步 v3.5）');
  assert(fs.existsSync(path.join(__dirname, '..', 'templates', 'config', 'external_source.json')), 'templates/config/external_source.json 模板存在（v3.5）');
  assert(fs.existsSync(path.join(__dirname, '..', 'templates', 'dashboard', 'external_companies.csv')), 'templates/dashboard/external_companies.csv 模板存在（v3.5）');
  assert(!fs.existsSync(path.join(__dirname, '..', 'scraper.js')), 'scraper.js 已删除');
  assert(!fs.existsSync(path.join(__dirname, '..', 'templates', 'dashboard', 'application_log.csv')), 'application_log.csv 死文件已清理');

  // 校验模板内容：user_profile.json 模板必须包含 job_type 字段且默认 full-time
  const profileTpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'config', 'user_profile.json'), 'utf-8'));
  assert(profileTpl.job_type === 'full-time', 'user_profile 模板默认 job_type=full-time（排除实习）');
  assert(profileTpl.graduation_year === '', 'user_profile 模板 graduation_year 默认空（不硬编码届别）');
  assert(Array.isArray(profileTpl.search_targets) && profileTpl.search_targets.length === 0, 'user_profile 模板 search_targets 默认空（不硬编码公司）');

  // job_pool.csv 模板必须同时含 cohort_match_status 与 match_degree 两列
  const csvTpl = fs.readFileSync(path.join(__dirname, '..', 'templates', 'dashboard', 'job_pool.csv'), 'utf-8');
  assert(csvTpl.includes('cohort_match_status'), 'job_pool.csv 模板含 cohort_match_status 列（届别状态）');
  assert(csvTpl.includes('match_degree'), 'job_pool.csv 模板含 match_degree 列（匹配度，与届别分离）');

  // 2. 检查 .gitignore
  console.log('  [2/9] 检查 .gitignore...');
  const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf-8');
  assert(gitignore.includes('dashboard/job_pool.csv'), '.gitignore 保护 job_pool.csv');
  assert(gitignore.includes('config/'), '.gitignore 保护 config/ 目录');
  assert(!gitignore.includes('application_log.csv'), '.gitignore 已移除 application_log.csv 引用');

  // 3. 检查 package.json 无 Playwright 依赖
  console.log('  [3/9] 检查 package.json...');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  assert(!pkg.dependencies || !pkg.dependencies.playwright, 'package.json 无 Playwright 依赖');
  assert(Object.keys(pkg.dependencies || {}).length === 0, 'package.json 零依赖');

  // 4. 检查 server.js 代码质量
  console.log('  [4/9] 检查 server.js 代码...');
  const serverCode = fs.readFileSync(SERVER_PATH, 'utf-8');
  assert(serverCode.includes('initDataFiles'), 'server.js 包含数据初始化逻辑');
  assert(serverCode.includes('getLocalDate'), 'server.js 使用本地日期函数');
  assert(serverCode.includes('computeMatchStatus'), 'server.js 包含匹配度计算');
  assert(serverCode.includes('computeCohortStatus'), 'server.js 包含届别状态计算（与匹配度分离）');
  assert(serverCode.includes('MAX_BODY_SIZE'), 'server.js 包含请求体大小限制');
  assert(serverCode.includes('EADDRINUSE'), 'server.js 包含端口冲突处理');
  assert(!serverCode.includes('require(\'child_process\')'), 'server.js 不再使用 child_process');
  const codeLines = serverCode.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
  assert(!codeLines.some(l => /\bexec\s*\(/.test(l)), 'server.js 不再使用 exec() 函数调用');
  assert(serverCode.includes('inQuotes'), 'CSV 解析器支持引号内换行');
  // 新增：届别动态推导（不再硬编码 2026）—— 排除注释行后检查
  const nonCommentLines = serverCode.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  assert(!nonCommentLines.some(l => /校招\s*2026/.test(l)) && !nonCommentLines.some(l => /'2026'/.test(l)), 'server.js 不再硬编码 2026 届（注释除外）');
  assert(serverCode.includes("`${gradYear}届`"), 'server.js 动态推导届别关键词（graduation_year 驱动）');
  // 新增：实习过滤
  assert(serverCode.includes('isInternship'), 'server.js 引入 isInternship 进行实习过滤');
  assert(serverCode.includes('skippedIntern'), 'server.js 批量导入时统计实习排除数');
  assert(serverCode.includes('allowInternship'), 'server.js 根据 job_type 决定是否收实习');
  // 新增：发现计划 / 已适配公司端点
  assert(serverCode.includes('/api/discover-plan'), 'server.js 提供 /api/discover-plan 端点（公司发现计划）');
  assert(serverCode.includes('/api/supported-companies'), 'server.js 提供 /api/supported-companies 端点（动态公司列表）');
  assert(serverCode.includes('generateDiscoveryPlan'), 'server.js 调用 generateDiscoveryPlan 生成发现计划');

  // 5. 检查 dashboard.html XSS 防护
  console.log('  [5/9] 检查 dashboard.html XSS 防护...');
  const dashCode = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'dashboard.html'), 'utf-8');
  assert(dashCode.includes('function escapeHtml'), 'dashboard.html 包含 escapeHtml 函数');
  assert(dashCode.includes('function safeUrl'), 'dashboard.html 包含 safeUrl 函数');
  assert(dashCode.includes('getLocalDate'), 'dashboard.html 使用本地日期函数');
  assert(!dashCode.includes('${l.msg ||'), '日志消息已转义');
  // 搜索目标 t.company 在 onclick/HTML 属性中必须经过 escapeHtml 或 data 属性转义，不能裸插值
  assert(!dashCode.match(/onclick="realSearchCompany\('\$\{t\.company\}/), '搜索目标 t.company 在 onclick 中不裸插值（已改为 data 属性）');
  // 新增：前端调用新端点
  assert(dashCode.includes('/api/discover-plan'), 'dashboard.html 调用 /api/discover-plan');
  assert(dashCode.includes('/api/supported-companies'), 'dashboard.html 调用 /api/supported-companies');
  assert(dashCode.includes('showDiscoveryPlan'), 'dashboard.html 提供公司发现计划面板');
  // 新增：match_degree 字段优先于 cohort_match_status
  assert(dashCode.includes('job.match_degree || job.cohort_match_status'), 'dashboard.html 优先读 match_degree，兼容旧 cohort_match_status');

  // 6. lib/job_filters.js 单元测试
  console.log('  [6/9] 单元测试 lib/job_filters.js...');
  const filters = require(path.join(__dirname, '..', 'lib', 'job_filters'));

  // 6.1 detectJobType / isInternship
  assert(filters.detectJobType({ title: '产品经理' }) === '校招', 'detectJobType: 无关键词默认校招');
  assert(filters.detectJobType({ title: '日常实习生' }) === '实习', 'detectJobType: 识别"日常实习生"为实习');
  assert(filters.detectJobType({ title: '暑期实习' }) === '实习', 'detectJobType: 识别"暑期实习"为实习');
  assert(filters.detectJobType({ title: 'Intern Program' }) === '实习', 'detectJobType: 识别英文 intern 为实习');
  assert(filters.detectJobType({ title: '资深产品经理', description: '社招' }) === '社招', 'detectJobType: 识别社招');
  assert(filters.isInternship({ title: '寒假实习' }) === true, 'isInternship: 寒假实习返回 true');
  assert(filters.isInternship({ title: '产品经理' }) === false, 'isInternship: 全职校招返回 false');

  // 6.2 extractCohortYears
  assert(JSON.stringify(filters.extractCohortYears('2027届校招')) === '[2027]', 'extractCohortYears: 识别 2027届');
  assert(JSON.stringify(filters.extractCohortYears('面向2026届和2027届毕业生')) === '[2026,2027]', 'extractCohortYears: 识别多届');
  assert(JSON.stringify(filters.extractCohortYears('27届校招')) === '[2027]', 'extractCohortYears: 识别 27届→2027');
  assert(JSON.stringify(filters.extractCohortYears('产品经理')) === '[]', 'extractCohortYears: 无届别返回空数组');

  // 6.3 verifyCohort
  const cohortYes = filters.verifyCohort({ title: '2027届校园招聘 产品经理' }, '2027');
  assert(cohortYes.status === 'Yes', 'verifyCohort: 2027届岗位 × 2027毕业 → Yes');
  const cohortNo = filters.verifyCohort({ title: '2026届校园招聘 产品经理' }, '2027');
  assert(cohortNo.status === 'No', 'verifyCohort: 2026届岗位 × 2027毕业 → No（不混入26届）');
  const cohortUnverified = filters.verifyCohort({ title: '产品经理' }, '2027');
  assert(cohortUnverified.status === 'Unverified', 'verifyCohort: 无届别标注 → Unverified（不模糊措辞）');
  const cohortMulti = filters.verifyCohort({ title: '面向2026届/2027届毕业生' }, '2027');
  assert(cohortMulti.status === 'Yes', 'verifyCohort: 多届含目标届 → Yes');
  const cohortNoYear = filters.verifyCohort({ title: '产品经理' }, '');
  assert(cohortNoYear.status === 'Unverified', 'verifyCohort: 未配置毕业年份 → Unverified');

  // 6.4 checkFreshness
  const freshJob = { posted_date: new Date().toISOString().split('T')[0] };
  assert(filters.checkFreshness(freshJob).status === 'fresh', 'checkFreshness: 今日发布 → fresh');
  const staleJob = { posted_date: '2024-01-01' };
  assert(filters.checkFreshness(staleJob).status === 'stale', 'checkFreshness: 超过6个月 → stale（提示复核开放状态）');
  const unknownJob = { posted_date: '' };
  assert(filters.checkFreshness(unknownJob).status === 'unknown', 'checkFreshness: 无发布时间 → unknown');

  // 6.5 computeMatchDegree（v3.9: 2-gram 碎片匹配 + v3.8 标题加权）
  // v3.8 阈值：标题命中 >=2 → 高度匹配；标题命中 1 或 ratio >=30% → 中度匹配；有命中 → 可以尝试
  // v3.9 碎片匹配：("结构设计" → ["结构","构设","设计"])，能命中"结构工程师"
  const degree1 = filters.computeMatchDegree({ title: 'AI产品经理', company: '字节跳动' }, ['AI', '产品']);
  assert(degree1 === '高度匹配', 'computeMatchDegree: 标题含2个关键词 → 高度匹配');
  const degree2 = filters.computeMatchDegree({ title: '产品运营', company: '小红书' }, ['AI', '产品', '医疗']);
  assert(degree2 === '中度匹配', 'computeMatchDegree: 标题含1个关键词 → 中度匹配');
  const degree3 = filters.computeMatchDegree({ title: '运营专员', company: '美团' }, ['AI', '产品']);
  assert(degree3 === '', 'computeMatchDegree: 0 命中 → 空（不模糊标注）');
  // v3.8 新增：机械类岗位测试（禾赛科技机械工程师，7个关键词中标题命中1个应至少中度匹配）
  const mechDegree = filters.computeMatchDegree(
    { title: '机械工程师', company: '禾赛科技' },
    ['机械', '结构', '机器人', '自动化', '制造', '硬件', '机电']
  );
  assert(mechDegree === '中度匹配' || mechDegree === '高度匹配', 'computeMatchDegree: 机械工程师标题含"机械" → 至少中度匹配（v3.8修复）');
  // v3.9 新增：2-gram 碎片匹配测试（"结构设计"应命中"结构工程师"）
  const structDegree = filters.computeMatchDegree(
    { title: '结构工程师', company: '三一重工' },
    ['结构设计', '机械', '制造']
  );
  assert(structDegree === '中度匹配' || structDegree === '高度匹配', 'computeMatchDegree: "结构设计"碎片匹配"结构工程师"（v3.9 2-gram）');
  // v3.9 新增：tokenize 单元测试
  const tokens1 = filters.tokenize('结构设计');
  assert(tokens1.includes('结构'), 'tokenize: "结构设计" 含 "结构" 碎片');
  assert(tokens1.includes('设计'), 'tokenize: "结构设计" 含 "设计" 碎片');
  const tokens2 = filters.tokenize('SolidWorks');
  assert(tokens2.includes('solidworks'), 'tokenize: "SolidWorks" 含整词');
  assert(tokens2.includes('soli'), 'tokenize: "SolidWorks" 含4字符前缀（v3.9 2-gram）');

  // 6.6 filterJobs（综合过滤）
  const mixedJobs = [
    { title: '2027届 产品经理', company: 'A' },
    { title: '2026届 产品经理', company: 'B' },
    { title: '暑期实习 产品', company: 'C' },
    { title: '产品经理', company: 'D' }
  ];
  const filteredResult = filters.filterJobs(mixedJobs, { graduationYear: '2027', excludeInternship: true, keywords: ['产品'] });
  assert(filteredResult.passed.length === 2, 'filterJobs: 2027届目标下，4个岗位 → 通过2个（2027届 + 无届别标注），剔除26届和实习');
  assert(filteredResult.filtered.length === 2, 'filterJobs: 被过滤2个（26届 + 实习）');
  assert(filteredResult.passed.some(j => j.company === 'A'), 'filterJobs: 2027届岗位通过');
  assert(filteredResult.passed.some(j => j.company === 'D'), 'filterJobs: 无届别标注岗位通过（标 Unverified）');
  assert(!filteredResult.passed.some(j => j.company === 'B'), 'filterJobs: 2026届岗位被剔除');
  assert(!filteredResult.passed.some(j => j.company === 'C'), 'filterJobs: 实习岗位被剔除');

  // 7. lib/company_discovery.js 单元测试（跨专业通用性验证）
  console.log('  [7/9] 单元测试 lib/company_discovery.js（跨专业通用性）...');
  const discovery = require(path.join(__dirname, '..', 'lib', 'company_discovery'));

  // 7.1 医学 + AI 产品方向（作者本人画像）
  const medicalPlan = discovery.generateDiscoveryPlan({
    major: '计算机科学与技术',
    research_direction: '医疗大模型',
    target_roles: ['AI产品经理', '产品运营'],
    skills: ['Python', 'Prompt工程'],
    keywords: ['AI', '医疗'],
    graduation_year: '2027',
    job_type: 'full-time',
    target_cities: ['北京', '上海']
  });
  assert(medicalPlan.cohort === '2027届', 'discovery: 医学画像 → cohort=2027届');
  assert(medicalPlan.job_type === '全职校招', 'discovery: full-time → 全职校招（排除实习）');
  assert(medicalPlan.include_internship === false, 'discovery: full-type → include_internship=false');
  assert(medicalPlan.layers.core && medicalPlan.layers.core.keywords.length > 0, 'discovery: 医学画像 → 本体行业关键词非空');
  assert(medicalPlan.layers.upstream && medicalPlan.layers.upstream.keywords.length > 0, 'discovery: 医学画像 → 上游关键词非空');
  assert(medicalPlan.layers.downstream && medicalPlan.layers.downstream.keywords.length > 0, 'discovery: 医学画像 → 下游关键词非空');
  assert(medicalPlan.layers.cross && medicalPlan.layers.cross.keywords.length > 0, 'discovery: 医学画像 → 交叉领域关键词非空');
  assert(medicalPlan.search_queries.length > 0, 'discovery: 医学画像 → 生成搜索串');
  assert(medicalPlan.agent_instruction.includes('2027届'), 'discovery: agent_instruction 含届别');
  assert(medicalPlan.agent_instruction.includes('全职校招'), 'discovery: agent_instruction 含全职校招');

  // 7.2 机械 + 机器人方向（验证换专业后方法仍可用，不硬编码）
  const mechPlan = discovery.generateDiscoveryPlan({
    major: '机械工程',
    research_direction: '机器人控制',
    target_roles: ['机械工程师', '机器人算法工程师'],
    skills: ['SolidWorks', 'ROS', 'C++'],
    keywords: ['机器人', '机械'],
    graduation_year: '2027',
    job_type: 'full-time',
    target_cities: ['深圳']
  });
  assert(mechPlan.layers.core.keywords.some(k => /机械|机器人/.test(k)), 'discovery: 机械画像 → 本体含"机械/机器人"关键词');
  assert(mechPlan.layers.upstream.keywords.length > 0, 'discovery: 机械画像 → 上游关键词非空（零件/工具供应商）');
  assert(mechPlan.layers.downstream.keywords.length > 0, 'discovery: 机械画像 → 下游关键词非空（应用场景）');
  assert(mechPlan.layers.cross.keywords.length > 0, 'discovery: 机械画像 → 交叉领域关键词非空');

  // 7.3 计算机 + AI 方向（再换一个专业）
  const csPlan = discovery.generateDiscoveryPlan({
    major: '计算机科学',
    research_direction: '大语言模型',
    target_roles: ['AI算法工程师'],
    skills: ['PyTorch', 'CUDA'],
    keywords: ['AI', 'LLM'],
    graduation_year: '2028',
    job_type: 'internship',
    target_cities: ['北京']
  });
  assert(csPlan.cohort === '2028届', 'discovery: 计算机画像 → cohort=2028届（动态推导）');
  assert(csPlan.job_type === '实习', 'discovery: internship → 实习（用户主动开启）');
  assert(csPlan.include_internship === true, 'discovery: internship → include_internship=true');
  assert(csPlan.layers.core.keywords.some(k => /AI|算法|计算机/.test(k)), 'discovery: 计算机画像 → 本体含 AI/算法 关键词');

  // 7.4 空画像兜底（不应崩溃）
  const emptyPlan = discovery.generateDiscoveryPlan({});
  assert(emptyPlan.cohort === '', 'discovery: 空画像 → cohort 为空（不硬编码）');
  assert(emptyPlan.layers.core && Array.isArray(emptyPlan.layers.core.keywords), 'discovery: 空画像 → 仍返回四层结构');

  // 7.5 实习模式开关注入指令
  assert(emptyPlan.agent_instruction.includes('只收全职校招') === false || emptyPlan.agent_instruction.length > 0, 'discovery: 空画像 → 仍有 agent_instruction');

  // 7.6 v3.9: filterLowQualityQueries 单元测试
  const filtered = discovery.filterLowQualityQueries([
    '机械 2027届校招',                          // ✓ 保留（真实搜索词）
    '减速器供应商 2027届校招',                  // ✓ 保留（含具体产品名）
    '机械工程师+机械工程 2027届校招',           // ✗ 丢掉（含 +，笛卡尔积产物）
    '机械工程+机械工程师 2027届校招',           // ✗ 丢掉（含 +）
    '机械工程行业 2027届校招',                  // ✗ 丢掉（含泛词"行业"）
    '机械工程场景 2027届校招',                  // ✗ 丢掉（含泛词"场景"）
    '机械工程应用 2027届校招',                  // ✗ 丢掉（含泛词"应用"）
    '机械工程科技 2027届校招',                  // ✗ 丢掉（含泛词"科技"）
    '机械工程解决方案 2027届校招',              // ✗ 丢掉（含泛词"解决方案"）
    '机械工程 2027届校招'                       // ✓ 保留（真实搜索词）
  ]);
  assert(filtered.length === 3, `filterLowQualityQueries: 10条→3条（v3.9 过滤笛卡尔积+泛词），实际=${filtered.length}`);
  assert(!filtered.some(q => q.includes('+')), 'filterLowQualityQueries: 过滤后不含"+"拼接词');
  assert(!filtered.some(q => q.includes('行业') || q.includes('场景') || q.includes('应用') || q.includes('科技') || q.includes('解决方案')), 'filterLowQualityQueries: 过滤后不含泛词后缀');

  // 7.7 v3.9: 机械画像的 search_queries 不应含笛卡尔积和泛词
  const mechQueries = mechPlan.search_queries.map(q => q.query);
  assert(!mechQueries.some(q => q.includes('+')), 'discovery: 机械画像 search_queries 不含"+"拼接词（v3.9 过滤）');
  assert(!mechQueries.some(q => q.includes('行业') || q.includes('场景') || q.includes('应用') || q.includes('科技') || q.includes('解决方案')), 'discovery: 机械画像 search_queries 不含泛词后缀（v3.9 过滤）');

  // 8. lib/recruiters 适配器单元测试（v3.4 新增）
  console.log('  [8/9] 单元测试 lib/recruiters 适配器（v3.4 通用化）...');
  const recruiters = require(path.join(__dirname, '..', 'lib', 'recruiters'));
  const BeisenRecruiter = recruiters.BeisenRecruiter;
  const FeishuRecruiter = recruiters.FeishuRecruiter;
  const MokaRecruiter = recruiters.MokaRecruiter;
  const AggregateRecruiter = recruiters.AggregateRecruiter;
  const GenericRecruiter = recruiters.GenericRecruiter;

  // 8.1 createRecruiter 按系统类型路由
  assert(recruiters.createRecruiter('beisen', { companyDomain: 'iflytek.zhiye.com', companyName: '科大讯飞' }) instanceof BeisenRecruiter, 'createRecruiter: type=beisen → BeisenRecruiter');
  assert(recruiters.createRecruiter('feishu', { companyDomain: 'jobs.bytedance.com', companyName: '字节跳动' }) instanceof FeishuRecruiter, 'createRecruiter: type=feishu → FeishuRecruiter');
  assert(recruiters.createRecruiter('moka', { companyDomain: 'app.mokahr.com', companyName: '搜狐畅游' }) instanceof MokaRecruiter, 'createRecruiter: type=moka → MokaRecruiter');
  assert(recruiters.createRecruiter('aggregate', {}) instanceof AggregateRecruiter, 'createRecruiter: type=aggregate → AggregateRecruiter');
  assert(recruiters.createRecruiter('generic', { companyName: '未知公司', campusUrl: 'https://example.com' }) instanceof GenericRecruiter, 'createRecruiter: type=generic → GenericRecruiter');
  // 未知类型应兜底为 GenericRecruiter
  assert(recruiters.createRecruiter('unknown-type', {}) instanceof GenericRecruiter, 'createRecruiter: 未知类型 → GenericRecruiter 兜底');

  // 8.2 createRecruiterByCompany 按公司名路由
  const iflytekRecruiter = recruiters.createRecruiterByCompany('科大讯飞');
  assert(iflytekRecruiter instanceof BeisenRecruiter, 'createRecruiterByCompany: 科大讯飞 → BeisenRecruiter');
  assert(iflytekRecruiter.companyDomain === 'iflytek.zhiye.com', 'BeisenRecruiter.companyDomain 正确');
  assert(recruiters.createRecruiterByCompany('字节跳动') instanceof FeishuRecruiter, 'createRecruiterByCompany: 字节跳动 → FeishuRecruiter');
  assert(recruiters.createRecruiterByCompany('搜狐畅游') instanceof MokaRecruiter, 'createRecruiterByCompany: 搜狐畅游 → MokaRecruiter');
  assert(recruiters.createRecruiterByCompany('京东') instanceof GenericRecruiter, 'createRecruiterByCompany: 京东（自研系统暂归 generic）→ GenericRecruiter');
  assert(recruiters.createRecruiterByCompany('完全未注册的公司XYZ') === null, 'createRecruiterByCompany: 未注册公司返回 null');

  // 8.3 detectRecruiterType URL 模式识别
  assert(recruiters.detectRecruiterType('https://iflytek.zhiye.com/campus') === 'beisen', 'detectRecruiterType: *.zhiye.com → beisen');
  assert(recruiters.detectRecruiterType('https://jobs.bytedance.com/campus') === 'feishu', 'detectRecruiterType: jobs.bytedance.com → feishu');
  assert(recruiters.detectRecruiterType('https://agirobot.jobs.feishu.cn/') === 'feishu', 'detectRecruiterType: *.jobs.feishu.cn → feishu');
  assert(recruiters.detectRecruiterType('https://app.mokahr.com/campus_apply/cyou-inc') === 'moka', 'detectRecruiterType: *.mokahr.com → moka');
  assert(recruiters.detectRecruiterType('https://www.nowcoder.com/school/schedule') === 'aggregate', 'detectRecruiterType: nowcoder.com → aggregate');
  assert(recruiters.detectRecruiterType('https://campus.jd.com/') === 'unknown', 'detectRecruiterType: 京东自研 → unknown');

  // 8.4 createRecruiterByUrl 未知公司按 URL 自动路由（v3.4 核心特性）
  const unknownBeisen = recruiters.createRecruiterByUrl('https://newcompany.zhiye.com/campus', '新公司');
  assert(unknownBeisen instanceof BeisenRecruiter, 'createRecruiterByUrl: 未知北森公司 → BeisenRecruiter 自动路由');
  assert(unknownBeisen.companyDomain === 'newcompany.zhiye.com', 'createRecruiterByUrl: 提取 companyDomain 正确');

  const unknownFeishu = recruiters.createRecruiterByUrl('https://newcompany.jobs.feishu.cn/?token=abc123', '新飞书公司');
  assert(unknownFeishu instanceof FeishuRecruiter, 'createRecruiterByUrl: 未知飞书公司 → FeishuRecruiter 自动路由');
  assert(unknownFeishu.token === 'abc123', 'createRecruiterByUrl: 提取 token 正确');

  const unknownMoka = recruiters.createRecruiterByUrl('https://app.mokahr.com/campus_apply/newco/positions', '新Moka公司');
  assert(unknownMoka instanceof MokaRecruiter, 'createRecruiterByUrl: 未知 Moka 公司 → MokaRecruiter 自动路由');
  assert(unknownMoka.companySlug === 'newco', 'createRecruiterByUrl: 提取 companySlug 正确');

  const unknownGeneric = recruiters.createRecruiterByUrl('https://campus.unknown.com/', '完全未知公司');
  assert(unknownGeneric instanceof GenericRecruiter, 'createRecruiterByUrl: 完全未知系统 → GenericRecruiter 兜底');

  // 8.5 GenericRecruiter 行为：不调用 API，返回占位记录 + Agent 操作指令（v3.9 强化）
  const genericResult = await unknownGeneric.fetchJobs({ keyword: '产品', graduationYear: '2027' });
  assert(Array.isArray(genericResult) && genericResult.length === 1, 'GenericRecruiter.fetchJobs: 返回 1 条占位记录');
  assert(genericResult[0].source.includes('待Agent'), 'GenericRecruiter: source 含"待Agent"引导（v3.9 强化）');
  assert(genericResult[0].url === 'https://campus.unknown.com/', 'GenericRecruiter: url 即 campusUrl');
  assert(genericResult[0].note.includes('browser') || genericResult[0].note.includes('Agent 必读'), 'GenericRecruiter: note 含浏览器操作指令（v3.9 强化）');
  assert(genericResult[0].agent_action !== undefined, 'GenericRecruiter: 含 agent_action 字段（v3.9 结构化指令）');

  // 8.6 AggregateRecruiter 行为：返回各聚合源搜索 URL
  const aggRecruiter = new AggregateRecruiter({});
  const aggResult = await aggRecruiter.fetchJobs({ keyword: '产品', graduationYear: '2027', city: '北京' });
  assert(Array.isArray(aggResult) && aggResult.length > 0, 'AggregateRecruiter: 返回非空聚合源列表');
  assert(aggResult.some(j => j.source.includes('牛客')), 'AggregateRecruiter: 含牛客源');
  assert(aggResult.some(j => j.url.includes('nowcoder.com') || j.url.includes('haitou') || j.url.includes('yingjiesheng')), 'AggregateRecruiter: URL 含聚合源域名');
  assert(aggResult.every(j => j.note.includes('公司发现层专用')), 'AggregateRecruiter: 每条 note 标"公司发现层专用"');

  // 8.7 BeisenRecruiter：Category 动态化（不硬编码 ['2']）
  const beisenCode = fs.readFileSync(path.join(__dirname, '..', 'lib', 'recruiters', 'beisen.js'), 'utf-8');
  assert(beisenCode.includes('resolveCampusCategoryIds'), 'BeisenRecruiter: 含 resolveCampusCategoryIds 方法');
  assert(beisenCode.includes('GetJobAdSearchConditions'), 'BeisenRecruiter: 调用 GetJobAdSearchConditions 动态获取分类');
  assert(beisenCode.includes('_filterByCohort'), 'BeisenRecruiter: 含 _filterByCohort 二次届别过滤');
  const beisen = new BeisenRecruiter({ companyDomain: 'iflytek.zhiye.com', companyName: '科大讯飞' });
  // 默认 categoryIds 缓存为空
  assert(beisen._categoriesCache === null, 'BeisenRecruiter: 初始 _categoriesCache 为 null');
  // forceCategoryIds 可强制覆盖
  const forced = await beisen.resolveCampusCategoryIds(['99']);
  assert(forced[0] === '99', 'BeisenRecruiter: forceCategoryIds 强制覆盖');

  // 8.8 FeishuRecruiter：无 token 时降级为 Agent 验证
  const feishu = new FeishuRecruiter({ companyDomain: 'test.jobs.feishu.cn', companyName: '测试飞书公司' });
  // 由于无网络或 API 失败，应降级返回 1 条 Agent 验证记录
  const feishuResult = await feishu.fetchJobs({ keyword: '产品', graduationYear: '2027' });
  assert(Array.isArray(feishuResult), 'FeishuRecruiter: 返回数组');
  // 测试环境无网络，应该走降级分支
  if (feishuResult.length === 1 && feishuResult[0].note && feishuResult[0].note.includes('token')) {
    assert(true, 'FeishuRecruiter: API 失败时降级为 Agent 验证模式（含 token 引导）');
  } else {
    assert(feishuResult.length > 0, 'FeishuRecruiter: 至少返回非空结果');
  }

  // 8.9 listSupportedCompanies / listSupportedTypes
  const supportedCompanies = recruiters.listSupportedCompanies();
  assert(Array.isArray(supportedCompanies) && supportedCompanies.length >= 20, 'listSupportedCompanies: 返回 ≥20 家公司（含 generic 兜底注册）');
  assert(supportedCompanies.some(c => c.company === '科大讯飞' && c.type === 'beisen'), 'listSupportedCompanies: 含科大讯飞(beisen)');
  assert(supportedCompanies.some(c => c.company === '字节跳动' && c.type === 'feishu'), 'listSupportedCompanies: 含字节跳动(feishu)');
  assert(supportedCompanies.some(c => c.company === '搜狐畅游' && c.type === 'moka'), 'listSupportedCompanies: 含搜狐畅游(moka)');

  const supportedTypes = recruiters.listSupportedTypes();
  assert(supportedTypes.length === 5, 'listSupportedTypes: 返回 5 种系统类型');
  assert(supportedTypes.some(t => t.type === 'beisen'), 'listSupportedTypes: 含 beisen');
  assert(supportedTypes.some(t => t.type === 'feishu'), 'listSupportedTypes: 含 feishu');
  assert(supportedTypes.some(t => t.type === 'moka'), 'listSupportedTypes: 含 moka');
  assert(supportedTypes.some(t => t.type === 'aggregate'), 'listSupportedTypes: 含 aggregate');
  assert(supportedTypes.some(t => t.type === 'generic'), 'listSupportedTypes: 含 generic');

  // 9. 启动服务器并测试 API
  console.log('  [9/9] 启动服务器测试 API...');
  process.env.PORT = PORT;
  const { spawn } = require('child_process');
  const child = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: String(PORT), SKIP_AUTO_SYNC: '1' },
    stdio: 'pipe'
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    // 8.1 dashboard 页面
    const dash = await httpGet(`http://localhost:${PORT}/dashboard.html`);
    assert(dash.status === 200, 'GET /dashboard.html 返回 200');

    // 8.2 CSV 文件存在（自动 seed 成功）
    const csv = await httpGet(`http://localhost:${PORT}/job_pool.csv`);
    assert(csv.status === 200, 'GET /job_pool.csv 返回 200（自动 seed 成功）');

    // 8.3 /api/scrape 返回 agent-search 模式
    const targets = await httpPost(`http://localhost:${PORT}/api/scrape`, {});
    assert(targets.status === 200, 'POST /api/scrape 返回 200');
    assert(JSON.parse(targets.data).mode === 'agent-search', 'API 返回 agent-search 模式');

    // v3.9: GET /api/scrape 也能用（不再强制 POST）
    const targetsGet = await httpGet(`http://localhost:${PORT}/api/scrape`);
    assert(targetsGet.status === 200, 'GET /api/scrape 返回 200（v3.9 改 GET 兼容）');
    assert(JSON.parse(targetsGet.data).mode === 'agent-search', 'GET /api/scrape 返回 agent-search 模式');

    // v3.9: POST /api/scrape 不带 body 不再报 Invalid JSON
    const targetsEmptyPost = await httpPost(`http://localhost:${PORT}/api/scrape`, null);
    // httpPost helper 会把 null 序列化为 "null"，但服务端 readJSON 已支持空 body 降级
    // 这里只验证不返回 400 即可
    assert(targetsEmptyPost.status !== 400 || JSON.parse(targetsEmptyPost.data || '{}').mode === 'agent-search', 'POST /api/scrape 空 body 友好降级（v3.9）');

    // 8.4 /api/user-profile（GET）
    const profile = await httpGet(`http://localhost:${PORT}/api/user-profile`);
    assert(profile.status === 200, 'GET /api/user-profile 返回 200');

    // 8.5 /api/supported-companies（新增端点）
    const supported = await httpPost(`http://localhost:${PORT}/api/supported-companies`, {});
    assert(supported.status === 200, 'POST /api/supported-companies 返回 200');
    const supportedData = JSON.parse(supported.data);
    assert(supportedData.success === true, '/api/supported-companies 返回 success=true');
    assert(Array.isArray(supportedData.companies), '/api/supported-companies 返回 companies 数组');
    assert(supportedData.companies.length > 0, '/api/supported-companies 返回非空公司列表（动态来自 COMPANY_RECRUITER_MAP）');
    assert(supportedData.companies.some(c => c.company === '科大讯飞'), '/api/supported-companies 含科大讯飞');

    // v3.9: GET /api/supported-companies 也能用 + 含机械类公司
    const supportedGet = await httpGet(`http://localhost:${PORT}/api/supported-companies`);
    assert(supportedGet.status === 200, 'GET /api/supported-companies 返回 200（v3.9 改 GET 兼容）');
    const supportedGetData = JSON.parse(supportedGet.data);
    assert(supportedGetData.companies.some(c => c.company === '三一重工'), '/api/supported-companies 含三一重工（v3.9 制造业扩充）');
    assert(supportedGetData.companies.some(c => c.company === '海康机器人'), '/api/supported-companies 含海康机器人（v3.9 机器人扩充）');
    assert(supportedGetData.companies.length >= 80, '/api/supported-companies 公司数 >=80（v3.9 多行业扩充）');

    // 8.6 /api/discover-plan（新增端点，核心功能）
    const discover = await httpPost(`http://localhost:${PORT}/api/discover-plan`, {});
    assert(discover.status === 200, 'POST /api/discover-plan 返回 200');
    const discoverData = JSON.parse(discover.data);
    assert(discoverData.success === true, '/api/discover-plan 返回 success=true');
    assert(discoverData.plan && discoverData.plan.layers, '/api/discover-plan 返回 plan.layers');
    assert(discoverData.plan.layers.core && discoverData.plan.layers.upstream && discoverData.plan.layers.downstream && discoverData.plan.layers.cross, '/api/discover-plan 返回四维度（本体/上游/下游/交叉）');
    assert(typeof discoverData.plan.agent_instruction === 'string' && discoverData.plan.agent_instruction.length > 0, '/api/discover-plan 返回 agent_instruction');

    // v3.9: GET /api/discover-plan 也能用
    const discoverGet = await httpGet(`http://localhost:${PORT}/api/discover-plan`);
    assert(discoverGet.status === 200, 'GET /api/discover-plan 返回 200（v3.9 改 GET 兼容）');

    // 8.6.1 /api/external-companies（v3.5 外部公司库）
    const extResp = await httpGet(`http://localhost:${PORT}/api/external-companies`);
    assert(extResp.status === 200, 'GET /api/external-companies 返回 200');
    const extData = JSON.parse(extResp.data);
    assert(extData.success === true, '/api/external-companies 返回 success=true');
    assert(Array.isArray(extData.companies), '/api/external-companies 返回 companies 数组');

    // 8.6.2 server.js 含 external_companies.csv seed 和 external_source.json seed
    assert(serverCode.includes("'external_companies.csv'"), "server.js DATA_FILES 含 external_companies.csv");
    assert(serverCode.includes('external_source.json'), 'server.js 含 external_source.json seed 逻辑');
    assert(serverCode.includes('/api/sync-external'), 'server.js 含 /api/sync-external 端点');
    assert(serverCode.includes('/api/import-external-to-pool'), 'server.js 含 /api/import-external-to-pool 端点');
    assert(serverCode.includes('/api/toggle-mark'), 'server.js 含 /api/toggle-mark 端点（v3.6 收藏/剔除）');
    assert(serverCode.includes('SKIP_AUTO_SYNC'), 'server.js 支持 SKIP_AUTO_SYNC 环境变量（测试用）');

    // 8.6.3 dashboard.html 含秋招公司库功能区
    assert(dashCode.includes('秋招公司库'), 'dashboard.html 含"秋招公司库"tab');
    assert(dashCode.includes('externalSection'), 'dashboard.html 含 externalSection 区域');
    assert(dashCode.includes('syncExternal'), 'dashboard.html 含 syncExternal 函数');
    assert(dashCode.includes('renderExternalTable'), 'dashboard.html 含 renderExternalTable 函数');
    assert(dashCode.includes('importExternalToPool'), 'dashboard.html 含 importExternalToPool 函数');
    assert(dashCode.includes('data-ext-action'), 'dashboard.html 外部公司库按钮用 data-* 防 XSS');

    // 8.6.4 .gitignore 保护 external_companies.csv
    const gitignoreContent = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf-8');
    assert(gitignoreContent.includes('external_companies.csv'), '.gitignore 含 external_companies.csv');

    // 8.6.5 feishu_source.js 模块单元测试
    const feishuSource = require(path.join(__dirname, '..', 'lib', 'feishu_source.js'));
    assert(typeof feishuSource.syncExternalCompanies === 'function', 'feishu_source.syncExternalCompanies 是函数');
    assert(typeof feishuSource.readExternalCompanies === 'function', 'feishu_source.readExternalCompanies 是函数');
    assert(typeof feishuSource.loadConfig === 'function', 'feishu_source.loadConfig 是函数');
    assert(Array.isArray(feishuSource.CSV_HEADERS) && feishuSource.CSV_HEADERS.length === 13, 'feishu_source.CSV_HEADERS 含 13 个字段（含 favorited + excluded）');
    assert(feishuSource.CSV_HEADERS.includes('company_name'), 'CSV_HEADERS 含 company_name');
    assert(feishuSource.CSV_HEADERS.includes('career_url'), 'CSV_HEADERS 含 career_url');
    assert(feishuSource.CSV_HEADERS.includes('favorited'), 'CSV_HEADERS 含 favorited（v3.6 收藏字段）');
    assert(feishuSource.CSV_HEADERS.includes('excluded'), 'CSV_HEADERS 含 excluded（v3.6 剔除字段）');
    // 配置模板可正常加载
    const extConfig = feishuSource.loadConfig();
    assert(extConfig !== null, 'feishu_source.loadConfig 返回非 null（模板可 seed）');
    assert(extConfig.base_token && extConfig.table_id, 'external_source.json 含 base_token 和 table_id');
    assert(extConfig.field_map && typeof extConfig.field_map === 'object', 'external_source.json 含 field_map');

    // 8.7 实习过滤：批量导入实习岗位应被排除（user_profile 默认 job_type=full-time）
    // 先确保 user_profile 为全职模式（模板默认即 full-time）
    const internTestId = Date.now();
    const internImport = await httpPost(`http://localhost:${PORT}/api/import-batch`, {
      jobs: [
        { company: `实习测试公司_${internTestId}`, job_title: '日常实习生 产品', location: '北京' },
        { company: `全职测试公司_${internTestId}`, job_title: '产品经理', location: '北京' }
      ]
    });
    assert(internImport.status === 200, 'POST /api/import-batch 返回 200');
    const internData = JSON.parse(internImport.data);
    assert(internData.imported === 1, '实习岗位被自动排除，仅导入1个全职岗位');
    assert(internData.skippedIntern === 1, 'skippedIntern=1（统计实习排除数）');

    // 8.8 普通批量导入去重
    const dupImport = await httpPost(`http://localhost:${PORT}/api/import-batch`, {
      jobs: [
        { company: `全职测试公司_${internTestId}`, job_title: '产品经理', location: '北京' }
      ]
    });
    const dupData = JSON.parse(dupImport.data);
    assert(dupData.imported === 0 && dupData.skipped === 1, '重复岗位被跳过（去重生效）');

    // 8.9 届别状态写入：导入无届别标注岗位，cohort_match_status 应为 Unverified
    const cohortTestId = Date.now();
    const cohortImport = await httpPost(`http://localhost:${PORT}/api/import-batch`, {
      jobs: [
        { company: `届别测试公司_${cohortTestId}`, job_title: '产品经理', location: '北京' }
      ]
    });
    assert(cohortImport.status === 200, '届别测试导入返回 200');

    // 读取 CSV 验证 cohort_match_status 字段
    const csvAfter = await httpGet(`http://localhost:${PORT}/job_pool.csv`);
    assert(csvAfter.status === 200, 'GET /job_pool.csv 返回 200');
    assert(csvAfter.data.includes('届别测试公司_' + cohortTestId), 'CSV 含届别测试公司记录');
    assert(csvAfter.data.includes('Unverified') || csvAfter.data.includes('待官网复核'), 'CSV 含届别状态标注（Unverified / 待官网复核）');

    // 8.10 路径遍历防护
    const traversal = await httpGet(`http://localhost:${PORT}/../../etc/passwd`);
    assert(traversal.status === 403 || traversal.status === 404, '路径遍历被阻止');

    // 8.11 toggle-mark API（v3.6 收藏/剔除功能）
    const toggleResp = await httpPost(`http://localhost:${PORT}/api/toggle-mark`, {
      source: 'job_pool',
      recordId: '1',
      field: 'favorited',
      value: true
    });
    assert(toggleResp.status === 200, 'POST /api/toggle-mark 返回 200');
    const toggleData = JSON.parse(toggleResp.data);
    assert(toggleData.success === true, 'toggle-mark 返回 success=true');
    assert(toggleData.value === '1', 'toggle-mark favorited=true 后 value=1');

    // 取消收藏
    const toggleOffResp = await httpPost(`http://localhost:${PORT}/api/toggle-mark`, {
      source: 'job_pool',
      recordId: '1',
      field: 'favorited',
      value: false
    });
    assert(toggleOffResp.status === 200, 'POST /api/toggle-mark (off) 返回 200');
    assert(JSON.parse(toggleOffResp.data).value === '', 'toggle-mark favorited=false 后 value 为空');

    // v3.11: 验证 searchQuery 不含城市（城市仅作优先级参考，不限制搜索范围）
    const scrapeResp = await httpGet(`http://localhost:${PORT}/api/scrape`);
    const scrapeData = JSON.parse(scrapeResp.data);
    if (scrapeData.targets && scrapeData.targets.length > 0) {
      const t = scrapeData.targets[0];
      // searchQuery 字段不应包含具体城市名（如"北京"/"上海"/"合肥"）
      // 注意：只检查 searchQuery 字段，userCities 是单独字段可以含城市
      if (t.searchQuery) {
        assert(!t.searchQuery.includes('北京') && !t.searchQuery.includes('上海') && !t.searchQuery.includes('合肥'), 'searchQuery 不含城市名（v3.11 城市仅作优先级参考）');
      }
    }

    // v3.11: 验证 dashboard.html 含多专业岗位候选 + 简历上传提示 + 城市说明
    assert(dashCode.includes('机械工程师') && dashCode.includes('结构工程师'), 'dashboard.html 设置向导含机械类岗位候选（v3.11 多专业）');
    assert(dashCode.includes('临床研发') && dashCode.includes('医学事务'), 'dashboard.html 设置向导含医学类岗位候选（v3.11 多专业）');
    assert(dashCode.includes('投资分析师') && dashCode.includes('行业研究员'), 'dashboard.html 设置向导含金融类岗位候选（v3.11 多专业）');
    assert(dashCode.includes('上传现成简历') || dashCode.includes('简历'), 'dashboard.html 设置向导含简历上传提示（v3.11）');
    assert(dashCode.includes('不限制岗位搜索范围') || dashCode.includes('不限制搜索范围'), 'dashboard.html 设置向导含"城市不限制搜索范围"说明（v3.11）');

    // v3.11: 验证 SKILL.md 含强制 lark-cli 主动安装流程
    const skillCode = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf-8');
    assert(skillCode.includes('立即主动安装 lark-cli'), 'SKILL.md 含"立即主动安装 lark-cli"强制流程（v3.11）');
    assert(skillCode.includes('npx @larksuite/cli@latest install'), 'SKILL.md 含 lark-cli 官方安装命令（v3.11）');
    assert(skillCode.includes('不要') && skillCode.includes('target_cities') && skillCode.includes('搜索关键词'), 'SKILL.md 含"城市不写进搜索关键词"规则（v3.11）');
    assert(skillCode.includes('机械工程师') && skillCode.includes('临床医学'), 'SKILL.md 询问话术含多专业候选（v3.11）');

    // 10. v3.12 新增测试：displayIndex、start.bat、SKILL.md 并行安装
    console.log('  [10/10] v3.12 新增测试...');

    // 10.1 displayIndex — server.js parseCSV 含 displayCounter
    assert(serverCode.includes('displayCounter'), 'server.js parseCSV 含 displayCounter 变量（v3.12）');
    assert(serverCode.includes('displayIndex'), 'server.js parseCSV 含 displayIndex 字段（v3.12）');
    assert(serverCode.includes('++displayCounter'), 'server.js displayCounter 从 1 递增（v3.12）');

    // 10.2 displayIndex — dashboard.html 前端解析含 displayCounter
    assert(dashCode.includes('displayCounter'), 'dashboard.html 前端 CSV 解析含 displayCounter（v3.12）');
    assert(dashCode.includes('displayIndex'), 'dashboard.html 前端 CSV 解析含 displayIndex 字段（v3.12）');
    assert(dashCode.includes('idx + 1'), 'dashboard.html 使用当前视图序号 idx+1（v3.12.1 按tab重新编号）');

    // 10.3 start.bat 一键启动脚本
    const startBat = path.join(__dirname, '..', 'start.bat');
    assert(fs.existsSync(startBat), 'start.bat 一键启动脚本存在（v3.12）');
    const batContent = fs.readFileSync(startBat, 'utf-8');
    assert(batContent.includes('node dashboard\\server.js'), 'start.bat 含启动命令（v3.12）');
    assert(batContent.includes('where node'), 'start.bat 含 Node.js 检测（v3.12）');
    assert(batContent.includes('CareerSail'), 'start.bat 含 CareerSail 品牌标识（v3.12）');

    // 10.4 SKILL.md 并行安装流程（lark-cli + 用户画像并行）
    assert(skillCode.includes('并行'), 'SKILL.md 含"并行"安装流程（v3.12）');
    assert(skillCode.includes('A 路') || skillCode.includes('A路'), 'SKILL.md 含 A 路 lark-cli 安装指引（v3.12）');
    assert(skillCode.includes('B 路') || skillCode.includes('B路'), 'SKILL.md 含 B 路用户画像询问（v3.12）');

    // 10.5 README.md 含 start.bat 使用说明
    const readmeContent = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf-8');
    assert(readmeContent.includes('start.bat'), 'README.md 含 start.bat 使用说明（v3.12）');

    // 10.6 server.js 版本号更新
    assert(serverCode.includes('v3.12'), 'server.js 含 v3.12 版本注释（v3.12）');

  } catch (e) {
    console.error('  API 测试出错:', e.message);
    failed++;
  } finally {
    child.kill();
  }

  // 结果
  console.log('');
  console.log('  ───────────────────────────');
  console.log(`  ✓ 通过: ${passed}  ✗ 失败: ${failed}`);
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('测试运行失败:', e);
  process.exit(1);
});
