/**
 * 图片文字识别接口(用多模态模型做 OCR)
 * POST /api/extract  { image: "data:image/jpeg;base64,..." }
 * 返回 { text }
 */
const { sessionEmail } = require('./_kv.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST' });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: '服务器尚未配置 API Key。' });

  const who = await sessionEmail(req);
  if (!who) return res.status(401).json({ error: '图片识别需要先登录。' });

  const { image } = req.body || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: '图片数据无效。' });
  }
  if (image.length > 4 * 1024 * 1024) {
    return res.status(400).json({ error: '图片太大,请换清晰度低一些的图片。' });
  }

  try {
    const baseUrl = (process.env.API_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
    const apiResp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.VISION_MODEL || process.env.MODEL_NAME || 'deepseek-chat',
        temperature: 0,
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请把图片中的文字内容完整转录为纯文本,保持原有的结构和顺序(标题、分条等用换行区分)。只输出转录出的文本本身,不要添加任何解释、评论或格式标记。' },
            { type: 'image_url', image_url: { url: image } }
          ]
        }]
      })
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      console.error('vision API error:', apiResp.status, errText);
      return res.status(502).json({ error: '图片识别服务暂时不可用,请改用 PDF 或手动粘贴文本。' });
    }

    const result = await apiResp.json();
    const text = result?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty vision response');

    return res.status(200).json({ text });
  } catch (err) {
    console.error('extract error:', err);
    return res.status(500).json({ error: '图片识别失败,请改用 PDF 或手动粘贴文本。' });
  }
};
