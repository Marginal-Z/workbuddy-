// WorkBuddy 签到助手 · 本地服务
// 1) 托管静态页面；2) 转发签到请求（浏览器直连会被 CORS 拦掉）；
// 3) 可选：把凭据加密存到服务端并每日定时代签（7×24），结果可通过 Web Push 推送。

import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as upstream from './lib/upstream.mjs';
import * as store from './lib/store.mjs';
import * as push from './lib/push.mjs';
import { runNow, startScheduler } from './lib/scheduler.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || '0.0.0.0';
const ACCESS_KEY = process.env.WB_ACCESS_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function guard(req) {
  if (!ACCESS_KEY) return true;
  return req.headers['x-access-key'] === ACCESS_KEY;
}

function validUid(uid) {
  return /^[0-9]{1,32}$/.test(String(uid ?? ''));
}

function validToken(token) {
  return typeof token === 'string' && token.length >= 8 && token.length <= 4096;
}

/* ------------------------------ 路由：签到代理 ------------------------------ */

async function handleProxy(req, res) {
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad request' }); }
  const { token, uid, domain, apiPath, payload } = body || {};
  if (!validToken(token)) return json(res, 400, { error: 'invalid token' });
  if (!validUid(uid)) return json(res, 400, { error: 'invalid uid' });
  if (!upstream.ALLOWED.has(apiPath)) return json(res, 400, { error: 'path not allowed' });
  try {
    const out = await upstream.call({ token, uid, domain, apiPath, payload });
    return json(res, 200, out);
  } catch (err) {
    return json(res, 200, { status: 0, error: err.code || 'NETWORK' });
  }
}

/* ------------------------------ 路由：云端代签 ------------------------------ */

async function handleCloud(req, res, url) {
  if (!guard(req)) return json(res, 403, { error: 'access key required' });
  const route = url.pathname;

  if (route === '/api/cloud/accounts' && req.method === 'GET') {
    return json(res, 200, {
      accounts: store.listAccounts(),
      stats: store.stats(),
      envSecret: store.hasSecretFromEnv(),
    });
  }

  if (route === '/api/cloud/bind' && req.method === 'POST') {
    const body = await readBody(req);
    if (!validUid(body.uid)) return json(res, 400, { error: 'invalid uid' });
    if (!validToken(body.token)) return json(res, 400, { error: 'invalid token' });
    // 先验一次凭据，避免把无效令牌存进服务端
    try {
      await upstream.status({ token: body.token, uid: String(body.uid), domain: body.domain || 'www.workbuddy.cn' });
    } catch (err) {
      if (err.code === 'AUTH') return json(res, 200, { verified: false, error: '授权无效或已过期' });
      // 网络类错误不阻断绑定，交给定时任务重试
    }
    const account = store.bindAccount({
      uid: String(body.uid),
      token: body.token,
      domain: body.domain,
      name: body.name,
      time: body.time,
      tz: body.tz,
    });
    return json(res, 200, { account, verified: true });
  }

  if (route === '/api/cloud/update' && req.method === 'POST') {
    const body = await readBody(req);
    if (!validUid(body.uid)) return json(res, 400, { error: 'invalid uid' });
    const account = store.updateAccount(String(body.uid), { time: body.time, enabled: body.enabled, name: body.name, tz: body.tz });
    if (!account) return json(res, 404, { error: 'not found' });
    return json(res, 200, { account });
  }

  if (route === '/api/cloud/unbind' && req.method === 'POST') {
    const body = await readBody(req);
    if (!validUid(body.uid)) return json(res, 400, { error: 'invalid uid' });
    return json(res, 200, { removed: store.unbindAccount(String(body.uid)) });
  }

  if (route === '/api/cloud/run' && req.method === 'POST') {
    const body = await readBody(req);
    if (!validUid(body.uid)) return json(res, 400, { error: 'invalid uid' });
    const out = await runNow(String(body.uid), { trigger: 'manual' });
    return json(res, 200, out);
  }

  if (route === '/api/cloud/results' && req.method === 'GET') {
    const uid = url.searchParams.get('uid') || '';
    if (!validUid(uid)) return json(res, 400, { error: 'invalid uid' });
    const limit = Math.min(Number(url.searchParams.get('limit') || 30) || 30, 200);
    return json(res, 200, { results: store.resultsFor(uid, limit) });
  }

  return json(res, 404, { error: 'not found' });
}

/* ------------------------------ 路由：推送 ------------------------------ */

async function handlePush(req, res, url) {
  if (!guard(req)) return json(res, 403, { error: 'access key required' });

  if (url.pathname === '/api/push/key' && req.method === 'GET') {
    return json(res, 200, { publicKey: push.publicKey() });
  }

  if (url.pathname === '/api/push/subscribe' && req.method === 'POST') {
    const body = await readBody(req);
    if (!validUid(body.uid)) return json(res, 400, { error: 'invalid uid' });
    if (!body.subscription?.endpoint) return json(res, 400, { error: 'invalid subscription' });
    store.setPush(String(body.uid), body.subscription);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/push/test' && req.method === 'POST') {
    const body = await readBody(req);
    if (!validUid(body.uid)) return json(res, 400, { error: 'invalid uid' });
    const out = await push.notify(String(body.uid), {
      title: '签到助手',
      body: '通知已开启，签到结果会推送到这里。',
      tag: 'test',
    });
    return json(res, 200, out);
  }

  return json(res, 404, { error: 'not found' });
}

/* ------------------------------ 静态资源 ------------------------------ */

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(ROOT)) return json(res, 403, { error: 'forbidden' });

  let info;
  try { info = await stat(target); } catch { info = null; }

  if (!info || info.isDirectory()) {
    // 只有无扩展名的路径才回退到 SPA 外壳
    if (path.extname(target)) return json(res, 404, { error: 'not found' });
    const fallback = path.join(ROOT, 'index.html');
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
    createReadStream(fallback).pipe(res);
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=300';
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  createReadStream(target).pipe(res);
}

/* ------------------------------ 服务入口 ------------------------------ */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-access-key',
  'access-control-max-age': '86400',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
  }

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        cloud: true,
        push: Boolean(push.publicKey()),
        at: new Date().toISOString(),
      });
    }

    if (pathname === '/api/wb' && req.method === 'POST') return await handleProxy(req, res);
    if (pathname.startsWith('/api/cloud/')) return await handleCloud(req, res, url);
    if (pathname.startsWith('/api/push/')) return await handlePush(req, res, url);
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, pathname);
    return json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    return json(res, 500, { error: 'internal', detail: String(err?.message || err) });
  }
});

store.init();
push.initPush();
startScheduler();

server.listen(PORT, HOST, () => {
  console.log(`[workbuddy] 签到助手已启动：http://127.0.0.1:${PORT}`);
  console.log(`[workbuddy] 云端代签：${store.stats().accounts} 个账号，数据目录 ${store.DATA_DIR}`);
});
