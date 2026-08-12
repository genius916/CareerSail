/**
 * CareerSail 岗位搜索主模块
 * 
 * 基于 Playwright MCP 浏览器自动化 + 官网 API 直接调用
 * 不依赖模糊 Web Search，确保岗位真实且链接直达 JD 详情页
 * 
 * 使用方式（命令行）：
 *   node lib/search_jobs.js --company "科大讯飞" --keyword "产品"
 *   node lib/search_jobs.js --all --output dashboard/job_pool.csv
 * 
 * 使用方式（API）：
 *   const { searchJobs, importJobs } = require('./lib/search_jobs');
 *   const jobs = await searchJobs({ company: '科大讯飞', keyword: '产品' });
 *   const result = await importJobs(jobs, 'dashboard/job_pool.csv');
 */

const fs = require('fs');
const path = require('path');
const {
  createRecruiter,
  createRecruiterByCompany,
  createRecruiterByUrl,
  detectRecruiterType,
  COMPANY_RECRUITER_MAP
} = require('./recruiters');
const {
  parseCSV,
  rowsToCSV,
  getLocalDate
} = require('./csv_utils');
const {
  verifyCohort,
  checkFreshness,
  computeMatchDegree,
  isInternship
} = require('./job_filters');

// ============================================================
// 核心搜索函数
// ============================================================

/**
 * 搜索单个公司的校招岗位
 * @param {Object} options
 * @param {string} options.company - 公司名称
 * @param {string} options.campusUrl - 校招官网URL
 * @param {string} options.keyword - 搜索关键词
 * @param {string} options.graduationYear - 毕业年份
 * @param {string[]} options.keywords - 用户关键词（用于匹配度计算）
 * @param {boolean} options.excludeInternship - 是否排除实习（默认 true，只收全职校招）
 * @returns {Promise<Array>} 标准化的岗位列表
 */
async function searchCompanyJobs(options = {}) {
  const {
    company,
    campusUrl = '',
    keyword = '',
    graduationYear = '',
    keywords = [],
    excludeInternship = true
  } = options;

  console.log(`🔍 搜索 ${company} 校招岗位...`);

  // 1. 优先按公司名查 COMPANY_RECRUITER_MAP；查不到则根据 URL 自动路由
  //    v3.4：适配器按招聘系统类型工作，未知公司根据 URL 模式自动识别
  let recruiter = createRecruiterByCompany(company);
  let detectedType = '';

  if (!recruiter && campusUrl) {
    detectedType = detectRecruiterType(campusUrl);
    if (detectedType !== 'unknown') {
      console.log(`  → 自动检测到招聘系统: ${detectedType}`);
    }
    // 用 createRecruiterByUrl 自动路由（识别不出会返回 GenericRecruiter 兜底）
    recruiter = createRecruiterByUrl(campusUrl, company);
  }

  if (!recruiter) {
    // 既无公司映射也无 URL，返回最基础的占位记录
    console.log(`  ⚠  无公司映射且无 campusUrl，返回占位记录`);
    return [{
      id: '',
      title: `${company} 校园招聘`,
      company: company,
      city: '',
      department: '',
      category: '',
      publishDate: '',
      url: campusUrl || '',
      description: '',
      requirement: '',
      source: `${company}校招官网（待验证）`,
      level: '校招',
      note: '未知公司且无 URL，请告知 Agent 校招官网链接'
    }];
  }

  // 2. 调用适配器获取岗位
  // v4.1: 错误信息透传，不再静默返回空数组
  try {
    const jobs = await recruiter.fetchJobs({
      keyword,
      graduationYear,
      pageSize: 50,
      maxPages: 5
    });

    console.log(`  ✅ 找到 ${jobs.length} 个岗位`);

    // 3. 过滤 + 标注：实习过滤、届别验证、新鲜度、匹配度
    const passed = [];
    let skippedIntern = 0;
    let skippedCohort = 0;

    for (const job of jobs) {
      const enriched = { ...job, company: job.company || company };

      // 3.1 实习过滤（默认只收全职校招）
      if (excludeInternship && isInternship(enriched)) {
        skippedIntern++;
        continue;
      }

      // 3.2 届别验证：明确不符目标届的剔除
      const cohort = verifyCohort(enriched, graduationYear);
      if (cohort.status === 'No') {
        skippedCohort++;
        continue;
      }

      // 3.3 新鲜度
      const freshness = checkFreshness(enriched);

      // 3.4 匹配度
      const matchDegree = computeMatchDegree(enriched, keywords);

      passed.push({
        ...enriched,
        matchStatus: matchDegree,
        matchDegree,
        cohortStatus: cohort.status,
        cohortReason: cohort.reason,
        freshnessStatus: freshness.status,
        freshnessReason: freshness.reason
      });
    }

    if (skippedIntern > 0 || skippedCohort > 0) {
      console.log(`  ↪ 过滤: 排除实习 ${skippedIntern} 个, 届别不符 ${skippedCohort} 个`);
    }

    return passed;
  } catch (e) {
    const errMsg = e.message || String(e);
    console.error(`  ❌ 搜索 ${company} 失败: ${errMsg}`);
    // v4.1: 返回带错误信息的对象，而非静默空数组
    // 调用方通过检查 _error 字段判断是否失败
    const errorJob = {
      _error: true,
      _errorMessage: errMsg,
      id: '',
      title: `${company} 搜索失败`,
      company: company,
      city: '',
      department: '',
      category: '',
      publishDate: '',
      url: campusUrl || '',
      description: `搜索失败: ${errMsg}`,
      requirement: '',
      source: `${company}（搜索失败）`,
      level: '校招',
      note: `API 调用失败: ${errMsg}。请检查: 1) 公司校招官网是否可访问 2) 关键词是否合理 3) Playwright MCP 服务是否运行`
    };
    return [errorJob];
  }
}

/**
 * 批量搜索多个公司的岗位
 * @param {Array} targets - 搜索目标数组 [{ company, campusUrl, keywords }]
 * @param {Object} options - 全局选项
 * @returns {Promise<Array>} 所有岗位的合并列表
 */
async function searchAllCompanies(targets = [], options = {}) {
  const {
    keyword = '',
    graduationYear = '',
    keywords = [],
    excludeInternship = true,
    delayMs = 2000
  } = options;

  const allJobs = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const jobs = await searchCompanyJobs({
      company: target.company,
      campusUrl: target.campusUrl || '',
      keyword: target.keywords || keyword,
      graduationYear,
      keywords,
      excludeInternship
    });
    allJobs.push(...jobs);

    // 控制频率
    if (i < targets.length - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return allJobs;
}

// ============================================================
// CSV 导入函数
// ============================================================

/**
 * 将搜索到的岗位导入到 job_pool.csv
 * 自动去重（按 company + job_title 判断）
 *
 * 字段语义修正：
 *  - cohort_match_status：真正的届别匹配状态（Yes/No/Unverified）
 *  - match_degree：匹配度（高度匹配/中度匹配/可以尝试）
 * 旧 CSV 若无 match_degree 列，匹配度仍写入 cohort_match_status 以兼容历史数据。
 *
 * @param {Array} jobs - 岗位列表
 * @param {string} csvPath - CSV 文件路径
 * @param {Object} options
 * @returns {Object} { imported, skipped, total }
 */
function importJobs(jobs, csvPath, options = {}) {
  const {
    defaultPriority = 'Medium',
    defaultStatus = 'Pending'
  } = options;

  // 读取现有数据
  let existingJobs = [];
  let headers = [
    'date_found', 'company', 'job_title', 'role_family', 'level',
    'location', 'remote_policy', 'source', 'job_url', 'posted_date',
    'priority', 'status', 'resume_variant', 'skip_reason', 'blocker',
    'next_action', 'notes', 'cohort_match_status', 'match_degree', 'current_stage'
  ];

  if (fs.existsSync(csvPath)) {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const parsed = parseCSV(csvContent);
    headers = parsed.headers.length > 0 ? parsed.headers : headers;
    existingJobs = parsed.rows;
  }

  const hasMatchDegreeCol = headers.includes('match_degree');

  // 构建去重集合
  const existingSet = new Set(
    existingJobs.map(j => `${j.company}|${j.job_title}`)
  );

  const today = getLocalDate();
  const newJobs = [];
  let skipped = 0;

  for (const job of jobs) {
    const key = `${job.company}|${job.title}`;
    if (existingSet.has(key)) {
      skipped++;
      continue;
    }

    // 组装备注：匹配度 + 届别复核提示 + 新鲜度提示
    const noteParts = [];
    if (job.matchDegree) noteParts.push(`匹配度：${job.matchDegree}`);
    if (job.cohortStatus === 'Unverified') noteParts.push('届别待官网复核');
    if (job.freshnessStatus === 'stale') noteParts.push('岗位较旧，复核是否仍开放');
    else if (job.freshnessStatus === 'unknown') noteParts.push('无发布时间，复核开放状态');

    const newJob = {
      date_found: today,
      company: job.company || '',
      job_title: job.title || '',
      role_family: job.category || '',
      level: job.level || '校招',
      location: job.city || '',
      remote_policy: '',
      source: job.source || '官网',
      job_url: job.url || '',
      posted_date: job.publishDate || '',
      priority: defaultPriority,
      status: defaultStatus,
      resume_variant: '',
      skip_reason: '',
      blocker: '',
      next_action: '',
      notes: noteParts.join(' | '),
      cohort_match_status: job.cohortStatus || 'Unverified',
      current_stage: ''
    };
    if (hasMatchDegreeCol) {
      newJob.match_degree = job.matchDegree || '';
    } else {
      // 兼容旧 CSV：把匹配度塞进 cohort_match_status（历史 dashboard 读这个字段）
      newJob.cohort_match_status = job.matchDegree || job.cohortStatus || 'Unverified';
    }

    newJobs.push(newJob);
    existingSet.add(key);
  }

  // 合并写入
  const allRows = [...existingJobs, ...newJobs];
  const csvContent = rowsToCSV(headers, allRows);
  // v4.1: 移除 BOM (\uFEFF)，与 server.js 的 writeCSV 保持一致
  fs.writeFileSync(csvPath, csvContent, 'utf-8');

  return {
    imported: newJobs.length,
    skipped,
    total: allRows.length,
    newJobs
  };
}

/**
 * 从用户配置中读取搜索目标
 * @param {string} configPath - 用户配置文件路径
 * @returns {Object} { search_targets, keywords, graduation_year, target_roles }
 */
function loadUserProfile(configPath) {
  if (!fs.existsSync(configPath)) {
    return {
      search_targets: [],
      keywords: [],
      graduation_year: '',
      target_roles: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.error('读取用户配置失败:', e.message);
    return { search_targets: [], keywords: [] };
  }
}

// ============================================================
// 命令行入口
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    if (idx >= 0 && idx < args.length - 1) return args[idx + 1];
    return null;
  };

  const company = getArg('company');
  const keyword = getArg('keyword') || '';
  const outputPath = getArg('output') || 'dashboard/job_pool.csv';
  const configPath = getArg('config') || 'config/user_profile.json';
  const allFlag = args.includes('--all');
  const listFlag = args.includes('--list');

  // 列出支持的公司
  if (listFlag) {
    console.log('📋 已适配招聘系统的公司列表：');
    Object.entries(COMPANY_RECRUITER_MAP).forEach(([name, config]) => {
      console.log(`  ${name} → ${config.type} (${config.companyDomain})`);
    });
    console.log('\n💡 更多公司可通过 campusUrl 参数自动检测');
    return;
  }

  if (allFlag) {
    // 从配置读取所有目标公司并搜索
    const profile = loadUserProfile(configPath);
    if (profile.search_targets.length === 0) {
      console.error('❌ 用户配置中没有搜索目标，请先配置 search_targets');
      process.exit(1);
    }

    console.log(`📊 将搜索 ${profile.search_targets.length} 家公司的校招岗位\n`);
    const excludeInternship = profile.job_type !== 'internship';
    const allJobs = await searchAllCompanies(profile.search_targets, {
      keyword,
      graduationYear: profile.graduation_year,
      keywords: profile.keywords,
      excludeInternship,
      delayMs: 2000
    });

    console.log(`\n📈 共找到 ${allJobs.length} 个岗位`);

    if (allJobs.length > 0) {
      const result = importJobs(allJobs, outputPath);
      console.log(`✅ 导入完成: 新增 ${result.imported} 个，跳过 ${result.skipped} 个，总计 ${result.total} 个`);
    }
    return;
  }

  if (company) {
    // 搜索单个公司
    const campusUrl = getArg('campus-url') || '';
    const jobs = await searchCompanyJobs({
      company,
      campusUrl,
      keyword,
      keywords: loadUserProfile(configPath).keywords
    });

    console.log(`\n📋 ${company} 岗位列表 (${jobs.length}个):`);
    jobs.slice(0, 20).forEach((j, i) => {
      console.log(`  ${i + 1}. ${j.title} — ${j.city || '未知城市'}`);
      console.log(`     🔗 ${j.url}`);
    });
    if (jobs.length > 20) {
      console.log(`  ... 还有 ${jobs.length - 20} 个岗位`);
    }

    // 是否导入
    const importFlag = args.includes('--import');
    if (importFlag && jobs.length > 0) {
      const result = importJobs(jobs, outputPath);
      console.log(`\n✅ 导入完成: 新增 ${result.imported} 个，跳过 ${result.skipped} 个`);
    }
    return;
  }

  // 无参数时显示帮助
  console.log(`
CareerSail 岗位搜索工具 (Playwright MCP 浏览器自动化)

用法:
  node lib/search_jobs.js --list                           列出支持的公司
  node lib/search_jobs.js --company "科大讯飞" [--keyword "产品"] [--import]
  node lib/search_jobs.js --all [--output dashboard/job_pool.csv]

选项:
  --company <name>       搜索单个公司
  --keyword <kw>         搜索关键词
  --campus-url <url>     校招官网URL（用于自动检测招聘系统）
  --all                  搜索配置中所有目标公司
  --import               搜索后导入到CSV
  --output <path>        输出CSV路径
  --config <path>        用户配置路径
  --list                 列出已适配的公司
`);
}

// 如果直接运行此文件
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  searchCompanyJobs,
  searchAllCompanies,
  importJobs,
  loadUserProfile
};
