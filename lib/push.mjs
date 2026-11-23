// Web Push：首次启动生成 VAPID 密钥并持久化，订阅失效时自动清理。
import fs from 'node:fs';
import path from 'node:path';
import { generateVAPIDKeys, sendNotification, setVapidDetails } from 'web-push';
import { DATA_DIR, getPush, removePush } from './store.mjs';

let vapid = null;

export function initPush() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DATA_DIR, 'vapid.json');
  if (fs.existsSync(file)) {
    vapid = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    vapid = generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(vapid, null, 2), { mode: 0o600 });
  }
  setVapidDetails('mailto:checkin@localhost', vapid.publicKey, vapid.privateKey);
  return vapid.publicKey;
}

export function publicKey() {
  return vapid?.publicKey || null;
}

export async function notify(uid, payload) {
  const subscription = getPush(uid);
  if (!subscription) return { sent: false, reason: 'no-subscription' };
  try {
    await sendNotification(subscription, JSON.stringify(payload), { TTL: 3600 });
    return { sent: true };
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) removePush(uid);
    return { sent: false, reason: err?.statusCode || err?.message || 'error' };
  }
}
