// 签到助手 · 应用主逻辑（无框架，原生 ES Module）
import icons from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const VERSION = '1.0.0';

const KEY = {
  accounts: 'wb.accounts',
  active: 'wb.active',
  settings: 'wb.settings',
  history: 'wb.history',
};

const state = {
  booted: false,
  view: 'today',
  accounts: [],
  activeId: null,
  settings: { auto: true, time: '00:05', theme: 'auto', push: false, server: '', accessKey: '' },
  history: {},
  status: null,
  statusAt: null,
  busy: false,
  proxy: null,
  calMonth: new Date(),
  sheet: null,
  cloud: { ready: false, accounts: [], busy: false },
};

/* ------------------------------------------------------------------ */
/* 存储                                                                */
/* ------------------------------------------------------------------ */

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 忽略配额错误 */ }
}

function load() {
  state.accounts = read(KEY.accounts, []);
  if (!Array.isArray(state.accounts)) state.accounts = [];
  state.activeId = read(KEY.active, null) || state.accounts[0]?.id || null;
  state.settings = { ...state.settings, ...read(KEY.settings, {}) };
  state.history = read(KEY.history, {});
  if (!state.history || typeof state.history !== 'object') state.history = {};
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const activeAccount = () =>
  state.accounts.find((a) => a.id === state.activeId) || state.accounts[0] || null;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const maskUid = (uid) => {
  const s = String(uid || '');
  if (s.length <= 4) return s;
  return `${s.slice(0, 3)} ${'•'.repeat(Math.min(4, s.length - 4))} ${s.slice(-2)}`;
};

function fmtDateLong(d = new Date()) {
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEK[d.getDay()]}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function initialOf(acc) {
  const name = String(acc?.name || '').trim();
  if (!name || name.startsWith('账号 ')) {
    return state.accounts.length > 1 ? String(acc?.uid || 'W').slice(-2) : 'W';
  }
  return name.slice(0, 1).toUpperCase();
}

function shiftDate(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '00:05').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/* ------------------------------------------------------------------ */
/* 网络层                                                              */
/* ------------------------------------------------------------------ */

/** 组装 API 地址：网页版用同源，APK / 独立部署时可指定服务器 */
function apiUrl(pathname) {
  const base = String(state.settings.server || '').replace(/\/+$/, '');
  return base ? base + pathname : pathname;
}

function apiHeaders(extra = {}) {
  const headers = { ...extra };
  if (state.settings.accessKey) headers['x-access-key'] = state.settings.accessKey;
  return headers;
}

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function detectProxy() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(apiUrl('/api/health'), { signal: ctrl.signal });
    clearTimeout(timer);
    state.proxy = r.ok;
  } catch {
    state.proxy = false;
  }
  return state.proxy;
}

async function callApi(cred, apiPath, payload = {}) {
  if (cred.demo) return demoApi(apiPath, payload);
  if (!state.proxy) throw new ApiError('NO_PROXY', '未连接到签到服务，请用 npm start 启动后访问');
  let res;
  try {
    const r = await fetch(apiUrl('/api/wb'), {
      method: 'POST',
      headers: apiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        token: cred.token,
        uid: cred.uid,
        domain: cred.domain,
        apiPath,
        payload,
      }),
    });
    if (r.status === 403) throw new ApiError('KEY', '访问口令不正确，请在「我的 → 访问口令」里更新');
    res = await r.json();
    if (!r.ok) throw new ApiError('ERROR', res?.error || `请求失败（${r.status}）`);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('NETWORK', '网络不可达，稍后再试');
  }
  if (res.status === 401) throw new ApiError('AUTH', '登录状态已失效，请重新绑定账号');
  if (res.status === 403) throw new ApiError('FORBIDDEN', '服务端拒绝了这次请求');
  if (res.status === 0) throw new ApiError('NETWORK', '网络不可达，稍后再试');
  if (res.status >= 400) throw new ApiError('ERROR', res?.data?.msg || `接口异常（HTTP ${res.status}）`);
  return res.data || {};
}

function normalizeStatus(raw) {
  const d = raw?.data && typeof raw.data === 'object' ? raw.data : raw || {};
  const checkedFlag = d.today_checked_in === true || d.today_checked_in === 1 || d.checked === true;
  return {
    active: d.active !== false,
    checked: checkedFlag,
    todayCredit: num(d.today_credit ?? d.todayCredit),
    streak: num(d.streak_days ?? d.streakDays ?? d.continuous_days) ?? 0,
    total: num(d.total_credits ?? d.totalCredits ?? d.credits),
  };
}

async function fetchStatus(cred) {
  const raw = await callApi(cred, '/v2/billing/meter/checkin-activity-status');
  return normalizeStatus(raw);
}

async function claim(cred) {
  const raw = await callApi(cred, '/v2/billing/meter/daily-checkin');
  const d = raw?.data && typeof raw.data === 'object' ? raw.data : raw || {};
  const credit = num(d.credit ?? d.credit_amount ?? d.today_credit);
  if (credit === null) {
    const msg = String(d.msg || raw?.msg || '');
    if (msg.includes('已签') || d.code === 10001) return { credit: 0, already: true };
    throw new ApiError('ERROR', msg || '领取接口没有返回积分');
  }
  return { credit, already: false };
}

/* ------------- 演示模式：不联网、仅用于预览界面 ---------------- */

const demoState = { checked: false, streak: 11, total: 1180, credit: 100 };

function seedDemoHistory() {
  if (state.history.demo?.length) return;
  const list = [];
  for (let i = 1; i <= 11; i++) {
    const d = shiftDate(new Date(), -i);
    list.push({
      date: ymd(d),
      at: `${ymd(d)}T00:0${(i % 6) + 1}:00`,
      result: 'CLAIMED',
      credit: 100,
    });
  }
  state.history.demo = list;
  write(KEY.history, state.history);
}

function demoApi(apiPath) {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (apiPath.endsWith('checkin-activity-status')) {
        resolve({
          active: true,
          today_checked_in: demoState.checked,
          today_credit: demoState.credit,
          streak_days: demoState.streak,
          total_credits: demoState.total,
        });
      } else {
        demoState.checked = true;
        demoState.streak += 1;
        demoState.total += demoState.credit;
        resolve({ credit: demoState.credit });
      }
    }, 850);
  });
}

/* ------------------------------------------------------------------ */
/* 历史记录                                                            */
/* ------------------------------------------------------------------ */

function historyFor(id) {
  const list = state.history[id];
  return Array.isArray(list) ? list : [];
}

function pushHistory(id, entry) {
  const list = historyFor(id).filter((e) => e.date !== entry.date);
  list.unshift(entry);
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  state.history[id] = list.slice(0, 400);
  write(KEY.history, state.history);
}

/** 已签到的日期集合：历史记录 + 由连签天数反推 */
function signedSet(id) {
  const set = new Set(historyFor(id).map((e) => e.date));
  const acc = activeAccount();
  if (acc && acc.id === id && state.status?.checked) {
    const streak = state.status.streak || 1;
    for (let i = 0; i < streak; i++) set.add(ymd(shiftDate(new Date(), -i)));
  }
  return set;
}

/* ------------------------------------------------------------------ */
/* 视图：登录                                                          */
/* ------------------------------------------------------------------ */

function renderAuth() {
  return `
  <div class="auth">
    <div class="auth-spacer"></div>
    <div class="brand-mark">${icons.seal()}</div>
    <div class="brand-name">WorkBuddy</div>
    <h1 class="auth-title">每天一次签到，<br/>剩下的交给我。</h1>
    <p class="auth-sub">登录 WorkBuddy 账号，签到助手会按你设定的时间自动完成每日签到，连签不断、积分不漏。</p>
    <div class="auth-actions">
      <button class="btn btn-primary" data-act="login">使用 WorkBuddy 账号登录</button>
      <button class="btn btn-soft" data-act="demo">以演示模式预览</button>
    </div>
    <div class="auth-spacer"></div>
    <p class="auth-foot">授权信息只保存在本机浏览器，随时可在「我的」中移除。<br/>本应用非腾讯官方产品，接口来自客户端。</p>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* 视图：今日                                                          */
/* ------------------------------------------------------------------ */

function renderToday() {
  const acc = activeAccount();
  const st = state.status;
  const checked = !!st?.checked;
  const streak = st?.streak ?? 0;
  const signed = signedSet(acc.id);
  const hist = historyFor(acc.id);

  const days = [];
  for (let i = 6; i >= 0; i--) days.push(shiftDate(new Date(), -i));
  const monthKey = ymd(new Date()).slice(0, 7);
  const monthCount = [...signed].filter((k) => k.startsWith(monthKey)).length;

  const weekHtml = days
    .map((d) => {
      const key = ymd(d);
      const isToday = key === ymd(new Date());
      const isSigned = signed.has(key);
      const cls = ['week-dot', isSigned ? 'is-signed' : '', isToday ? 'is-today' : ''].join(' ').trim();
      return `<div>
        <div class="week-letter">${WEEK[d.getDay()]}</div>
        <div class="${cls}">${isSigned ? icons.check() : d.getDate()}</div>
      </div>`;
    })
    .join('');

  const startDate = checked && streak > 0 ? shiftDate(new Date(), -(streak - 1)) : null;
  const caption = !st
    ? (state.proxy === false ? '未连接到签到服务，暂时无法同步状态。' : '正在同步今日状态…')
    : checked
      ? `已连续签到 ${streak} 天${startDate ? ` · 始于 ${startDate.getMonth() + 1} 月 ${startDate.getDate()} 日` : ''}`
      : st.active === false
        ? '今日签到活动尚未开启。'
        : '今天还没有签到，现在补上也不算断。';

  const actionBtn = state.busy
    ? `<button class="btn btn-primary" disabled>签到中…</button>`
    : checked
      ? `<button class="btn btn-done" data-act="goto" data-view="records">${icons.checkCircle()}今日已签到</button>`
      : st && st.active === false
        ? `<button class="btn btn-soft" disabled>今日活动未开启</button>`
        : `<button class="btn btn-primary" data-act="signin">立即签到</button>`;

  return `
  <div class="screen">
    <div class="topbar">
      <div>
        <div class="topbar-date">${fmtDateLong()}</div>
        <h1 class="greeting">${greeting()}</h1>
      </div>
      <button class="avatar is-pine" data-act="goto" data-view="accounts" aria-label="账号">${esc(initialOf(acc))}</button>
    </div>

    ${state.proxy === false ? `
    <div class="banner" style="margin-bottom:16px">
      ${icons.info()}
      <div>没有连上签到服务。用 <strong>npm start</strong> 启动，或在「我的 → 服务器地址」填写已部署的服务地址。</div>
    </div>` : ''}

    <div class="card hero">
      <div class="hero-top">
        <span class="pill ${checked ? 'is-ok' : st?.active === false ? 'is-warn' : ''}">
          <i class="dot"></i>${checked ? '今日已签到' : st?.active === false ? '活动未开启' : '待签到'}
        </span>
        <span class="pill ${cloudFor(acc.uid)?.enabled ? 'is-ok' : ''}">${
          cloudFor(acc.uid)?.enabled ? `云端 · ${cloudFor(acc.uid).time}` : state.settings.auto ? `自动 · ${state.settings.time}` : '自动已关闭'
        }</span>
      </div>

      <div class="hero-figure">
        <span class="hero-number">${streak}</span>
        <span class="hero-unit">天连签</span>
      </div>
      <div class="hero-caption">${esc(caption)}</div>

      <hr class="divider" />

      <div class="metrics">
        <div class="metric">
          <div class="metric-value">${st?.todayCredit != null ? `+${st.todayCredit}` : '—'}<small>分</small></div>
          <div class="metric-label">${checked ? '今日所得' : '今日可得'}</div>
        </div>
        <div class="metric">
          <div class="metric-value">${st?.total != null ? st.total.toLocaleString('zh-CN') : '—'}</div>
          <div class="metric-label">累计积分</div>
        </div>
        <div class="metric">
          <div class="metric-value">${monthCount}<small>天</small></div>
          <div class="metric-label">本月签到</div>
        </div>
      </div>
    </div>

    <div style="margin-top:14px">${actionBtn}</div>

    <div class="section">
      <span class="section-title">本周</span>
      <span class="section-action">${days[0].getMonth() + 1}.${days[0].getDate()} – ${days[6].getMonth() + 1}.${days[6].getDate()}</span>
    </div>
    <div class="card"><div class="week">${weekHtml}</div></div>

    <div class="section"><span class="section-title">自动签到</span></div>
    <div class="card">
      <div class="auto-head">
        <div>
          <div class="auto-title">每天自动签到</div>
          <div class="auto-sub">打开 App 时自动补齐，绝不断签</div>
        </div>
        <button class="switch ${state.settings.auto ? 'on' : ''}" data-act="toggle-auto"
          role="switch" aria-checked="${state.settings.auto}" aria-label="自动签到"></button>
      </div>
      <button class="auto-time" data-act="edit-time">
        <span class="auto-time-label">执行时间</span>
        <span class="auto-time-value">${state.settings.time}${icons.chevronRight()}</span>
      </button>
    </div>

    <div class="section">
      <span class="section-title">最近记录</span>
      <button class="section-action" data-act="goto" data-view="records">全部</button>
    </div>
    <div class="card card-flush">
      ${hist.length ? `<div class="list">${hist.slice(0, 3).map(recordRow).join('')}</div>` : `<div class="empty">签到之后，这里会出现第一条记录</div>`}
    </div>

    <p class="footnote">签到接口来自 WorkBuddy 桌面客户端，并非官方公开 API，可能随版本调整。请遵守服务条款。</p>
  </div>`;
}

function recordRow(e) {
  const d = new Date(e.at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const ok = e.result === 'CLAIMED';
  return `<div class="row">
    <div class="row-icon ${ok ? 'is-pine' : ''}">${ok ? icons.check() : icons.checkCircle()}</div>
    <div class="row-main">
      <div class="row-title">${ok ? '签到成功' : '今日已签'}${e.cloud ? ' <span class="badge">云端</span>' : ''}</div>
      <div class="row-sub">${e.date.slice(5).replace('-', ' 月 ')} 日 · ${time}</div>
    </div>
    <div class="row-side ${e.credit ? 'is-pos' : ''}">${e.credit ? `+${e.credit}` : '—'}</div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* 视图：记录                                                          */
/* ------------------------------------------------------------------ */

function renderRecords() {
  const acc = activeAccount();
  const base = state.calMonth;
  const y = base.getFullYear();
  const m = base.getMonth();
  const signed = signedSet(acc.id);
  const first = new Date(y, m, 1);
  const startPad = first.getDay();
  const total = new Date(y, m + 1, 0).getDate();

  let cells = '';
  for (let i = 0; i < startPad; i++) cells += '<div class="cal-cell is-out"></div>';
  for (let day = 1; day <= total; day++) {
    const key = `${y}-${pad(m + 1)}-${pad(day)}`;
    const isSigned = signed.has(key);
    const isToday = key === ymd(new Date());
    cells += `<div class="cal-cell ${isSigned ? 'is-signed' : ''} ${isToday ? 'is-today' : ''}">
      ${day}<span class="pip"></span>
    </div>`;
  }

  const monthKey = `${y}-${pad(m + 1)}`;
  const rows = historyFor(acc.id).filter((e) => String(e.at).startsWith(monthKey));
  const monthSigned = [...signed].filter((k) => k.startsWith(monthKey)).length;

  return `
  <div class="screen">
    <div class="topbar">
      <div>
        <div class="topbar-date">History</div>
        <h1 class="greeting">签到记录</h1>
      </div>
    </div>

    <div class="card">
      <div class="cal-head">
        <span class="cal-month">${y} 年 ${m + 1} 月</span>
        <div class="cal-nav">
          <button data-act="cal-prev" aria-label="上个月">${icons.chevronLeft()}</button>
          <button data-act="cal-next" aria-label="下个月">${icons.chevronRight()}</button>
        </div>
      </div>
      <div class="cal-grid" style="margin-bottom:10px">
        ${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div class="week-letter" style="margin:0">${w}</div>`).join('')}
      </div>
      <div class="cal-grid">${cells}</div>
      <hr class="divider" />
      <div class="metrics">
        <div class="metric">
          <div class="metric-value">${monthSigned}<small>天</small></div>
          <div class="metric-label">本月签到</div>
        </div>
        <div class="metric">
          <div class="metric-value">${state.status?.streak ?? 0}<small>天</small></div>
          <div class="metric-label">当前连签</div>
        </div>
        <div class="metric">
          <div class="metric-value">${rows.reduce((s, r) => s + (r.credit || 0), 0)}</div>
          <div class="metric-label">本月积分</div>
        </div>
      </div>
    </div>

    <div class="section"><span class="section-title">本月明细</span></div>
    <div class="card card-flush">
      ${rows.length ? `<div class="list">${rows.map(recordRow).join('')}</div>` : `<div class="empty">这个月还没有签到记录</div>`}
    </div>
    <p class="footnote">记录保存在本机浏览器中，清除数据后会一并删除。</p>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* 视图：账号                                                          */
/* ------------------------------------------------------------------ */

function renderAccounts() {
  const acc = activeAccount();
  return `
  <div class="screen">
    <div class="topbar">
      <div>
        <div class="topbar-date">Accounts</div>
        <h1 class="greeting">账号</h1>
      </div>
      <button class="avatar" data-act="login" aria-label="添加账号">${icons.plus()}</button>
    </div>

    <div class="card card-flush">
      <div class="list">
        ${state.accounts.map((a) => `
          <button class="row is-btn" data-act="account-menu" data-id="${esc(a.id)}">
            <div class="mono">${esc(initialOf(a))}</div>
            <div class="row-main">
              <div class="row-title">${esc(a.name)}${a.demo ? ' <span class="badge">演示</span>' : ''}</div>
              <div class="row-sub clip">UID ${esc(maskUid(a.uid))}</div>
            </div>
            ${a.id === acc?.id ? '<span class="badge is-pine">当前</span>' : ''}${icons.chevronRight()}
          </button>`).join('')}
      </div>
    </div>

    <button class="btn btn-soft" style="margin-top:16px" data-act="login">${icons.plus()}添加账号</button>

    <div class="section"><span class="section-title">说明</span></div>
    <div class="card">
      <div class="row" style="border-top:0;padding-top:0">
        <div class="row-icon">${icons.shield()}</div>
        <div class="row-main">
          <div class="row-title">凭据只存在本机</div>
          <div class="row-sub">授权信息保存在浏览器本地存储，不上传第三方服务器</div>
        </div>
      </div>
      <div class="row">
        <div class="row-icon">${icons.clock()}</div>
        <div class="row-main">
          <div class="row-title">多账号轮流签到</div>
          <div class="row-sub">切换到某个账号后，自动签到只作用于当前账号</div>
        </div>
      </div>
    </div>
    <p class="footnote">账号失效时（提示 401），重新绑定一次即可恢复。</p>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* 视图：我的                                                          */
/* ------------------------------------------------------------------ */

function renderSettings() {
  const acc = activeAccount();
  const theme = state.settings.theme;
  return `
  <div class="screen">
    <div class="topbar">
      <div>
        <div class="topbar-date">Settings</div>
        <h1 class="greeting">我的</h1>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="mono" style="width:52px;height:52px;border-radius:17px;font-size:19px">${esc(initialOf(acc))}</div>
        <div style="min-width:0">
          <div style="font-size:18px;font-weight:600;letter-spacing:-0.02em">${esc(acc?.name || '未登录')}</div>
          <div class="row-sub">${acc ? `${esc(maskUid(acc.uid))} · ${esc(acc.domain || 'www.workbuddy.cn')}` : '登录后开始自动签到'}</div>
        </div>
      </div>
      <hr class="divider" />
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <span class="auto-time-label">服务连接</span>
        <span class="pill ${state.proxy ? 'is-ok' : 'is-warn'}"><i class="dot"></i>${state.proxy ? '已连接' : '未连接'}</span>
      </div>
    </div>

    <div class="section"><span class="section-title">签到</span></div>
    <div class="card">
      <div class="auto-head">
        <div>
          <div class="auto-title">自动签到</div>
          <div class="auto-sub">打开 App 时自动检查并补齐</div>
        </div>
        <button class="switch ${state.settings.auto ? 'on' : ''}" data-act="toggle-auto" role="switch" aria-checked="${state.settings.auto}"></button>
      </div>
      <button class="auto-time" data-act="edit-time">
        <span class="auto-time-label">执行时间</span>
        <span class="auto-time-value">${state.settings.time}${icons.chevronRight()}</span>
      </button>
    </div>

    <div class="card" style="margin-top:12px">
      <div class="auto-head">
        <div>
          <div class="auto-title">云端代签</div>
          <div class="auto-sub">${cloudFor(acc?.uid) ? `服务器每天 ${cloudFor(acc?.uid).time} 替你签到` : '服务器每天替你签到，不用打开 App'}</div>
        </div>
        <button class="switch ${cloudFor(acc?.uid)?.enabled ? 'on' : ''}" data-act="toggle-cloud" role="switch"
          aria-checked="${Boolean(cloudFor(acc?.uid)?.enabled)}"></button>
      </div>
      ${cloudFor(acc?.uid) ? `
      <button class="auto-time" data-act="run-cloud">
        <span class="auto-time-label">${cloudFor(acc?.uid).needsRebind ? '授权已失效，需要重新绑定' : '立即在云端执行一次'}</span>
        <span class="auto-time-value">${icons.chevronRight()}</span>
      </button>` : ''}
    </div>

    <div class="card card-flush" style="margin-top:12px">
      <div class="list">
        <button class="row is-btn" data-act="toggle-push">
          <div class="row-icon">${icons.clock()}</div>
          <div class="row-main">
            <div class="row-title">签到结果通知</div>
            <div class="row-sub">${state.settings.push ? '已开启，签到后推送系统通知' : '开启后签到成功 / 失败都会提醒'}</div>
          </div>
          <span class="switch ${state.settings.push ? 'on' : ''}" style="pointer-events:none"></span>
        </button>
        ${state.settings.push ? `<button class="row is-btn" data-act="test-push">
          <div class="row-icon">${icons.link()}</div>
          <div class="row-main"><div class="row-title">发送测试通知</div><div class="row-sub">确认手机能收到推送</div></div>
          ${icons.chevronRight()}
        </button>` : ''}
      </div>
    </div>

    <div class="section"><span class="section-title">外观</span></div>
    <div class="card">
      <div class="segmented" data-act="theme" role="group" aria-label="外观">
        <button class="segment ${theme === 'auto' ? 'is-active' : ''}" data-act="theme" data-theme="auto">跟随系统</button>
        <button class="segment ${theme === 'light' ? 'is-active' : ''}" data-act="theme" data-theme="light">浅色</button>
        <button class="segment ${theme === 'dark' ? 'is-active' : ''}" data-act="theme" data-theme="dark">深色</button>
      </div>
    </div>

    <div class="section"><span class="section-title">服务</span></div>
    <div class="card card-flush">
      <div class="list">
        <button class="row is-btn" data-act="edit-server">
          <div class="row-icon">${icons.link()}</div>
          <div class="row-main">
            <div class="row-title">服务器地址</div>
            <div class="row-sub clip">${esc(state.settings.server || '当前站点（同源）')}</div>
          </div>
          ${icons.chevronRight()}
        </button>
        <button class="row is-btn" data-act="edit-key">
          <div class="row-icon">${icons.shield()}</div>
          <div class="row-main">
            <div class="row-title">访问口令</div>
            <div class="row-sub clip">${state.settings.accessKey ? '已设置' : '未设置（服务端开启鉴权时填写）'}</div>
          </div>
          ${icons.chevronRight()}
        </button>
      </div>
    </div>

    <div class="section"><span class="section-title">数据</span></div>
    <div class="card card-flush">
      <div class="list">
        <button class="row is-btn" data-act="goto" data-view="accounts">
          <div class="row-icon">${icons.account()}</div>
          <div class="row-main"><div class="row-title">账号管理</div><div class="row-sub">${state.accounts.length} 个已绑定账号</div></div>
          ${icons.chevronRight()}
        </button>
        <button class="row is-btn" data-act="clear-history">
          <div class="row-icon">${icons.trash()}</div>
          <div class="row-main"><div class="row-title">清除本地记录</div><div class="row-sub">只删除签到历史，不影响账号</div></div>
          ${icons.chevronRight()}
        </button>
        <button class="row is-btn" data-act="unbind">
          <div class="row-icon">${icons.close()}</div>
          <div class="row-main"><div class="row-title">解除全部绑定</div><div class="row-sub">删除账号与凭据，回到登录页</div></div>
          ${icons.chevronRight()}
        </button>
      </div>
    </div>

    <div class="section"><span class="section-title">关于</span></div>
    <div class="card card-flush">
      <div class="list">
        <button class="row is-btn" data-act="about">
          <div class="row-icon">${icons.info()}</div>
          <div class="row-main"><div class="row-title">关于签到助手</div><div class="row-sub">版本 ${VERSION} · 非官方工具</div></div>
          ${icons.chevronRight()}
        </button>
        <button class="row is-btn" data-act="open-official">
          <div class="row-icon">${icons.external()}</div>
          <div class="row-main"><div class="row-title">WorkBuddy 官网</div><div class="row-sub">查看账号与活动规则</div></div>
          ${icons.chevronRight()}
        </button>
      </div>
    </div>
    <p class="footnote">签到接口由客户端行为整理而来，非官方公开 API。若账号被要求重新登录，请按提示重新绑定。</p>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Tab / 渲染                                                          */
/* ------------------------------------------------------------------ */

function tabbar() {
  const items = [
    ['today', '今日', icons.today],
    ['records', '记录', icons.records],
    ['accounts', '账号', icons.account],
    ['settings', '我的', icons.settings],
  ];
  return `<nav class="tabbar">
    ${items.map(([id, label, icon]) => `
      <button class="tab ${state.view === id ? 'is-active' : ''}" data-act="goto" data-view="${id}">
        ${icon()}<span>${label}</span>
      </button>`).join('')}
  </nav>`;
}

function render() {
  const app = $('#app');
  if (!state.booted) {
    app.innerHTML = `<div class="shell"><div class="card" style="margin-top:80px"><div class="skeleton" style="height:18px;width:45%"></div><div class="skeleton" style="height:64px;margin-top:18px"></div></div></div>`;
    return;
  }
  const acc = activeAccount();
  if (!acc) {
    app.innerHTML = renderAuth();
    return;
  }
  const views = { today: renderToday, records: renderRecords, accounts: renderAccounts, settings: renderSettings };
  app.innerHTML = `<div class="shell">${(views[state.view] || renderToday)()}</div>${tabbar()}`;
  applyTheme();
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/* ------------------------------------------------------------------ */
/* 浮层：sheet / toast                                                 */
/* ------------------------------------------------------------------ */

function openSheet(html, { onMount } = {}) {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const layer = $('#layer');
  layer.innerHTML = `<div class="sheet-wrap">
    <div class="sheet-back" data-act="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>
  </div>`;
  state.sheet = html;
  onMount?.(layer);
  const focusable = layer.querySelector('input, button');
  focusable?.focus({ preventScroll: true });
}

function closeSheet() {
  $('#layer').innerHTML = '';
  state.sheet = null;
}

let toastTimer = null;
function toast(message, ms = 2600) {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), ms);
}

/* ------------------------------------------------------------------ */
/* 交互：签到                                                          */
/* ------------------------------------------------------------------ */

async function doSignin() {
  const acc = activeAccount();
  if (!acc || state.busy) return;
  state.busy = true;
  render();
  try {
    let st = state.status;
    if (!st) st = await fetchStatus(acc);
    if (st.checked) {
      state.status = st;
      state.busy = false;
      pushHistory(acc.id, { date: ymd(new Date()), at: new Date().toISOString(), result: 'ALREADY', credit: st.todayCredit || 0 });
      render();
      toast('今天已经签过了');
      return;
    }
    const res = await claim(acc);
    const fresh = await fetchStatus(acc).catch(() => null);
    state.status = fresh || { ...st, checked: true, streak: (st.streak || 0) + 1, todayCredit: res.credit };
    state.statusAt = Date.now();
    pushHistory(acc.id, {
      date: ymd(new Date()),
      at: new Date().toISOString(),
      result: res.already ? 'ALREADY' : 'CLAIMED',
      credit: res.credit,
    });
    state.busy = false;
    render();
    toast(res.already ? '今天已经签过了' : `签到成功，+${res.credit} 积分`);
  } catch (err) {
    state.busy = false;
    render();
    if (err.code === 'AUTH') {
      toast('登录已失效，请重新绑定账号');
      openLoginSheet({ rebind: true });
    } else {
      toast(err.message || '签到失败，请稍后重试');
    }
  }
}

async function refreshStatus({ silent = true } = {}) {
  const acc = activeAccount();
  if (!acc || acc.demo) return;
  try {
    const st = await fetchStatus(acc);
    state.status = st;
    state.statusAt = Date.now();
    if (st.checked) {
      const key = ymd(new Date());
      if (!historyFor(acc.id).some((e) => e.date === key)) {
        pushHistory(acc.id, { date: key, at: new Date().toISOString(), result: 'ALREADY', credit: st.todayCredit || 0 });
      }
    }
    render();
  } catch (err) {
    if (!silent) toast(err.message || '同步失败');
  }
}

/* ------------------------------------------------------------------ */
/* 交互：登录 / 绑定                                                   */
/* ------------------------------------------------------------------ */

function openLoginSheet(opts = {}) {
  openSheet(`
    <h2 class="sheet-title">${opts.rebind ? '重新绑定账号' : '登录 WorkBuddy'}</h2>
    <p class="sheet-sub">${opts.rebind ? '原授权可能已过期。' : ''}先在官方页面完成登录，再把授权信息交给签到助手。整个过程只需要一次。</p>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div>
          <div class="step-title">打开官方登录页</div>
          <div class="step-text">在 WorkBuddy 官网或客户端里登录你的账号。</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div>
          <div class="step-title">复制授权信息</div>
          <div class="step-text">客户端会把登录态写入本机。把 <span style="color:var(--ink-2)">accessToken</span>（或整段 JSON）复制出来。</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div>
          <div class="step-title">粘贴并完成绑定</div>
          <div class="step-text">粘贴后自动识别账号，之后每天自动签到。</div>
        </div>
      </div>
    </div>
    <div class="sheet-actions">
      <button class="btn btn-primary" data-act="bind-step">我已登录，去粘贴</button>
      <button class="btn btn-soft" data-act="open-official">${icons.external()}打开官方页面</button>
      <button class="btn btn-quiet" data-act="close-sheet">取消</button>
    </div>
  `);
}

function openBindSheet(preset = {}) {
  openSheet(`
    <h2 class="sheet-title">粘贴授权信息</h2>
    <p class="sheet-sub">支持直接粘贴 accessToken，或整段 <code style="font-size:12px">{"uid":"…","accessToken":"…"}</code>。</p>
    <form data-form="bind" novalidate>
      <div class="field">
        <label class="field-label" for="f-token">授权信息</label>
        <textarea class="input" id="f-token" name="token" rows="3" placeholder="粘贴 accessToken 或 JSON" autocomplete="off" spellcheck="false">${esc(preset.token || '')}</textarea>
        <div class="hint">浏览器不允许跨站读取官方页面，所以这一步需要你手动复制一次。桌面客户端的登录态通常写在 <strong>workbuddy-desktop.info</strong> 里。</div>
      </div>
      <div class="field">
        <label class="field-label" for="f-uid">账号 UID（选填）</label>
        <input class="input" id="f-uid" name="uid" inputmode="numeric" placeholder="能自动识别就留空" value="${esc(preset.uid || '')}" />
      </div>
      <div class="field">
        <label class="field-label" for="f-domain">登录域</label>
        <input class="input" id="f-domain" name="domain" placeholder="www.workbuddy.cn" value="${esc(preset.domain || 'www.workbuddy.cn')}" />
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary" type="submit">完成绑定</button>
        <button class="btn btn-quiet" type="button" data-act="close-sheet">取消</button>
      </div>
    </form>
  `);
}

function parseBinding(rawToken, uidInput, domainInput) {
  let token = String(rawToken || '').trim();
  let uid = String(uidInput || '').trim();
  let domain = String(domainInput || '').trim() || 'www.workbuddy.cn';

  if (token.startsWith('{')) {
    let json;
    try { json = JSON.parse(token); } catch { throw new ApiError('BIND', '这段 JSON 解析不了，检查是否复制完整'); }
    token = json.accessToken || json.token || json.access_token || '';
    uid = uid || String(json.uid || json.userId || '');
    domain = json.domain || domain;
  }
  if (!token) throw new ApiError('BIND', '没有找到 accessToken');
  if (token.length < 8) throw new ApiError('BIND', 'accessToken 看起来不完整');

  if (!uid) {
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const bin = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        uid = String(payload.uid || payload.userId || payload.user_id || payload.sub || '');
      } catch { /* 不是 JWT 就算了 */ }
    }
  }
  if (!/^\d{1,32}$/.test(uid)) throw new ApiError('BIND', '还需要填写数字 UID（在账号信息里可以看到）');
  return { token, uid, domain };
}

async function bindAccount(form) {
  const fd = new FormData(form);
  let cred;
  try {
    cred = parseBinding(fd.get('token'), fd.get('uid'), fd.get('domain'));
  } catch (err) {
    toast(err.message);
    return;
  }
  state.accounts = state.accounts.filter((a) => !a.demo);
  const existing = state.accounts.find((a) => a.uid === cred.uid);
  if (existing) {
    Object.assign(existing, cred);
    state.activeId = existing.id;
    toast('已更新这个账号的授权');
  } else {
    const acc = {
      id: `acc_${Date.now().toString(36)}`,
      name: `账号 ${cred.uid.slice(-4)}`,
      ...cred,
      addedAt: Date.now(),
    };
    state.accounts.push(acc);
    state.activeId = acc.id;
  }
  write(KEY.accounts, state.accounts);
  write(KEY.active, state.activeId);
  state.status = null;
  closeSheet();
  state.view = 'today';
  state.booted = true;
  render();
  toast('绑定成功，正在同步签到状态');
  await refreshStatus({ silent: false });
}

function enableDemo() {
  const acc = { id: 'demo', name: '林小满', uid: '88023174', domain: 'www.workbuddy.cn', token: 'demo', demo: true };
  state.accounts = [acc];
  state.activeId = 'demo';
  write(KEY.accounts, state.accounts);
  write(KEY.active, state.activeId);
  seedDemoHistory();
  demoState.checked = false;
  state.status = { active: true, checked: false, todayCredit: 100, streak: 11, total: 1180 };
  state.statusAt = Date.now();
  state.booted = true;
  state.view = 'today';
  render();
  toast('演示模式：数据为示意，不会真的签到');
}

/* ------------------------------------------------------------------ */
/* 交互：时间 / 主题 / 清除                                            */
/* ------------------------------------------------------------------ */

function openTimeSheet() {
  const [h, m] = state.settings.time.split(':');
  const presets = ['00:05', '08:00', '12:30', '21:00'];
  openSheet(`
    <h2 class="sheet-title">执行时间</h2>
    <p class="sheet-sub">每天到这个时间，签到助手会尝试自动完成签到。</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:20px">
      ${presets.map((p) => `<button class="pill ${p === state.settings.time ? 'is-ok' : ''}" style="height:34px;padding:0 14px"
        data-act="time-preset" data-time="${p}">${p}</button>`).join('')}
    </div>
    <div style="display:flex;gap:12px;align-items:flex-end;margin-top:18px">
      <div style="flex:1">
        <label class="field-label">小时</label>
        <select class="input" id="t-hour">
          ${Array.from({ length: 24 }, (_, i) => `<option value="${pad(i)}" ${Number(h) === i ? 'selected' : ''}>${pad(i)} 时</option>`).join('')}
        </select>
      </div>
      <div style="flex:1">
        <label class="field-label">分钟</label>
        <select class="input" id="t-min">
          ${Array.from({ length: 12 }, (_, i) => i * 5).map((v) => `<option value="${pad(v)}" ${Number(m) === v ? 'selected' : ''}>${pad(v)} 分</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="sheet-actions">
      <button class="btn btn-primary" data-act="time-confirm">保存</button>
      <button class="btn btn-quiet" data-act="close-sheet">取消</button>
    </div>
  `);
}

function saveTime() {
  const h = $('#t-hour')?.value || '00';
  const m = $('#t-min')?.value || '05';
  setTime(`${h}:${m}`);
}

function setTime(value) {
  state.settings.time = value;
  write(KEY.settings, state.settings);
  closeSheet();
  render();
  syncCloudTime();
  toast(`自动签到时间已设为 ${value}`);
}

/** 云端账号的时间跟着 App 一起改 */
function syncCloudTime() {
  const acc = activeAccount();
  if (!acc || !cloudFor(acc.uid)) return;
  cloudFetch('/api/cloud/update', { uid: acc.uid, time: state.settings.time })
    .then(() => cloudRefresh().then(render))
    .catch(() => {});
}

/* ------------------------------------------------------------------ */
/* 账号菜单                                                            */
/* ------------------------------------------------------------------ */

function openAccountSheet(id) {
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc) return;
  const isActive = acc.id === state.activeId;
  openSheet(`
    <h2 class="sheet-title">${esc(acc.name)}</h2>
    <p class="sheet-sub">UID ${esc(maskUid(acc.uid))} · ${esc(acc.domain || 'www.workbuddy.cn')}${
      cloudFor(acc.uid) ? ' · 云端代签已开启' : ''
    }</p>
    <div class="sheet-actions">
      ${isActive ? '' : `<button class="btn btn-primary" data-act="switch-account" data-id="${esc(acc.id)}">切换为当前账号</button>`}
      <button class="btn btn-soft" data-act="rebind" data-id="${esc(acc.id)}">更新授权</button>
      <button class="btn btn-quiet btn-danger" data-act="remove-account" data-id="${esc(acc.id)}">移除这个账号</button>
      <button class="btn btn-quiet" data-act="close-sheet">取消</button>
    </div>
  `);
}

function removeAccount(id) {
  state.accounts = state.accounts.filter((a) => a.id !== id);
  delete state.history[id];
  write(KEY.history, state.history);
  if (state.activeId === id) state.activeId = state.accounts[0]?.id || null;
  write(KEY.accounts, state.accounts);
  write(KEY.active, state.activeId);
  state.status = null;
  closeSheet();
  render();
  toast('账号已移除');
}

function switchAccount(id) {
  state.activeId = id;
  write(KEY.active, id);
  state.status = null;
  closeSheet();
  state.view = 'today';
  render();
  refreshStatus();
  toast('已切换当前账号');
}

/* ------------------------------------------------------------------ */
/* 云端代签 / 推送                                                      */
/* ------------------------------------------------------------------ */

async function cloudFetch(pathname, body) {
  const res = await fetch(apiUrl(pathname), body
    ? { method: 'POST', headers: apiHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(body) }
    : { headers: apiHeaders() });
  if (res.status === 403) throw new ApiError('KEY', '访问口令不正确，请在「我的 → 访问口令」里更新');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError('CLOUD', data.error || `云端服务不可用（${res.status}）`);
  }
  return res.json();
}

async function cloudRefresh() {
  if (!state.proxy) {
    state.cloud = { ready: false, accounts: [], busy: false };
    return;
  }
  try {
    const data = await cloudFetch('/api/cloud/accounts');
    state.cloud = { ready: true, accounts: data.accounts || [], busy: state.cloud.busy };
  } catch {
    state.cloud = { ready: false, accounts: [], busy: false };
  }
}

const cloudFor = (uid) => state.cloud.accounts.find((a) => a.uid === uid) || null;

/** 把云端结果合并进本地历史（按时间戳去重） */
async function cloudSyncResults(uid) {
  if (!state.cloud.ready || !uid) return;
  try {
    const data = await cloudFetch(`/api/cloud/results?uid=${encodeURIComponent(uid)}&limit=60`);
    const list = historyFor(uid).slice();
    let added = 0;
    for (const r of data.results || []) {
      if (!r.date) continue;
      if (list.some((e) => e.at === r.at)) continue;
      list.push({ date: r.date, at: r.at, result: r.result, credit: r.credit || 0, cloud: true });
      added++;
    }
    if (!added) return;
    list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    state.history[uid] = list.slice(0, 400);
    write(KEY.history, state.history);
  } catch { /* 同步失败不打扰 */ }
}

async function cloudEnable(acc) {
  if (!state.proxy) throw new ApiError('CLOUD', '云端服务没有启动，先运行 npm start');
  const out = await cloudFetch('/api/cloud/bind', {
    uid: acc.uid,
    token: acc.token,
    domain: acc.domain || 'www.workbuddy.cn',
    name: acc.name,
    time: state.settings.time,
    tz: 'Asia/Shanghai',
  });
  if (!out.verified) throw new ApiError('CLOUD', out.error || '授权无效或已过期，请重新绑定');
  await cloudRefresh();
  await cloudSyncResults(acc.uid);
  render();
}

async function cloudDisable(uid) {
  await cloudFetch('/api/cloud/unbind', { uid });
  await cloudRefresh();
  render();
}

async function cloudRunNow(acc) {
  const out = await cloudFetch('/api/cloud/run', { uid: acc.uid });
  await cloudRefresh();
  await cloudSyncResults(acc.uid);
  const st = await fetchStatus(acc).catch(() => null);
  if (st) state.status = st;
  render();
  if (!out.ok && out.result === 'AUTH') throw new ApiError('AUTH', '授权已失效，请重新绑定账号');
  toast(out.ok ? `云端签到完成${out.credit ? `，+${out.credit}` : ''}` : (out.report || '云端签到未执行'));
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function pushEnable(uid) {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new ApiError('PUSH', '当前浏览器不支持通知');
  }
  if (!window.isSecureContext) throw new ApiError('PUSH', '通知需要 HTTPS 或 localhost，局域网 IP 下不可用');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new ApiError('PUSH', '通知权限没有授予');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await cloudFetch('/api/push/key');
  if (!publicKey) throw new ApiError('PUSH', '服务端还没有生成推送密钥');
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  }));
  await cloudFetch('/api/push/subscribe', { uid, subscription: sub.toJSON() });
  state.settings.push = true;
  write(KEY.settings, state.settings);
}

async function pushDisable() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch { /* 忽略 */ }
  state.settings.push = false;
  write(KEY.settings, state.settings);
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'edit-server':
      openServerSheet();
      break;
    case 'edit-key':
      openKeySheet();
      break;
    case 'toggle-cloud':
      toggleCloud();
      break;
    case 'run-cloud':
      runCloudNow();
      break;
    case 'toggle-push':
      togglePush();
      break;
    case 'test-push':
      testPush();
      break;
    case 'goto':
      state.view = el.dataset.view;
      if (state.view === 'records') state.calMonth = new Date();
      render();
      window.scrollTo({ top: 0 });
      break;
    case 'login':
      openLoginSheet();
      break;
    case 'bind-step':
      openBindSheet();
      break;
    case 'demo':
      enableDemo();
      break;
    case 'signin':
      doSignin();
      break;
    case 'toggle-auto':
      state.settings.auto = !state.settings.auto;
      write(KEY.settings, state.settings);
      render();
      toast(state.settings.auto ? '已开启自动签到' : '已关闭自动签到');
      break;
    case 'edit-time':
      openTimeSheet();
      break;
    case 'time-preset':
      setTime(el.dataset.time);
      break;
    case 'time-confirm':
      saveTime();
      break;
    case 'theme':
      if (el.dataset.theme) {
        state.settings.theme = el.dataset.theme;
        write(KEY.settings, state.settings);
        applyTheme();
        render();
      }
      break;
    case 'cal-prev':
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1);
      render();
      break;
    case 'cal-next':
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1);
      render();
      break;
    case 'account-menu':
      openAccountSheet(el.dataset.id);
      break;
    case 'switch-account':
      switchAccount(el.dataset.id);
      break;
    case 'rebind': {
      const acc = state.accounts.find((a) => a.id === el.dataset.id);
      closeSheet();
      openBindSheet({ uid: acc?.uid || '', domain: acc?.domain || 'www.workbuddy.cn' });
      break;
    }
    case 'remove-account':
      removeAccount(el.dataset.id);
      break;
    case 'clear-history':
      state.history = {};
      write(KEY.history, state.history);
      render();
      toast('本地签到记录已清除');
      break;
    case 'unbind':
      openSheet(`
        <h2 class="sheet-title">解除全部绑定？</h2>
        <p class="sheet-sub">将删除本机保存的 ${state.accounts.length} 个账号与全部签到记录，删除后无法恢复。</p>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-danger" style="background:var(--danger);color:#fff" data-act="confirm-unbind">确认解除</button>
          <button class="btn btn-quiet" data-act="close-sheet">取消</button>
        </div>
      `);
      break;
    case 'confirm-cloud-on': {
      const acc = activeAccount();
      closeSheet();
      toast('正在保存到云端…');
      cloudEnable(acc)
        .then(() => toast('云端代签已开启'))
        .catch((err) => toast(err.message || '开启失败'));
      break;
    }
    case 'confirm-cloud-off': {
      const acc = activeAccount();
      closeSheet();
      cloudDisable(acc.uid)
        .then(() => toast('已关闭云端代签，凭据已删除'))
        .catch((err) => toast(err.message || '关闭失败'));
      break;
    }
    case 'confirm-unbind':
      state.accounts = [];
      state.activeId = null;
      state.history = {};
      state.status = null;
      write(KEY.accounts, []);
      write(KEY.active, null);
      write(KEY.history, {});
      closeSheet();
      render();
      toast('已解除全部绑定');
      break;
    case 'about':
      openSheet(`
        <h2 class="sheet-title">关于签到助手</h2>
        <p class="sheet-sub">版本 ${VERSION} · 网页 App（PWA）</p>
        <div class="banner" style="margin-top:18px">${icons.info()}
          <div>这不是腾讯官方产品。签到接口由 WorkBuddy 客户端行为整理而来，随客户端版本可能失效；请遵守服务条款，风险自负。</div>
        </div>
        <div class="sheet-actions">
          <button class="btn btn-soft" data-act="open-official">${icons.external()}访问 WorkBuddy 官网</button>
          <button class="btn btn-quiet" data-act="close-sheet">关闭</button>
        </div>
      `);
      break;
    case 'open-official':
      window.open('https://www.workbuddy.cn', '_blank', 'noopener');
      break;
    case 'close-sheet':
      closeSheet();
      break;
    default:
      break;
  }
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target.closest('form');
  if (!form) return;
  if (form.dataset.form === 'bind') bindAccount(form);
  else if (form.dataset.form === 'server') saveServer(form);
  else if (form.dataset.form === 'key') saveKey(form);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.sheet) closeSheet();
});

/* ------------------------------------------------------------------ */
/* 服务器地址                                                          */
/* ------------------------------------------------------------------ */

function openServerSheet() {
  openSheet(`
    <h2 class="sheet-title">服务器地址</h2>
    <p class="sheet-sub">网页版留空即用当前站点。安装成 APK、或把服务部署到别处时，填服务地址，例如 https://checkin.example.com。</p>
    <form data-form="server" novalidate>
      <div class="field">
        <label class="field-label" for="f-server">地址</label>
        <input class="input" id="f-server" name="server" type="url" inputmode="url"
          placeholder="留空 = 当前站点" value="${esc(state.settings.server || '')}" autocomplete="off" spellcheck="false" />
        <div class="hint">只填到域名，不带结尾的斜杠。</div>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary" type="submit">保存</button>
        <button class="btn btn-quiet" type="button" data-act="close-sheet">取消</button>
      </div>
    </form>
  `);
}

function openKeySheet() {
  openSheet(`
    <h2 class="sheet-title">访问口令</h2>
    <p class="sheet-sub">服务端设置了 WB_ACCESS_KEY 时，所有云端与签到请求都要带上这个口令。留空表示服务端没有开启鉴权。</p>
    <form data-form="key" novalidate>
      <div class="field">
        <label class="field-label" for="f-key">口令</label>
        <input class="input" id="f-key" name="key" type="password" placeholder="留空 = 不发送口令"
          value="${esc(state.settings.accessKey || '')}" autocomplete="off" spellcheck="false" />
        <div class="hint">只保存在这台设备的浏览器里。</div>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary" type="submit">保存</button>
        <button class="btn btn-quiet" type="button" data-act="close-sheet">取消</button>
      </div>
    </form>
  `);
}

function saveKey(form) {
  const value = String(new FormData(form).get('key') || '').trim();
  state.settings.accessKey = value;
  write(KEY.settings, state.settings);
  closeSheet();
  render();
  toast(value ? '访问口令已保存' : '已清空访问口令');
  cloudRefresh().then(render);
}

async function saveServer(form) {
  const value = String(new FormData(form).get('server') || '').trim().replace(/\/+$/, '');
  if (value && !/^https?:\/\/[^\s]+$/i.test(value)) {
    toast('地址需要以 http:// 或 https:// 开头');
    return;
  }
  state.settings.server = value;
  write(KEY.settings, state.settings);
  closeSheet();
  render();
  await detectProxy();
  await cloudRefresh();
  render();
  toast(value ? '服务器地址已保存' : '已改回当前站点');
}

/* ------------------------------------------------------------------ */
/* 云端 / 推送交互                                                     */
/* ------------------------------------------------------------------ */

async function toggleCloud() {
  const acc = activeAccount();
  if (!acc || acc.demo) {
    toast('演示模式不会连接云端');
    return;
  }
  const current = cloudFor(acc.uid);
  if (current?.enabled) {
    openSheet(`
      <h2 class="sheet-title">关闭云端代签？</h2>
      <p class="sheet-sub">服务器会删除这个账号加密保存的凭据，之后只在 App 打开时签到。</p>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-act="confirm-cloud-off">关闭并删除凭据</button>
        <button class="btn btn-quiet" data-act="close-sheet">取消</button>
      </div>
    `);
    return;
  }
  openSheet(`
    <h2 class="sheet-title">开启云端代签</h2>
    <p class="sheet-sub">开启后这个账号的授权会用 AES-256-GCM 加密保存在服务器上，每天 ${state.settings.time} 由服务器完成签到，手机不用打开 App。</p>
    <div class="banner" style="margin-top:16px">${icons.shield()}
      <div>凭据只加密存在你自己的服务器上；随时可以关闭并删除。</div>
    </div>
    <div class="sheet-actions">
      <button class="btn btn-primary" data-act="confirm-cloud-on">开启云端代签</button>
      <button class="btn btn-quiet" data-act="close-sheet">取消</button>
    </div>
  `);
}

async function runCloudNow() {
  const acc = activeAccount();
  if (!acc) return;
  closeSheet();
  toast('正在让云端执行签到…');
  try {
    await cloudRunNow(acc);
  } catch (err) {
    toast(err.message || '云端执行失败');
  }
}

async function togglePush() {
  const acc = activeAccount();
  if (!acc || acc.demo) {
    toast('演示模式不会订阅通知');
    return;
  }
  if (state.settings.push) {
    await pushDisable();
    render();
    toast('已关闭通知');
    return;
  }
  try {
    await pushEnable(acc.uid);
    render();
    toast('通知已开启');
  } catch (err) {
    toast(err.message || '开启通知失败');
  }
}

async function testPush() {
  const acc = activeAccount();
  if (!acc) return;
  try {
    const out = await cloudFetch('/api/push/test', { uid: acc.uid });
    toast(out.sent ? '测试通知已发送' : '发送失败，检查云端推送配置');
  } catch (err) {
    toast(err.message || '发送失败');
  }
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  load();
  applyTheme();

  const acc = activeAccount();
  if (acc?.demo) {
    seedDemoHistory();
    state.status = { active: true, checked: false, todayCredit: 100, streak: 11, total: 1180 };
  }

  state.booted = true;
  render();

  await detectProxy();
  render();

  await cloudRefresh();
  if (acc && !acc.demo) {
    await cloudSyncResults(acc.uid).catch(() => {});
  }
  render();

  if (acc && !acc.demo) {
    await refreshStatus();
    // 到点自动补签：App 打开 / 回到前台时检查一次
    maybeAutoSignin();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') maybeAutoSignin();
  });

  setInterval(() => { maybeAutoSignin(); }, 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

let autoDate = null;

async function maybeAutoSignin() {
  const acc = activeAccount();
  if (!acc || acc.demo || !state.settings.auto) return;

  const today = ymd(new Date());
  // 跨天：先清掉昨天的状态再同步
  if (state.statusDay && state.statusDay !== today) {
    state.status = null;
    state.statusDay = today;
    await refreshStatus();
    return;
  }
  state.statusDay = today;

  const added = acc.addedAt ? new Date(acc.addedAt) : null;
  if (added && ymd(added) === today) return; // 绑定当天先让用户手动签一次
  if (state.status?.checked || autoDate === today) return;
  if (nowMinutes() < minutesOf(state.settings.time)) return;
  autoDate = today;
  try {
    const st = await fetchStatus(acc);
    state.status = st;
    if (!st.checked) {
      const res = await claim(acc);
      pushHistory(acc.id, { date: ymd(new Date()), at: new Date().toISOString(), result: 'CLAIMED', credit: res.credit });
      state.status = { ...st, checked: true, streak: (st.streak || 0) + 1, todayCredit: res.credit };
      render();
      toast(`已自动签到，+${res.credit} 积分`);
      return;
    }
    render();
  } catch { /* 自动流程失败不打扰 */ }
}

boot();
