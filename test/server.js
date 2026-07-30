// 本地测试服务器:静态文件 + 模拟 API(不调用真实模型/Redis/邮件)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3000;

const MOCK_REPORT = {
  score: 72,
  verdict: '简历整体结构清晰,但量化成果不足是最大短板。建议围绕目标JD补充3-5个带数字的成果描述,匹配度可提升至85分以上再投递。',
  dimensions: [
    { name: '岗位匹配度', score: 70, comment: '核心关键词覆盖一般,缺少数据分析相关表述' },
    { name: '成果量化', score: 55, comment: '多数经历缺少数字支撑' },
    { name: '关键词覆盖', score: 75, comment: '覆盖了产品设计、需求分析等词' },
    { name: '结构与排版', score: 85, comment: '结构清晰,模块完整' },
    { name: '语言表达', score: 75, comment: '表达尚可,部分句子偏口语化' },
  ],
  missing_keywords: ['SQL', 'A/B 测试', '数据埋点', '用户画像'],
  issues: [
    { severity: 'high', title: '缺少量化成果', quote: '负责公司产品的日常运营工作', suggestion: '补充具体数据,如用户量、增长率、转化率' },
    { severity: 'medium', title: '技能描述与JD不匹配', quote: '熟悉办公软件', suggestion: 'JD要求数据分析能力,应突出SQL/Excel建模等技能' },
    { severity: 'low', title: '自我评价空泛', quote: '工作认真负责,有责任心', suggestion: '用具体事例替代形容词' },
  ],
  rewrites: [
    { before: '负责公司产品的日常运营工作', after: '负责XX产品日常运营,3个月内将DAU从1.2万提升至2.5万(+108%)', why: '把职责改成带数字的成果,让HR一眼看到你的价值' },
    { before: '熟悉办公软件', after: '熟练使用SQL与Excel透视表完成用户行为分析,支撑3次产品迭代决策', why: '对齐JD要求的数据分析能力,具体到工具和产出' },
  ],
};

const MOCK_REWRITE = `# 张三
📱 138-XXXX-XXXX | ✉️ zhangsan@example.com | 求职意向:产品经理

## 个人简介
3年互联网产品运营经验,擅长数据驱动增长,曾主导DAU翻倍项目。

## 工作经历
**XX科技有限公司 | 产品运营 | 2023.06 - 至今**
- 负责XX产品日常运营,3个月内将DAU从1.2万提升至2.5万(+108%)
- 熟练使用SQL与Excel透视表完成用户行为分析,支撑3次产品迭代决策
- 搭建用户反馈闭环机制,需求响应周期从7天缩短至2天

## 教育背景
**XX大学 | 本科 | 市场营销 | 2019 - 2023**

## 技能
SQL / Excel建模 / Axure / 墨刀 / 数据埋点分析

## 待你补充
- [X] 请补充最近一段实习/项目的具体数据
- [X] 请确认求职意向城市`;

const MOCK_EXTRACT = `张三
电话:138-XXXX-XXXX 邮箱:zhangsan@example.com
求职意向:产品经理
工作经历:
XX科技有限公司 产品运营 2023.06-至今
负责公司产品的日常运营工作,熟悉办公软件。
教育背景:XX大学 本科 市场营销 2019-2023
自我评价:工作认真负责,有责任心。`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let MOCK_APPLICATIONS = [];

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/analyze' && req.method === 'POST') {
    await readBody(req);
    setTimeout(() => json(res, 200, MOCK_REPORT), 800);
    return;
  }
  if (p === '/api/rewrite' && req.method === 'POST') {
    await readBody(req);
    setTimeout(() => json(res, 200, { content: MOCK_REWRITE }), 800);
    return;
  }
  if (p === '/api/extract' && req.method === 'POST') {
    await readBody(req);
    setTimeout(() => json(res, 200, { text: MOCK_EXTRACT }), 500);
    return;
  }
  if (p === '/api/auth-send-code' && req.method === 'POST') {
    const b = await readBody(req);
    console.log('[mock] send code 123456 to', b.email);
    json(res, 200, { ok: true });
    return;
  }
  if (p === '/api/auth-verify' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.code === '123456') json(res, 200, { token: 'test-token-0123456789abcdef', email: b.email });
    else json(res, 400, { error: '验证码错误' });
    return;
  }
  if (p === '/api/stats') {
    json(res, 200, { users: 12, analyses: 34, rewrites: 8 });
    return;
  }
  if (p === '/api/applications') {
    if (req.method === 'GET') { json(res, 200, { records: MOCK_APPLICATIONS }); return; }
    if (req.method === 'POST') {
      const b = await readBody(req);
      MOCK_APPLICATIONS = Array.isArray(b.records) ? b.records : [];
      json(res, 200, { ok: true, count: MOCK_APPLICATIONS.length });
      return;
    }
  }

  // 静态文件
  let file = p === '/' ? '/index.html' : p;
  const full = path.join(ROOT, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`test server on http://localhost:${PORT}`));
