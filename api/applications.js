/**
 * 投递记录同步接口。
 * 只保存用户主动维护的公司、岗位和进度，绝不保存简历原文或 JD。
 */
const { redis, kvConfigured, sessionEmail } = require('./_kv.js');

const MAX_RECORDS = 200;

function cleanRecord(item) {
  if (!item || typeof item !== 'object') return null;
  const company = String(item.company || '').trim().slice(0, 80);
  const jobTitle = String(item.jobTitle || '').trim().slice(0, 80);
  if (!company || !jobTitle) return null;
  return {
    id: String(item.id || '').trim().slice(0, 80),
    company,
    jobTitle,
    status: String(item.status || '已投递').trim().slice(0, 20),
    date: String(item.date || '').trim().slice(0, 20),
    note: String(item.note || '').trim().slice(0, 200)
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!kvConfigured()) return res.status(503).json({ error: '云端同步尚未配置，记录仍保存在当前设备。' });

  const email = await sessionEmail(req);
  if (!email || email === '__kv_off__') return res.status(401).json({ error: '请先登录后同步记录。' });
  const key = `job-data:${email}`;

  try {
    if (req.method === 'GET') {
      const saved = await redis('get', key);
      let data = {};
      try { data = saved ? JSON.parse(saved) : {}; } catch { data = {}; }
      return res.status(200).json({
        records: Array.isArray(data.records) ? data.records : [],
        offers: data.offers && typeof data.offers === 'object' ? data.offers : {}
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 GET 或 POST 请求' });

    const items = Array.isArray(req.body && req.body.records) ? req.body.records : [];
    const records = items.slice(0, MAX_RECORDS).map(cleanRecord).filter(Boolean);
    const offers = req.body && req.body.offers && typeof req.body.offers === 'object' ? req.body.offers : {};
    await redis('set', key, JSON.stringify({ records, offers }));
    return res.status(200).json({ ok: true, count: records.length });
  } catch (err) {
    console.error('applications error:', err);
    return res.status(500).json({ error: '云端同步失败，已保留本地记录。' });
  }
};
