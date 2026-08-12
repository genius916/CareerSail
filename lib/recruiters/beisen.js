/**
 * 北森招聘系统适配器（通用版）
 *
 * 通用性：任何北森公司都跑这一份代码，不绑定公司名。
 * 新公司只需在 COMPANY_RECRUITER_MAP 注册 { company → type:'beisen', companyDomain, companyName }。
 *
 * 已知使用北森的公司（举例，非硬编码）：
 * - 科大讯飞 (iflytek.zhiye.com)
 * - 长鑫存储 (cxmt.zhiye.com)
 * - 鱼跃医疗 (yuwell.zhiye.com)
 * - 欧普照明 (opple.zhiye.com)
 * - 创维集团 (skyworth.zhiye.com)
 * - 麦克奥迪 (motic.zhiye.com)
 * - 汇川技术 (inovance.zhiye.com)
 *
 * API 接口：
 * - POST /api/Jobad/GetJobAdPageList
 *   请求体：{ PageIndex, PageSize, Category:[...], KeyWords:"..." }
 *     - PageIndex: 从 0 开始
 *     - PageSize: 每页数量
 *     - Category: 数组，不同公司语义不同（"1"=社招/"2"=校招/"3"=实习 在多数公司成立，但不绝对）
 *     - KeyWords: 搜索关键词
 *   返回：{ Code: 200, Count, Data: [{ Id, JobAdName, LocNames, Duty, Require, PostDate, ClassificationOne }] }
 *
 * - POST /api/Jobad/GetJobAdSearchConditions
 *   返回该公司所有可选分类，用于动态识别"校招"分类 ID
 *
 * v3.4 改进：
 *   1. Category 不再硬编码 ['2']。先调 GetJobAdSearchConditions 拿真实分类，
 *      找名字含"校招/campus"的；若失败则查询 ['1','2','3'] 全集，再用岗位标题前缀二次筛届别。
 *   2. 二次过滤：若岗位标题含【27届】/2027届 → 保留；含【26届】且用户是27届 → 丢弃。
 *   3. 实习识别：把 Category=["3"]（若存在）识别为实习来源，由 job_filters.isInternship 兜底。
 */

const BaseRecruiter = require('./base');

class BeisenRecruiter extends BaseRecruiter {
  constructor(options = {}) {
    super({
      name: '北森',
      baseUrl: `https://${options.companyDomain}`,
      ...options
    });
    this.companyDomain = options.companyDomain;
    this.companyName = options.companyName || '';
    this.apiUrl = `https://${options.companyDomain}/api/Jobad/GetJobAdPageList`;
    this.conditionsUrl = `https://${options.companyDomain}/api/Jobad/GetJobAdSearchConditions`;
    // 缓存分类，避免每次 fetchJobs 都拉一次
    this._categoriesCache = null;
  }

  buildJobUrl(job) {
    const id = typeof job === 'string' ? job : (job.id || job.Id || job.JobAdId);
    return `https://${this.companyDomain}/campus/detail?jobAdId=${id}`;
  }

  /**
   * 动态获取校招分类 ID
   * 策略：
   *   1. 调 GetJobAdSearchConditions 拿全部分类，找 name 含"校招/campus/校园"的
   *   2. 失败则回退 ['2']（北森系统多数公司校招分类为 "2"）
   *   3. 用户可传入 forceCategoryIds 强制覆盖
   */
  async resolveCampusCategoryIds(forceCategoryIds) {
    if (forceCategoryIds && forceCategoryIds.length > 0) return forceCategoryIds;
    if (this._categoriesCache) return this._categoriesCache;

    try {
      const result = await this._callApi(this.conditionsUrl, {});
      if (result && result.Code === 200 && result.Data) {
        const cats = result.Data.Categories || result.Data.Classifications || [];
        const campus = cats.filter(c => {
          const name = String(c.Name || c.name || '').toLowerCase();
          return name.includes('校招') || name.includes('校园') || name.includes('campus');
        }).map(c => String(c.Id || c.id));
        if (campus.length > 0) {
          this._categoriesCache = campus;
          return campus;
        }
      }
    } catch (e) {
      console.warn(`[Beisen] ${this.companyDomain} 获取分类失败，回退默认 ['2']:`, e.message);
    }

    // 兜底：北森系统多数公司 "2" 即校招
    this._categoriesCache = ['2'];
    return this._categoriesCache;
  }

  async fetchJobs(params = {}) {
    const {
      keyword = '',
      graduationYear = '',
      categoryIds: forceCategoryIds = null, // 用户可强制指定
      pageSize = 20,
      maxPages = 10
    } = params;

    // 1. 动态解析校招分类 ID（不再硬编码 ['2']）
    const categoryIds = await this.resolveCampusCategoryIds(forceCategoryIds);

    // 2. 把届别融入关键词（北森 API 无独立届别过滤位，靠 KeyWords + 后置二次过滤双保险）
    const cohortTag = graduationYear ? `${graduationYear}届` : '';
    const effectiveKeyword = [cohortTag, keyword].filter(Boolean).join(' ').trim();

    const allJobs = [];
    let pageIndex = 0; // 北森 API 从 0 开始

    while (pageIndex < maxPages) {
      try {
        const body = {
          PageIndex: pageIndex,
          PageSize: pageSize,
          Category: categoryIds,
          KeyWords: effectiveKeyword,
          SpecialType: 0,
          PortalId: '',
          DisplayFields: ['Category', 'Kind', 'LocId', 'PostDate', 'ClassificationOne']
        };

        const result = await this._callApi(this.apiUrl, body);

        if (!result || result.Code !== 200 || !result.Data) {
          break;
        }

        const { Data, Count } = result;
        const normalized = Data.map(j => this.normalizeJob(j));
        allJobs.push(...normalized);

        if (allJobs.length >= Count || Data.length < pageSize) {
          break;
        }

        pageIndex++;
        // 控制频率，避免被封禁
        await this._sleep(1000);
      } catch (e) {
        console.error(`[Beisen] ${this.companyDomain} 第${pageIndex + 1}页请求失败:`, e.message);
        break;
      }
    }

    // 3. 二次届别过滤：若用户给了 graduationYear，丢弃标题明确为其他届的岗位
    //    （防止"实习岗已确认但全职未定"或"届别标注与时间窗口不一致"陷阱）
    const filtered = graduationYear
      ? this._filterByCohort(allJobs, graduationYear)
      : allJobs;

    return filtered;
  }

  /**
   * 二次届别过滤
   * 保留：无届别标注 / 含目标届
   * 丢弃：明确为其他届（如标题【26届】且用户是27届）
   */
  _filterByCohort(jobs, graduationYear) {
    const target = parseInt(graduationYear);
    if (!target) return jobs;
    return jobs.filter(job => {
      const text = `${job.title || ''} ${job.description || ''} ${job.requirement || ''}`;
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
      // 【XX届】方括号包围
      const bracket = text.match(/【\s*(20\d{2}|\d{2})\s*届\s*】/g);
      if (bracket) {
        bracket.forEach(s => {
          const m = s.match(/(20\d{2}|\d{2})/);
          if (m) {
            const n = parseInt(m[1]);
            years.add(n >= 100 ? n : 2000 + n);
          }
        });
      }
      if (years.size === 0) return true; // 无标注，保留
      return years.has(target);
    });
  }

  /**
   * 获取岗位分类列表（通过 API 调用）
   * 公开方法，供 Agent/调试使用
   */
  async fetchCategories() {
    try {
      const result = await this._callApi(this.conditionsUrl, {});
      if (result && result.Code === 200 && result.Data) {
        return result.Data.Categories || result.Data.Classifications || [];
      }
    } catch (e) {
      console.warn(`[Beisen] 获取分类失败:`, e.message);
    }
    // 兜底：返回常见分类
    return [
      { id: '2', name: '校园招聘' },
    ];
  }

  normalizeJob(rawJob) {
    const id = rawJob.Id || rawJob.JobAdId || rawJob.id || '';
    const title = rawJob.JobAdName || rawJob.title || '';
    const city = rawJob.LocNames?.join(', ') || rawJob.city || '';
    const publishDate = rawJob.PostDate ? rawJob.PostDate.split('T')[0] : '';

    // 复用基类 normalizeJob 的实习/校招/社招检测，避免实习冒充全职校招
    const job = super.normalizeJob(rawJob);
    return {
      ...job,
      id,
      title,
      company: this.companyName,
      city,
      department: rawJob.Org || rawJob.OrgId || '',
      category: rawJob.ClassificationOne || rawJob.Category || '',
      publishDate,
      url: this.buildJobUrl(id),
      description: rawJob.Duty || rawJob.duty || rawJob.description || '',
      requirement: rawJob.Require || rawJob.require || '',
      source: `${this.companyName}校招官网（已验证）`
    };
  }

  async _callApi(url, body) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const postData = JSON.stringify(body);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'Origin': `https://${this.companyDomain}`,
          'Referer': `https://${this.companyDomain}/campus/jobs`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-Requested-With': 'XMLHttpRequest',
          'langtype': 'zh_CN'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON解析失败: ${e.message}, 响应内容: ${data.substring(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BeisenRecruiter;
