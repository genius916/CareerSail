/**
 * 通用兜底适配器（v3.9 强化）
 *
 * 当公司不在 COMPANY_RECRUITER_MAP 且 URL 无法识别招聘系统类型时使用。
 * 适配器本身不做网络请求（零依赖），但返回结构化指令告诉 Agent 如何用
 * Playwright MCP / /browser_use / Chrome DevTools MCP 抓取岗位。
 *
 * 设计原则：
 *   - 服务端永远返回非空数组（保证任何公司都有占位记录）
 *   - 占位记录附详细的 Agent 操作指令（navigate + snapshot + 文本提取）
 *   - 让 Agent 拿到指令后能直接调浏览器工具完成真实抓取
 *   - 不在适配器里调用 fetch/http，保持零依赖
 */

const BaseRecruiter = require('./base');

class GenericRecruiter extends BaseRecruiter {
  constructor(options = {}) {
    super({
      name: '通用兜底',
      baseUrl: options.campusUrl || '',
      ...options
    });
    this.companyName = options.companyName || '';
    this.campusUrl = options.campusUrl || '';
  }

  buildJobUrl(job) {
    return this.campusUrl || job.url || '';
  }

  /**
   * 返回占位记录 + Agent 操作指令
   * Agent 读取 note 后调用浏览器自动化工具完成真实抓取
   */
  async fetchJobs(params = {}) {
    const {
      keyword = '',
      graduationYear = ''
    } = params;

    const cohortTag = graduationYear ? `${graduationYear}届` : '';
    const hasUrl = !!this.campusUrl;

    // 构造 Agent 操作指令（note 字段）
    const instructions = [];

    if (hasUrl) {
      instructions.push(`【Agent 必读】未知招聘系统，请用浏览器自动化抓取：`);
      instructions.push(`1. Trae: 输入 /browser_use 命令，打开 ${this.campusUrl}`);
      instructions.push(`2. 其他 Agent: 用 Playwright MCP 的 browser_navigate 打开 ${this.campusUrl}`);
      instructions.push(`3. 调用 browser_snapshot / browser_evaluate 读取页面所有岗位标题文本`);
      instructions.push(`4. 从文本中识别形如"机械工程师/产品经理/算法工程师"的岗位名`);
      instructions.push(`5. 提取每个岗位的详情页链接（href）`);
      instructions.push(`6. 识别出招聘系统类型后，反填到 lib/recruiters/index.js 的 COMPANY_RECRUITER_MAP`);
    } else {
      instructions.push(`【Agent 必读】未知公司且无 URL，请先用搜索找官网：`);
      instructions.push(`1. 用 WebSearch 搜 "${this.companyName} 校园招聘 官网 ${cohortTag}"`);
      instructions.push(`2. 从搜索结果中识别真实的校招官网域名（排除招聘聚合站）`);
      instructions.push(`3. 把找到的 URL 写入 config/user_profile.json 的 search_targets`);
      instructions.push(`4. 然后重新调用搜索 API，本次返回的占位会被真实岗位替换`);
    }

    if (cohortTag) {
      instructions.push(`7. 必须确认页面标题/导航含"${cohortTag}"字样，排除 N-1 届岗位`);
    }
    if (keyword) {
      instructions.push(`8. 用官网搜索框输入"${keyword}"筛选目标岗位`);
    }

    return [{
      id: '',
      title: `${this.companyName} 校园招聘${keyword ? `（关键词：${keyword}）` : ''}`,
      company: this.companyName,
      city: '',
      department: '',
      category: '',
      publishDate: '',
      url: this.campusUrl || '',
      description: '',
      requirement: '',
      source: hasUrl ? `${this.companyName}校招官网（待Agent浏览器抓取）` : `${this.companyName}（待Agent搜索官网）`,
      level: '校招',
      note: instructions.join(' | '),
      // v3.9 新增：结构化指令字段，供 Agent 程序化读取
      agent_action: hasUrl ? 'browser_scrape' : 'search_then_scrape',
      agent_target_url: this.campusUrl || '',
      agent_search_hint: !hasUrl ? `${this.companyName} 校园招聘 官网 ${cohortTag}` : ''
    }];
  }

  normalizeJob(rawJob) {
    return rawJob; // 兜底适配器返回的已是标准格式
  }
}

module.exports = GenericRecruiter;
