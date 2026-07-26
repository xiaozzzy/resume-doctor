/**
 * 简历诊断接口 — Vercel Serverless Function
 * POST /api/analyze  { resume: string, jd?: string }
 *
 * 环境变量:
 *   DEEPSEEK_API_KEY  — 必填,模型平台的 API Key(DeepSeek 或任何 OpenAI 兼容平台)
 *   API_BASE_URL      — 选填,默认 https://api.deepseek.com(OpenAI 兼容平台可改)
 *   MODEL_NAME        — 选填,默认 deepseek-chat
 */

const { redis, sessionEmail } = require('./_kv.js');

const MAX_LEN = 8000;

const SYSTEM_PROMPT = `你是一位有 10 年经验的资深 HR 兼猎头,擅长一眼看出简历的问题并给出可落地的修改建议。你将收到一份简历文本,可能还有一份目标岗位 JD。

请从以下五个维度诊断简历(每个维度 0-100 分):
1. 岗位匹配度:技能与经历是否覆盖 JD 的核心要求(无 JD 时按简历自身目标岗位推断)
2. 量化程度:经历描述是否有数字化的结果(STAR 法则中的 Result)
3. 表达质量:是否使用精确的动作动词,避免"负责""参与"等空泛表述和套话
4. 结构完整度:模块是否齐全、排序是否合理、篇幅是否得当
5. 关键词覆盖:JD 中的硬技能关键词是否在简历中出现(应对 ATS 机器筛选)

综合评分标准(务必严格,不要给人情分):
- 80-100:可直接投递,仅需微调
- 65-79:小幅打磨后投递
- 45-64:存在明显问题,建议优化后再投
- 0-44:需要大幅修改

要求:
- 每个问题必须引用简历原文(quote 字段),不允许泛泛而谈
- 改写示范必须基于简历中真实存在的句子,不得虚构经历;缺失的数字用"X"占位并在 why 中提醒用户填入真实数据
- 如果没有提供 JD,missing_keywords 返回空数组,岗位匹配度按简历自身定位评估
- 所有输出使用简体中文

只输出 JSON(不要 markdown 代码块),结构如下:
{
  "score": <0-100 整数>,
  "verdict": "<一句话总评,50-80字>",
  "dimensions": [
    {"name": "岗位匹配度", "score": <0-100>, "comment": "<一句话点评>"},
    {"name": "量化程度", "score": <0-100>, "comment": "..."},
    {"name": "表达质量", "score": <0-100>, "comment": "..."},
    {"name": "结构完整度", "score": <0-100>, "comment": "..."},
    {"name": "关键词覆盖", "score": <0-100>, "comment": "..."}
  ],
  "missing_keywords": ["<JD中出现但简历未覆盖的技能词>", "..."],
  "issues": [
    {"severity": "high|medium|low", "title": "<问题标题>", "quote": "<简历原文引用>", "suggestion": "<具体建议>"}
  ],
  "rewrites": [
    {"before": "<原文>", "after": "<改写后>", "why": "<改写思路说明>"}
  ]
}
issues 给 3-6 条,rewrites 给 2-3 条。`;

module.exports = async (req, res) => {
  // CORS(便于本地调试)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST 请求' });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '服务器尚未配置 API Key(环境变量 DEEPSEEK_API_KEY)。你可以先点击"查看演示报告"体验效果。' });
  }

  const who = await sessionEmail(req);
  if (!who) return res.status(401).json({ error: '请先登录后再使用诊断功能。' });

  const { resume, jd } = req.body || {};
  if (!resume || typeof resume !== 'string' || resume.trim().length < 50) {
    return res.status(400).json({ error: '简历内容太短,请提供完整的简历文本。' });
  }
  if (resume.length > MAX_LEN || (jd && jd.length > MAX_LEN)) {
    return res.status(400).json({ error: '内容超过 8000 字上限。' });
  }

  const userContent = jd && jd.trim()
    ? `【简历】\n${resume}\n\n【目标岗位 JD】\n${jd}`
    : `【简历】\n${resume}\n\n(未提供 JD,请做通用体检)`;

  try {
    const baseUrl = (process.env.API_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const payload = {
      model: process.env.MODEL_NAME || 'deepseek-chat',
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ]
    };
    const callModel = (body) => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    let apiResp = await callModel(payload);
    if (apiResp.status === 400) {
      // 部分兼容平台不支持 response_format 参数,去掉后重试一次
      const { response_format, ...fallback } = payload;
      apiResp = await callModel(fallback);
    }

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      console.error('DeepSeek API error:', apiResp.status, errText);
      if (apiResp.status === 401) return res.status(500).json({ error: 'API Key 无效,请检查环境变量配置。' });
      if (apiResp.status === 402) return res.status(500).json({ error: 'API 账户余额不足,请前往 DeepSeek 平台充值。' });
      if (apiResp.status === 429) return res.status(503).json({ error: '请求过于频繁,请稍等几秒再试。' });
      return res.status(502).json({ error: '模型服务暂时不可用,请稍后重试。' });
    }

    const result = await apiResp.json();
    const content = result?.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty model response');

    let report;
    try {
      report = JSON.parse(content);
    } catch {
      // 容错:剥掉可能出现的 markdown 代码块再解析
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('unparseable model response');
      report = JSON.parse(m[0]);
    }

    // 基本结构校验,保证前端渲染稳定
    if (typeof report.score !== 'number' || !Array.isArray(report.dimensions)) {
      throw new Error('unexpected report structure');
    }
    report.score = Math.max(0, Math.min(100, Math.round(report.score)));
    report.missing_keywords = Array.isArray(report.missing_keywords) ? report.missing_keywords : [];
    report.issues = Array.isArray(report.issues) ? report.issues : [];
    report.rewrites = Array.isArray(report.rewrites) ? report.rewrites : [];

    await redis('incr', 'count:analyses').catch(() => {}); // 计数失败不影响主流程

    return res.status(200).json(report);
  } catch (err) {
    console.error('analyze error:', err);
    return res.status(500).json({ error: '分析过程出错,请稍后重试。' });
  }
};
