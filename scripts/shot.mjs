// 本地视觉自检脚本：用无头 Chromium 截图各页面（仅开发时使用）
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

const EXE = path.join(os.homedir(), '.cache/ms-playwright/chromium-1148/chrome-linux/chrome');
const BASE = process.env.BASE || 'http://127.0.0.1:5178';
const OUT = process.env.OUT || '/root/workspace/shots';

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
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const shot = async (name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await shot('01-auth');

await page.getByText('以演示模式预览').click();
await shot('02-today');

await page.getByText('立即签到').click();
await page.waitForTimeout(1200);
await shot('03-signed');

await page.getByRole('button', { name: '记录' }).click();
await shot('04-records');

await page.getByRole('button', { name: '账号' }).click();
await shot('05-accounts');

await page.getByRole('button', { name: '我的' }).click();
await shot('06-settings');

await page.getByText('深色', { exact: true }).click();
await shot('07-settings-dark');

await page.getByRole('button', { name: '今日' }).click();
await shot('08-today-dark');

await page.getByText('每天自动签到').click({ force: true }).catch(() => {});
await ctx.close();

const ctx2 = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  colorScheme: 'light',
  locale: 'zh-CN',
});
const p2 = await ctx2.newPage();
await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
await p2.getByText('使用 WorkBuddy 账号登录').click();
await p2.waitForTimeout(400);
await p2.screenshot({ path: `${OUT}/09-login-sheet.png` });
await p2.getByText('我已登录，去粘贴').click();
await p2.waitForTimeout(400);
await p2.screenshot({ path: `${OUT}/10-bind-sheet.png` });
await p2.getByText('取消').click();
await p2.getByText('以演示模式预览').click();
await p2.waitForTimeout(300);
await p2.getByText('执行时间').click();
await p2.waitForTimeout(400);
await p2.screenshot({ path: `${OUT}/11-time-sheet.png` });

await browser.close();
console.log('done');
