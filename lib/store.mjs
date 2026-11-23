// 服务端账户仓库：凭据加密落盘、签到结果、推送订阅。
// 目录权限 0700，文件 0600；密钥来自 WB_SECRET，未配置时在数据目录生成一次性密钥。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { deriveKey, seal, open } from './crypto.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.WB_DATA_DIR || path.join(HERE, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'accounts.json');
const KEY_FILE = path.join(DATA_DIR, 'secret.key');
const MAX_RESULTS = 200;

let state = { accounts: {}, results: {}, push: {} };
let key = null;
let loaded = false;

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DATA_DIR, 0o700); } catch { /* 忽略 */ }
}

function loadKey() {
  if (process.env.WB_SECRET) return deriveKey(process.env.WB_SECRET);
  ensureDir();
  if (fs.existsSync(KEY_FILE)) {
    return deriveKey(fs.readFileSync(KEY_FILE, 'utf8').trim());
  }
  const secret = randomBytes(32).toString('base64url');
  fs.writeFileSync(KEY_FILE, secret, { mode: 0o600 });
  return deriveKey(secret);
}

export function init() {
  if (loaded) return;
  ensureDir();
  key = loadKey();
  if (fs.existsSync(STORE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      state = {
        accounts: parsed.accounts || {},
        results: parsed.results || {},
        push: parsed.push || {},
      };
    } catch {
      state = { accounts: {}, results: {}, push: {} };
    }
  }
  loaded = true;
}

function save() {
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
}

export function hasSecretFromEnv() {
  return Boolean(process.env.WB_SECRET);
}

export function listAccounts() {
  init();
  return Object.values(state.accounts).map(publicView);
}

function publicView(a) {
  return {
    uid: a.uid,
    name: a.name,
    domain: a.domain,
    time: a.time,
    tz: a.tz,
    enabled: Boolean(a.enabled),
    createdAt: a.createdAt,
    lastRunAt: a.lastRunAt || null,
    lastDate: a.lastDate || null,
    lastResult: a.lastResult || null,
    needsRebind: Boolean(a.needsRebind),
  };
}

export function getAccount(uid) {
  init();
  return state.accounts[uid] || null;
}

export function bindAccount({ uid, token, domain, name, time, tz }) {
  init();
  const prev = state.accounts[uid];
  state.accounts[uid] = {
    uid,
    name: name || prev?.name || `账号 ${String(uid).slice(-4)}`,
    domain: domain || 'www.workbuddy.cn',
    time: time || prev?.time || '00:05',
    tz: tz || prev?.tz || 'Asia/Shanghai',
    enabled: prev ? prev.enabled : true,
    createdAt: prev?.createdAt || new Date().toISOString(),
    lastRunAt: prev?.lastRunAt || null,
    lastDate: prev?.lastDate || null,
    lastResult: prev?.lastResult || null,
    needsRebind: false,
    token: seal(key, token),
  };
  save();
  return publicView(state.accounts[uid]);
}

export function updateAccount(uid, patch = {}) {
  init();
  const acc = state.accounts[uid];
  if (!acc) return null;
  if (typeof patch.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.time)) acc.time = patch.time;
  if (typeof patch.enabled === 'boolean') acc.enabled = patch.enabled;
  if (typeof patch.name === 'string' && patch.name.trim()) acc.name = patch.name.trim().slice(0, 32);
  if (typeof patch.tz === 'string' && patch.tz) acc.tz = patch.tz;
  save();
  return publicView(acc);
}

export function unbindAccount(uid) {
  init();
  const existed = Boolean(state.accounts[uid]);
  delete state.accounts[uid];
  delete state.results[uid];
  delete state.push[uid];
  save();
  return existed;
}

export function credentialsFor(uid) {
  init();
  const acc = state.accounts[uid];
  if (!acc) return null;
  return { uid: acc.uid, domain: acc.domain, token: open(key, acc.token) };
}

export function recordResult(uid, { date, result, credit = 0, streak = null, total = null, report = '' }) {
  init();
  const acc = state.accounts[uid];
  if (!acc) return;
  const entry = { at: new Date().toISOString(), date, result, credit, streak, total, report };
  const list = state.results[uid] || [];
  list.unshift(entry);
  state.results[uid] = list.slice(0, MAX_RESULTS);
  acc.lastRunAt = entry.at;
  if (date) acc.lastDate = date;
  acc.lastResult = { result, credit, at: entry.at };
  if (result === 'AUTH') acc.needsRebind = true;
  save();
}

export function resultsFor(uid, limit = 30) {
  init();
  return (state.results[uid] || []).slice(0, limit);
}

export function markRebind(uid, value = true) {
  init();
  if (state.accounts[uid]) {
    state.accounts[uid].needsRebind = value;
    save();
  }
}

export function setPush(uid, subscription) {
  init();
  state.push[uid] = { subscription, at: new Date().toISOString() };
  save();
}

export function getPush(uid) {
  init();
  return state.push[uid]?.subscription || null;
}

export function removePush(uid) {
  init();
  delete state.push[uid];
  save();
}

export function stats() {
  init();
  return {
    accounts: Object.keys(state.accounts).length,
    subscribed: Object.keys(state.push).length,
    dataDir: DATA_DIR,
  };
}
