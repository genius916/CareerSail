/**
 * 招聘系统适配器基类
 * 所有具体招聘系统适配器都继承自此类
 * 
 * 使用方式（Agent 调用）：
 *   const recruiter = new BeisenRecruiter({ companyDomain: 'iflytek.zhiye.com' });
 *   const jobs = await recruiter.fetchJobs({ keyword: '产品', category: 2 });
 * 
 * 适配原则：
 * - 每个适配器返回统一格式的岗位列表
 * - 每个岗位必须包含 id, title, url, city, department
 * - url 必须是直达 JD 详情页的链接
 */

class BaseRecruiter {
  constructor(options = {}) {
    this.name = options.name || 'unknown';
    this.baseUrl = options.baseUrl || '';
    this.options = options;
  }

  /**
   * 获取岗位列表
   * @param {Object} params - 搜索参数
   * @param {string} params.keyword - 搜索关键词
   * @param {string} params.graduationYear - 毕业年份（如 "2027"）
   * @param {string[]} params.categories - 岗位类别
   * @param {string[]} params.cities - 城市
   * @returns {Promise<Array>} 岗位列表
   */
  async fetchJobs(params = {}) {
    throw new Error('fetchJobs must be implemented by subclass');
  }

  /**
   * 验证校招页面是否存在且届别正确
   * @returns {Promise<boolean>}
   */
  async validateCampusPage() {
    return true; // 默认返回 true，子类可覆盖
  }

  /**
   * 构造 JD 详情页 URL
   * @param {string|Object} job - 岗位对象或岗位ID
   * @returns {string} JD详情页URL
   */
  buildJobUrl(job) {
    const id = typeof job === 'string' ? job : job.id;
    return `${this.baseUrl}/campus/detail?jobAdId=${id}`;
  }

  /**
   * 标准化岗位格式
   * 注意：level 不再硬编码为 '校招'，由 job_filters.detectJobType 依据文本判定，
   * 以区分实习 / 全职校招 / 社招。cohortStatus / freshness 由调用方按需补充。
   * @param {Object} rawJob - 原始岗位数据
   * @returns {Object} 标准化岗位对象
   */
  normalizeJob(rawJob) {
    const job = {
      id: rawJob.id || rawJob.Id || rawJob.jobId || '',
      title: rawJob.title || rawJob.JobAdName || rawJob.job_title || '',
      company: rawJob.company || this.options.companyName || '',
      city: rawJob.city || rawJob.LocNames?.join(',') || rawJob.location || '',
      department: rawJob.department || rawJob.dept || '',
      category: rawJob.category || rawJob.jobType || '',
      publishDate: rawJob.publishDate || rawJob.PostDate || rawJob.posted_date || '',
      url: rawJob.url || this.buildJobUrl(rawJob),
      description: rawJob.description || rawJob.Duty || rawJob.duty || '',
      requirement: rawJob.requirement || rawJob.Require || rawJob.require || '',
      source: `${this.name}校招官网（已验证）`,
      level: rawJob.level || '' // 留空，由 detectJobType 判定
    };
    // 检测岗位类型（实习 / 校招 / 社招），避免实习冒充全职校招
    try {
      const { detectJobType } = require('../job_filters');
      job.level = detectJobType(job);
    } catch (e) {
      job.level = job.level || '校招';
    }
    return job;
  }
}

module.exports = BaseRecruiter;
