// 与 WorkBuddy 服务端通信：签到状态查询、领取、令牌刷新。
// 只做转发与结果归一化，调用方负责决定是否落盘。
const UPSTREAM = process.env.WB_UPSTREAM || 'https://copilot.tencent.com';
const ALLOWED = new Set([
  '/v2/billing/meter/checkin-activity-status',
  '/v2/billing/meter/daily-checkin',
]);

export class UpstreamError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

function headers({ token, uid, domain }) {
  return {
    authorization: 'Bearer ' + token,
    'x-user-id': String(uid),
    'x-domain': domain || 'www.workbuddy.cn',
    'content-type': 'application/json',
    'user-agent': 'WorkBuddy/checkin-app',
  };
}

export async function call({ token, uid, domain, apiPath, payload = {} }) {
  if (!ALLOWED.has(apiPath)) throw new UpstreamError('BAD_PATH', 'path not allowed');
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(UPSTREAM + apiPath, {
        method: 'POST',
        headers: headers({ token, uid, domain }),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 400) }; }
      if (res.status >= 500 && attempt === 0) continue;
      return { status: res.status, data };
    } catch (err) {
      lastError = err;
      if (attempt === 0) continue;
    }
  }
  throw new UpstreamError('NETWORK', lastError?.name || 'NETWORK');
}

function normalizeStatus(raw) {
  const d = raw?.data && typeof raw.data === 'object' ? raw.data : raw || {};
  return {
    active: d.active !== false,
    checked: d.today_checked_in === true || d.today_checked_in === 1,
    todayCredit: Number(d.today_credit ?? 0) || 0,
    streak: Number(d.streak_days ?? d.streakDays ?? 0) || 0,
    total: Number(d.total_credits ?? d.totalCredits ?? 0) || 0,
  };
}

export async function status(cred) {
  const res = await call({ ...cred, apiPath: '/v2/billing/meter/checkin-activity-status' });
  if (res.status === 401) throw new UpstreamError('AUTH', '登录状态已失效');
  if (res.status === 403) throw new UpstreamError('FORBIDDEN', '服务端拒绝');
  if (res.status < 200 || res.status >= 300) {
    throw new UpstreamError('HTTP', res?.data?.msg || `HTTP ${res.status}`, { status: res.status });
  }
  return normalizeStatus(res.data);
}

/** 幂等签到：先查状态，未签才领；返回统一结果。 */
export async function signIn(cred) {
  const before = await status(cred);
  if (before.active === false) {
    return { result: 'INACTIVE', credit: 0, ...before, report: '今日签到活动未开启' };
  }
  if (before.checked) {
    return { result: 'ALREADY', credit: before.todayCredit, ...before, report: '今日已签过' };
  }
  const res = await call({ ...cred, apiPath: '/v2/billing/meter/daily-checkin' });
  if (res.status === 401) throw new UpstreamError('AUTH', '登录状态已失效');
  if (res.status < 200 || res.status >= 300) {
    const msg = String(res?.data?.msg || '');
    if (msg.includes('已签')) return { result: 'ALREADY', credit: before.todayCredit, ...before, report: '今日已签过' };
    throw new UpstreamError('HTTP', msg || `HTTP ${res.status}`, { status: res.status });
  }
  const d = res.data?.data && typeof res.data.data === 'object' ? res.data.data : res.data || {};
  const credit = Number(d.credit ?? d.credit_amount ?? before.todayCredit) || 0;
  let after = before;
  try { after = await status(cred); } catch { /* 查询失败不影响领取结果 */ }
  return { result: 'CLAIMED', credit, ...after, report: after.checked ? `签到成功，+${credit}` : '已提交签到' };
}

export { ALLOWED };
