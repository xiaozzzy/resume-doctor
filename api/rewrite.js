/**
 * 简历重写接口 — Vercel Serverless Function
 * POST /api/rewrite  { resume: string, jd?: string }
 * 返回 { content: string }  — 按 JD 优化后的完整简历(Markdown)
 *
 * 环境变量同 analyze.js:DEEPSEEK_API_KEY / API_BASE_URL / MODEL_NAME
 */

const { redis, sessionEmail } = require('./_kv.js');

const MAX_LEN = 8000;

const SYSTEM_PROMPT = `你是一位有 10 年经验的资深简历改写专家。你将收到一份简历原文,可能还有一份目标岗位 JD。请输出一份完整的、优化后的简历。

改写原则(必须严格遵守):
1. 【绝对诚实】只能基于原简历中真实存在的经历改写,严禁虚构任何经历、公司、项目或技能。
2. 【数字占位】原文缺少量化数据的地方,用占位符 [X] 标注(如"阅读量提升 [X]%"),让求职者自行填入真实数字,不要编造数字。
3. 【对齐 JD】把原有经历用目标岗位的语言重新表述,优先突出与 JD 要求相关的技能和经历;JD 中要求但简历完全没有的能力,不要硬加。
4. 【STAR 法则】每条经历尽量体现:背景/任务 → 具体动作 → 可量化结果。
5. 【动词升级】替换"负责""参与"等弱动词为:主导、搭建、策划并落地、复盘迭代等精确动词。
6. 【结构优化】合理排序:一句话个人定位 → 核心技能 → 实习/项目经历(按相关度排序)→ 教育背景。删除空泛的自我评价。

输出格式:
- 直接输出简历正文,用 Markdown 格式(# 姓名区、## 模块标题、- 条目)
- 姓名、电话、邮箱用 [姓名] [电话] [邮箱] 占位
- 简历正文之后,空两行,加一个"---"分隔线,再加一段"📝 待你补充的信息",逐条列出所有 [X] 占位符对应需要填写的真实数据
- 不要输出任何其他解释性文字`;

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
    ? `【简历原文】\n${resume}\n\n【目标岗位 JD】\n${jd}`
    : `【简历原文】\n${resume}\n\n(未提供 JD,请做通用优化)`;

  try {
    const baseUrl = (process.env.API_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const apiResp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.MODEL_NAME || 'deepseek-chat',
        temperature: 0.4,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ]
      })
    });

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
    if (!content || !content.trim()) throw new Error('empty model response');

    redis('incr', 'count:rewrites').catch(() => {});

    return res.status(200).json({ content: content.trim() });
  } catch (err) {
    console.error('rewrite error:', err);
    return res.status(500).json({ error: '生成过程出错,请稍后重试。' });
  }
};
