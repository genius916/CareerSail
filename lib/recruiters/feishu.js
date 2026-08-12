/**
 * 飞书招聘系统适配器（通用版）
 *
 * 通用性：任何使用飞书招聘（jobs.feishu.cn / *.feishu.cn / *.larkoffice.com）的公司都跑这一份代码。
 * 新公司只需在 COMPANY_RECRUITER_MAP 注册 { company → type:'feishu', companyDomain, companyName, token }。
 *
 * 已知使用飞书招聘的公司（举例，非硬编码）：
 * - 字节跳动 (jobs.bytedance.com)
 * - 小米 (xiaomi.jobs.feishu.cn)
 * - 滴滴 (didialift.jobs.feishu.cn)
 * - MiniMax (vrfi1sk8a0.jobs.feishu.cn)
 * - 智元机器人 (agirobot.jobs.feishu.cn)
 *
 * 飞书招聘官网内部 API（通用模式）：
 * - POST /api/v1/search/job/list
 *   请求体: { keyword, page_size, page_token, job_category, employment_type }
 *   返回: { code:0, data: { job_list: [...], page_token, has_more } }
 *
 *   employment_type 取值（通用枚举）：
 *     - 1: 全职
 *     - 2: 实习
 *     - 3: 校招（部分公司合并到 1）
 *
 * 详情页 URL 格式：https://{domain}/position/{id}/detail
 *
 * v3.4 实现策略：
 *   - 优先走内部 API（直接 HTTP POST），分页拿全量
 *   - 若 API 失败（403/404/CORS），降级返回校招官网链接，标"待 Agent 浏览器验证"
 *   - Agent 用 Playwright 打开官网 → F12 看 XHR → 找到具体 API → 反填到 token/endpoint
 *
 * 注意：飞书招聘多数情况下 API 需要网站 token，token 在 URL 中（如 ?token=xxx）或 Cookie 中。
 *      本适配器提供 token 入参，由调用方传入。无 token 时降级为 Agent 验证模式。
 */

const BaseRecruiter = require('./base');

class FeishuRecruiter extends BaseRecruiter {
  constructor(options = {}) {
    super({
      name: '飞书招聘',
      baseUrl: `https://${options.companyDomain}`,
      ...options
    });
    this.companyDomain = options.companyDomain;
    this.companyName = options.companyName || '';
    // 飞书招聘部分公司有 token（在 URL ?token=xxx 中），用于 API 鉴权
    this.token = options.token || '';
    // API 端点（默认通用路径，部分公司可能不同，由调用方覆盖）
    this.apiEndpoint = options.apiEndpoint || `https://${options.companyDomain}/api/v1/search/job/list`;
  }

  buildJobUrl(job) {
    const id = typeof job === 'string' ? job : (job.id || job.job_id || job.position_id);
    return `https://${this.companyDomain}/position/${id}/detail${this.token ? `?token=${this.token}` : ''}`;
  }

  async fetchJobs(params = {}) {
    const {
      keyword = '',
      graduationYear = '',
      pageSize = 20,
      maxPages = 10
    } = params;

    // 把届别融入关键词
    const cohortTag = graduationYear ? `${graduationYear}届` : '';
    const effectiveKeyword = [cohortTag, keyword].filter(Boolean).join(' ').trim();

    const allJobs = [];
    let pageToken = '';
    let pageCount = 0;

    while (pageCount < maxPages) {
      try {
        const body = {
          keyword: effectiveKeyword,
          page_size: pageSize,
          page_token: pageToken,
          employment_type: 1 // 默认全职校招（飞书 employment_type=1）
        };
        if (this.token) body.token = this.token;

        const result = await this._callApi(this.apiEndpoint, body);

        // 飞书 API 失败时降级
        if (!result || (result.code && result.code !== 0)) {
          console.warn(`[Feishu] ${this.companyDomain} API 调用失败，降级为 Agent 验证模式`);
          return this._fallbackToAgent(effectiveKeyword);
        }

        const data = result.data || {};
        const jobList = data.job_list || data.jobs || [];
        const normalized = jobList.map(j => this.normalizeJob(j));
        allJobs.push(...normalized);

        if (!data.has_more || !data.page_token) break;
        pageToken = data.page_token;
        pageCount++;
        await this._sleep(800);
      } catch (e) {
        console.warn(`[Feishu] ${this.companyDomain} 第${pageCount + 1}页请求失败，降级为 Agent 验证模式:`, e.message);
        return this._fallbackToAgent(effectiveKeyword);
      }
    }

    return allJobs;
  }

  /**
   * 降级：API 不可用时，返回校招官网链接 + Agent 手动验证提示
   */
  _fallbackToAgent(keyword) {
    return [{
      id: '',
      title: `${this.companyName} 校园招聘${keyword ? `（关键词：${keyword}）` : ''}`,
      company: this.companyName,
      city: '',
      department: '',
      category: '',
      publishDate: '',
      url: `https://${this.companyDomain}/${this.token ? `?token=${this.token}` : ''}`,
      description: '',
      requirement: '',
      source: `${this.companyName}校招官网（飞书招聘，待Agent浏览器验证）`,
      level: '校招',
      note: '飞书招聘 API 需要 token，请 Agent 用 Playwright 打开官网 → F12 看 XHR → 找到 token 与 API 路径，反填到 COMPANY_RECRUITER_MAP'
    }];
  }

  normalizeJob(rawJob) {
    const id = rawJob.id || rawJob.job_id || rawJob.position_id || '';
    const title = rawJob.title || rawJob.job_name || '';
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
      category: rawJob.category || rawJob.job_category || '',
      publishDate,
      url: this.buildJobUrl(id),
      description: rawJob.description || rawJob.job_description || '',
      requirement: rawJob.requirement || rawJob.job_requirement || '',
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
      req.write(postData);
      req.end();
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FeishuRecruiter;
