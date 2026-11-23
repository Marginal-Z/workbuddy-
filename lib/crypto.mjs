// 凭据加密：AES-256-GCM，密钥由 WB_SECRET 派生；未配置时在数据目录生成一次性密钥。
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

const SALT = 'workbuddy-checkin/v1';

export function deriveKey(secret) {
  return scryptSync(String(secret), SALT, 32);
}

export function seal(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

export function open(key, box) {
  if (!box || box.v !== 1) throw new Error('unsupported envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]).toString('utf8');
}
