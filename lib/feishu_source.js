/**
 * 飞书 Base 外部公司库同步模块
 *
 * 用途：把别人维护的"27届秋招投递信息汇总"飞书多维表格同步到本地 CSV，
 *      在 CareerSail 仪表盘中以独立功能区呈现，不改变现有 job_pool 等内容。
 *
 * 工作方式：
 *   1. 读取 config/external_source.json 获取 base_token / table_id
 *   2. 调用 lark-cli base +record-list 分页拉取全量记录（--as user）
 *   3. 解析飞书 CellValue 格式，转换为扁平结构
 *   4. 写入 dashboard/external_companies.csv（覆盖式更新）
 *   5. 记录最后同步时间到 config/external_source.json
 *
 * 数据来源（用户可配置）：
 *   默认指向 "27届 秋招投递信息" Base，用户可在 config/external_source.json 改成任何飞书 Base
 *
 * 持续更新策略：
 *   - 手动：仪表盘"同步"按钮 → POST /api/sync-external → 调用 syncExternalCompanies()
 *   - 自动：Agent 定时任务（Schedule 工具）每天调一次 syncExternalCompanies()
 *   - 启动时：server.js 启动检查 last_sync_at，超过 sync_interval_hours 自动同步
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseCSV, rowsToCSV } = require('./csv_utils');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'external_source.json');
const CSV_PATH = path.join(ROOT, 'dashboard', 'external_companies.csv');
const CONFIG_TEMPLATE = path.join(ROOT, 'templates', 'config', 'external_source.json');

// CSV 表头（与 templates/dashboard/external_companies.csv 一致）
const CSV_HEADERS = [
  'company_name',      // 公司名称
  'enterprise_type',   // 企业类型（国央企/科技/互联网/游戏/外企/金融/教育）
  'batch',             // 批次（秋招提前批/秋招正式批/管培生/顶尖人才/暑期提前批/暑期正式批）
  'cities',            // base 地点（分号分隔）
  'job_categories',    // 岗位类别（分号分隔）
  'open_date',         // 开放日期
  'deadline',          // 截止日期
  'career_url',        // 招聘官网链接
  'career_url_text',   // 招聘官网显示文本
  'source_record_id',  // 飞书记录 ID（用于去重/更新）
  'synced_at',         // 同步时间
  'favorited',         // 用户收藏标记（1=收藏, 空=未收藏）— 同步时保留
  'excluded'           // 用户剔除标记（1=剔除, 空=未剔除）— 同步时保留
];

/**
 * 读取外部数据源配置
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (fs.existsSync(CONFIG_TEMPLATE)) {
      fs.copyFileSync(CONFIG_TEMPLATE, CONFIG_PATH);
    } else {
      return null;
    }
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    console.error('[feishu_source] 配置解析失败:', e.message);
    return null;
  }
}

/**
 * 保存配置（含最后同步时间）
 */
function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * 调用 lark-cli 拉取一页记录
 * 返回 { records, has_more, total }
 *
 * lark-cli base +record-list 分页参数：--offset（偏移量）+ --limit（每页大小，最大 200）
 * 默认输出 markdown 表格格式：
 *   | _record_id | 字段1 | 字段2 | ... |
 *   | --- | --- | --- | ... |
 *   | recXXX | 值1 | 值2 | ... |
 *   Meta: count=N; has_more=true/false; ...
 *
 * 用 markdown 格式而不是 --json，因为 --json 返回值数组（无字段名），
 * 字段顺序不固定，难以可靠映射。markdown 表头有字段名，可直接映射。
 */
function fetchPage(baseToken, tableId, offset = 0, limit = 200) {
  const args = [
    'base', '+record-list',
    '--base-token', baseToken,
    '--table-id', tableId,
    '--offset', String(offset),
    '--limit', String(limit),
    '--as', 'user'
  ];

  let stdout;
  try {
    stdout = execFileSync('lark-cli', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 60000,
      windowsHide: true
    });
  } catch (e) {
    throw new Error(`lark-cli 调用失败: ${e.message}`);
  }

  return parseLarkCliMarkdown(stdout);
}

/**
 * 解析 lark-cli 默认 markdown 输出
 * 表头行含字段名，数据行按表头顺序排列，最后一行 Meta 含 has_more
 */
function parseLarkCliMarkdown(stdout) {
  const lines = stdout.split('\n').map(l => l.trim()).filter(l => l);

  // 找表头行（以 | 开头）
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('|') && lines[i].includes('---') === false) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    // 检查是否是错误输出
    if (stdout.includes('"ok": false') || stdout.includes('"error"')) {
      throw new Error(`lark-cli 报错: ${stdout.substring(0, 300)}`);
    }
    return { records: [], has_more: false };
  }

  const headers = parseMarkdownRow(lines[headerIdx]);
  // 跳过分隔行 | --- | --- |
  let dataStart = headerIdx + 1;
  if (dataStart < lines.length && lines[dataStart].includes('---')) {
    dataStart++;
  }

  const records = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Meta:')) break;
    if (!line.startsWith('|')) continue;

    const values = parseMarkdownRow(line);
    const record = { _record_id: '', fields: {} };
    headers.forEach((h, j) => {
      const val = values[j] || '';
      if (h === '_record_id') {
        record._record_id = val;
      } else {
        record.fields[h] = parseMarkdownValue(val);
      }
    });
    records.push(record);
  }

  // 从 Meta 行提取 has_more
  // 注意：Meta 中的 count 是当前页返回条数（=records.length），不是全表总数
  const metaLine = lines.find(l => l.startsWith('Meta:')) || '';
  const hasMore = metaLine.includes('has_more=true');

  return { records, has_more: hasMore };
}

/**
 * 解析 markdown 表格行，返回单元格值数组
 * 支持 | 值1 | 值2 | 格式，值内可能含转义的 |
 *
 * v4.1: 修复字段值内含 | 字符导致错误分割的问题
 * 使用引号感知的分割：如果字段值以 " 开头，则跳过引号内的 | 直到找到闭合引号
 */
function parseMarkdownRow(line) {
  // 去掉首尾的 |
  const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === '|' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim()); // 最后一个单元格
  return cells;
}

/**
 * 解析 markdown 单元格值
 * 飞书多选/单选字段在 markdown 中显示为 ["选项1","选项2"] 格式
 * 日期显示为 2026-07-20 00:00:00
 * 超链接显示为 [文本](URL)
 */
function parseMarkdownValue(val) {
  if (!val || val === '') return '';

  // 多选/单选：["选项1","选项2"] → 数组
  if (val.startsWith('["') || val.startsWith('[ ')) {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr)) {
        // 返回数组对象，让 recordToRow 按字段类型处理
        return arr.map(item => {
          if (typeof item === 'string') return { name: item, text: item };
          return item;
        });
      }
    } catch (e) {
      // 不是合法 JSON，当文本处理
    }
  }

  // null 字符串
  if (val === 'null' || val === '[]') return '';

  return val;
}

/**
 * 解析飞书 CellValue
 * 飞书字段值有多种格式：
 *   - text: [{ type:'text', text:'值' }] 或直接字符串
 *   - select: [{ name:'选项名' }] 或 '选项名'
 *   - multiselect: [{ name:'选项1' }, { name:'选项2' }]
 *   - datetime: 毫秒时间戳数字 → 'YYYY-MM-DD'
 *   - url/hyperlink: [{ type:'url', text:'显示文本', link:'https://...' }]
 */
function parseCellValue(value, fieldType) {
  if (value === null || value === undefined || value === '') return '';

  // 字符串直接返回
  if (typeof value === 'string') return value;

  // 数字（datetime 是毫秒时间戳）
  if (typeof value === 'number') {
    if (fieldType === 'datetime') {
      const d = new Date(value);
      if (isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return String(value);
  }

  // 数组（text/select/multiselect/url）
  if (Array.isArray(value)) {
    // text 字段：[{ type:'text', text:'片段' }]
    if (fieldType === 'text') {
      return value.map(v => v.text || v.name || v.link || '').join('');
    }
    // select/multiselect：[{ name:'选项' }]
    if (fieldType === 'select' || fieldType === 'multiselect') {
      return value.map(v => v.name || v.text || '').join('; ');
    }
    // url/hyperlink：[{ type:'url', text:'显示', link:'URL' }]
    if (fieldType === 'url') {
      const item = value[0] || {};
      return item.link || item.text || '';
    }
    // 兜底
    return value.map(v => v.text || v.name || v.link || JSON.stringify(v)).join('; ');
  }

  return String(value);
}

/**
 * 从飞书记录提取超链接信息
 * 支持多种输入格式：
 *   - 字符串：markdown 链接 [文本](URL) 或纯 URL
 *   - 数组（飞书 CellValue）：[{ type:'url', text:'网易互娱招聘', link:'https://...' }]
 *                              或 [{ type:'text', text:'[网易互娱招聘](https://...)' }]
 */
function extractUrl(value) {
  // 字符串输入：可能是 markdown 链接 [文本](URL) 或纯 URL
  if (typeof value === 'string') {
    const mdMatch = value.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (mdMatch) {
      return { url: mdMatch[2], text: mdMatch[1] };
    }
    const urlMatch = value.match(/(https?:\/\/[^\s)]+)/);
    if (urlMatch) {
      return { url: urlMatch[1], text: value };
    }
    return { url: '', text: value };
  }
  // 数组输入（飞书 CellValue 格式）
  if (!value || !Array.isArray(value)) return { url: '', text: '' };
  const first = value[0] || {};
  // 类型1：直接 link 属性
  if (first.link) {
    return { url: first.link, text: first.text || first.link };
  }
  // 类型2：text 内含 markdown 链接
  const fullText = value.map(v => v.text || '').join('');
  const mdMatch = fullText.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (mdMatch) {
    return { url: mdMatch[2], text: mdMatch[1] };
  }
  // 类型3：纯 URL 文本
  const urlMatch = fullText.match(/(https?:\/\/[^\s)]+)/);
  if (urlMatch) {
    return { url: urlMatch[1], text: fullText || urlMatch[1] };
  }
  return { url: '', text: fullText };
}

/**
 * 把飞书记录转换为 CSV 行
 * 字段映射（飞书字段名 → CSV 字段）：
 *   公司名称 → company_name
 *   企业类型 → enterprise_type
 *   批次 → batch
 *   base（超6个即全国） → cities
 *   岗位（具体需要查看官网） → job_categories
 *   开放日期 → open_date
 *   截止日期 → deadline
 *   招聘官网 → career_url + career_url_text
 *   _record_id → source_record_id
 */
function recordToRow(record, fieldMap, syncedAt, userState) {
  const fields = record.fields || {};
  const row = {
    company_name: '',
    enterprise_type: '',
    batch: '',
    cities: '',
    job_categories: '',
    open_date: '',
    deadline: '',
    career_url: '',
    career_url_text: '',
    source_record_id: record.record_id || record._record_id || '',
    synced_at: syncedAt,
    favorited: '',
    excluded: ''
  };

  // 合并用户状态（收藏/剔除）— 同步时保留用户的标记
  if (userState) {
    row.favorited = userState.favorited || '';
    row.excluded = userState.excluded || '';
  }

  // 按字段名映射
  // 注意：只用 csvName 判断字段类型，不能用 feishuName.includes('官网')
  // 因为 "岗位（具体需要查看官网）" 字段名也含"官网"但实际是多选字段
  for (const [feishuName, csvName] of Object.entries(fieldMap)) {
    const fieldDef = fields[feishuName];
    if (fieldDef === undefined) continue;

    if (csvName === 'career_url') {
      // URL 字段：提取超链接
      const { url, text } = extractUrl(fieldDef);
      row.career_url = url;
      row.career_url_text = text;
    } else if (csvName === 'cities' || csvName === 'job_categories') {
      // 多选 → 分号分隔
      row[csvName] = parseCellValue(fieldDef, 'multiselect').replace(/; /g, ';');
    } else if (csvName === 'open_date' || csvName === 'deadline') {
      let dateVal = parseCellValue(fieldDef, 'datetime');
      // markdown 输出日期为 "2026-07-20 00:00:00"，去掉时间部分
      if (typeof dateVal === 'string' && dateVal.includes(' ')) {
        dateVal = dateVal.split(' ')[0];
      }
      row[csvName] = dateVal;
    } else {
      row[csvName] = parseCellValue(fieldDef, 'text');
    }
  }

  return row;
}

/**
 * 主同步函数：拉取飞书 Base 全量记录，写入 CSV
 * @param {Object} options - { force: 跳过缓存检查强制同步 }
 * @returns {Object} { success, count, message, last_sync_at }
 */
function syncExternalCompanies(options = {}) {
  const config = loadConfig();
  if (!config || !config.base_token || !config.table_id) {
    return {
      success: false,
      count: 0,
      message: '未配置飞书 Base（config/external_source.json 缺少 base_token 或 table_id）',
      last_sync_at: config?.last_sync_at || ''
    };
  }

  // 检查同步间隔（除非 force）
  if (!options.force && config.last_sync_at) {
    const intervalHours = config.sync_interval_hours || 6;
    const last = new Date(config.last_sync_at);
    const elapsed = (Date.now() - last.getTime()) / (1000 * 60 * 60);
    if (elapsed < intervalHours) {
      return {
        success: true,
        count: 0,
        message: `距上次同步不足 ${intervalHours} 小时，跳过（上次：${config.last_sync_at}）`,
        last_sync_at: config.last_sync_at,
        skipped: true
      };
    }
  }

  const syncedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const allRows = [];
  let offset = 0;
  const pageSize = 200; // lark-cli +record-list --limit 最大 200
  const maxPages = 100; // 安全上限，避免死循环（200 × 100 = 20000 条）
  let pageCount = 0;

  // 读取旧 CSV 中的用户状态（收藏/剔除），同步时保留
  const userStateMap = {};
  if (fs.existsSync(CSV_PATH)) {
    try {
      const oldRows = readExternalCompanies();
      for (const r of oldRows) {
        if (r.source_record_id) {
          userStateMap[r.source_record_id] = {
            favorited: r.favorited || '',
            excluded: r.excluded || ''
          };
        }
      }
    } catch (e) {
      // 旧 CSV 读取失败不阻断同步，继续即可
    }
  }

  // 字段映射表（飞书字段名 → CSV 字段名）
  // 用字段名而非 ID，更直观；若飞书表改字段名，这里需对应修改
  const fieldMap = config.field_map || {
    '公司名称': 'company_name',
    '企业类型': 'enterprise_type',
    '批次': 'batch',
    'base（超6个即全国）': 'cities',
    '岗位（具体需要查看官网）': 'job_categories',
    '开放日期': 'open_date',
    '截止日期': 'deadline',
    '招聘官网': 'career_url'
  };

  while (pageCount < maxPages) {
    pageCount++;
    let page;
    try {
      page = fetchPage(config.base_token, config.table_id, offset, pageSize);
    } catch (e) {
      return {
        success: false,
        count: allRows.length,
        message: `第 ${pageCount} 页拉取失败 (offset=${offset}): ${e.message}`,
        last_sync_at: config.last_sync_at || ''
      };
    }

    for (const record of page.records) {
      const rid = record.record_id || record._record_id || '';
      const userState = userStateMap[rid] || null;
      allRows.push(recordToRow(record, fieldMap, syncedAt, userState));
    }

    if (!page.has_more) break;
    offset += pageSize;
  }

  // 写入 CSV（覆盖式）
  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  fs.writeFileSync(CSV_PATH, rowsToCSV(CSV_HEADERS, allRows), 'utf-8');

  // 更新最后同步时间
  config.last_sync_at = syncedAt;
  config.last_sync_count = allRows.length;
  saveConfig(config);

  return {
    success: true,
    count: allRows.length,
    message: `同步成功：${allRows.length} 条公司记录（共 ${pageCount} 页）`,
    last_sync_at: syncedAt
  };
}

/**
 * 读取本地缓存的外部公司库 CSV
 */
function readExternalCompanies() {
  if (!fs.existsSync(CSV_PATH)) return [];
  const { rows } = parseCSV(fs.readFileSync(CSV_PATH, 'utf-8'));
  return rows;
}

/**
 * 检查是否需要在启动时自动同步
 */
function shouldSyncOnStartup() {
  const config = loadConfig();
  if (!config || !config.auto_sync_on_startup) return false;
  if (!config.last_sync_at) return true;
  const intervalHours = config.sync_interval_hours || 6;
  const last = new Date(config.last_sync_at);
  const elapsed = (Date.now() - last.getTime()) / (1000 * 60 * 60);
  return elapsed >= intervalHours;
}

module.exports = {
  syncExternalCompanies,
  readExternalCompanies,
  loadConfig,
  saveConfig,
  shouldSyncOnStartup,
  CSV_HEADERS,
  CSV_PATH,
  CONFIG_PATH
};
