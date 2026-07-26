/**
 * 公开统计接口  GET /api/stats
 * 只返回聚合数字,不含任何个人信息
 */
const { redis, kvConfigured } = require('./_kv.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60'); // CDN 缓存 1 分钟
  if (!kvConfigured()) return res.status(200).json({ users: 0, analyses: 0, rewrites: 0 });
  try {
    const [users, analyses, rewrites] = await Promise.all([
      redis('scard', 'users'),
      redis('get', 'count:analyses'),
      redis('get', 'count:rewrites')
    ]);
    return res.status(200).json({
      users: Number(users) || 0,
      analyses: Number(analyses) || 0,
      rewrites: Number(rewrites) || 0
    });
  } catch (err) {
    console.error('stats error:', err);
    return res.status(200).json({ users: 0, analyses: 0, rewrites: 0 });
  }
};
