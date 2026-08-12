/**
 * 招聘系统适配器统一入口
 *
 * v3.4 核心原则：
 *   - 适配器按「招聘系统类型」路由，不绑定公司名
 *   - 新公司只需在 COMPANY_RECRUITER_MAP 注册「公司名 → 系统类型 + 域名」
 *   - 适配器自动复用，换公司不换代码
 *   - 未知公司根据 URL 自动识别系统类型并路由
 *
 * 已支持系统类型：
 *   - beisen     北森（*.zhiye.com）— Category 动态化 + 标题前缀二次筛届别
 *   - feishu     飞书招聘（*.feishu.cn / *.larkoffice.com）— 内部 API + token 降级
 *   - moka       Moka（*.mokahr.com / app.mokahr.com）— position_type 路由
 *   - aggregate  聚合源（牛客/海投网/应届生网）— 公司发现层专用
 *   - generic    通用兜底（未知系统→返回校招官网链接+待Agent验证）
 *
 * 使用方式：
 *   const { createRecruiter, createRecruiterByCompany, createRecruiterByUrl } = require('./lib/recruiters');
 *   const r1 = createRecruiter('beisen', { companyDomain: 'iflytek.zhiye.com', companyName: '科大讯飞' });
 *   const r2 = createRecruiterByCompany('科大讯飞');
 *   const r3 = createRecruiterByUrl('https://jobs.bytedance.com/campus/positions', '字节跳动');
 */

const BeisenRecruiter = require('./beisen');
const FeishuRecruiter = require('./feishu');
const MokaRecruiter = require('./moka');
const AggregateRecruiter = require('./aggregate');
const GenericRecruiter = require('./generic');
const BaseRecruiter = require('./base');

// ============================================================
// 已知公司的招聘系统映射表
// 新公司添加时只需在这里注册即可，适配器自动复用
// 字段说明：{ type, companyDomain, companyName, ...adapterSpecific }
// ============================================================
const COMPANY_RECRUITER_MAP = {
  // === 北森系统 ===
  '科大讯飞': { type: 'beisen', companyDomain: 'iflytek.zhiye.com', companyName: '科大讯飞' },
  '长鑫存储': { type: 'beisen', companyDomain: 'cxmt.zhiye.com', companyName: '长鑫存储' },
  '鱼跃医疗': { type: 'beisen', companyDomain: 'yuwell.zhiye.com', companyName: '鱼跃医疗' },
  '欧普照明': { type: 'beisen', companyDomain: 'opple.zhiye.com', companyName: '欧普照明' },
  '创维集团': { type: 'beisen', companyDomain: 'skyworth.zhiye.com', companyName: '创维集团' },
  '麦克奥迪': { type: 'beisen', companyDomain: 'motic.zhiye.com', companyName: '麦克奥迪' },
  '北京怡和嘉业': { type: 'beisen', companyDomain: 'bmcmedical.zhiye.com', companyName: '北京怡和嘉业' },
  '汇川技术': { type: 'beisen', companyDomain: 'inovance.zhiye.com', companyName: '汇川技术' },
  '南芯科技': { type: 'beisen', companyDomain: 'nanxin.zhiye.com', companyName: '南芯科技' },
  'Babycare': { type: 'beisen', companyDomain: 'babycare.zhiye.com', companyName: 'Babycare' },
  '人保财险': { type: 'beisen', companyDomain: 'picc.zhiye.com', companyName: '人保财险' },

  // === 飞书招聘 ===
  // 注意：飞书招聘多数 API 需 token，无 token 时会降级为 Agent 验证模式
  '字节跳动': { type: 'feishu', companyDomain: 'jobs.bytedance.com', companyName: '字节跳动' },
  '智元机器人': { type: 'feishu', companyDomain: 'agirobot.jobs.feishu.cn', companyName: '智元机器人' },
  'MiniMax': { type: 'feishu', companyDomain: 'vrfi1sk8a0.jobs.feishu.cn', companyName: 'MiniMax' },
  'B站': { type: 'feishu', companyDomain: 'jobs.bilibili.com', companyName: 'B站' },
  '哔哩哔哩': { type: 'feishu', companyDomain: 'jobs.bilibili.com', companyName: '哔哩哔哩' },

  // === Moka ===
  '搜狐畅游': { type: 'moka', companyDomain: 'app.mokahr.com', companySlug: 'cyou-inc', companyName: '搜狐畅游' },
  '北京畅游天下': { type: 'moka', companyDomain: 'app.mokahr.com', companySlug: 'cyou-inc', companyName: '北京畅游天下' },

  // === 自研系统（暂归 generic，等具体 API 确认后再单独建适配器） ===
  '京东': { type: 'generic', campusUrl: 'https://campus.jd.com/', companyName: '京东' },
  '拼多多': { type: 'generic', campusUrl: 'https://careers.pddglobalhr.com/campus/grad', companyName: '拼多多' },
  '阿里巴巴': { type: 'generic', campusUrl: 'https://campus-talent.alibaba.com/campus/', companyName: '阿里巴巴' },
  '蚂蚁集团': { type: 'generic', campusUrl: 'https://talent.alibaba.com/campus', companyName: '蚂蚁集团' },
  '阿里健康': { type: 'generic', campusUrl: 'https://campus-talent.alibaba.com/campus/', companyName: '阿里健康' },
  '百度': { type: 'generic', campusUrl: 'https://talent.baidu.com/jobs', companyName: '百度' },
  '腾讯': { type: 'generic', campusUrl: 'https://join.qq.com', companyName: '腾讯' },
  '网易': { type: 'generic', campusUrl: 'https://campus.163.com', companyName: '网易' },
  '快手': { type: 'generic', campusUrl: 'https://campus.kuaishou.cn/', companyName: '快手' },
  '小米': { type: 'generic', campusUrl: 'https://hr.xiaomi.com/campus', companyName: '小米' },
  '华为': { type: 'generic', campusUrl: 'https://career.huawei.com/reccampportal/', companyName: '华为' },
  '米哈游': { type: 'generic', campusUrl: 'https://jobs.mihoyo.com/campus', companyName: '米哈游' },
  '叠纸游戏': { type: 'generic', campusUrl: 'https://jobs.papegames.com/campus', companyName: '叠纸游戏' },
  '联想': { type: 'generic', campusUrl: 'https://talent.lenovo.com.cn/campus', companyName: '联想' },
  '帆软': { type: 'generic', campusUrl: 'https://join.fanruan.com/campus', companyName: '帆软' },
  'Shopee': { type: 'generic', campusUrl: 'https://careers.shopee.cn/campus', companyName: 'Shopee' },
  '京东健康': { type: 'generic', campusUrl: 'https://campus.jd.com/', companyName: '京东健康' },
  '小荷健康（字节跳动）': { type: 'feishu', companyDomain: 'jobs.bytedance.com', companyName: '小荷健康（字节跳动）' },
  '小鹏集团': { type: 'generic', campusUrl: 'https://xiaopeng.jobs/fe/campus', companyName: '小鹏集团' },
  '基恩士': { type: 'generic', campusUrl: 'https://www.keyence.com.cn', companyName: '基恩士' },
  '欧莱雅': { type: 'generic', campusUrl: 'https://www.lorealcampus.com.cn', companyName: '欧莱雅' },
  '安永': { type: 'generic', campusUrl: 'https://www.ey.com/zh_cn/careers/students', companyName: '安永' },
  '毕马威': { type: 'generic', campusUrl: 'https://home.kpmg/cn/zh/home/careers/students.html', companyName: '毕马威' },
  '德勤': { type: 'generic', campusUrl: 'https://www2.deloitte.com/cn/zh/careers/students.html', companyName: '德勤' },
  '普华永道': { type: 'generic', campusUrl: 'https://www.pwccn.com/zh/careers/students.html', companyName: '普华永道' },
  '瑞银': { type: 'generic', campusUrl: 'https://www.ubs.com/cn/sc/careers/students.html', companyName: '瑞银' },
  'OPPO华中东区': { type: 'generic', campusUrl: 'https://career.oppo.com/campus', companyName: 'OPPO华中东区' },
  '罗技': { type: 'generic', campusUrl: 'https://www.logitech.com/zh-cn/careers', companyName: '罗技' },
  '迈瑞医疗': { type: 'generic', campusUrl: 'https://www.mindray.com/cn/careers', companyName: '迈瑞医疗' },
  '科大讯飞（医学类）': { type: 'beisen', companyDomain: 'iflytek.zhiye.com', companyName: '科大讯飞' },

  // === 制造业 / 机械 / 自动化 / 汽车工业（v3.9 扩充） ===
  // 机械、自动化、车辆、机电、制造专业用户使用
  '三一重工': { type: 'generic', campusUrl: 'https://campus.sany.com.cn/', companyName: '三一重工' },
  '徐工集团': { type: 'generic', campusUrl: 'https://campus.xcmg.com/', companyName: '徐工集团' },
  '中联重科': { type: 'generic', campusUrl: 'https://campus.zoomlion.com/', companyName: '中联重科' },
  '柳工机械': { type: 'generic', campusUrl: 'https://campus.liugong.com/', companyName: '柳工机械' },
  '潍柴动力': { type: 'generic', campusUrl: 'https://campus.weichai.com/', companyName: '潍柴动力' },
  '玉柴机器': { type: 'generic', campusUrl: 'https://campus.yuchai.com/', companyName: '玉柴机器' },
  '上海电气': { type: 'generic', campusUrl: 'https://seczhaopin.shanghai-electric.com/campus', companyName: '上海电气' },
  '东方电气': { type: 'generic', campusUrl: 'https://www.dongfang.com/campus', companyName: '东方电气' },
  '哈电集团': { type: 'generic', campusUrl: 'https://www.harbin-electric.com/campus', companyName: '哈电集团' },
  '宁德时代': { type: 'generic', campusUrl: 'https://app.mokahr.com/campus/apply/catl/', companyName: '宁德时代' },
  '比亚迪': { type: 'generic', campusUrl: 'https://campus.byd.com/', companyName: '比亚迪' },
  '吉利汽车': { type: 'generic', campusUrl: 'https://campus.geely.com/', companyName: '吉利汽车' },
  '长城汽车': { type: 'generic', campusUrl: 'https://campus.gwm.com.cn/', companyName: '长城汽车' },
  '蔚来汽车': { type: 'generic', campusUrl: 'https://nio.com/careers/campus', companyName: '蔚来汽车' },
  '理想汽车': { type: 'generic', campusUrl: 'https://www.lixiang.com/careers/campus', companyName: '理想汽车' },
  '小鹏汽车': { type: 'generic', campusUrl: 'https://job.xiaopeng.com/campus', companyName: '小鹏汽车' },
  '一汽集团': { type: 'generic', campusUrl: 'https://campus.faw.com/', companyName: '一汽集团' },
  '东风汽车': { type: 'generic', campusUrl: 'https://campus.dfmc.com.cn/', companyName: '东风汽车' },
  '上汽集团': { type: 'generic', campusUrl: 'https://campus.saicmotor.com/', companyName: '上汽集团' },
  '广汽集团': { type: 'generic', campusUrl: 'https://campus.gac.com.cn/', companyName: '广汽集团' },
  '奇瑞汽车': { type: 'generic', campusUrl: 'https://campus.chery.cn/', companyName: '奇瑞汽车' },

  // 机器人 / 自动化 / 工业控制
  '海康机器人': { type: 'generic', campusUrl: 'https://campus.hikrobotics.com/', companyName: '海康机器人' },
  '新松机器人': { type: 'generic', campusUrl: 'https://www.siasun.com/careers/campus', companyName: '新松机器人' },
  '埃斯顿自动化': { type: 'generic', campusUrl: 'https://www.estun.com/careers/campus', companyName: '埃斯顿自动化' },
  '英威腾': { type: 'generic', campusUrl: 'https://www.invt.com/careers/campus', companyName: '英威腾' },
  '信捷电气': { type: 'generic', campusUrl: 'https://www.xinje.com/careers/campus', companyName: '信捷电气' },
  '禾赛科技': { type: 'generic', campusUrl: 'https://www.hesaitech.com/careers/campus', companyName: '禾赛科技' },
  '速腾聚创': { type: 'generic', campusUrl: 'https://www.robosense.cn/careers/campus', companyName: '速腾聚创' },
  '大疆': { type: 'generic', campusUrl: 'https://we.dji.com/zh-CN/campus', companyName: '大疆' },
  '大疆创新': { type: 'generic', campusUrl: 'https://we.dji.com/zh-CN/campus', companyName: '大疆创新' },
  '优必选': { type: 'generic', campusUrl: 'https://www.ubtrobot.com/careers/campus', companyName: '优必选' },

  // 航空航天 / 军工
  '中国航天科技': { type: 'generic', campusUrl: 'http://www.spacechina.com/campus', companyName: '中国航天科技' },
  '中国航天科工': { type: 'generic', campusUrl: 'http://www.casic.com.cn/campus', companyName: '中国航天科工' },
  '中国航空工业': { type: 'generic', campusUrl: 'http://www.avic.com/campus', companyName: '中国航空工业' },
  '中国商飞': { type: 'generic', campusUrl: 'https://www.comac.cc/campus', companyName: '中国商飞' },
  '中国兵器工业': { type: 'generic', campusUrl: 'http://www.norincogroup.com.cn/campus', companyName: '中国兵器工业' },
  '中航工业': { type: 'generic', campusUrl: 'http://www.avic.com/campus', companyName: '中航工业' },

  // 能源 / 电力 / 化工
  '国家电网': { type: 'generic', campusUrl: 'http://campus.sgcc.com.cn/', companyName: '国家电网' },
  '南方电网': { type: 'generic', campusUrl: 'http://campus.csg.cn/', companyName: '南方电网' },
  '中石油': { type: 'generic', campusUrl: 'https://www.cnpc.com.cn/campus', companyName: '中石油' },
  '中石化': { type: 'generic', campusUrl: 'https://www.sinopec.com/campus', companyName: '中石化' },
  '中海油': { type: 'generic', campusUrl: 'https://www.cnooc.com.cn/campus', companyName: '中海油' },
  '中化集团': { type: 'generic', campusUrl: 'https://www.sinochem.com/campus', companyName: '中化集团' },
  '万华化学': { type: 'generic', campusUrl: 'https://www.whchem.com/campus', companyName: '万华化学' },
  '恒力集团': { type: 'generic', campusUrl: 'https://www.hengli.com/campus', companyName: '恒力集团' },
  '盛虹集团': { type: 'generic', campusUrl: 'https://www.shenghonggrp.com/campus', companyName: '盛虹集团' },

  // 轨道交通 / 船舶
  '中国中车': { type: 'generic', campusUrl: 'https://www.crrcgc.cc/campus', companyName: '中国中车' },
  '中车集团': { type: 'generic', campusUrl: 'https://www.crrcgc.cc/campus', companyName: '中车集团' },
  '中国船舶': { type: 'generic', campusUrl: 'http://www.cssc.net.cn/campus', companyName: '中国船舶' },
  '中船重工': { type: 'generic', campusUrl: 'http://www.csic.com.cn/campus', companyName: '中船重工' },

  // 家电 / 消费电子制造
  '美的集团': { type: 'generic', campusUrl: 'https://campus.midea.com/', companyName: '美的集团' },
  '海尔集团': { type: 'generic', campusUrl: 'https://campus.haier.com/', companyName: '海尔集团' },
  '格力电器': { type: 'generic', campusUrl: 'https://www.gree.com/careers/campus', companyName: '格力电器' },
  'TCL集团': { type: 'generic', campusUrl: 'https://campus.tcl.com/', companyName: 'TCL集团' },
  '海信集团': { type: 'generic', campusUrl: 'https://campus.hisense.com/', companyName: '海信集团' },

  // 半导体 / 电子制造
  '中芯国际': { type: 'generic', campusUrl: 'https://www.smics.com/careers/campus', companyName: '中芯国际' },
  '华虹半导体': { type: 'generic', campusUrl: 'https://www.huahong.com/careers/campus', companyName: '华虹半导体' },
  '长江存储': { type: 'generic', campusUrl: 'https://www.ymtc.com/careers/campus', companyName: '长江存储' },
  '紫光集团': { type: 'generic', campusUrl: 'https://www.unisoc.com/careers/campus', companyName: '紫光集团' },
  '立讯精密': { type: 'generic', campusUrl: 'https://www.luxshare-ict.com/careers/campus', companyName: '立讯精密' },
  '歌尔股份': { type: 'generic', campusUrl: 'https://www.goertek.com/careers/campus', companyName: '歌尔股份' },
  '瑞声科技': { type: 'generic', campusUrl: 'https://www.aactechnologies.com/careers/campus', companyName: '瑞声科技' },

  // 工程 / 建筑施工
  '中国建筑': { type: 'generic', campusUrl: 'https://www.cscec.com/campus', companyName: '中国建筑' },
  '中国中铁': { type: 'generic', campusUrl: 'https://www.crec.cn/campus', companyName: '中国中铁' },
  '中国铁建': { type: 'generic', campusUrl: 'https://www.crcc.cn/campus', companyName: '中国铁建' },
  '中国交建': { type: 'generic', campusUrl: 'https://www.ccccltd.cn/campus', companyName: '中国交建' },
  '中国电建': { type: 'generic', campusUrl: 'https://www.powerchina.cn/campus', companyName: '中国电建' },
  '中国能建': { type: 'generic', campusUrl: 'https://www.ceec.net.cn/campus', companyName: '中国能建' },

  // 钢铁 / 材料
  '宝武钢铁': { type: 'generic', campusUrl: 'https://www.baowugroup.com/campus', companyName: '宝武钢铁' },
  '鞍钢集团': { type: 'generic', campusUrl: 'https://www.ansteel.cn/campus', companyName: '鞍钢集团' },
  '沙钢集团': { type: 'generic', campusUrl: 'https://www.shaganggroup.com/campus', companyName: '沙钢集团' },
  '首钢集团': { type: 'generic', campusUrl: 'https://www.shougang.com.cn/campus', companyName: '首钢集团' },
  '中国铝业': { type: 'generic', campusUrl: 'https://www.chalco.com.cn/campus', companyName: '中国铝业' },
  '中国五矿': { type: 'generic', campusUrl: 'https://www.minmetals.com.cn/campus', companyName: '中国五矿' },
};

// ============================================================
// 系统类型 → 适配器类 映射
// 适配器按系统类型工作，新公司只换配置不换代码
// ============================================================
const TYPE_TO_CLASS = {
  beisen: BeisenRecruiter,
  feishu: FeishuRecruiter,
  moka: MokaRecruiter,
  aggregate: AggregateRecruiter,
  generic: GenericRecruiter
};

// ============================================================
// URL 模式 → 系统类型 识别规则
// 用于未知公司根据 campusUrl 自动路由
// ============================================================
const URL_TYPE_RULES = [
  { type: 'beisen',    pattern: /zhiye\.com/i },
  { type: 'feishu',    pattern: /(jobs\.feishu\.cn|\.feishu\.cn|\.larkoffice\.com|jobs\.bytedance\.com|jobs\.bilibili\.com)/i },
  { type: 'moka',      pattern: /mokahr\.com/i },
  { type: 'aggregate', pattern: /(nowcoder\.com|haitou\.cc|yingjiesheng\.com|shixiseng\.com)/i }
];

/**
 * 创建招聘系统适配器实例
 * @param {string} type - 系统类型：beisen | feishu | moka | aggregate | generic
 * @param {Object} options - 配置选项
 * @returns {BaseRecruiter} 适配器实例
 */
function createRecruiter(type, options = {}) {
  const Cls = TYPE_TO_CLASS[type];
  if (Cls) return new Cls(options);
  // 未知类型 → 兜底
  return new GenericRecruiter(options);
}

/**
 * 根据公司名自动创建对应适配器
 * @param {string} companyName - 公司名称
 * @returns {BaseRecruiter|null} 适配器实例，未知公司返回null（由调用方决定是否走 URL 识别）
 */
function createRecruiterByCompany(companyName) {
  const config = COMPANY_RECRUITER_MAP[companyName];
  if (!config) return null;
  return createRecruiter(config.type, config);
}

/**
 * 根据校招官网 URL 自动识别系统类型并创建适配器
 * v3.4 新增：未知公司根据 URL 模式路由到对应系统适配器
 * @param {string} campusUrl - 校招官网URL
 * @param {string} companyName - 公司名称（用于适配器展示）
 * @returns {BaseRecruiter} 适配器实例（识别不出时返回 GenericRecruiter 兜底）
 */
function createRecruiterByUrl(campusUrl, companyName = '') {
  if (!campusUrl) {
    return new GenericRecruiter({ companyName, campusUrl: '' });
  }

  // 1. URL 模式匹配
  for (const rule of URL_TYPE_RULES) {
    if (rule.pattern.test(campusUrl)) {
      const options = extractOptionsFromUrl(rule.type, campusUrl, companyName);
      return createRecruiter(rule.type, options);
    }
  }

  // 2. 兜底
  return new GenericRecruiter({ companyName, campusUrl });
}

/**
 * 根据 URL 提取适配器所需的配置（domain、token 等）
 */
function extractOptionsFromUrl(type, url, companyName) {
  const match = url.match(/https?:\/\/([^/]+)/);
  const domain = match ? match[1] : '';
  const baseOptions = { companyName, companyDomain: domain };

  switch (type) {
    case 'beisen':
      return baseOptions;
    case 'feishu': {
      // 飞书招聘 URL 中常带 ?token=xxx，提取出来
      const tokenMatch = url.match(/[?&]token=([^&]+)/);
      return { ...baseOptions, token: tokenMatch ? tokenMatch[1] : '' };
    }
    case 'moka': {
      // Moka URL 常为 /campus_apply/{slug}/...，提取 slug
      const slugMatch = url.match(/campus_apply\/([^/]+)/);
      return { ...baseOptions, companySlug: slugMatch ? slugMatch[1] : '' };
    }
    default:
      return { companyName, campusUrl: url };
  }
}

/**
 * 检测公司使用的招聘系统类型
 * @param {string} campusUrl - 校招官网URL
 * @returns {string} 系统类型标识（beisen | feishu | moka | aggregate | generic | unknown）
 */
function detectRecruiterType(campusUrl) {
  if (!campusUrl) return 'unknown';
  for (const rule of URL_TYPE_RULES) {
    if (rule.pattern.test(campusUrl)) return rule.type;
  }
  return 'unknown';
}

/**
 * 列出所有已适配招聘系统的公司
 * 供前端 /api/supported-companies 端点调用
 */
function listSupportedCompanies() {
  return Object.entries(COMPANY_RECRUITER_MAP).map(([name, cfg]) => ({
    company: name,
    type: cfg.type,
    domain: cfg.companyDomain || cfg.campusUrl || ''
  }));
}

/**
 * 列出所有支持的招聘系统类型
 */
function listSupportedTypes() {
  return Object.keys(TYPE_TO_CLASS).map(type => ({
    type,
    name: new TYPE_TO_CLASS[type]().name
  }));
}

module.exports = {
  createRecruiter,
  createRecruiterByCompany,
  createRecruiterByUrl,
  detectRecruiterType,
  extractOptionsFromUrl,
  listSupportedCompanies,
  listSupportedTypes,
  COMPANY_RECRUITER_MAP,
  TYPE_TO_CLASS,
  URL_TYPE_RULES,
  BeisenRecruiter,
  FeishuRecruiter,
  MokaRecruiter,
  AggregateRecruiter,
  GenericRecruiter,
  BaseRecruiter
};
