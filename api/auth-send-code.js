/**
 * 发送邮箱验证码  POST /api/auth-send-code  { email }
 * 环境变量: BREVO_API_KEY(Brevo 邮件服务)、SENDER_EMAIL(已验证的发件邮箱)
 */
const { redis, kvConfigured } = require('./_kv.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST' });

  if (!kvConfigured()) return res.status(500).json({ error: '服务器未配置存储,请联系管理员。' });
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) {
    return res.status(500).json({ error: '服务器未配置邮件服务,请联系管理员。' });
  }

  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 100) {
    return res.status(400).json({ error: '邮箱格式不正确。' });
  }

  try {
    // 限频:同一邮箱 60 秒内只发一次
    const rl = await redis('incr', `rl:send:${email}`);
    if (rl === 1) await redis('expire', `rl:send:${email}`, '60');
    if (rl > 1) return res.status(429).json({ error: '发送太频繁,请 60 秒后再试。' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await redis('set', `code:${email}`, code, 'EX', '600');
    await redis('del', `rl:verify:${email}`);

    const mailResp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: '简历医生', email: process.env.SENDER_EMAIL },
        to: [{ email }],
        subject: `【简历医生】登录验证码:${code}`,
        htmlContent: `<div style="font-family:sans-serif;line-height:1.8"><p>你好!你正在登录「简历医生」。</p><p>验证码:<b style="font-size:24px;letter-spacing:2px">${code}</b></p><p style="color:#888">10 分钟内有效。如果这不是你的操作,请忽略本邮件。</p></div>`
      })
    });
    if (!mailResp.ok) {
      console.error('brevo error:', mailResp.status, await mailResp.text());
      return res.status(502).json({ error: '邮件发送失败,请稍后重试或检查邮箱地址。' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-code error:', err);
    return res.status(500).json({ error: '发送验证码出错,请稍后重试。' });
  }
};
