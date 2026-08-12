/**
 * CareerSail 岗位过滤器
 *
 * 集中处理三件原本散落/缺失的事：
 *  1. 届别验证（verifyCohort）—— 用户是 27 届就只要 27 届校招，不混入 26 届
 *  2. 实习 / 全职识别（detectJobType）—— 默认只收全职校招，排除实习
 *  3. 时间新鲜度（checkFreshness）—— 标注发布时间是否过旧，提示 Agent 复核是否仍开放
 *  4. 匹配度计算（computeMatchDegree）—— 基于用户关键词 × 岗位文本
 *
 * 设计原则：
 *  - 纯函数、零依赖，方便任何 Agent / 测试调用
 *  - 不硬编码任何专业或公司，所有判断基于入参文本
 */

// ============================================================
// 1. 实习 / 全职识别
// ============================================================

const INTERN_KEYWORDS = [
  '实习', '实习生', '日常实习', '寒假期实习', '寒假实习', '暑假期实习', '暑期实习',
  '假期实习', '留用实习', 'intern', 'internship', '实习生项目', '实习项目'
];

const SOCIAL_KEYWORDS = ['社招', '社会招聘', ' Experienced', 'experienced', '资深'];

/**
 * 检测岗位类型：实习 / 校招 / 社招
 * 依据：岗位标题、分类、职责、要求中的关键词
 * @param {Object} job - 标准化岗位对象
 * @returns {string} '实习' | '校招' | '社招'
 */
function detectJobType(job) {
  const text = [
    job.title || job.job_title || '',
    job.category || job.role_family || '',
    job.description || '',
    job.requirement || '',
    job.notes || ''
  ].join(' ').toLowerCase();

  // 实习优先判定：只要明确出现实习关键词，就归为实习
  // （避免"实习岗位已确认但全职未定"陷阱——把含糊岗位留给后续 verifyCohort 复核）
  for (const kw of INTERN_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return '实习';
  }
  for (const kw of SOCIAL_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) return '社招';
  }
  // 默认按校招处理（CareerSail 默认面向应届校园全职招聘）
  return '校招';
}

/**
 * 是否为实习岗位
 */
function isInternship(job) {
  return detectJobType(job) === '实习';
}

// ============================================================
// 2. 届别验证
// ============================================================

/**
 * 从岗位文本中提取出现的届别年份
 * 匹配 "2027届"、"2027 届"、"27届"、"2027届毕业生" 等
 * @param {string} text
 * @returns {number[]} 出现的届别年份数组，如 [2026, 2027]
 */
function extractCohortYears(text) {
  if (!text) return [];
  const years = new Set();
  // 4 位年份 + 届
  const full = text.match(/(20\d{2})\s*届/g);
  if (full) full.forEach(s => years.add(parseInt(s)));
  // 2 位年份 + 届（如 27届 → 2027）
  const short = text.match(/(?<!\d)(\d{2})\s*届/g);
  if (short) {
    short.forEach(s => {
      const n = parseInt(s);
      if (n >= 25 && n <= 35) years.add(2000 + n);
    });
  }
  return [...years].sort();
}

/**
 * 验证岗位届别是否匹配用户毕业年份
 *
 * 判定逻辑：
 *  - 岗位文本中明确提到目标届（如 2027届）且未提到其他届 → matched
 *  - 岗位文本提到其他届（如 2026届）且未提到目标届 → mismatched
 *  - 岗位文本同时提到多届（含目标届）→ matched（多届校招常见）
 *  - 岗位文本未提到任何届 → unverified（无法从文本判断，依赖招聘类别）
 *
 * @param {Object} job
 * @param {string|number} graduationYear - 用户毕业年份，如 "2027"
 * @returns {{status: 'Yes'|'No'|'Unverified', detected: number[], reason: string}}
 */
function verifyCohort(job, graduationYear) {
  const target = parseInt(graduationYear);
  if (!target) {
    return { status: 'Unverified', detected: [], reason: '未配置毕业年份，无法校验届别' };
  }

  const text = [
    job.title || job.job_title || '',
    job.category || job.role_family || '',
    job.description || '',
    job.requirement || '',
    job.notes || ''
  ].join(' ');

  const detected = extractCohortYears(text);

  if (detected.length === 0) {
    return {
      status: 'Unverified',
      detected: [],
      reason: `岗位文本未标注届别，需进入官网复核是否为 ${target}届校招`
    };
  }

  if (detected.includes(target)) {
    return {
      status: 'Yes',
      detected,
      reason: `岗位明确面向 ${target}届`
    };
  }

  // 检测到届别但不含目标届
  return {
    status: 'No',
    detected,
    reason: `岗位面向 ${detected.join('/')}届，与目标 ${target}届不符`
  };
}

// ============================================================
// 3. 时间新鲜度检查
// ============================================================

const STALE_DAYS = 180; // 超过 6 个月视为可能过时

/**
 * 检查岗位发布时间新鲜度
 * @param {Object} job
 * @param {Date} [referenceDate=new Date()] - 参考日期（默认今天）
 * @returns {{fresh: boolean, daysOld: number|null, status: 'fresh'|'stale'|'unknown', reason: string}}
 */
function checkFreshness(job, referenceDate = new Date()) {
  const raw = job.publishDate || job.posted_date || job.PostDate || '';
  if (!raw) {
    return { fresh: false, daysOld: null, status: 'unknown', reason: '无发布时间，需复核招聘是否仍开放' };
  }
  const dateStr = raw.split('T')[0].split(' ')[0];
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return { fresh: false, daysOld: null, status: 'unknown', reason: `发布时间格式异常: ${raw}` };
  }
  const daysOld = Math.floor((referenceDate - d) / (1000 * 60 * 60 * 24));
  if (daysOld > STALE_DAYS) {
    return { fresh: false, daysOld, status: 'stale', reason: `发布于 ${dateStr}（${daysOld}天前），可能已结束，需复核` };
  }
  return { fresh: true, daysOld, status: 'fresh', reason: `发布于 ${dateStr}（${daysOld}天前）` };
}

// ============================================================
// 4. 匹配度计算（语义修正：这里只算"匹配度"，不算"届别"）
// ============================================================

/**
 * 把关键词拆成最小语义碎片（2-gram + 单字 + 英文整词）
 *
 * v3.9 新增：解决 "结构设计" 不匹配 "结构工程师" 这类语义近邻但字面不等的问题。
 * 拆词规则：
 *   - 中文：2-gram 滑窗（"结构设计" → ["结构", "构设", "设计"]）+ 单字
 *     单字加入是因为很多岗位名只含一个核心字（如"机"器工程师 vs "机械"）
 *     但单字过泛会引入噪音（如"化"在太多词里），所以只保留 2 字以上的碎片
 *   - 英文：原词整保留 + 4+ 字母的前缀（"SolidWorks" → ["solidworks", "solid"]）
 *   - 数字：原样保留
 *
 * @param {string} kw
 * @returns {string[]} 碎片数组（已小写）
 */
function tokenize(kw) {
  const s = String(kw).toLowerCase().trim();
  if (!s) return [];

  const tokens = new Set();
  // 英文整词
  const englishWords = s.match(/[a-z]+/gi) || [];
  englishWords.forEach(w => {
    tokens.add(w.toLowerCase());
    if (w.length >= 4) tokens.add(w.toLowerCase().slice(0, 4)); // 前缀匹配
  });

  // 数字串
  const numbers = s.match(/\d+/g) || [];
  numbers.forEach(n => tokens.add(n));

  // 中文 2-gram（滑窗）
  const chineseChars = s.match(/[\u4e00-\u9fa5]/g) || [];
  if (chineseChars.length >= 2) {
    for (let i = 0; i < chineseChars.length - 1; i++) {
      tokens.add(chineseChars[i] + chineseChars[i + 1]);
    }
  }
  // 中文 3-gram（捕获三字词的核心语义）
  if (chineseChars.length >= 3) {
    for (let i = 0; i < chineseChars.length - 2; i++) {
      tokens.add(chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2]);
    }
  }
  // 单字（仅当关键词本身只有 1 个中文字时）
  if (chineseChars.length === 1) {
    tokens.add(chineseChars[0]);
  }

  return [...tokens].filter(t => t.length >= 2 || /[\u4e00-\u9fa5]/.test(t));
}

/**
 * 判断关键词是否命中目标文本（基于碎片匹配）
 * 任一碎片命中即算该关键词命中
 *
 * @param {string} text - 目标文本（已小写）
 * @param {string[]} tokens - 关键词碎片数组
 * @returns {boolean}
 */
function tokensMatch(text, tokens) {
  if (!text || tokens.length === 0) return false;
  return tokens.some(t => text.includes(t));
}

/**
 * 计算岗位匹配度（高度匹配 / 中度匹配 / 可以尝试）
 * 基于「关键词碎片」匹配，解决精确子串匹配的语义陷阱
 *
 * v3.9 优化：
 *   - 关键词拆碎片（2-gram）后匹配：("结构设计" → ["结构","构设","设计"])
 *     "结构设计" 的碎片 "结构" 能命中 "结构工程师" → 算匹配
 *   - 保留 v3.8 的标题加权逻辑和阈值
 *   - 高度匹配：标题命中 >=2 个，或全文命中率 >=50%
 *   - 中度匹配：标题命中 1 个，或全文命中率 >=30%
 *
 * @param {Object} job
 * @param {string[]} keywords - 用户关键词
 * @returns {string} 匹配度标签
 */
function computeMatchDegree(job, keywords = []) {
  if (!keywords || keywords.length === 0) return '';

  const titleText = (job.title || job.job_title || '').toLowerCase();
  const fullText = [
    titleText,
    job.category || job.role_family || '',
    job.description || '',
    job.requirement || '',
    job.notes || '',
    job.company || ''
  ].join(' ').toLowerCase();

  // 预拆词：每个关键词 → 碎片数组
  const tokenizedKeywords = keywords.map(kw => ({
    original: kw,
    tokens: tokenize(kw)
  }));

  let matchCount = 0;       // 全文命中数
  let titleMatchCount = 0;  // 标题命中数（加权）

  tokenizedKeywords.forEach(({ original, tokens }) => {
    // 优先精确匹配（向后兼容）
    const k = String(original).toLowerCase();
    const fullHit = fullText.includes(k) || tokensMatch(fullText, tokens);
    const titleHit = titleText.includes(k) || tokensMatch(titleText, tokens);
    if (fullHit) matchCount++;
    if (titleHit) titleMatchCount++;
  });

  if (matchCount === 0) {
    // 不限专业的岗位也推荐：标题/正文含"不限专业"/"专业不限"/"不限"关键词
    const noMajorLimit = /不限专业|专业不限|不限/.test(fullText);
    if (noMajorLimit) return '可以尝试';
    return '';
  }

  const ratio = matchCount / keywords.length;
  // v3.8: 标题命中加权 — 标题里直接出现关键词，说明岗位核心方向匹配
  // 高度匹配：标题命中 >=2 个（核心方向双重契合），或全文命中率 >=50%
  if (titleMatchCount >= 2 || ratio >= 0.5) return '高度匹配';
  // 中度匹配：标题命中 1 个（核心方向单点契合），或全文命中率 >=30%
  if (titleMatchCount >= 1 || ratio >= 0.3) return '中度匹配';
  // 可以尝试：至少有命中（仅正文命中，标题未命中）
  return '可以尝试';
}

/**
 * 综合过滤：根据用户配置过滤岗位
 * 返回通过过滤的岗位列表，以及被过滤岗位的明细（供日志/备注）
 * @param {Array} jobs
 * @param {Object} options - { graduationYear, excludeInternship, keywords }
 * @returns {{passed: Array, filtered: Array<{job, reason}>}}
 */
function filterJobs(jobs, options = {}) {
  const {
    graduationYear = '',
    excludeInternship = true,
    keywords = []
  } = options;

  const passed = [];
  const filtered = [];

  for (const job of jobs) {
    // 1. 实习过滤
    if (excludeInternship && isInternship(job)) {
      filtered.push({ job, reason: '实习岗位（已排除）' });
      continue;
    }
    // 2. 届别过滤：明确不匹配的剔除；未标注的保留但标注 Unverified
    const cohort = verifyCohort(job, graduationYear);
    if (cohort.status === 'No') {
      filtered.push({ job, reason: cohort.reason });
      continue;
    }
    // 3. 补充字段
    passed.push({
      ...job,
      level: job.level && job.level !== '校招' ? job.level : detectJobType(job),
      cohortStatus: cohort.status,
      cohortReason: cohort.reason,
      matchDegree: computeMatchDegree(job, keywords)
    });
  }

  return { passed, filtered };
}

module.exports = {
  INTERN_KEYWORDS,
  STALE_DAYS,
  detectJobType,
  isInternship,
  extractCohortYears,
  verifyCohort,
  checkFreshness,
  computeMatchDegree,
  tokenize,
  tokensMatch,
  filterJobs
};
