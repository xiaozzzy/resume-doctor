/**
 * 校验验证码并创建会话  POST /api/auth-verify  { email, code }
 * 返回 { token, email }
 */
const crypto = require('crypto');
const { redis, kvConfigured } = require('./_kv.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST' });
  if (!kvConfigured()) return res.status(500).json({ error: '服务器未配置存储。' });

  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: '请输入 6 位数字验证码。' });

  try {
    // 防爆破:同一邮箱最多试 5 次
    const rl = await redis('incr', `rl:verify:${email}`);
    if (rl === 1) await redis('expire', `rl:verify:${email}`, '600');
    if (rl > 5) return res.status(429).json({ error: '尝试次数过多,请重新获取验证码。' });

    const saved = await redis('get', `code:${email}`);
    if (!saved || saved !== code) return res.status(400).json({ error: '验证码错误或已过期。' });

    await redis('del', `code:${email}`);
    const token = crypto.randomBytes(24).toString('hex');
    await redis('set', `sess:${token}`, email, 'EX', String(30 * 24 * 3600)); // 30 天
    const added = await redis('sadd', 'users', email); // 用户去重集合
    if (added === 1) await redis('incr', 'count:signups');

    return res.status(200).json({ token, email });
  } catch (err) {
    console.error('verify error:', err);
    return res.status(500).json({ error: '登录出错,请稍后重试。' });
  }
};
