// 本地测试服务器:静态托管 index.html + 模拟 /api/analyze
// 用法: node test/server.js  → http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const MOCK_REPORT = {
  score: 72,
  verdict: '简历整体质量不错,经历有一定量化,但与目标岗位的 AI 相关关键词覆盖不足,小幅打磨后即可投递。',
  dimensions: [
    { name: '岗位匹配度', score: 68, comment: 'JD 要求的 Prompt 设计经验未在简历中体现。' },
    { name: '量化程度', score: 75, comment: '多数经历有数字,但缺少对比基线。' },
    { name: '表达质量', score: 80, comment: '动作动词使用得当,个别句子偏长。' },
    { name: '结构完整度', score: 82, comment: '结构清晰,建议增加个人定位一句话。' },
    { name: '关键词覆盖', score: 60, comment: '命中 6/10,缺 RAG、Agent 等核心词。' }
  ],
  missing_keywords: ['Prompt 工程', 'RAG', 'Agent', '用户调研'],
  issues: [
    { severity: 'high', title: '缺少与 AI 产品直接相关的经历描述', quote: '负责产品的日常运营工作。', suggestion: '把使用 AI 工具完成的具体工作单独提炼成一条经历。' },
    { severity: 'medium', title: '部分成果缺少对比基线', quote: '将转化率提升至 5%。', suggestion: '补充提升前的数字,如"从 2% 提升至 5%"。' },
    { severity: 'low', title: '技能罗列过于笼统', quote: '熟悉各类办公软件。', suggestion: '替换为具体工具名 + 熟练度。' }
  ],
  rewrites: [
    { before: '负责产品的日常运营工作。', after: '独立负责 X 产品运营,搭建数据看板监控 5 项核心指标,月活从 X 提升至 X(+40%)。', why: '补齐了动作和可验证结果,请把 X 替换为真实数字。' }
  ]
};

const MOCK_REWRITE = `# [姓名]\n\n**求职意向:AI 产品运营 | [电话] | [邮箱]**\n\n## 实习经历\n**某互联网公司 · 运营实习生**(2025.3 – 2025.6)\n- 独立运营公众号 [X] 个月,平均阅读量从 [X] 提升至 [X]\n\n---\n\n📝 待你补充的信息:\n1. 公众号运营数据`;

http.createServer((req, res) => {
  if (req.url === '/api/rewrite' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: MOCK_REWRITE }));
      }, 600);
    });
    return;
  }
  if (req.url === '/api/analyze' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      setTimeout(() => {  // 模拟模型延迟
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(MOCK_REPORT));
      }, 800);
    });
    return;
  }
  const file = req.url === '/' ? '/index.html' : req.url;
  const fp = path.join(ROOT, file.split('?')[0]);
  if (fp.startsWith(ROOT) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { 'Content-Type': fp.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    res.end(fs.readFileSync(fp));
  } else {
    res.writeHead(404); res.end('not found');
  }
}).listen(3000, () => console.log('test server on http://localhost:3000'));
