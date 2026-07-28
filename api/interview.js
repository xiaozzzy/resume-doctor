/**
 * 模拟面试提问接口 — Vercel Serverless Function
 * POST /api/interview  { resume: string, jd?: string }
 * 返回 { questions: [ { category, question, focus, tip } ] }
 *
 * 复用与 analyze.js / rewrite.js 完全相同的模型与环境变量:
 *   DEEPSEEK_API_KEY / API_BASE_URL / MODEL_NAME
 */

const { redis, sessionEmail } = require('./_kv.js');

const MAX_LEN = 8000;

const SYSTEM_PROMPT = `你是一位有 10 年经验的资深面试官,擅长针对候选人的简历和目标岗位设计有区分度的面试问题。你将收到一份简历,可能还有一份目标岗位 JD。请生成一组模拟面试题,帮助候选人面试前自测。

出题原则(必须严格遵守):
1. 【基于真实简历】所有"项目深挖"类问题必须引用简历中真实存在的经历,不得虚构。
2. 【对齐 JD】优先围绕目标岗位 JD 的核心要求出题;没有 JD 时,按简历自身定位的岗位出题。
3. 【有区分度】不要问"请做个自我介绍"这类套话,要问能考验候选人真实能力和思考深度的问题。
4. 【覆盖维度】题目分布覆盖:岗位匹配、项目深挖、专业知识、行为面试(STAR)、职业规划、压力/追问 等多个类别。
5. 【给候选人抓手】每题都要给出"考察点"和一条具体的"回答思路"提示(基于该候选人的简历,而不是泛泛而谈)。
6. 所有输出使用简体中文。

只输出 JSON(不要 markdown 代码块),结构如下:
{
  "questions": [
    {
      "category": "<类别,如:岗位匹配 / 项目深挖 / 专业知识 / 行为面试 / 职业规划 / 压力追问>",
      "question": "<面试问题原文>",
      "focus": "<这道题在考察什么,一句话>",
      "tip": "<结合该候选人简历的回答思路提示,一句话>"
    }
  ]
}
questions 给 6-8 道,类别尽量分散。`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST 请求' });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '服务器尚未配置 API Key(环境变量 DEEPSEEK_API_KEY)。' });
  }

  const who = await sessionEmail(req);
  if (!who) return res.status(401).json({ error: '请先登录后再使用此功能。' });

  const { resume, jd } = req.body || {};
  if (!resume || typeof resume !== 'string' || resume.trim().length < 50) {
    return res.status(400).json({ error: '简历内容太短,请提供完整的简历文本。' });
  }
  if (resume.length > MAX_LEN || (jd && jd.length > MAX_LEN)) {
    return res.status(400).json({ error: '内容超过 8000 字上限。' });
  }

  const userContent = jd && jd.trim()
    ? `【简历】\n${resume}\n\n【目标岗位 JD】\n${jd}`
    : `【简历】\n${resume}\n\n(未提供 JD,请按简历自身定位的岗位出题)`;

  try {
    const baseUrl = (process.env.API_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const payload = {
      model: process.env.MODEL_NAME || 'deepseek-chat',
      temperature: 0.5,
      max_tokens: 3000,
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
      console.error('model API error:', apiResp.status, errText);
      if (apiResp.status === 401) return res.status(500).json({ error: 'API Key 无效,请检查环境变量配置。' });
      if (apiResp.status === 402) return res.status(500).json({ error: 'API 账户余额不足。' });
      if (apiResp.status === 429) return res.status(503).json({ error: '请求过于频繁,请稍等几秒再试。' });
      return res.status(502).json({ error: '模型服务暂时不可用,请稍后重试。' });
    }

    const result = await apiResp.json();
    const content = result?.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty model response');

    let data;
    try {
      data = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('unparseable model response');
      data = JSON.parse(m[0]);
    }

    let questions = Array.isArray(data.questions) ? data.questions : [];
    // 结构清洗,保证前端渲染稳定
    questions = questions
      .filter(q => q && typeof q.question === 'string' && q.question.trim())
      .map(q => ({
        category: (typeof q.category === 'string' && q.category.trim()) ? q.category.trim() : '面试问题',
        question: q.question.trim(),
        focus: (typeof q.focus === 'string') ? q.focus.trim() : '',
        tip: (typeof q.tip === 'string') ? q.tip.trim() : ''
      }));
    if (!questions.length) throw new Error('no questions parsed');

    await redis('incr', 'count:interviews').catch(() => {}); // 计数失败不影响主流程

    return res.status(200).json({ questions });
  } catch (err) {
    console.error('interview error:', err);
    return res.status(500).json({ error: '生成过程出错,请稍后重试。' });
  }
};
