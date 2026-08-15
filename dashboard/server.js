/**
 * CareerSail · 职航 — 求职看板服务端
 * 零依赖 Node.js HTTP 服务器
 * 启动: node server.js
 * 默认端口: 8430
 *
 * v2.0 — 修复清单:
 *   P0-1: 启动时自动从 templates/ seed 数据文件，外人克隆不再 404
 *   P0-3: 去除硬编码作者求职画像，改为用户配置驱动 (config/user_profile.json)
 *   P1-4: 真正实现匹配度计算（基于用户关键词×岗位）
 *   P1-6: CSV 解析支持引号内换行（state-machine parser）
 *   P1-7: 时区修复——用本地日期替代 toISOString().split('T')[0]
 *   P2-9: readJSON 添加请求体大小上限 (1MB)
 *   P2-10: 移除 exec() 调用，不再启动外部爬虫
 *   P2-11: 端口冲突 EADDRINUSE 友好报错
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { verifyCohort, isInternship, computeMatchDegree, checkFreshness } = require(path.join(__dirname, '..', 'lib', 'job_filters'));
const { generateDiscoveryPlan, generateProgressivePlan } = require(path.join(__dirname, '..', 'lib', 'company_discovery'));
const { COMPANY_RECRUITER_MAP } = require(path.join(__dirname, '..', 'lib', 'recruiters'));
const { isUnsuitableRole, isRealJob } = require(path.join(__dirname, '..', 'lib', 'job_filters'));

// v4.4: 已搜索公司记录 —— 「刷新发现新公司」时避免重复搜索已搜过的公司
function readSearchedCompanies() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, 'searched_companies.json'), 'utf-8'));
  } catch (e) { return {}; }
}
function markCompanySearched(company) {
  if (!company) return;
  try {
    const data = readSearchedCompanies();
    data[String(company).trim()] = new Date().toISOString();
    fs.writeFileSync(path.join(DASHBOARD_DIR, 'searched_companies.json'), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) { /* 记录失败不影响主流程 */ }
}
const { parseCSV, escapeCSV, rowsToCSV, getLocalDate } = require(path.join(__dirname, '..', 'lib', 'csv_utils'));

const PORT = process.env.PORT || 8430;
const MAX_BODY_SIZE = 1024 * 1024; // 1MB 请求体上限
const DASHBOARD_DIR = __dirname;
const PROJECT_ROOT = path.join(DASHBOARD_DIR, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates', 'dashboard');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'user_profile.json');
const CONFIG_TEMPLATE = path.join(PROJECT_ROOT, 'templates', 'config', 'user_profile.json');

// 需要自动 seed 的数据文件列表
const DATA_FILES = ['job_pool.csv', 'follow_up.csv', 'activity_log.jsonl', 'external_companies.csv'];

// ========== P1-7: 本地日期（v4.0: 统一使用 csv_utils.js 的 getLocalDate） ==========

// ========== P0-1: 启动时自动初始化数据文件 ==========
function initDataFiles() {
  // 1. Seed CSV/JSONL 数据文件
  for (const filename of DATA_FILES) {
    const target = path.join(DASHBOARD_DIR, filename);
    if (!fs.existsSync(target)) {
      const template = path.join(TEMPLATES_DIR, filename);
      if (fs.existsSync(template)) {
        fs.copyFileSync(template, target);
        console.log(`  ✓ 初始化数据文件: ${filename}`);
      } else if (filename.endsWith('.jsonl')) {
        // JSONL 文件没有模板，创建空文件
        fs.writeFileSync(target, '', 'utf-8');
        console.log(`  ✓ 初始化数据文件: ${filename} (空)`);
      }
    }
  }

  // 2. Seed 用户配置文件
  if (!fs.existsSync(CONFIG_FILE)) {
    if (fs.existsSync(CONFIG_TEMPLATE)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.copyFileSync(CONFIG_TEMPLATE, CONFIG_FILE);
      console.log('  ✓ 初始化用户配置: config/user_profile.json');
    }
  }

  // 3. Seed 外部数据源配置（飞书 Base 同步）
  const EXT_SOURCE_FILE = path.join(CONFIG_DIR, 'external_source.json');
  const EXT_SOURCE_TEMPLATE = path.join(PROJECT_ROOT, 'templates', 'config', 'external_source.json');
  if (!fs.existsSync(EXT_SOURCE_FILE)) {
    if (fs.existsSync(EXT_SOURCE_TEMPLATE)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.copyFileSync(EXT_SOURCE_TEMPLATE, EXT_SOURCE_FILE);
      console.log('  ✓ 初始化外部数据源配置: config/external_source.json');
    }
  }
}

// ========== CSV 解析（v4.0: 统一使用 csv_utils.js，消除三处重复代码） ==========
// v4.2: 路径安全 — 使用 safeJoin 防止目录遍历攻击
function readCSV(filename) {
  const filePath = safeJoin(DASHBOARD_DIR, filename);
  if (!filePath) { console.error(`  ⚠ 非法文件路径: ${filename}`); return { headers: [], rows: [] }; }
  if (!fs.existsSync(filePath)) return { headers: [], rows: [] };
  return parseCSV(fs.readFileSync(filePath, 'utf-8'));
}

function writeCSV(filename, headers, rows) {
  const filePath = safeJoin(DASHBOARD_DIR, filename);
  if (!filePath) { console.error(`  ⚠ 非法文件路径: ${filename}`); return; }
  fs.writeFileSync(filePath, rowsToCSV(headers, rows), 'utf-8');
}

// ========== P2-9: readJSON 带请求体大小上限 + v4.1 超时处理 ==========
function readJSON(body) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let resolved = false;

    // v4.1: 30秒超时，防止请求挂起
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        body.destroy();
        reject(new Error('请求超时（30秒）'));
      }
    }, 30000);

    body.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          body.destroy();
          reject(new Error('请求体超过 1MB 上限'));
        }
        return;
      }
      data += chunk;
    });
    body.on('end', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      // v3.9: 空 body 友好降级 — 只读端点允许空 POST，返回 {}
      if (!data || !data.trim()) {
        resolve({});
        return;
      }
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    body.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function sendJSON(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

// P2-8: 路径安全 — 防止目录遍历
function safeJoin(base, target) {
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(path.resolve(base))) return null;
  return resolved;
}

function serveStatic(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not Found');
  }
}

// ========== 用户配置读取 ==========
// v4.0: 添加缓存，避免每次请求读磁盘（被 computeMatchStatus/computeCohortStatus 高频调用）
let _profileCache = null;
let _profileCacheTime = 0;
const PROFILE_CACHE_TTL = 30000; // 30 秒缓存

function loadUserProfile() {
  const now = Date.now();
  if (_profileCache && (now - _profileCacheTime) < PROFILE_CACHE_TTL) {
    return _profileCache;
  }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      _profileCache = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      _profileCacheTime = now;
      return _profileCache;
    }
  } catch (e) {
    console.error('  ⚠ 读取用户配置失败:', e.message);
  }
  _profileCache = null;
  _profileCacheTime = now;
  return null;
}

function saveUserProfile(profile) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(profile, null, 2), 'utf-8');
    // 缓存失效
    _profileCache = null;
    _profileCacheTime = 0;
    return true;
  } catch (e) {
    return false;
  }
}

// ========== P0-3: 用户配置驱动的搜索目标 ==========
// v4.1: 移除硬编码 slice(0,10)，集成渐进式策略
// 新用户画像为空 → 返回默认热门岗位推荐（冷启动）
// 有画像 → 返回渐进式三层计划（精准匹配 → 扩展发现 → 全量兜底）
function getSearchTargets() {
  const { rows } = readCSV('job_pool.csv');
  const existingCompanies = new Set(rows.map(r => (r.company || '').trim()).filter(Boolean));
  const profile = loadUserProfile();

  // 从用户配置读取搜索目标，而非硬编码
  const allTargets = (profile && Array.isArray(profile.search_targets)) ? profile.search_targets : [];

  // 分类：新公司 vs 已覆盖公司
  const newCompanies = allTargets.filter(t => !existingCompanies.has(t.company));
  const existingTargets = allTargets.filter(t => existingCompanies.has(t.company));

  // 动态推导届别关键词
  const gradYear = profile && profile.graduation_year ? String(profile.graduation_year) : '';
  const cohortTag = gradYear ? `${gradYear}届` : '';
  const jobType = profile && profile.job_type === 'internship' ? '实习' : '校招';

  const keywords = (profile && Array.isArray(profile.target_roles)) ? profile.target_roles : [];
  const cities = (profile && Array.isArray(profile.target_cities)) ? profile.target_cities : [];
  const searchQuery = [jobType, cohortTag, ...keywords].filter(Boolean).join(' ');

  // v4.1: 读取外部公司库，生成渐进式计划
  let progressivePlan = null;
  try {
    const extPath = path.join(DASHBOARD_DIR, 'external_companies.csv');
    let externalCompanies = [];
    if (fs.existsSync(extPath)) {
      const extResult = readCSV('external_companies.csv');
      externalCompanies = extResult.rows;
    }
    progressivePlan = generateProgressivePlan(profile || {}, externalCompanies);
  } catch (e) {
    // 渐进式计划生成失败不阻塞，降级为传统模式
  }

  // v4.1: 新用户冷启动 — 画像为空时提供默认推荐（9大专业大类通用岗位）
  // v4.2: 统一判定逻辑 — 与 generateProgressivePlan 的 cold_start 保持一致
  // 画像有效的判定：target_roles 非空 或 keywords 非空 或 major 非空 或 search_targets 非空
  const profileRoles = (profile && Array.isArray(profile.target_roles)) ? profile.target_roles : [];
  const profileKeywords = (profile && Array.isArray(profile.keywords)) ? profile.keywords : [];
  const hasProfile = allTargets.length > 0 || profileRoles.length > 0
    || profileKeywords.length > 0 || !!(profile && profile.major);
  const defaultRoles = !hasProfile ? [
    '产品经理', '产品运营', '数据分析', 'AI产品', '管培生',
    '软件开发', '算法工程师', '测试开发', '前端开发'
  ] : [];

  return {
    cohort: cohortTag,
    job_type: jobType,
    graduation_year: gradYear,
    // v4.1: 不再硬编码 slice(0,10)，返回全部新公司（前端/AI Agent 自行分批）
    newCompanies: newCompanies,
    existingCompanies: existingTargets,
    totalExisting: existingCompanies.size,
    searchQuery,
    userKeywords: keywords,
    userCities: cities,
    configured: hasProfile,
    // v4.1: 渐进式计划（供 AI Agent 分层执行）
    progressive_plan: progressivePlan,
    // v4.1: 冷启动默认推荐
    default_roles: defaultRoles,
    cold_start: !hasProfile,
    // v4.1: 建议批量大小
    suggested_batch_size: hasProfile ? 15 : 5
  };
}

// ========== P1-4: 匹配度计算 ==========
// 语义修正：computeMatchStatus 只算「匹配度」（高度/中度/可以尝试）；
// 届别匹配由 computeCohortStatus 单独计算（Yes/No/Unverified）。
// 历史代码把匹配度塞进 cohort_match_status 字段，新代码用 match_degree 列承载匹配度，
// cohort_match_status 回归为真正的届别匹配状态。
// v4.0: 使用 job_filters.js 的 n-gram tokenizer，匹配更精准
function computeMatchStatus(job) {
  const profile = loadUserProfile();
  if (!profile) return '';
  return computeMatchDegree(job, profile.keywords || []);
}

// 届别匹配状态：基于用户毕业年份 × 岗位文本
function computeCohortStatus(job) {
  const profile = loadUserProfile();
  if (!profile || !profile.graduation_year) return 'Unverified';
  return verifyCohort(job, profile.graduation_year).status;
}

// ========== CSV Operations ==========

function updateStatusInCSV(filename, rowIndex, company, jobTitle, newStatus) {
  const { headers, rows } = readCSV(filename);
  const target = rows.find((r, i) => i + 1 === rowIndex && r.company === company && r.job_title === jobTitle);
  if (!target) return { success: false, error: '岗位未找到或信息不匹配' };

  target.status = newStatus;
  if (newStatus === 'Offer') target.current_stage = 'offer';
  if (newStatus === 'Rejected') target.current_stage = '挂了(被拒)';

  // 重新计算匹配度与届别状态（按列是否存在分别写入）
  const degree = computeMatchStatus(target);
  if (headers.includes('match_degree')) target.match_degree = degree;
  else target.cohort_match_status = degree; // 兼容旧 CSV
  if (headers.includes('cohort_match_status') && headers.includes('match_degree')) {
    target.cohort_match_status = computeCohortStatus(target);
  }

  writeCSV(filename, headers, rows);
  return { success: true };
}

function updateStageInCSV(rowIndex, company, jobTitle, stage) {
  const { headers, rows } = readCSV('job_pool.csv');
  const target = rows.find((r, i) => i + 1 === rowIndex && r.company === company && r.job_title === jobTitle);
  if (!target) return { success: false, error: '岗位未找到或信息不匹配' };

  target.current_stage = stage;

  if (stage === 'offer') target.status = 'Offer';
  else if (stage === '挂了(被拒)') target.status = 'Rejected';

  writeCSV('job_pool.csv', headers, rows);

  // Append to follow_up.csv
  const nextActionMap = {
    '简历筛选': '等待HR筛选结果',
    'AI测评': '完成AI测评',
    '测评': '完成测评',
    '笔试': '完成笔试',
    'AI面试': '准备AI面试',
    '一面': '准备一面',
    '二面': '准备二面',
    '三面': '准备三面',
    'HR面': '准备HR面',
    '终面': '准备终面',
    '谈薪': '准备谈薪',
    '泡池子': '等待结果',
    'offer': '接受Offer',
    '挂了(被拒)': '已结束'
  };

  const today = getLocalDate();
  const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  // v4.2: 动态读取现有 follow_up.csv 表头，而非硬编码，防止字段漂移
  let followHeaders = ['date', 'company', 'job_title', 'contact', 'channel', 'event_type', 'deadline', 'next_action', 'status', 'notes', 'time'];
  let followRows = [];
  const followPath = path.join(DASHBOARD_DIR, 'follow_up.csv');
  if (fs.existsSync(followPath)) {
    const parsed = readCSV('follow_up.csv');
    if (parsed.headers.length > 0) {
      followHeaders = parsed.headers;
      followRows = parsed.rows;
    }
  }

  followRows.push({
    date: today,
    company: company,
    job_title: jobTitle,
    contact: '',
    channel: '',
    event_type: stage,
    deadline: '',
    next_action: nextActionMap[stage] || '',
    status: (stage === 'offer' || stage === '挂了(被拒)') ? 'Completed' : 'Active',
    notes: '',
    time: now
  });

  writeCSV('follow_up.csv', followHeaders.length > 0 ? followHeaders : ['date','company','job_title','contact','channel','event_type','deadline','next_action','status','notes','time'], followRows);

  return { success: true };
}

function importJobToCSV(data) {
  // 编码校验：防止中文被错误编码为 ? 导致数据损坏
  const company = (data.company || '').trim();
  const job_title = (data.job_title || '').trim();
  if (!company || !job_title) return { success: false, error: '公司名称和岗位名称为必填' };
  // 检测编码损坏：公司名或岗位名只有 ? 号（中文被错误编码的特征）
  const corrupted = /^[\?]{1,10}$/;
  if (corrupted.test(company) || corrupted.test(job_title)) {
    return { success: false, error: '编码错误：公司名或岗位名包含乱码，请使用 UTF-8 编码重新发送请求' };
  }
  // 检测公司名和岗位名中是否包含大量连续 ? 号（部分损坏）
  if ((company.match(/\?/g) || []).length > 2 || (job_title.match(/\?/g) || []).length > 3) {
    return { success: false, error: '编码疑似损坏：公司名或岗位名包含过多 ? 字符，请检查编码' };
  }

  const { headers, rows } = readCSV('job_pool.csv');

  // v4.0: 去重检查 — 按 company + job_title 去重
  const dupKey = (company + '|' + job_title).toLowerCase().trim();
  const existingKeys = new Set(rows.map(r => ((r.company || '') + '|' + (r.job_title || '')).toLowerCase().trim()));
  if (existingKeys.has(dupKey)) {
    return { success: false, error: `岗位已存在: ${company} — ${job_title}` };
  }

  // v4.1: 实习过滤（与 importBatchToCSV 保持一致）
  const profile = loadUserProfile();
  const allowInternship = !!(profile && profile.job_type === 'internship');
  const jobForDetect = { title: job_title, category: data.role_family || '', notes: data.notes || '', description: data.description || '', requirement: data.requirement || '' };
  if (!allowInternship && isInternship(jobForDetect)) {
    return { success: false, error: `实习岗位已排除（当前配置只收全职校招）: ${job_title}` };
  }

  // v4.1: URL 质量检查（与 importBatchToCSV 保持一致）
  const urlQuality = checkUrlQuality(data.job_url);
  if (urlQuality.isLowQuality) {
    // 不拒绝导入，但在备注中标注
  }

  // v4.0: 使用 job_filters.js 的高级匹配度计算（n-gram tokenizer），替代基础 substring match
  const keywords = profile ? (profile.keywords || []) : [];
  const matchDegree = computeMatchDegree(
    { title: job_title, category: data.role_family || '', notes: data.notes || '', company },
    keywords
  );
  const cohortStatus = profile && profile.graduation_year
    ? verifyCohort({ title: job_title, category: data.role_family || '', notes: data.notes || '' }, profile.graduation_year).status
    : 'Unverified';

  // v4.1: 新鲜度检查
  const freshness = checkFreshness({ posted_date: data.posted_date || '' });

  // v4.1: 组装备注（与 importBatchToCSV 保持一致）
  const noteParts = [];
  if (data.notes) noteParts.push(data.notes);
  if (cohortStatus === 'Unverified') noteParts.push('届别待官网复核');
  if (urlQuality.isLowQuality) noteParts.push(`⚠️ ${urlQuality.reason}`);
  if (freshness.status === 'stale') noteParts.push(freshness.reason);
  else if (freshness.status === 'unknown') noteParts.push('无发布时间，复核开放状态');

  const newRow = {};
  headers.forEach(h => {
    if (h === 'date_found') newRow[h] = data.date_found || getLocalDate();
    else if (h === 'company') newRow[h] = data.company;
    else if (h === 'job_title') newRow[h] = data.job_title;
    else if (h === 'role_family') newRow[h] = data.role_family || '';
    else if (h === 'level') newRow[h] = data.level || '校招';
    else if (h === 'location') newRow[h] = data.location || '';
    else if (h === 'remote_policy') newRow[h] = '';
    else if (h === 'source') newRow[h] = data.source || '';
    else if (h === 'job_url') newRow[h] = data.job_url || '';
    else if (h === 'posted_date') newRow[h] = data.posted_date || '';
    else if (h === 'priority') newRow[h] = data.priority || 'Medium';
    else if (h === 'status') newRow[h] = data.status || 'Pending';
    else if (h === 'resume_variant') newRow[h] = '';
    else if (h === 'skip_reason') newRow[h] = data.skip_reason || '';
    else if (h === 'blocker') newRow[h] = '';
    else if (h === 'next_action') newRow[h] = '';
    else if (h === 'notes') newRow[h] = noteParts.join(' | ');
    else if (h === 'match_degree') newRow[h] = matchDegree;
    else if (h === 'cohort_match_status') newRow[h] = cohortStatus;
    else if (h === 'current_stage') newRow[h] = '';
    else newRow[h] = '';
  });
  rows.push(newRow);
  writeCSV('job_pool.csv', headers, rows);
  return { success: true };
}

function updateJobInCSV(data) {
  const { headers, rows } = readCSV('job_pool.csv');
  const rowIndex = data.rowIndex;
  const target = rows.find((r, i) => i + 1 === rowIndex);
  if (!target) return { success: false, error: '岗位未找到' };

  if (data.company !== undefined) target.company = data.company;
  if (data.job_title !== undefined) target.job_title = data.job_title;
  if (data.location !== undefined) target.location = data.location;
  if (data.role_family !== undefined) target.role_family = data.role_family;
  if (data.priority !== undefined) target.priority = data.priority;
  if (data.status !== undefined) {
    target.status = data.status;
    if (data.status === 'Offer') target.current_stage = 'offer';
    if (data.status === 'Rejected') target.current_stage = '挂了(被拒)';
  }
  if (data.job_url !== undefined) target.job_url = data.job_url;
  if (data.notes !== undefined) target.notes = data.notes;
  if (data.level !== undefined) target.level = data.level;

  // 重新计算匹配度与届别状态
  const degree = computeMatchStatus(target);
  if (headers.includes('match_degree')) target.match_degree = degree;
  else target.cohort_match_status = degree; // 兼容旧 CSV
  if (headers.includes('cohort_match_status') && headers.includes('match_degree')) {
    target.cohort_match_status = computeCohortStatus(target);
  }

  writeCSV('job_pool.csv', headers, rows);
  return { success: true };
}

// ========== Log Operations ==========
const LOG_FILE = path.join(DASHBOARD_DIR, 'activity_log.jsonl');

function appendLog(entry) {
  const now = new Date();
  const line = JSON.stringify({
    time: now.toISOString(),
    date: getLocalDate(),
    msg: entry.msg || '',
    type: entry.type || 'info',
    notes: entry.notes || ''
  }) + '\n';
  fs.appendFileSync(LOG_FILE, line, 'utf-8');
}

function readLogs(limit = 200) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const content = fs.readFileSync(LOG_FILE, 'utf-8').trim();
  if (!content) return [];
  const lines = content.split('\n');
  const logs = [];
  for (let i = lines.length - 1; i >= 0 && logs.length < limit; i--) {
    try { logs.push(JSON.parse(lines[i])); } catch (e) {}
  }
  return logs;
}

function syncLogs(logs) {
  const existing = readLogs(1000);
  const existingKeys = new Set(existing.map(l => l.time + l.msg));
  let newCount = 0;
  logs.forEach(l => {
    const key = (l.time || '') + (l.msg || '');
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      appendLog({ msg: l.msg || '', type: l.type || 'manual', notes: l.notes || '' });
      newCount++;
    }
  });
  return { synced: newCount, total: existing.length + newCount };
}

// ========== Follow-up Edit ==========
function updateFollowUpInCSV(data) {
  const followPath = path.join(DASHBOARD_DIR, 'follow_up.csv');
  if (!fs.existsSync(followPath)) return { success: false, error: 'follow_up.csv 不存在' };

  const { headers, rows } = readCSV('follow_up.csv');
  const target = rows.find(r =>
    r.company === data.company &&
    r.job_title === data.job_title &&
    r.date === data.date &&
    r.time === data.time &&
    r.event_type === data.event_type
  );

  if (!target) return { success: false, error: '未找到匹配的跟进记录' };

  if (data.notes !== undefined) target.notes = data.notes;
  if (data.event_type !== undefined) target.event_type = data.event_type;

  writeCSV('follow_up.csv', headers, rows);
  return { success: true };
}

// ========== Batch Import ==========
// v3.8: URL 质量检查 — 标记低质量链接（第三方聚合站，非官网）
// 低质量域名列表：常见的招聘聚合站/资讯站，不是公司校招官网
const LOW_QUALITY_URL_DOMAINS = [
  'offcn.com',      // 中公教育
  '163.com',        // 网易新闻
  'toutiao.com',    // 今日头条
  'sohu.com',       // 搜狐
  'sina.com',       // 新浪
  'qq.com',         // 腾讯新闻
  'baidu.com',      // 百度百家号
  'zhihu.com',      // 知乎
  'weibo.com',      // 微博
  'xiaohongshu.com',// 小红书
  'douyin.com',     // 抖音
  'bjx.com.cn',     // 北极星招聘
  'zhipin.com',     // BOSS直聘
  '51job.com',      // 前程无忧
  'zhaopin.com',    // 智联招聘
  'liepin.com',     // 猎聘
  '58.com',         // 58同城
  'ganji.com'       // 赶集
];

/**
 * 检查 job_url 质量
 * @param {string} url
 * @returns {{isLowQuality: boolean, reason: string}}
 */
function checkUrlQuality(url) {
  if (!url || !url.trim()) {
    return { isLowQuality: false, reason: '' };  // 空链接不标记，只标记有链接但质量差的
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const bad of LOW_QUALITY_URL_DOMAINS) {
      if (hostname.includes(bad)) {
        return { isLowQuality: true, reason: `链接为第三方聚合站(${hostname})，建议替换为官网` };
      }
    }
    return { isLowQuality: false, reason: '' };
  } catch (e) {
    return { isLowQuality: true, reason: '链接格式异常，建议复核' };
  }
}

function importBatchToCSV(jobs) {
  const { headers, rows } = readCSV('job_pool.csv');
  const existingKeys = new Set(rows.map(r =>
    ((r.company || '') + '|' + (r.job_title || '')).toLowerCase().trim()
  ));

  const profile = loadUserProfile();
  const allowInternship = !!(profile && profile.job_type === 'internship');

  let imported = 0;
  let skipped = 0;
  let skippedIntern = 0;
  let lowQualityUrlCount = 0;   // v3.8: 统计低质量链接数
  const today = getLocalDate();

  jobs.forEach(job => {
    const key = ((job.company || '') + '|' + (job.job_title || '')).toLowerCase().trim();
    if (existingKeys.has(key)) {
      skipped++;
      return;
    }

    // 实习过滤：默认只收全职校招
    const jobForDetect = { title: job.job_title, category: job.role_family, notes: job.notes, description: job.description, requirement: job.requirement };
    if (!allowInternship && isInternship(jobForDetect)) {
      skippedIntern++;
      return;
    }

    existingKeys.add(key);

    // 届别与匹配度
    const degree = computeMatchStatus({ job_title: job.job_title, role_family: job.role_family, notes: job.notes, company: job.company });
    const cohort = computeCohortStatus({ job_title: job.job_title, role_family: job.role_family, notes: job.notes, company: job.company });

    // v3.8: URL 质量检查
    const urlQuality = checkUrlQuality(job.job_url);
    if (urlQuality.isLowQuality) lowQualityUrlCount++;

    // v4.2: 组装备注 — 统一使用 checkFreshness，与 importJobToCSV 保持一致
    const noteParts = [];
    if (job.notes) noteParts.push(job.notes);
    if (cohort === 'Unverified') noteParts.push('届别待官网复核');
    if (urlQuality.isLowQuality) noteParts.push(`⚠️ ${urlQuality.reason}`);
    const freshness = checkFreshness({ posted_date: job.posted_date || '' });
    if (freshness.status === 'stale') noteParts.push(freshness.reason);
    else if (freshness.status === 'unknown') noteParts.push('无发布时间，复核开放状态');

    const newRow = {};
    headers.forEach(h => {
      if (h === 'date_found') newRow[h] = today;
      else if (h === 'company') newRow[h] = job.company || '';
      else if (h === 'job_title') newRow[h] = job.job_title || '';
      else if (h === 'role_family') newRow[h] = job.role_family || '';
      else if (h === 'level') newRow[h] = job.level || (isInternship(jobForDetect) ? '实习' : '校招');
      else if (h === 'location') newRow[h] = job.location || '';
      else if (h === 'remote_policy') newRow[h] = '';
      else if (h === 'source') newRow[h] = job.source || 'Playwright 浏览器自动化';
      else if (h === 'job_url') newRow[h] = job.job_url || '';
      else if (h === 'posted_date') newRow[h] = job.posted_date || '';
      else if (h === 'priority') newRow[h] = job.priority || 'Medium';
      else if (h === 'status') newRow[h] = 'Pending';
      else if (h === 'resume_variant') newRow[h] = '';
      else if (h === 'skip_reason') newRow[h] = '';
      else if (h === 'blocker') newRow[h] = '';
      else if (h === 'next_action') newRow[h] = '';
      else if (h === 'notes') newRow[h] = noteParts.join(' | ');
      else if (h === 'match_degree') newRow[h] = degree;
      else if (h === 'cohort_match_status') {
        // 有 match_degree 列时写届别状态；否则回退写匹配度（兼容旧 CSV）
        newRow[h] = headers.includes('match_degree') ? cohort : degree;
      }
      else if (h === 'current_stage') newRow[h] = '';
      else newRow[h] = '';
    });
    rows.push(newRow);
    imported++;
  });

  if (imported > 0) {
    writeCSV('job_pool.csv', headers, rows);
  }

  return { imported, skipped, skippedIntern, lowQualityUrlCount, total: rows.length };
}

// ========== Server ==========
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // Static files — P2-8: 路径安全校验
  if (method === 'GET') {
    if (url.pathname === '/' || url.pathname === '/dashboard.html') {
      serveStatic(res, path.join(DASHBOARD_DIR, 'dashboard.html'), 'text/html; charset=utf-8');
      return;
    }
    if (url.pathname.endsWith('.csv')) {
      const filename = path.basename(url.pathname);
      const csvPath = safeJoin(DASHBOARD_DIR, filename);
      if (!csvPath) { res.writeHead(403); res.end('Forbidden'); return; }
      serveStatic(res, csvPath, 'text/csv; charset=utf-8');
      return;
    }
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
      const filename = path.basename(url.pathname);
      const filePath = safeJoin(DASHBOARD_DIR, filename);
      if (!filePath) { res.writeHead(403); res.end('Forbidden'); return; }
      const ext = path.extname(url.pathname);
      const mime = ext === '.js' ? 'application/javascript' : 'text/css';
      serveStatic(res, filePath, mime + '; charset=utf-8');
      return;
    }

    // GET /api/external-companies — 读取本地缓存的外部公司库 CSV
    if (url.pathname === '/api/external-companies') {
      try {
        const feishuSource = require(path.join(__dirname, '..', 'lib', 'feishu_source.js'));
        const rows = feishuSource.readExternalCompanies();
        const config = feishuSource.loadConfig() || {};
        sendJSON(res, 200, {
          success: true,
          companies: rows,
          count: rows.length,
          last_sync_at: config.last_sync_at || '',
          source_name: config.source_name || '',
          source_url: config.source_url || ''
        });
      } catch (e) {
        sendJSON(res, 500, { success: false, error: e.message });
      }
      return;
    }

    // v3.9: 只读端点改为 GET（向后兼容 POST，POST 仍可用）
    // GET /api/scrape — 生成 Agent 搜索任务
    if (url.pathname === '/api/scrape') {
      const targets = getSearchTargets();
      sendJSON(res, 200, {
        success: true,
        message: targets.configured ? 'Agent 搜索任务已生成' : '尚未配置用户画像，请先告诉 Agent 你的背景',
        mode: 'agent-search',
        targets: targets,
        instruction: targets.configured
          ? '请 AI Agent 使用 Web Search 搜索以下公司的最新校招岗位'
          : '请在对话中告诉 AI Agent 你的专业、学历、目标城市和岗位方向，Agent 会自动配置搜索目标'
      });
      appendLog({ msg: targets.configured ? `生成 Agent 搜索任务: ${targets.newCompanies.length} 个新目标` : '用户画像未配置', type: 'agent-search' });
      return;
    }

    // GET /api/search-targets — 获取搜索目标
    if (url.pathname === '/api/search-targets') {
      const targets = getSearchTargets();
      sendJSON(res, 200, { success: true, targets });
      return;
    }

    // v4.4 GET /api/discover-new-companies — 从秋招公司库发现"新开秋招且可自动搜索"的公司
    // 规则：① career_url 可自动识别（北森/飞书/Moka）② 岗位池中无该公司 ③ 7 天内未搜索过
    // 排序：开招时间（open_date）最新优先 —— 新开秋招的公司最可能带来新岗位
    if (url.pathname === '/api/discover-new-companies') {
      try {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '15', 10) || 15, 50);
        const feishuSource = require(path.join(__dirname, '..', 'lib', 'feishu_source.js'));
        const recruiters = require(path.join(__dirname, '..', 'lib', 'recruiters'));
        const rows = feishuSource.readExternalCompanies();

        const pool = parseCSV(fs.readFileSync(path.join(DASHBOARD_DIR, 'job_pool.csv'), 'utf-8')).rows;
        const poolCompanies = [...new Set(pool.map(r => (r.company || '').trim()).filter(Boolean))];
        const searched = readSearchedCompanies();
        const now = Date.now();
        const RETRY_MS = 7 * 24 * 60 * 60 * 1000;

        const candidates = [];
        const seenNames = new Set();
        for (const r of rows) {
          const name = (r.company_name || '').trim();
          const curl = (r.career_url || '').trim();
          if (!name || !curl) continue;
          if (seenNames.has(name)) continue; // 同名公司去重
          if (['true', '1', '是'].includes(String(r.excluded || '').trim())) continue;
          const type = recruiters.detectRecruiterType(curl);
          if (!['beisen', 'feishu', 'moka'].includes(type)) continue;
          // 已在岗位池（含已剔除）→ 该公司已覆盖，不再重复搜
          if (poolCompanies.some(pc => pc && (pc.includes(name) || name.includes(pc)))) continue;
          // 7 天内搜过（无论成功失败）→ 跳过
          const last = searched[name];
          if (last && now - new Date(last).getTime() < RETRY_MS) continue;
          candidates.push({ company: name, url: curl, type, openDate: (r.open_date || '').substring(0, 10) });
          seenNames.add(name);
        }
        candidates.sort((a, b) => (b.openDate || '').localeCompare(a.openDate || ''));
        sendJSON(res, 200, { success: true, count: candidates.length, companies: candidates.slice(0, limit) });
      } catch (e) {
        sendJSON(res, 500, { success: false, error: e.message });
      }
      return;
    }

    // GET /api/discover-plan — 公司发现计划
    if (url.pathname === '/api/discover-plan') {
      const profile = loadUserProfile() || {};
      const plan = generateDiscoveryPlan(profile);
      sendJSON(res, 200, { success: true, plan });
      return;
    }

    // GET /api/external-clues — 外部公司库智能线索（基于用户画像精排）
    if (url.pathname === '/api/external-clues') {
      try {
        const profile = loadUserProfile() || {};
        const extPath = path.join(DASHBOARD_DIR, 'external_companies.csv');
        let externalCompanies = [];
        if (fs.existsSync(extPath)) {
          const extResult = readCSV('external_companies.csv');
          externalCompanies = extResult.rows;
        }
        if (externalCompanies.length === 0) {
          sendJSON(res, 200, { success: true, clues: [], total: 0, message: '外部公司库为空，请先同步飞书数据' });
          return;
        }

        const { tokenize } = require(path.join(__dirname, '..', 'lib', 'company_discovery.js'));

        const targetRoles = (profile.target_roles || []).map(r => r.toLowerCase());
        const targetCities = (profile.target_cities || []).map(c => c.replace(/^[\u4e00-\u9fa5]+·/, '').trim());
        const profileKeywords = (profile.keywords || []).map(k => k.toLowerCase());
        const hasProfile = targetRoles.length > 0 || profileKeywords.length > 0;

        const scored = externalCompanies.map(c => {
          let score = 0;
          const reasons = [];
          const jobCategories = (c.job_categories || '').toLowerCase();
          const cities = (c.cities || '').toLowerCase();

          for (const role of targetRoles) {
            for (const rt of tokenize(role)) {
              if (rt.length >= 2 && jobCategories.includes(rt)) {
                score += 10; reasons.push(rt);
                break;
              }
            }
          }
          for (const city of targetCities) {
            if (city.length >= 2 && cities.includes(city.toLowerCase())) {
              score += 5; reasons.push(city);
            }
          }
          const companyText = `${c.company_name} ${c.job_categories} ${c.enterprise_type}`.toLowerCase();
          for (const kw of profileKeywords) {
            if (kw.length >= 2 && companyText.includes(kw)) {
              score += 2; reasons.push(kw);
            }
          }
          return { ...c, score, reasons: [...new Set(reasons)].slice(0, 5) };
        });

        scored.sort((a, b) => b.score - a.score);
        const topN = scored.filter(c => c.score > 0).slice(0, 30);

        const clues = topN.map(c => ({
          company: c.company_name,
          enterprise_type: c.enterprise_type || '',
          cities: c.cities || '',
          job_categories: c.job_categories || '',
          career_url: c.career_url || '',
          batch: c.batch || '',
          open_date: c.open_date || '',
          match_reasons: c.reasons,
          score: c.score
        }));

        const byType = {};
        clues.forEach(c => {
          const t = c.enterprise_type || '其他';
          if (!byType[t]) byType[t] = [];
          byType[t].push(c);
        });

        sendJSON(res, 200, {
          success: true,
          clues,
          total: externalCompanies.length,
          matched: clues.length,
          cold_start: !hasProfile,
          by_type: byType,
          summary: clues.length > 0
            ? `从 ${externalCompanies.length} 家公司中匹配出 ${clues.length} 家，按企业类型分${Object.keys(byType).length}类`
            : '未匹配到相关公司，请完善用户画像（target_roles / keywords）'
        });
      } catch (e) {
        sendJSON(res, 500, { success: false, error: e.message });
      }
      return;
    }

    // GET /api/supported-companies — 已适配招聘系统的公司列表
    if (url.pathname === '/api/supported-companies') {
      const companies = Object.entries(COMPANY_RECRUITER_MAP).map(([name, cfg]) => ({
        company: name,
        type: cfg.type,
        domain: cfg.companyDomain || cfg.campusUrl || ''
      }));
      sendJSON(res, 200, { success: true, companies });
      return;
    }
  }

  // API Routes
  if (method === 'POST') {
    try {
      const body = await readJSON(req);

      if (url.pathname === '/api/update-status') {
        const { rowIndex, company, job_title, status } = body;
        if (!rowIndex || !company || !job_title || !status) {
          sendJSON(res, 400, { error: '缺少必要参数' });
          return;
        }
        const result = updateStatusInCSV('job_pool.csv', rowIndex, company, job_title, status);
        appendLog({ msg: `状态更新: ${company} ${job_title} → ${status}`, type: 'status' });
        sendJSON(res, result.success ? 200 : 409, result);
        return;
      }

      if (url.pathname === '/api/update-stage') {
        const { rowIndex, company, job_title, stage } = body;
        if (!rowIndex || !company || !job_title || !stage) {
          sendJSON(res, 400, { error: '缺少必要参数' });
          return;
        }
        const result = updateStageInCSV(rowIndex, company, job_title, stage);
        appendLog({ msg: `进度更新: ${company} ${job_title} → ${stage}`, type: 'stage' });
        sendJSON(res, result.success ? 200 : 409, result);
        return;
      }

      if (url.pathname === '/api/import-job') {
        const result = importJobToCSV(body);
        if (result.success) {
          appendLog({ msg: `添加岗位: ${body.company} ${body.job_title}`, type: 'import' });
        }
        sendJSON(res, result.success ? 200 : 500, result);
        return;
      }

      if (url.pathname === '/api/update-job') {
        const { rowIndex, company, job_title } = body;
        if (!rowIndex || !company || !job_title) {
          sendJSON(res, 400, { error: '缺少必要参数' });
          return;
        }
        const result = updateJobInCSV(body);
        appendLog({ msg: `编辑岗位: ${company} ${job_title}`, type: 'edit' });
        sendJSON(res, result.success ? 200 : 409, result);
        return;
      }

      // v4.2: /api/scrape 已由 GET 处理器统一处理（行 760），此处仅保留向后兼容重定向
      if (url.pathname === '/api/scrape') {
        // 重定向到 GET 处理器逻辑（避免重复代码）
        const targets = getSearchTargets();
        sendJSON(res, 200, { success: true, mode: 'agent-search', targets, message: '请使用 GET /api/scrape' });
        return;
      }

      // Batch import jobs from Agent search results
      if (url.pathname === '/api/import-batch') {
        const { jobs } = body;
        if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
          sendJSON(res, 400, { error: 'jobs 数组为必填且不能为空' });
          return;
        }
        const result = importBatchToCSV(jobs);
        const internNote = result.skippedIntern > 0 ? `，排除实习 ${result.skippedIntern} 个` : '';
        appendLog({ msg: `Agent 批量导入: ${result.imported} 个新岗位 (${result.skipped} 个已存在${internNote})`, type: 'agent-import' });
        sendJSON(res, 200, { success: true, ...result });
        return;
      }

      // Get search targets for Agent
      if (url.pathname === '/api/search-targets') {
        const targets = getSearchTargets();
        sendJSON(res, 200, { success: true, targets });
        return;
      }

      // 公司发现计划：基于用户画像生成四维度（本体/上游/下游/交叉）发现方案
      // 公司池由用户画像驱动，不硬编码行业列表，适用于任何专业
      if (url.pathname === '/api/discover-plan') {
        const profile = loadUserProfile() || {};
        const plan = generateDiscoveryPlan(profile);
        sendJSON(res, 200, { success: true, plan });
        return;
      }

      // v4.0: 渐进式发现计划 — 三层策略：精准匹配 → 扩展发现 → 全量兜底
      // 解决新用户只推荐几个岗位 vs 全量搜索太慢的矛盾
      if (url.pathname === '/api/progressive-plan') {
        try {
          const profile = loadUserProfile() || {};
          // 读取外部公司库
          let externalCompanies = [];
          const extPath = path.join(DASHBOARD_DIR, 'external_companies.csv');
          if (fs.existsSync(extPath)) {
            const { rows } = readCSV('external_companies.csv');
            externalCompanies = rows;
          }
          const plan = generateProgressivePlan(profile, externalCompanies);
          sendJSON(res, 200, { success: true, plan });
        } catch (e) {
          sendJSON(res, 500, { success: false, error: e.message });
        }
        return;
      }

      // 已适配招聘系统的公司列表（动态来自 COMPANY_RECRUITER_MAP，不前端硬编码）
      if (url.pathname === '/api/supported-companies') {
        const companies = Object.entries(COMPANY_RECRUITER_MAP).map(([name, cfg]) => ({
          company: name,
          type: cfg.type,
          domain: cfg.companyDomain
        }));
        sendJSON(res, 200, { success: true, companies });
        return;
      }

      // ===== 外部公司库（飞书 Base 同步）=====
      // 同步外部公司库（触发 lark-cli 拉取飞书 Base）
      // 请求体: { force: true } 可跳过同步间隔检查
      if (url.pathname === '/api/sync-external') {
        try {
          const feishuSource = require(path.join(__dirname, '..', 'lib', 'feishu_source.js'));
          const force = body && body.force === true;
          const result = feishuSource.syncExternalCompanies({ force });
          sendJSON(res, 200, result);
        } catch (e) {
          sendJSON(res, 500, { success: false, error: e.message, count: 0 });
        }
        return;
      }

      // 把外部公司库中的公司导入到 job_pool（加入岗位池）
      // 请求体: { company: '公司名', career_url: '...', batch: '...', cities: '...' }
      if (url.pathname === '/api/import-external-to-pool') {
        try {
          const { company, career_url = '', batch = '', cities = '', job_categories = '' } = body;
          if (!company) {
            sendJSON(res, 400, { success: false, error: 'company 为必填' });
            return;
          }
          const { headers, rows } = readCSV('job_pool.csv');
          // 检查是否已存在（按 company + job_title 去重）
          const exists = rows.some(r => r.company === company && (r.job_title || '').includes('待查看'));
          if (!exists) {
            // v4.1: 计算匹配度
            const profile = loadUserProfile();
            const keywords = profile ? (profile.keywords || []) : [];
            const matchDegree = computeMatchDegree(
              { title: '待查看官网', category: job_categories || '', notes: `来自外部公司库：${batch} / ${job_categories}`, company },
              keywords
            );
            const cohortStatus = profile && profile.graduation_year
              ? verifyCohort({ title: '待查看官网', category: job_categories || '' }, profile.graduation_year).status
              : 'Unverified';

            rows.push({
              date_found: getLocalDate(),
              company,
              job_title: '待查看官网',
              role_family: job_categories || '',
              level: '校招',
              location: '',
              remote_policy: 'onsite',
              source: '外部公司库',
              job_url: career_url,
              posted_date: batch,
              priority: 'Medium',
              status: 'Pending',
              resume_variant: '',
              skip_reason: '',
              blocker: '',
              next_action: '查看官网具体岗位',
              notes: `来自外部公司库：${batch} / ${job_categories}`,
              cohort_match_status: cohortStatus,
              match_degree: matchDegree,
              current_stage: ''
            });
            writeCSV('job_pool.csv', headers, rows);
          }
          sendJSON(res, 200, { success: true, imported: !exists, message: exists ? '已存在于岗位池' : '已导入岗位池' });
        } catch (e) {
          sendJSON(res, 500, { success: false, error: e.message });
        }
        return;
      }

      // ===== 收藏 / 剔除 toggle（job_pool 和 external_companies 通用）=====
      // 请求体: { source: 'job_pool' | 'external', recordId: '行标识', field: 'favorited' | 'excluded', value: true|false }
      // 对于 external：recordId = source_record_id（飞书记录ID）
      // 对于 job_pool：recordId = rowIndex（行号）
      if (url.pathname === '/api/toggle-mark') {
        try {
          const { source, recordId, field, value } = body;
          if (!source || !recordId || !field) {
            sendJSON(res, 400, { success: false, error: 'source, recordId, field 为必填' });
            return;
          }
          if (field !== 'favorited' && field !== 'excluded') {
            sendJSON(res, 400, { success: false, error: 'field 只能是 favorited 或 excluded' });
            return;
          }

          const { parseCSV, rowsToCSV } = require(path.join(__dirname, '..', 'lib', 'csv_utils'));

          if (source === 'external') {
            // 外部公司库：按 source_record_id 查找
            const extPath = path.join(DASHBOARD_DIR, 'external_companies.csv');
            if (!fs.existsSync(extPath)) {
              sendJSON(res, 404, { success: false, error: 'external_companies.csv 不存在' });
              return;
            }
            const { headers, rows } = parseCSV(fs.readFileSync(extPath, 'utf-8'));
            // 确保表头含 favorited / excluded 列
            let headersUpdated = false;
            if (!headers.includes('favorited')) { headers.push('favorited'); headersUpdated = true; }
            if (!headers.includes('excluded')) { headers.push('excluded'); headersUpdated = true; }

            const target = rows.find(r => r.source_record_id === recordId);
            if (!target) {
              sendJSON(res, 404, { success: false, error: '未找到该记录' });
              return;
            }
            target[field] = value ? '1' : '';
            fs.writeFileSync(extPath, rowsToCSV(headers, rows), 'utf-8');
            sendJSON(res, 200, { success: true, field, value: target[field] });
            return;
          } else if (source === 'job_pool') {
            // 岗位池：按 rowIndex 查找
            const jobPath = path.join(DASHBOARD_DIR, 'job_pool.csv');
            if (!fs.existsSync(jobPath)) {
              sendJSON(res, 404, { success: false, error: 'job_pool.csv 不存在' });
              return;
            }
            const { headers, rows } = parseCSV(fs.readFileSync(jobPath, 'utf-8'));
            let headersUpdated = false;
            if (!headers.includes('favorited')) { headers.push('favorited'); headersUpdated = true; }

            const rowIndex = parseInt(recordId, 10);
            const target = rows.find((r, i) => (i + 1) === rowIndex);
            if (!target) {
              sendJSON(res, 404, { success: false, error: '未找到该记录' });
              return;
            }
            target[field] = value ? '1' : '';
            fs.writeFileSync(jobPath, rowsToCSV(headers, rows), 'utf-8');
            sendJSON(res, 200, { success: true, field, value: target[field] });
            return;
          } else {
            sendJSON(res, 400, { success: false, error: 'source 只能是 job_pool 或 external' });
            return;
          }
        } catch (e) {
          sendJSON(res, 500, { success: false, error: e.message });
        }
        return;
      }

      // P1-6: 真实岗位搜索 API（Playwright 浏览器自动化）
      // 直接调用官网 API 获取岗位，返回带 JD 详情页 URL 的岗位列表
      // 支持的招聘系统：北森（科大讯飞、长鑫存储、鱼跃医疗等）
      // 请求体: { company: "科大讯飞", keyword: "产品", campusUrl: "" }
      // 响应: { success: true, jobs: [...], source: "beisen-api" }
      if (url.pathname === '/api/search-jobs') {
        try {
          const { company, keyword = '', campusUrl = '' } = body;
          if (!company) {
            sendJSON(res, 400, { success: false, error: 'company 为必填' });
            return;
          }

          // 动态加载搜索模块（避免启动时依赖）
          const searchModule = require(path.join(__dirname, '..', 'lib', 'search_jobs.js'));
          const profile = loadUserProfile();

          const jobs = await searchModule.searchCompanyJobs({
            company,
            campusUrl,
            keyword,
            graduationYear: profile.graduation_year || '',
            keywords: profile.keywords || [],
            excludeInternship: profile.job_type !== 'internship'
          });

          // v4.1: 检查是否有 _error 标记（搜索失败），透传错误信息
          const hasError = jobs.length === 1 && jobs[0]._error;
          if (hasError) {
            appendLog({
              msg: `❌ 搜索失败: ${company} — ${jobs[0]._errorMessage}`,
              type: 'real-search-error'
            });
            sendJSON(res, 502, {
              success: false,
              error: jobs[0]._errorMessage,
              jobs: [],
              count: 0,
              company,
              hint: jobs[0].note || '请检查 Playwright MCP 服务或公司校招官网'
            });
            return;
          }

          appendLog({
            msg: `🔍 真实搜索: ${company} "${keyword}" → ${jobs.length} 个岗位`,
            type: 'real-search'
          });

          sendJSON(res, 200, {
            success: true,
            jobs,
            count: jobs.length,
            company,
            source: jobs.length > 0 && jobs[0].source ? jobs[0].source : 'api'
          });
        } catch (e) {
          console.error('搜索失败:', e);
          appendLog({ msg: `❌ 搜索失败: ${e.message}`, type: 'error' });
          sendJSON(res, 500, { success: false, error: e.message });
        }
        return;
      }

      // P1-6: 搜索并导入（一键导入到岗位池）
      if (url.pathname === '/api/search-and-import') {
        try {
          const { company, keyword = '', campusUrl = '' } = body;
          if (!company) {
            sendJSON(res, 400, { success: false, error: 'company 为必填' });
            return;
          }

          const searchModule = require(path.join(__dirname, '..', 'lib', 'search_jobs.js'));
          const profile = loadUserProfile();

          const jobs = await searchModule.searchCompanyJobs({
            company,
            campusUrl,
            keyword,
            graduationYear: profile.graduation_year || '',
            keywords: profile.keywords || [],
            excludeInternship: profile.job_type !== 'internship'
          });

          // v4.1: 检查搜索错误
          const hasError = jobs.length === 1 && jobs[0]._error;
          if (hasError) {
            sendJSON(res, 502, {
              success: false,
              error: jobs[0]._errorMessage,
              imported: 0,
              skipped: 0,
              hint: jobs[0].note || '请检查 Playwright MCP 服务或公司校招官网'
            });
            return;
          }

          if (jobs.length === 0) {
            sendJSON(res, 200, { success: true, imported: 0, skipped: 0, message: '未找到岗位' });
            return;
          }

          // v4.5: 岗位方向过滤（配置驱动）—— 剔除适配器降级占位记录 + 用户画像中排除的岗位方向
          const roleFilter = {
            strongExclude: profile.role_strong_exclude || [],
            keep: profile.role_keep || [],
            exclude: profile.role_exclude || []
          };
          const excludedCompanies = profile.excluded_companies || [];
          const cityRules = profile.company_city_rules || [];
          const suitable = [];
          let filteredOut = 0;
          for (const j of jobs) {
            if (!isRealJob(j)) { filteredOut++; continue; }
            const jobCompany = j.company || company || '';
            // 用户明确排除的公司
            if (excludedCompanies.some(ec => ec && jobCompany.includes(ec))) { filteredOut++; continue; }
            // 公司 × 城市白名单规则（如"人保财险只投上海/杭州/江西"）
            const rule = cityRules.find(r => r.company && jobCompany.includes(r.company));
            if (rule && Array.isArray(rule.cities) && rule.cities.length > 0) {
              const loc = `${j.city || ''} ${j.location || ''}`;
              if (!rule.cities.some(c => loc.includes(c))) { filteredOut++; continue; }
            }
            if (isUnsuitableRole(j.title || j.job_title || '', j.category || j.role_family || '', roleFilter)) { filteredOut++; continue; }
            suitable.push(j);
          }
          markCompanySearched(company);

          if (suitable.length === 0) {
            appendLog({
              msg: `🧹 ${company}: ${jobs.length} 个岗位全部被过滤（占位/专业壁垒），不导入`,
              type: 'search-import'
            });
            sendJSON(res, 200, { success: true, imported: 0, skipped: 0, filteredOut, message: '无适合岗位' });
            return;
          }

          const jobPoolPath = path.join(DASHBOARD_DIR, 'job_pool.csv');
          const result = searchModule.importJobs(suitable, jobPoolPath);
          appendLog({
            msg: `📥 搜索导入: ${company} → 新增${result.imported}个，跳过${result.skipped}个`,
            type: 'search-import'
          });

          sendJSON(res, 200, { success: true, ...result });
        } catch (e) {
          console.error('搜索导入失败:', e);
          sendJSON(res, 500, { success: false, error: e.message });
        }
        return;
      }

      // P0-3: 用户配置管理
      if (url.pathname === '/api/user-profile') {
        if (method === 'POST') {
          // 保存用户配置
          if (body.profile) {
            const ok = saveUserProfile(body.profile);
            sendJSON(res, ok ? 200 : 500, { success: ok });
            appendLog({ msg: '用户画像已更新', type: 'config' });
          } else {
            sendJSON(res, 400, { error: '缺少 profile 字段' });
          }
          return;
        }
      }

      // Update follow-up entry
      if (url.pathname === '/api/update-followup') {
        const { company, job_title, date, time, event_type, notes } = body;
        if (!company || !job_title || !date || !event_type) {
          sendJSON(res, 400, { error: '缺少必要参数' });
          return;
        }
        const result = updateFollowUpInCSV({ company, job_title, date, time, event_type, notes });
        appendLog({ msg: `编辑跟进备注: ${company} ${job_title} - ${event_type}`, type: 'edit' });
        sendJSON(res, result.success ? 200 : 409, result);
        return;
      }

      // Log sync endpoint
      if (url.pathname === '/api/log-sync') {
        const { logs } = body;
        if (!logs || !Array.isArray(logs)) {
          sendJSON(res, 400, { error: 'logs 数组为必填' });
          return;
        }
        const result = syncLogs(logs);
        sendJSON(res, 200, { success: true, ...result });
        return;
      }

      // Log endpoint
      if (url.pathname === '/api/log') {
        const { msg, type } = body;
        if (msg) {
          appendLog({ msg, type: type || 'manual' });
          sendJSON(res, 200, { success: true });
        } else {
          const logs = readLogs(50);
          sendJSON(res, 200, { logs });
        }
        return;
      }

      sendJSON(res, 404, { error: '未知 API 端点' });
    } catch (e) {
      sendJSON(res, 400, { error: '请求格式错误: ' + e.message });
    }
    return;
  }

  // GET API: 读取用户配置
  if (method === 'GET' && url.pathname === '/api/user-profile') {
    const profile = loadUserProfile();
    sendJSON(res, 200, { success: true, profile });
    return;
  }

  // Default 404
  sendJSON(res, 404, { error: 'Not Found' });
});

// P2-11: 端口冲突友好报错
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error('  ✗ 端口 ' + PORT + ' 已被占用！');
    console.error('    可能是另一个 CareerSail 实例正在运行。');
    console.error('    解决方法：');
    console.error('    1. 关闭之前的实例（按 Ctrl+C）');
    console.error('    2. 或设置环境变量换端口：set PORT=8431 && node server.js');
    console.error('');
  } else {
    console.error('  服务器错误:', err.message);
  }
  process.exit(1);
});

// ========== 启动 ==========
// P0-1: 先初始化数据文件，再启动服务
initDataFiles();

// v3.5: 启动时检查是否需要自动同步外部公司库（飞书 Base）
// 通用功能 — 首次启动或超过同步间隔时自动拉取飞书数据
// 测试环境可设置 SKIP_AUTO_SYNC=1 跳过
if (!process.env.SKIP_AUTO_SYNC) {
  try {
    const feishuSource = require(path.join(__dirname, '..', 'lib', 'feishu_source.js'));
    const extConfig = feishuSource.loadConfig();
    if (extConfig && extConfig.base_token && extConfig.table_id) {
      const extCsvPath = path.join(DASHBOARD_DIR, 'external_companies.csv');
      const csvExists = fs.existsSync(extCsvPath);
      const csvEmpty = csvExists ? fs.readFileSync(extCsvPath, 'utf-8').trim().split('\n').length <= 1 : true;
      if (csvEmpty || feishuSource.shouldSyncOnStartup()) {
        console.log('  ⏳ 正在同步飞书 Base 外部公司库...');
        const syncResult = feishuSource.syncExternalCompanies({ force: csvEmpty });
        if (syncResult.success) {
          console.log(`  ✓ ${syncResult.message}`);
        } else {
          console.log(`  ⚠ 外部公司库同步跳过: ${syncResult.message}`);
        }
      }
    }
  } catch (e) {
    console.log(`  ⚠ 外部公司库启动同步失败（不影响服务）: ${e.message}`);
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ⛵  CareerSail · 职航  v2.1.0');
  console.log('  ─────────────────────────');
  console.log(`  求职助手: http://localhost:${PORT}/dashboard.html`);
  console.log(`  API 端点: http://localhost:${PORT}/api/`);
  console.log('  ─────────────────────────');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
  console.log('  📦 外部依赖提示：');
  console.log('  ─────────────────────────');
  console.log('  1. Playwright MCP（岗位搜索）：');
  console.log('     如搜索返回空结果，请在 AI Agent 中安装 Playwright MCP');
  console.log('     详见 README.md「外部依赖」章节');
  console.log('  2. lark-cli（秋招公司库同步）：');
  console.log('     如秋招公司库显示 0 条，请安装 lark-cli（trae-remote-official:lark 插件）');
  console.log('     或手动编辑 dashboard/external_companies.csv 添加公司');
  console.log('  ─────────────────────────');
  console.log('');
});
