// 截取设置页下半部分（云端 / 通知 / 服务器 / 数据），用于交付检查
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

const EXE = path.join(os.homedir(), '.cache/ms-playwright/chromium-1148/chrome-linux/chrome');
const BASE = process.env.BASE || 'http://127.0.0.1:5179';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  colorScheme: 'light', locale: 'zh-CN',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);

// 已有账号则直接进设置，否则先绑定 mock 账号
if (await page.getByText('使用 WorkBuddy 账号登录').count()) {
  await page.getByText('使用 WorkBuddy 账号登录').click();
  await page.waitForTimeout(300);
  await page.getByText('我已登录，去粘贴').click();
  await page.waitForTimeout(300);
  await page.locator('#f-token').fill('mock-token-abcdef');
  await page.locator('#f-uid').fill('654321');
  await page.getByRole('button', { name: '完成绑定' }).click();
  await page.waitForTimeout(1200);
}

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(500);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(600);
await page.screenshot({ path: '/root/workspace/shots/s1-settings-bottom.png' });

await page.evaluate(() => window.scrollTo(0, 0));
await page.getByText('服务器地址').click();
await page.waitForTimeout(500);
await page.screenshot({ path: '/root/workspace/shots/s2-server-sheet.png' });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
