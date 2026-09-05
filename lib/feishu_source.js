/**
 * 飞书 Base 外部公司库同步模块
 *
 * 用途：把外部维护的飞书多维表格同步到本地 CSV，
 *      在 CareerSail 仪表盘中以独立功能区呈现，不改变现有 job_pool 等内容。
 *
 * 工作方式：
 *   1. 读取 config/external_source.json 获取 base_token / table_id
 *   2. 调用 lark-cli base +record-list --format ndjson 分页拉取全量记录（--as user，每页上限 2000 条）
 *   3. 解析 ndjson 记录（字段名即 key，类型保留：select 为数组、日期为 ISO 字符串），转换为扁平结构
 *   4. 写入 dashboard/external_companies.csv（覆盖式更新，按「更新时间」倒序）
 *   5. 记录最后同步时间到 config/external_source.json
 *
 * v5.0 为什么用 ndjson 而不是旧 markdown 表格解析：
 *   新表（26年校招汇总）的长文本字段（专业要求/备注/批次等）值内常见换行符，
 *   markdown 输出按行切分会把一条记录截成多行导致解析损坏；
 *   ndjson 每条记录一行 JSON，换行/竖线均被转义，解析零损失，且类型信息完整。
 *
 * 数据来源（用户可配置）：
 *   默认指向「26年【秋招/春招/实习】汇总表」，可在 config/external_source.json 改成任何飞书 Base
 *
 * 持续更新策略：
 *   - 手动：仪表盘"同步"按钮 → POST /api/sync-external → 调用 syncExternalCompanies()
 *   - 自动：Agent 定时任务（Schedule 工具）每天调一次 syncExternalCompanies()
 *   - 启动时：server.js 启动检查 last_sync_at，超过 sync_interval_hours 自动同步
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { parseCSV, rowsToCSV } = require('./csv_utils');

/**
 * 解析 lark-cli 可执行文件的完整路径
 *
 * 背景：lark-cli 不一定在 server.js 子进程的 PATH 里。它可能装在：
 *   1) Trae IDE 的 lark 插件自带 lark-cli.exe（最常见，%USERPROFILE%\.trae-cn\plugins\trae-remote-official\lark\<ver>\bin）
 *   2) npm 全局（用户自定义 prefix，如 ~/.npm-global）
 *   3) 默认 npm 全局（%APPDATA%\npm）
 *   4) node.exe 同目录
 *   5) 已在 PATH 中可直接调用（兜底）
 *
 * 返回 { cmd, useShell, searched }:
 *   - useShell=false: cmd 是可执行文件完整路径，直接用 execFileSync(cmd, args)
 *   - useShell=true:  cmd 是 'lark-cli'，需经 shell 调用（兜底，依赖 PATH）
 *   - searched: 搜索过的路径数组（调试用）
 */
let _resolvedLarkCli = null;
function resolveLarkCli() {
  if (_resolvedLarkCli) return _resolvedLarkCli;

  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'lark-cli.exe' : 'lark-cli';
  const cmdName = isWin ? 'lark-cli.cmd' : 'lark-cli';
  const searched = [];

  // 1) Trae lark 插件自带的 lark-cli.exe（版本号最大的目录）
  const traePluginBase = path.join(
    process.env.USERPROFILE || '',
    '.trae-cn', 'plugins', 'trae-remote-official', 'lark'
  );
  if (fs.existsSync(traePluginBase)) {
    try {
      const versions = fs.readdirSync(traePluginBase)
        .filter(d => fs.existsSync(path.join(traePluginBase, d, 'bin', exeName)));
      versions.sort().reverse(); // 高版本优先
      for (const v of versions) {
        searched.push(path.join(traePluginBase, v, 'bin', exeName));
      }
    } catch (e) { /* 忽略 */ }
  }

  // 2) npm 全局 prefix（用户可能改过 npm config set prefix）
  try {
    const npmPrefix = execSync('npm config get prefix', {
      encoding: 'utf-8', timeout: 5000, windowsHide: true
    }).trim();
    if (npmPrefix) {
      searched.push(path.join(npmPrefix, cmdName));
      searched.push(path.join(npmPrefix, 'bin', cmdName));
      searched.push(path.join(npmPrefix, exeName));
    }
  } catch (e) { /* 忽略 */ }

  // 3) 默认 npm 全局 %APPDATA%\npm
  if (process.env.APPDATA) {
    searched.push(path.join(process.env.APPDATA, 'npm', cmdName));
  }

  // 4) node.exe 同目录
  searched.push(path.join(path.dirname(process.execPath), cmdName));
  searched.push(path.join(path.dirname(process.execPath), exeName));

  for (const c of searched) {
    if (fs.existsSync(c)) {
      // .exe 直接调用；.cmd 经 shell 调用（execFileSync 在 Windows 下跑 .cmd 需要 shell）
      const useShell = isWin && c.toLowerCase().endsWith('.cmd');
      _resolvedLarkCli = { cmd: c, useShell, searched };
      return _resolvedLarkCli;
    }
  }

  // 5) 兜底：依赖 PATH
  _resolvedLarkCli = { cmd: 'lark-cli', useShell: true, searched };
  return _resolvedLarkCli;
}

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'external_source.json');
const CSV_PATH = path.join(ROOT, 'dashboard', 'external_companies.csv');
const CONFIG_TEMPLATE = path.join(ROOT, 'templates', 'config', 'external_source.json');

// CSV 表头（与 templates/dashboard/external_companies.csv 一致）
// v5.0: 适配「26年【秋招/春招/实习】汇总表」字段：新增 行业类别/届次/学历/专业/备注/公告链接，招聘官网=简历投递链接
const CSV_HEADERS = [
  'company_name',      // 公司名称（飞书「公司」）
  'enterprise_type',   // 企业类型（民企/央国企/外企/事业单位/社会组织/合资/政府机关/其他）
  'industry',          // 行业类别（IT/互联网/游戏、能源/化工/环保 等；分号分隔）
  'batch',             // 批次（秋招专场/秋招补招/春招专场/实习/寒假实习/暑期实习/社招 等；多选分号分隔）
  'cohort',            // 招聘届次（2026届/2027届/不限届 等；多选分号分隔）
  'cities',            // 工作地点（分号分隔）
  'job_categories',    // 招聘岗位（原文，可能较长）
  'education',         // 学历要求（本科, 硕士, 博士 等）
  'major',             // 专业要求（原文，可能较长）
  'open_date',         // 开始时间（新表大部分为空）
  'deadline',          // 截止时间（文本：日期 / 尽快投递 等）
  'updated_at',        // 表格更新时间（排序主键，倒序=最新在前）
  'career_url',        // 简历投递链接（网页或 mailto: 投递邮箱）
  'career_url_text',   // 投递链接显示文本
  'notice_url',        // 公告链接（岗位公告/推文页）
  'notice_url_text',   // 公告链接显示文本
  'remark',            // 备注
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
 * 调用 lark-cli 拉取一页记录（v5.0: --format ndjson）
 * 返回 { records, has_more, next_offset }
 *
 * lark-cli base +record-list --format ndjson：
 *   - 记录逐行写入本地 ndjson 文件（每行一个 JSON 对象，字段名即 key）
 *   - stdout 只输出 manifest JSON：含 record_file 路径、has_more、next_offset、records_count
 *   - select 字段 = 字符串数组；datetime = ISO 字符串；text = 字符串或 null
 *   - 每页上限 2000 条（markdown/json 格式只有 200）
 *
 * 读取后删除临时 ndjson/manifest 文件，不污染项目目录。
 */
function fetchPage(baseToken, tableId, offset = 0, limit = 2000) {
  const args = [
    'base', '+record-list',
    '--base-token', baseToken,
    '--table-id', tableId,
    '--offset', String(offset),
    '--limit', String(limit),
    '--format', 'ndjson',
    '--as', 'user'
  ];

  // v4.10: 显式解析 lark-cli 完整路径，不再依赖子进程 PATH
  const isWin = process.platform === 'win32';
  const { cmd, useShell, searched } = resolveLarkCli();

  // 仍把已知的 lark-cli bin 目录补进子进程 PATH（兼容 useShell=true 兜底 + 插件内部再起子进程）
  const spawnEnv = { ...process.env };
  if (isWin) {
    const extra = [path.dirname(process.execPath), process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '']
      .filter(Boolean).join(';');
    spawnEnv.PATH = `${extra};${spawnEnv.PATH || ''}`;
  }
  const spawnOpts = {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB（stdout 只有 manifest，很小；这里防御性保留）
    timeout: 180000, // 每页 2000 条实测 ~20s，留足余量
    windowsHide: true,
    env: spawnEnv
  };
  let stdout;
  try {
    if (useShell && isWin) {
      // 经 cmd.exe /d /s /c 代执行（.cmd 包装器 或 PATH 兜底）
      const q = s => /[\s&|<>^"]/.test(s) ? `"${s.replace(/"/g, '')}"` : s;
      const cmdline = ['lark-cli', ...args].map(q).join(' ');
      stdout = execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmdline], spawnOpts);
    } else if (useShell && !isWin) {
      stdout = execFileSync('lark-cli', args, spawnOpts);
    } else {
      // 直接用完整路径调用 lark-cli.exe（最稳，不依赖 PATH）
      stdout = execFileSync(cmd, args, spawnOpts);
    }
  } catch (e) {
    // 失败时把搜索过的路径一并报出，便于排查
    throw new Error(
      `lark-cli 调用失败: ${e.message}` +
      (cmd !== 'lark-cli' ? `（使用: ${cmd}）` : `（未找到 lark-cli，已尝试: ${searched.join(' | ') || '无'}，请安装 trae-remote-official:lark 插件或 npx @larksuite/cli）`)
    );
  }

  // 解析 manifest（stdout 即 manifest JSON）
  let manifest;
  try {
    manifest = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`lark-cli ndjson manifest 解析失败: ${String(stdout).substring(0, 300)}`);
  }
  if (manifest.records_count === undefined) {
    throw new Error(`lark-cli 返回异常: ${String(stdout).substring(0, 300)}`);
  }

  // 读取记录文件（每行一个 JSON）
  const records = [];
  if (manifest.record_file && fs.existsSync(manifest.record_file)) {
    const content = fs.readFileSync(manifest.record_file, 'utf-8');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        records.push(JSON.parse(t));
      } catch (e) { /* 跳过损坏行，不中断整页 */ }
    }
  } else if (manifest.records_count > 0) {
    throw new Error(`ndjson 记录文件不存在: ${manifest.record_file}`);
  }

  // 清理临时文件（record_file + manifest_file 均写在当前工作目录）
  for (const f of [manifest.record_file, manifest.manifest_file]) {
    if (f) { try { fs.unlinkSync(f); } catch (e) { /* 忽略 */ } }
  }

  return {
    records,
    has_more: !!manifest.has_more,
    next_offset: (typeof manifest.next_offset === 'number') ? manifest.next_offset : null
  };
}

// ============================================================
// v5.0: ndjson 记录解析辅助（适配「26年【秋招/春招/实习】汇总表」）
// ndjson 记录为扁平结构：{ record_id, 公司, 企业类型, ... }
//   - 多选/单选字段 = 字符串数组（如 ["民企"]、["秋招专场","秋招补招"]）
//   - 文本字段 = 字符串或 null
//   - 日期字段 = ISO 字符串（如 "2026-01-17T00:00:00.000+08:00"）
//   - 链接字段 = markdown 字符串（如 "[显示文本](https://...)"）
// ============================================================

/**
 * 字段值 → 分号分隔文本（多选字段为字符串数组，文本字段为字符串或 null）
 */
function joinList(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map(v => (typeof v === 'string' ? v : (v.text || v.name || ''))).filter(Boolean).join(';');
  }
  return String(value).trim();
}

/**
 * 提取纯文本（公司/岗位等字段可能内嵌 markdown 链接，只取显示文本）
 */
function plainText(value) {
  const s = joinList(value);
  const md = s.match(/\[([^\]]+)\]\([^)]*\)/);
  return md ? md[1] : s;
}

/**
 * 日期字段 → YYYY-MM-DD
 * ndjson datetime 为 ISO 字符串；「截止时间」可能是"尽快投递"等文本，原样保留；
 * "2027/01/31" 斜杠格式归一化为 "2027-01-31"
 */
function fmtDateField(value) {
  const s = joinList(value);
  if (!s) return '';
  const m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  return s;
}

/**
 * 判断是否为说明行等噪声记录（新表首行是"表格使用说明"，不是公司）
 */
function isNoiseRecord(fields) {
  if (joinList(fields['企业类型']).includes('使用说明')) return true;
  return !joinList(fields['公司']).trim();
}

/**
 * 从飞书记录提取超链接信息
 * 支持多种输入格式：
 *   - 字符串：markdown 链接 [文本](URL)、纯 URL 或 mailto: 投递邮箱
 *   - 数组（飞书 CellValue）：[{ type:'url', text:'网易互娱招聘', link:'https://...' }]
 *                              或 [{ type:'text', text:'[网易互娱招聘](https://...)' }]
 */
function extractUrl(value) {
  // 字符串输入：可能是 markdown 链接 [文本](URL)、纯 URL 或 mailto:
  if (typeof value === 'string') {
    const mdMatch = value.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (mdMatch) {
      return { url: mdMatch[2], text: mdMatch[1] };
    }
    const urlMatch = value.match(/((?:https?|mailto):\/\/?[^\s)"']+)/);
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
 * 把飞书记录（ndjson 扁平结构）转换为 CSV 行
 * 字段映射（飞书字段名 → CSV 字段，可通过 config.field_map 调整）：
 *   公司 → company_name           企业类型 → enterprise_type
 *   行业类别 → industry           批次 → batch
 *   招聘届次 → cohort             工作地点 → cities
 *   招聘岗位 → job_categories     学历要求 → education
 *   专业要求 → major              开始时间 → open_date
 *   截止时间 → deadline           更新时间 → updated_at
 *   简历投递链接 → career_url + career_url_text
 *   公告链接 → notice_url + notice_url_text
 *   备注 → remark
 */
function recordToRow(record, fieldMap, syncedAt, userState) {
  // ndjson 记录为扁平结构：{ record_id, 公司, 企业类型, ... }
  const fields = record.fields || record;

  const row = {};
  for (const h of CSV_HEADERS) row[h] = '';
  row.synced_at = syncedAt;
  row.source_record_id = record.record_id || record._record_id || '';

  // 合并用户状态（收藏/剔除）— 同步时保留用户的标记
  if (userState) {
    row.favorited = userState.favorited || '';
    row.excluded = userState.excluded || '';
  }

  for (const [feishuName, csvName] of Object.entries(fieldMap)) {
    if (!(feishuName in fields)) continue;
    const value = fields[feishuName];

    if (csvName === 'career_url' || csvName === 'notice_url') {
      // 链接字段：提取超链接与显示文本
      const { url, text } = extractUrl(value);
      row[csvName] = url;
      row[csvName + '_text'] = text;
    } else if (csvName === 'open_date' || csvName === 'deadline' || csvName === 'updated_at') {
      // 日期字段：ISO 字符串 → YYYY-MM-DD（文本型截止时间原样保留）
      row[csvName] = fmtDateField(value);
    } else if (csvName === 'company_name' || csvName === 'job_categories' ||
               csvName === 'major' || csvName === 'remark') {
      // 长文本字段：内嵌 markdown 链接时只取显示文本
      row[csvName] = plainText(value);
    } else {
      // 多选/单选字段：字符串数组 → 分号分隔
      row[csvName] = joinList(value);
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
  const pageSize = 2000; // v5.0: ndjson 格式每页上限 2000（旧 markdown/json 格式只有 200）
  const maxPages = 100;  // 安全上限，避免死循环（2000 × 100 = 20 万条）
  let pageCount = 0;
  let skippedNoise = 0;  // 过滤掉的"表格使用说明"等非公司行

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
    '公司': 'company_name',
    '企业类型': 'enterprise_type',
    '行业类别': 'industry',
    '批次': 'batch',
    '招聘届次': 'cohort',
    '工作地点': 'cities',
    '招聘岗位': 'job_categories',
    '学历要求': 'education',
    '专业要求': 'major',
    '开始时间': 'open_date',
    '截止时间': 'deadline',
    '更新时间': 'updated_at',
    '简历投递链接': 'career_url',
    '公告链接': 'notice_url',
    '备注': 'remark'
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
      // 跳过"表格使用说明"等非公司行
      if (isNoiseRecord(record.fields || record)) { skippedNoise++; continue; }
      const rid = record.record_id || record._record_id || '';
      const userState = userStateMap[rid] || null;
      allRows.push(recordToRow(record, fieldMap, syncedAt, userState));
    }

    if (!page.has_more) break;
    // 优先用 manifest 返回的 next_offset，避免 offset 计算不一致
    offset = (page.next_offset !== null && page.next_offset !== undefined)
      ? page.next_offset
      : offset + pageSize;
  }

  // v5.0: 按「更新时间」倒序 — 新表持续更新，最新更新的公司排最前；无更新时间的排最后
  allRows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

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
    message: `同步成功：${allRows.length} 条公司记录（共 ${pageCount} 页${skippedNoise ? `，过滤 ${skippedNoise} 条说明行` : ''}）`,
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
