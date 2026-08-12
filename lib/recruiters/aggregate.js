/**
 * 聚合源适配器（发现层专用）
 *
 * 通用性：聚合源不是某家公司的招聘系统，而是聚合多公司校招信息的平台。
 * 用于「公司发现」阶段——帮用户从聚合源发现更多公司，再回到具体公司校招官网验证。
 *
 * 支持的聚合源（举例，非硬编码）：
 * - 牛客网校招日历 (nowcoder.com)
 * - 高校就业网（各高校）
 * - 海投网 (haitou.cc)
 * - 应届生求职网 (yingjiesheng.com)
 * - 实习僧 (shixiseng.com) — 仅当用户 job_type=internship 时启用
 *
 * 工作方式：
 *   - 不直接抓取岗位，而是返回聚合源链接 + 关键词组合
 *   - Agent 用 Playwright 打开聚合源页面，按毕业届别过滤
 *   - 发现新公司后，注册到 user_profile.search_targets
 *
 * v3.4 实现策略：
 *   - 不做 API 调用，只返回各聚合源的搜索 URL 模板
 *   - Agent 根据模板拼接关键词 + 届别 + 城市，浏览器打开后人工/AI 识别公司
 *   - 这一层的输出是「公司列表」，不是「岗位列表」
 */

const BaseRecruiter = require('./base');

// 聚合源 URL 模板（{kw}=关键词，{cohort}=届别，{city}=城市）
const AGG_SOURCES = [
  {
    name: '牛客网校招日历',
    baseUrl: 'https://www.nowcoder.com',
    searchTemplate: 'https://www.nowcoder.com/school/schedule?kw={kw}&year={cohortYear}',
    note: '牛客校招日历，按公司列校招开启时间，可结合届别过滤'
  },
  {
    name: '海投网',
    baseUrl: 'https://www.haitou.cc',
    searchTemplate: 'https://www.haitou.cc/shixi/search?kw={kw}&city={city}',
    note: '海投网校招/实习聚合，按城市+关键词筛选'
  },
  {
    name: '应届生求职网',
    baseUrl: 'https://www.yingjiesheng.com',
    searchTemplate: 'https://s.yingjiesheng.com/search.php?kw={kw}&city={city}',
    note: '应届生求职网，校招信息聚合'
  },
  {
    name: '牛客讨论区',
    baseUrl: 'https://www.nowcoder.com',
    searchTemplate: 'https://www.nowcoder.com/search?type=post&query={kw}+{cohort}',
    note: '牛客讨论区，按关键词+届别搜面经，从面经反推公司'
  }
];

class AggregateRecruiter extends BaseRecruiter {
  constructor(options = {}) {
    super({
      name: '聚合源',
      baseUrl: '',
      ...options
    });
    this.companyName = '聚合源';
  }

  /**
   * 聚合源不直接返回岗位，而是返回各源的搜索链接
   * Agent 拿到链接后用浏览器打开，识别公司列表
   */
  async fetchJobs(params = {}) {
    const {
      keyword = '',
      graduationYear = '',
      city = ''
    } = params;

    const cohortTag = graduationYear ? `${graduationYear}届` : '';
    const cohortYear = graduationYear || '';
    const kw = encodeURIComponent(keyword || '');
    const cityEnc = encodeURIComponent(city || '');

    // 返回各聚合源的搜索 URL
    return AGG_SOURCES.map(src => {
      const url = src.searchTemplate
        .replace('{kw}', kw)
        .replace('{cohort}', encodeURIComponent(cohortTag))
        .replace('{cohortYear}', cohortYear)
        .replace('{city}', cityEnc);

      return {
        id: '',
        title: `${src.name} — 关键词：${keyword || '全部'}${cohortTag ? ` / ${cohortTag}` : ''}${city ? ` / ${city}` : ''}`,
        company: '聚合源',
        city: city || '',
        department: '',
        category: 'company-discovery',
        publishDate: '',
        url,
        description: src.note,
        requirement: '',
        source: src.name,
        level: '校招',
        note: `公司发现层专用：打开此链接 → 识别公司 → 注册到 user_profile.search_targets → 走具体公司校招官网适配器`
      };
    });
  }

  buildJobUrl(job) {
    return job.url || '';
  }

  normalizeJob(rawJob) {
    return rawJob; // 聚合源返回的已是标准格式
  }
}

// 导出聚合源列表，供 Agent/前端展示
AggregateRecruiter.SOURCES = AGG_SOURCES;

module.exports = AggregateRecruiter;
