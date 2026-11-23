// 每日定时代签：按账号设定的时区/时间执行，幂等，失败按冷却重试。
import { listAccounts, getAccount, credentialsFor, recordResult, updateAccount } from './store.mjs';
import { signIn } from './upstream.mjs';
import { notify } from './push.mjs';

const COOLDOWN_MS = 10 * 60 * 1000;
const retryAt = new Map();
const running = new Set();

export function clockIn(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hhmm = `${get('hour')}:${get('minute')}`;
  return { date, hhmm };
}

export async function runNow(uid, { trigger = 'manual' } = {}) {
  if (running.has(uid)) return { ok: false, reason: 'running' };
  const acc = getAccount(uid);
  if (!acc) return { ok: false, reason: 'not-found' };
  const cred = credentialsFor(uid);
  if (!cred) return { ok: false, reason: 'no-credential' };

  running.add(uid);
  const { date } = clockIn(acc.tz);
  try {
    const out = await signIn(cred);
    recordResult(uid, {
      date,
      result: out.result,
      credit: out.credit,
      streak: out.streak,
      total: out.total,
      report: out.report,
    });
    await notify(uid, {
      title: out.result === 'CLAIMED' ? '签到成功' : out.result === 'ALREADY' ? '今日已签到' : '签到未执行',
      body: `${out.report || ''}${out.streak ? ` · 连续 ${out.streak} 天` : ''}`.trim(),
      tag: 'checkin',
      uid,
    });
    return { ok: true, result: out.result, credit: out.credit, streak: out.streak, report: out.report, trigger };
  } catch (err) {
    const auth = err.code === 'AUTH';
    recordResult(uid, {
      date: auth ? date : null,
      result: auth ? 'AUTH' : 'ERROR',
      credit: 0,
      report: auth ? '登录已失效，需要重新绑定' : err.message || '签到失败',
    });
    if (!auth) retryAt.set(uid, Date.now() + COOLDOWN_MS);
    await notify(uid, {
      title: auth ? '需要重新登录 WorkBuddy' : '签到失败',
      body: auth ? '授权已失效，打开签到助手重新绑定即可恢复。' : (err.message || '稍后会自动重试'),
      tag: auth ? 'auth' : 'error',
      uid,
    });
    return { ok: false, result: auth ? 'AUTH' : 'ERROR', report: err.message };
  } finally {
    running.delete(uid);
  }
}

export function tick() {
  const accounts = listAccounts();
  for (const meta of accounts) {
    if (!meta.enabled || meta.needsRebind) continue;
    if (running.has(meta.uid)) continue;
    const acc = getAccount(meta.uid);
    if (!acc) continue;
    const { date, hhmm } = clockIn(acc.tz);
    if (acc.lastDate === date) continue;
    if (hhmm < acc.time) continue;
    if ((retryAt.get(meta.uid) || 0) > Date.now()) continue;
    runNow(meta.uid, { trigger: 'schedule' }).catch(() => {});
  }
}

export function startScheduler({ intervalMs = 30000 } = {}) {
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}

export { updateAccount };
