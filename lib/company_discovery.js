/**
 * CareerSail 公司发现引擎
 *
 * 核心原则：公司池由用户画像驱动，不硬编码行业列表。
 * 开源后用户专业五花八门（机械、计算机、金融、化工、设计……），
 * 因此本模块提供的是一套「方法」，而非某行业的公司清单。
 *
 * 四维度通用发现方法（适用于任何专业）：
 *   1. 本体行业 —— 目标岗位直接对应的行业
 *   2. 上游     —— 零部件 / 算法 / 材料 / 工具供应商
 *   3. 下游     —— 应用场景行业
 *   4. 交叉领域 —— 与其他技术 / 行业结合的领域
 *
 * 工作方式：
 *   generateDiscoveryPlan(profile) 从用户画像（专业 / 目标岗位 / 研究方向 /
 *   实习经历 / 能力 / 简历已有内容）派生每一层的关键词簇与搜索串，
 *   交由 Agent 用浏览器自动化 / Web Search 去发现真实公司并写入 search_targets。
 *
 * 换任何专业都跑同一套推导，关键词簇随画像不同而不同。
 */

// ============================================================
// 通用工具
// ============================================================

// 分词用的停用词 / 标点
const STOP_TOKENS = new Set([
  '的', '与', '及', '和', '或', '等', '以及', '并且', '相关', '方向', '专业',
  '本科', '硕士', '博士', '学历', '应届', '应届生', '毕业生', '届',
  '经验', '能力', '熟悉', '了解', '掌握', '具备', '具有', '优先',
  'strong', 'good', 'the', 'and', 'or', 'with'
]);

/**
 * 把一段文本切成有意义的关键词 token
 * 通用做法：按标点 / 空格切分，过滤停用词与过短 token
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  // 按中英文标点、斜杠、空格切分
  const parts = text.split(/[、，,；;。.\s/（）()\[\]【】「」""''`|·]+/).filter(Boolean);
  const tokens = [];
  for (const p of parts) {
    const clean = p.trim();
    if (!clean || clean.length < 2) continue;
    if (STOP_TOKENS.has(clean.toLowerCase())) continue;
    // 纯数字跳过
    if (/^\d+$/.test(clean)) continue;
    tokens.push(clean);
  }
  return tokens;
}

/**
 * 从多个画像字段汇总核心 token（去重）
 */
function extractProfileTokens(profile) {
  const sources = [
    profile.major || '',
    profile.research_direction || '',
    profile.internship_experience || '',
    ...(profile.target_roles || []),
    ...(profile.skills || []),
    ...(profile.keywords || [])
  ];
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    for (const t of tokenize(s)) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }
  return out;
}

/**
 * 从专业 / 研究方向中提取「领域词」（用于下游应用场景推断）
 * 启发式：取 major 与 research_direction 的首段 token 作为领域
 */
function extractDomainTokens(profile) {
  const domainSrc = [profile.major || '', profile.research_direction || '']
    .join(' ');
  return tokenize(domainSrc);
}

// ============================================================
// 四维度关键词簇生成
// ============================================================

/**
 * 第一层：本体行业
 * 目标岗位直接对应的行业。由 target_roles 派生行业关键词。
 * 策略：从岗位名提取核心名词 + 通用行业后缀，提示 Agent 用其发现公司。
 */
function buildCoreIndustry(profile) {
  const roles = profile.target_roles || [];
  const roleTokens = [];
  roles.forEach(r => roleTokens.push(...tokenize(r)));

  // 去重保序
  const seen = new Set();
  const keywords = [];
  for (const t of roleTokens) {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); keywords.push(t); }
  }

  return {
    name: '本体行业',
    hint: '目标岗位直接对应的行业。Agent 用这些关键词 + "{届}校招" 在招聘官网 / 搜索引擎发现对应公司。',
    keywords,
    search_queries: keywords.map(k => `${k} ${cohortTag(profile)}校招`)
  };
}

/**
 * 专业领域 → 上游供应链关键词映射表
 *
 * v3.8 修复：原先把每个 skill 简单拼接"供应商/芯片/平台"后缀，
 * 产生 "SolidWorks芯片"、"CATIA芯片" 这类无意义词。
 * 现在按专业大类预设真实的供应链关键词，覆盖主流工科专业。
 *
 * 设计原则：
 *   - 按"专业领域"匹配（不硬编码公司名），通过 major + skills + target_roles 关键词识别领域
 *   - 每个领域提供该行业真实的上游零部件/材料/工具供应商类别
 *   - 未命中任何领域时，回退到通用推导（但使用更合理的后缀）
 */
const DOMAIN_UPSTREAM_MAP = {
  // 机械类：核心零部件供应商
  '机械': ['减速器供应商', '电机供应商', '传感器供应商', '轴承制造商', '齿轮制造商', '液压元件', '气动元件', '模具制造商', '紧固件供应商'],
  // 电子/电气类
  '电子': ['芯片供应商', 'PCB制造商', '连接器供应商', '电容电阻供应商', '电源模块', '传感器供应商'],
  '电气': ['电机供应商', '变频器制造商', '电缆供应商', '继电器供应商', '电源供应商'],
  // 自动化/机器人
  '自动化': ['PLC供应商', '伺服电机供应商', '传感器供应商', '工业机器人制造商', '运动控制', '机器视觉'],
  '机器人': ['减速器供应商', '伺服电机供应商', '传感器供应商', '控制器', '机器视觉', 'SLAM'],
  // 计算机/软件
  '计算机': ['云服务商', '数据库', '芯片供应商', '服务器', '开发框架', '开源工具'],
  '软件': ['云服务商', '数据库', '开发框架', '中间件', '开源工具', 'API平台'],
  // 材料/化工
  '材料': ['原材料供应商', '化工原料', '金属材料', '高分子材料', '复合材料'],
  '化工': ['化工原料', '催化剂供应商', '管道阀门', '反应釜制造商'],
  // 汽车
  '汽车': ['汽车零部件', '动力系统', '底盘系统', '车身系统', '车载电子', '新能源电池'],
  // 医疗
  '医疗': ['医疗器械', '医药', '生物技术', '医疗信息化', '影像设备', '体外诊断'],
  // 金融
  '金融': ['金融科技', '支付平台', '风控系统', '数据服务商'],
  // 能源
  '能源': ['光伏', '风电', '储能', '电池', '电力设备', '新能源'],
  // 航空航天
  '航空': ['航空材料', '精密加工', '复合材料', '航电系统', '推进系统'],
  // 通信
  '通信': ['射频器件', '天线', '基站设备', '光模块', '通信芯片']
};

/**
 * 识别用户所属的专业领域
 * @param {Object} profile
 * @returns {string|null} 领域 key（如 '机械'）或 null
 */
function detectDomain(profile) {
  const text = [
    profile.major || '',
    profile.research_direction || '',
    ...(profile.skills || []),
    ...(profile.target_roles || []),
    ...(profile.keywords || [])
  ].join(' ').toLowerCase();

  // 按关键词匹配领域
  const domainKeywords = {
    '机械': ['机械', '机电', '制造', '结构', '模具', 'cad', 'solidworks', 'catia', 'ug', 'pro/e'],
    '电子': ['电子', '电路', 'pcb', '嵌入式', '单片机', 'fpga'],
    '电气': ['电气', '电力', '电机', '电网', '变电'],
    '自动化': ['自动化', '控制', 'plc', 'scada'],
    '机器人': ['机器人', 'robot', '机械臂', '运动控制'],
    '计算机': ['计算机', 'cs', '编程', '算法', '数据结构'],
    '软件': ['软件', '软件开发', '后端', '前端', '全栈', 'java', 'python', 'go'],
    '材料': ['材料', '金属', '高分子', '陶瓷', '复合材料'],
    '化工': ['化工', '化学', '催化', '反应'],
    '汽车': ['汽车', '车辆', '动力', '底盘', '车身'],
    '医疗': ['医疗', '医学', '医药', '临床', '生物医学'],
    '金融': ['金融', '经济', '会计', '银行', '证券'],
    '能源': ['能源', '光伏', '风电', '储能', '电池', '新能源'],
    '航空': ['航空', '航天', '飞行器', '推进'],
    '通信': ['通信', '射频', '无线', '5g', '6g']
  };

  for (const [domain, kws] of Object.entries(domainKeywords)) {
    for (const kw of kws) {
      if (text.includes(kw)) return domain;
    }
  }
  return null;
}

/**
 * 第二层：上游
 * 零部件 / 算法 / 材料 / 工具供应商。由 major + skills 派生。
 *
 * v3.8 修复：
 *   - 优先使用专业领域映射表（DOMAIN_UPSTREAM_MAP）生成真实的供应链关键词
 *   - 不再简单拼接 "skill + 芯片/平台" 产生无意义词（如 "SolidWorks芯片"）
 *   - 未命中领域时回退到通用推导，但使用更合理的后缀
 */
function buildUpstream(profile) {
  const domain = detectDomain(profile);
  const keywords = [];
  const seen = new Set();

  // 1. 优先使用专业领域映射表
  if (domain && DOMAIN_UPSTREAM_MAP[domain]) {
    for (const kw of DOMAIN_UPSTREAM_MAP[domain]) {
      if (!seen.has(kw)) { seen.add(kw); keywords.push(kw); }
    }
  }

  // 2. 补充：从 skills 中提取工具/软件名作为"工具供应商"提示
  //    但只加合理的后缀（供应商/制造商），不再加"芯片/平台"
  const skillTokens = (profile.skills || []).flatMap(s => tokenize(s));
  const majorTokens = tokenize(profile.major || '');
  const baseTokens = [...new Set([...majorTokens, ...skillTokens])].slice(0, 5);

  // 通用且合理的上游后缀（不再使用"芯片/平台/引擎/框架"这类软件类后缀给机械专业）
  const reasonableSuffixes = ['供应商', '制造商'];
  for (const t of baseTokens) {
    // 跳过明显是软件工具名的（CAD/SolidWorks 等），不给它们加"供应商"
    if (/^(cad|solidworks|catia|ug|pro\/e|ansys|matlab|python|java|c\+\+|linux|docker|kubernetes)$/i.test(t)) {
      if (!seen.has(t)) { seen.add(t); keywords.push(t); }
      continue;
    }
    for (const suf of reasonableSuffixes) {
      const combo = `${t}${suf}`;
      if (!seen.has(combo)) { seen.add(combo); keywords.push(combo); }
    }
  }

  // 3. 保留原始能力 token
  baseTokens.forEach(t => { if (!seen.has(t)) { seen.add(t); keywords.push(t); } });

  return {
    name: '上游',
    hint: domain
      ? `基于「${domain}」专业的真实供应链：零部件/材料/工具供应商。Agent 据此发现「造零部件/造工具」的公司。`
      : '零部件 / 材料 / 工具供应商。Agent 据此拓展「造工具/造平台」的公司。',
    keywords,
    search_queries: keywords.slice(0, 10).map(k => `${k} ${cohortTag(profile)}校招`)
  };
}

/**
 * 第三层：下游
 * 应用场景行业。由专业背景派生该专业落地的行业。
 * 策略：把领域 token + 通用「下游应用」后缀组合。
 */
function buildDownstream(profile) {
  const domain = extractDomainTokens(profile);
  const downstreamSuffixes = ['行业', '场景', '应用', '科技', '解决方案'];
  const keywords = [];
  const seen = new Set();
  for (const t of domain.slice(0, 5)) {
    for (const suf of downstreamSuffixes) {
      const combo = `${t}${suf}`;
      if (!seen.has(combo)) { seen.add(combo); keywords.push(combo); }
    }
  }
  domain.forEach(t => { if (!seen.has(t)) { seen.add(t); keywords.push(t); } });

  return {
    name: '下游',
    hint: '应用场景行业。Agent 据此发现「用得上该专业」的落地行业公司。',
    keywords,
    search_queries: keywords.slice(0, 8).map(k => `${k} ${cohortTag(profile)}校招`)
  };
}

/**
 * 第四层：交叉领域
 * 与其他技术 / 行业结合的领域。由「领域 × 目标岗位」组合派生。
 */
function buildCrossDomain(profile) {
  const domain = extractDomainTokens(profile).slice(0, 4);
  const roles = (profile.target_roles || []).flatMap(r => tokenize(r)).slice(0, 4);

  const keywords = [];
  const seen = new Set();
  // 领域 + 岗位 组合（如 医学 × AI → "AI+医疗"）
  for (const d of domain) {
    for (const r of roles) {
      const combo = `${r}+${d}`;
      const combo2 = `${d}+${r}`;
      if (!seen.has(combo)) { seen.add(combo); keywords.push(combo); }
      if (!seen.has(combo2)) { seen.add(combo2); keywords.push(combo2); }
    }
  }

  return {
    name: '交叉领域',
    hint: '与其他技术 / 行业结合的领域。Agent 据此发现跨界融合的公司。',
    keywords,
    search_queries: keywords.slice(0, 6).map(k => `${k} ${cohortTag(profile)}校招`)
  };
}

// ============================================================
// 辅助
// ============================================================

/**
 * v3.9: 过滤低质量搜索 Query
 *
 * 问题：下游和交叉领域的 Query 是角色名与画像 token 的笛卡尔积拼接，
 *   如 "机械工程师+机械工程 2027届校招" / "机械工程行业 2027届校招"，
 *   这些不是自然搜索词，搜索引擎不会返回有用结果。
 *
 * 过滤规则：
 *   1. 含 "+" 的 Query 全部丢掉（笛卡尔积产物）
 *   2. 含泛词后缀（行业 / 场景 / 应用 / 科技 / 解决方案）的 Query 丢掉
 *   3. 过滤后某层 Query 清零则该层 search_queries 为空（可接受）
 *
 * @param {string[]} queries - 搜索 Query 字符串数组
 * @returns {string[]} 过滤后的 Query
 */
function filterLowQualityQueries(queries) {
  // 泛词黑名单：这些词作为后缀拼接时产生的 Query 无搜索价值
  const GENERIC_TERMS = ['行业', '场景', '应用', '科技', '解决方案'];

  return queries.filter(q => {
    if (!q) return false;
    // 规则 1：含 "+" 的全部丢掉（笛卡尔积产物）
    if (q.includes('+')) return false;
    // 规则 2：含泛词后缀的丢掉
    for (const term of GENERIC_TERMS) {
      if (q.includes(term)) return false;
    }
    return true;
  });
}

function cohortTag(profile) {
  const y = parseInt(profile.graduation_year);
  return y ? `${y}届` : '';
}

function jobTypeLabel(profile) {
  const jt = profile.job_type || 'full-time';
  if (jt === 'internship') return '实习';
  return '全职校招';
}

// ============================================================
// 主入口：生成发现计划
// ============================================================

/**
 * 基于用户画像生成四维度公司发现计划
 * @param {Object} profile - 用户画像（config/user_profile.json）
 * @returns {Object} 发现计划
 */
function generateDiscoveryPlan(profile = {}) {
  const cohort = cohortTag(profile);
  const jobType = jobTypeLabel(profile);
  const profileTokens = extractProfileTokens(profile);
  const includeInternship = profile.job_type === 'internship';

  const layers = {
    core: buildCoreIndustry(profile),
    upstream: buildUpstream(profile),
    downstream: buildDownstream(profile),
    cross: buildCrossDomain(profile)
  };

  // v3.9: 过滤低质量搜索 Query（去笛卡尔积 + 去泛词后缀）
  // 只保留看起来像真实搜索词的 Query，过滤后某层清零则该层 search_queries 为空
  for (const key of Object.keys(layers)) {
    layers[key].search_queries = filterLowQualityQueries(layers[key].search_queries || []);
  }

  // 汇总所有搜索串（过滤后）
  const allQueries = [];
  Object.values(layers).forEach(l => {
    (l.search_queries || []).forEach(q => allQueries.push({ layer: l.name, query: q }));
  });

  return {
    cohort,                         // "2027届"
    job_type: jobType,              // "全职校招"
    include_internship: includeInternship,
    target_cities: profile.target_cities || [],
    profile_tokens: profileTokens,  // 从画像提取的核心 token，供 Agent 参考
    layers,
    search_queries: allQueries,
    agent_instruction:
      `请按「本体行业 → 上游 → 下游 → 交叉领域」四层逐层发现公司。` +
      `对每一层：用该层 search_queries 中的关键词，结合 "${cohort}校招" 与城市偏好，` +
      `通过 WebSearch / 浏览器访问公司校招官网，确认该公司确有面向 ${cohort} 的${jobType}岗位且正在开放，` +
      `然后把 { company, keywords, campus_url } 追加到 config/user_profile.json 的 search_targets。` +
      (includeInternship ? '' : `只收全职校招，排除实习岗位。`) +
      `发现后请逐家进入校招官网复核 ${cohort} 申请入口确实开放（而非仅有职业发展页面）。`
  };
}

// ============================================================
// 渐进式发现策略（v4.0）
// ============================================================

/**
 * v4.0: 渐进式岗位发现 — 解决新用户只推荐~10个岗位 vs 全量搜索太慢的矛盾
 *
 * 三层渐进策略：
 *   Tier 1（精准匹配，< 1秒）：从外部公司库匹配用户画像，直接返回匹配的公司列表
 *     - 匹配规则：公司岗位类别 × 用户目标岗位 + 城市偏好加权
 *     - 输出：15-20 家最匹配的公司，Agent 直接去这些公司搜岗位
 *   Tier 2（扩展发现，Agent 搜索）：基于画像派生的关键词，搜索额外 15-20 家公司
 *     - 使用现有的四维度发现计划（但限制搜索公司数量）
 *   Tier 3（全量兜底，深度搜索）：搜索外部公司库中剩余的所有公司
 *     - 输出：剩余公司列表，Agent 分批搜索（每批 10-15 家）
 *
 * 使用方式：
 *   1. Agent 先执行 Tier 1 → 快速获取 15-20 个岗位展示给用户
 *   2. 用户觉得不够，执行 Tier 2 → 再获取 15-20 个
 *   3. 还不够，执行 Tier 3 → 全量搜索
 *
 * @param {Object} profile - 用户画像
 * @param {Array} externalCompanies - 外部公司库数据（external_companies.csv 解析结果）
 * @returns {Object} { tier1, tier2, tier3, summary }
 */
function generateProgressivePlan(profile = {}, externalCompanies = []) {
  const cohort = cohortTag(profile);
  const jobType = jobTypeLabel(profile);
  const targetRoles = (profile.target_roles || []).map(r => r.toLowerCase());
  const targetCities = (profile.target_cities || []).map(c => c.replace(/^[\u4e00-\u9fa5]+·/, '').trim());
  const profileTokens = extractProfileTokens(profile).map(t => t.toLowerCase());
  const hasProfile = targetRoles.length > 0 || profileTokens.length > 0;

  // v4.1: 冷启动 — 画像为空时，用通用热门岗位关键词做匹配
  // 覆盖 9 大专业大类（计算机/机械/医学/金融/土木/化工/设计/运营/其他）
  const DEFAULT_COLD_START_ROLES = [
    '产品经理', '产品运营', '数据分析', 'AI产品', '管培生',
    '软件开发', '算法工程师', '测试开发', '前端开发', '后端开发',
    '机械工程师', '电气工程师', '结构工程师', '工艺工程师',
    '新媒体运营', '内容运营', '用户运营', '电商运营',
    'UI设计', 'UX设计', '平面设计', '视觉设计',
    '金融分析师', '投资分析', '风险控制', '量化',
    '化工工程师', '材料工程师', '土木工程师', '建筑设计师'
  ];
  const effectiveRoles = hasProfile ? targetRoles : DEFAULT_COLD_START_ROLES;
  const effectiveTokens = hasProfile ? profileTokens : DEFAULT_COLD_START_ROLES.map(r => r.toLowerCase());

  // ===== Tier 1: 外部公司库精准匹配 =====
  const tier1Companies = [];
  const tier1Seen = new Set();

  if (externalCompanies.length > 0) {
    // 对每家公司打分：岗位类别匹配 + 城市匹配 + 关键词匹配
    // v4.1: 使用 effectiveRoles/effectiveTokens 支持冷启动
    const scored = externalCompanies.map(company => {
      let score = 0;
      const reasons = [];

      // 岗位类别匹配（权重最高）
      const jobCategories = (company.job_categories || '').toLowerCase();
      for (const role of effectiveRoles) {
        const roleTokens = tokenize(role);
        for (const rt of roleTokens) {
          if (jobCategories.includes(rt) && rt.length >= 2) {
            score += 10;
            reasons.push(`岗位含「${rt}」`);
            break;
          }
        }
      }

      // 城市匹配
      const companyCities = (company.cities || '').toLowerCase();
      for (const city of targetCities) {
        if (companyCities.includes(city.toLowerCase()) && city.length >= 2) {
          score += 5;
          reasons.push(`base含「${city}」`);
        }
      }

      // 关键词匹配（公司名/岗位类别含用户画像 token）
      const companyText = `${company.company_name} ${company.job_categories} ${company.enterprise_type}`.toLowerCase();
      for (const token of effectiveTokens) {
        if (token.length >= 2 && companyText.includes(token)) {
          score += 2;
        }
      }

      return { ...company, score, reasons };
    });

    // 排序取 Top 20
    scored.sort((a, b) => b.score - a.score);
    const tier1Top = scored.filter(c => c.score > 0).slice(0, 20);

    for (const c of tier1Top) {
      if (!tier1Seen.has(c.company_name)) {
        tier1Seen.add(c.company_name);
        tier1Companies.push({
          company: c.company_name,
          enterprise_type: c.enterprise_type || '',
          cities: c.cities || '',
          job_categories: c.job_categories || '',
          career_url: c.career_url || '',
          score: c.score,
          match_reasons: c.reasons
        });
      }
    }
  }

  // ===== Tier 2: 画像驱动的关键词搜索 =====
  const discoveryPlan = generateDiscoveryPlan(profile);
  const tier2Queries = (discoveryPlan.search_queries || [])
    .filter(q => q.query && q.query.length > 0)
    .slice(0, 15); // 限制搜索串数量，避免过度搜索

  // ===== Tier 3: 外部公司库全量兜底 =====
  const tier3Companies = [];
  if (externalCompanies.length > 0) {
    for (const c of externalCompanies) {
      if (!tier1Seen.has(c.company_name) && c.company_name) {
        tier3Companies.push({
          company: c.company_name,
          enterprise_type: c.enterprise_type || '',
          cities: c.cities || '',
          job_categories: c.job_categories || '',
          career_url: c.career_url || ''
        });
      }
    }
  }

  const totalExternal = externalCompanies.length;
  const tier1Count = tier1Companies.length;
  const tier3Count = tier3Companies.length;

  return {
    cohort,
    job_type: jobType,
    target_cities: profile.target_cities || [],
    target_roles: profile.target_roles || [],
    profile_tokens: profileTokens,
    // v4.1: 冷启动标记
    cold_start: !hasProfile,

    // Tier 1: 精准匹配（即时有结果，不需要网络搜索）
    tier1: {
      name: hasProfile ? '精准匹配' : '通用推荐（冷启动）',
      description: hasProfile
        ? `从 ${totalExternal} 家外部公司库中匹配出 ${tier1Count} 家最相关的公司`
        : `画像未配置，使用 ${DEFAULT_COLD_START_ROLES.length} 个通用热门岗位关键词匹配出 ${tier1Count} 家公司`,
      companies: tier1Companies,
      instruction: tier1Companies.length > 0
        ? `请依次访问以下 ${tier1Count} 家公司的校招官网，搜索 ${cohort}${jobType}岗位：\n` +
          tier1Companies.map((c, i) =>
            `${i + 1}. ${c.company}（${c.enterprise_type}）— ${c.cities || '地点待定'} — ${c.job_categories || '岗位待查'} — ${c.career_url || '需搜索官网'} — 匹配原因：${c.match_reasons.join('/')}`
          ).join('\n') +
          `\n\n每家公司搜索到岗位后，通过 /api/import-jobs 批量导入到看板。` +
          (!hasProfile ? '\n\n💡 建议先完善用户画像（target_roles / keywords），以获得更精准的岗位推荐。' : '')
        : '外部公司库为空或未配置，请先同步飞书数据或使用 Tier 2。'
    },

    // Tier 2: 扩展发现
    tier2: {
      name: '扩展发现',
      description: hasProfile
        ? `基于「${targetRoles.join('、')}」生成 ${tier2Queries.length} 个搜索方向`
        : `画像未配置，使用通用发现策略生成 ${tier2Queries.length} 个搜索方向`,
      queries: tier2Queries,
      instruction: tier2Queries.length > 0
        ? `Tier 1 完成后若岗位不足，请用以下搜索词逐条搜索，每条约发现 3-5 家新公司：\n` +
          tier2Queries.map(q => `- ${q.query}（${q.layer}）`).join('\n')
        : '当前画像无法生成有效搜索词，建议完善 target_roles 和 keywords。'
    },

    // Tier 3: 全量兜底
    tier3: {
      name: '全量兜底',
      description: `外部公司库剩余 ${tier3Count} 家公司（排除 Tier 1 已匹配的）`,
      companies: tier3Companies,
      instruction: tier3Companies.length > 0
        ? `Tier 2 完成后若岗位仍不足，请分批搜索剩余 ${tier3Count} 家公司（每批 10-15 家）：\n` +
          `第 1 批：${tier3Companies.slice(0, 10).map(c => c.company).join('、')}\n` +
          (tier3Companies.length > 10 ? `... 剩余 ${tier3Companies.length - 10} 家请分批继续` : '')
        : '无剩余公司。'
    },

    // 汇总
    summary: {
      total_external_companies: totalExternal,
      tier1_matched: tier1Count,
      tier2_queries: tier2Queries.length,
      tier3_remaining: tier3Count,
      estimated_fast_jobs: tier1Count * 3,
      estimated_full_jobs: (tier1Count + tier3Count) * 2,
      cold_start: !hasProfile,
      recommendation: !hasProfile
        ? `冷启动模式：画像未配置，已用 ${DEFAULT_COLD_START_ROLES.length} 个通用热门岗位匹配。建议先完善用户画像（target_roles / keywords）以获得精准推荐。`
        : tier1Count >= 10
          ? 'Tier 1 已足够，直接执行 Tier 1 即可获得 30-60 个岗位。'
          : tier1Count >= 5
            ? 'Tier 1 偏少，建议执行 Tier 1 + Tier 2。'
            : '外部公司库匹配度较低，建议先完善用户画像中的 target_roles 和 keywords，再执行 Tier 1+Tier 2。'
    }
  };
}

module.exports = {
  tokenize,
  extractProfileTokens,
  extractDomainTokens,
  buildCoreIndustry,
  buildUpstream,
  buildDownstream,
  buildCrossDomain,
  filterLowQualityQueries,
  generateDiscoveryPlan,
  generateProgressivePlan
};
