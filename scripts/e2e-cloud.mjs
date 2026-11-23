// 端到端联调脚本：绑定账号 → 签到 → 开启云端代签 → 云端执行（配合 mock 上游使用）
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

const EXE = path.join(os.homedir(), '.cache/ms-playwright/chromium-1148/chrome-linux/chrome');
const BASE = process.env.BASE || 'http://127.0.0.1:5179';
const OUT = '/root/workspace/shots';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'light',
  locale: 'zh-CN',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);

await page.getByText('使用 WorkBuddy 账号登录').click();
await page.waitForTimeout(350);
await page.getByText('我已登录，去粘贴').click();
await page.waitForTimeout(350);
await page.locator('#f-token').fill('mock-token-abcdef');
await page.locator('#f-uid').fill('654321');
await page.getByRole('button', { name: '完成绑定' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/c1-bound.png` });
console.log('bound, status text:', (await page.locator('.hero-caption').innerText()).trim());

if (await page.getByText('立即签到').count()) {
  await page.getByText('立即签到').click();
  await page.waitForTimeout(1500);
  console.log('after signin:', (await page.locator('.hero-caption').innerText()).trim());
} else {
  console.log('already signed, skip manual signin');
}

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/c2-settings.png` });

await page.locator('[data-act="toggle-cloud"]').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/c3-cloud-consent.png` });
await page.getByText('开启云端代签', { exact: true }).last().click();
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/c4-cloud-on.png` });

const accounts = await fetch('http://127.0.0.1:5179/api/cloud/accounts').then((r) => r.json());
console.log('cloud accounts:', JSON.stringify(accounts.accounts));

await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/c5-records.png` });

await page.getByRole('button', { name: '今日', exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/c6-today.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
