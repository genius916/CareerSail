/**
 * Moka 招聘系统适配器（通用版）
 *
 * 通用性：任何使用 Moka（*.mokahr.com / app.mokahr.com）的公司都跑这一份代码。
 * 新公司只需在 COMPANY_RECRUITER_MAP 注册 { company → type:'moka', companyDomain, companyName, positionType }。
 *
 * 已知使用 Moka 的公司（举例，非硬编码）：
 * - 搜狐畅游 (app.mokahr.com/campus_apply/cyou-inc)
 * - 美团 (zhaopin.meituan.com)
 * - 部分中小公司
 *
 * Moka 招聘官网内部 API（通用模式）：
 * - GET /api/position/list
 *   参数: { page_no, page_size, keyword, position_type, employment_type }
 *   返回: { code: 0, data: { totalCount, positionList: [...] } }
 *
 *   position_type 取值（不同公司可能不同）：
 *     - 1: 社招
 *     - 2: 校招
 *   employment_type 取值：
 *     - 1: 全职
 *     - 2: 实习
 *
 * 详情页 URL 格式：https://{domain}/campus_apply/{company}/position/{id}
 *
 * v3.4 实现策略：
 *   - 优先走内部 API，分页拿全量
 *   - 若 API 失败，降级返回校招官网链接，标"待 Agent 浏览器验证"
 *   - positionType 由调用方传入（不同公司校招 position_type 不同）
 */

const BaseRecruiter = require('./base');

class MokaRecruiter extends BaseRecruiter {
  constructor(options = {}) {
    super({
      name: 'Moka',
      baseUrl: `https://${options.companyDomain}`,
      ...options
    });
    this.companyDomain = options.companyDomain;
    this.companyName = options.companyName || '';
    // Moka 招聘 URL 中的公司标识（如 cyou-inc）
    this.companySlug = options.companySlug || '';
    // 校招 position_type（不同公司可能不同，默认 2）
    this.positionType = options.positionType || '2';
    // API 端点（默认通用路径，部分公司可能不同）
    this.apiEndpoint = options.apiEndpoint || `https://${options.companyDomain}/api/position/list`;
  }

  buildJobUrl(job) {
    const id = typeof job === 'string' ? job : (job.id || job.position_id);
    if (this.companySlug) {
      return `https://${this.companyDomain}/campus_apply/${this.companySlug}/position/${id}`;
    }
    return `https://${this.companyDomain}/position/${id}`;
  }

  async fetchJobs(params = {}) {
    const {
      keyword = '',
      graduationYear = '',
      pageSize = 20,
      maxPages = 10
    } = params;

    // v4.3 修复：不再把"XX届"拼进搜索关键词（官网全文搜索几乎无命中），届别交给后置过滤
    const effectiveKeyword = keyword;

    const allJobs = [];
    let pageNo = 1; // Moka API 从 1 开始

    while (pageNo <= maxPages) {
      try {
        const qs = new URLSearchParams({
          page_no: String(pageNo),
          page_size: String(pageSize),
          position_type: this.positionType,
          employment_type: '1', // 全职校招
          keyword: effectiveKeyword
        }).toString();

        const result = await this._callApi(`${this.apiEndpoint}?${qs}`);

        // Moka API 失败时降级
        if (!result || (result.code && result.code !== 0)) {
          console.warn(`[Moka] ${this.companyDomain} API 调用失败，降级为 Agent 验证模式`);
          return this._fallbackToAgent(effectiveKeyword);
        }

        const data = result.data || {};
        const positionList = data.positionList || data.list || [];
        const normalized = positionList.map(j => this.normalizeJob(j));
        allJobs.push(...normalized);

        if (allJobs.length >= (data.totalCount || 0) || positionList.length < pageSize) {
          break;
        }

        pageNo++;
        await this._sleep(800);
      } catch (e) {
        console.warn(`[Moka] ${this.companyDomain} 第${pageNo}页请求失败，降级为 Agent 验证模式:`, e.message);
        return this._fallbackToAgent(effectiveKeyword);
      }
    }

    return allJobs;
  }

  /**
   * 降级：API 不可用时，返回校招官网链接 + Agent 手动验证提示
   */
  _fallbackToAgent(keyword) {
    const url = this.companySlug
      ? `https://${this.companyDomain}/campus_apply/${this.companySlug}`
      : `https://${this.companyDomain}/`;
    return [{
      id: '',
      title: `${this.companyName} 校园招聘${keyword ? `（关键词：${keyword}）` : ''}`,
      company: this.companyName,
      city: '',
      department: '',
      category: '',
      publishDate: '',
      url,
      description: '',
      requirement: '',
      source: `${this.companyName}校招官网（Moka，待Agent浏览器验证）`,
      level: '校招',
      note: 'Moka API 可能需要 cookie 鉴权，请 Agent 用 Playwright 打开官网 → F12 看 XHR → 找到 position_type 与 cookie，反填到 COMPANY_RECRUITER_MAP'
    }];
  }

  normalizeJob(rawJob) {
    const id = rawJob.id || rawJob.position_id || '';
    const title = rawJob.title || rawJob.position_name || '';
    const city = rawJob.city || (rawJob.city_list || []).join(', ') || '';
    const publishDate = rawJob.create_time
      ? new Date(rawJob.create_time * 1000).toISOString().split('T')[0]
      : (rawJob.publish_date || '');

    const job = super.normalizeJob(rawJob);
    return {
      ...job,
      id,
      title,
      company: this.companyName,
      city,
      department: rawJob.department || rawJob.dept_name || '',
      category: rawJob.category || rawJob.position_type_name || '',
      publishDate,
      url: this.buildJobUrl(id),
      description: rawJob.description || rawJob.position_desc || '',
      requirement: rawJob.requirement || rawJob.position_require || '',
      source: `${this.companyName}校招官网（已验证）`
    };
  }

  async _callApi(url) {
    const https = require('https');
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Referer': `https://${this.companyDomain}/`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON解析失败: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = MokaRecruiter;
