/**
 * Upstash Redis REST 极简客户端(Vercel Marketplace 集成自动注入环境变量)
 * 用法: await redis('set', 'key', 'value', 'EX', '600')
 */
const BASE = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

const kvConfigured = () => Boolean(BASE && TOKEN);

async function redis(...parts) {
  const resp = await fetch(`${BASE}/${parts.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `kv error ${resp.status}`);
  return data.result;
}

/** 校验会话 token,返回邮箱或 null */
async function sessionEmail(req) {
  if (!kvConfigured()) return '__kv_off__'; // KV 未配置时降级放行,不阻塞核心功能
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.length < 20) return null;
  try {
    return await redis('get', `sess:${token}`);
  } catch {
    return '__kv_off__'; // KV 故障时降级放行
  }
}

module.exports = { redis, kvConfigured, sessionEmail };
