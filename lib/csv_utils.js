/**
 * CSV 解析与写入工具
 * 支持引号内换行、转义引号等标准CSV格式
 */

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim()) return { headers: [], rows: [] };

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { currentField += '"'; i += 2; }
        else { inQuotes = false; i++; }
      } else { currentField += ch; i++; }
    } else {
      if (ch === '"') { inQuotes = true; i++; }
      else if (ch === ',') { currentRow.push(currentField); currentField = ''; i++; }
      else if (ch === '\r') {
        currentRow.push(currentField); currentField = '';
        rows.push(currentRow); currentRow = [];
        i++; if (text[i] === '\n') i++;
      } else if (ch === '\n') {
        currentRow.push(currentField); currentField = '';
        rows.push(currentRow); currentRow = [];
        i++;
      } else { currentField += ch; i++; }
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0].map(h => h.trim().replace(/^\uFEFF/, ''));
  const result = [];
  let displayCounter = 0;  // v4.0: 显示序号，从 1 递增，不随 CSV 行号跳
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue; // 跳过空行
    const obj = {};
    headers.forEach((h, j) => { obj[h] = (rows[r][j] || '').trim(); });
    obj._rowIndex = r;           // CSV 物理行号（API 调用用）
    obj.displayIndex = ++displayCounter;  // 显示序号，从 1 开始
    result.push(obj);
  }
  return { headers, rows: result };
}

function escapeCSV(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function rowsToCSV(headers, rows) {
  const headerLine = headers.map(h => escapeCSV(h)).join(',');
  const dataLines = rows.map(row => headers.map(h => escapeCSV(row[h] ?? '')).join(','));
  return headerLine + '\n' + dataLines.join('\n') + '\n';
}

function getLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// v4.1: computeMatchStatus 已迁移至 lib/job_filters.js（使用 n-gram tokenizer，匹配更精准）
// 本文件只保留纯 CSV 解析/写入/日期工具函数，不重复实现匹配度计算
// 如需匹配度计算，请使用: const { computeMatchDegree } = require('../lib/job_filters');

module.exports = {
  parseCSV,
  escapeCSV,
  rowsToCSV,
  getLocalDate
};
