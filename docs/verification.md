# 真机验证清单

按顺序做完，就能确认「网页 → 云端代签 → 推送 → APK」整条链路在你自己的环境里是通的。

## 0. 准备

- 一台常开的机器（VPS / NAS / 旧笔记本）或 Render 账号
- 一个域名 + HTTPS（推送必须；也可以先在本机 `localhost` 验证）
- 你的 WorkBuddy 桌面客户端已登录（用来取 `accessToken`）

## 1. 起服务

```bash
cd workbuddy-app
export WB_SECRET="$(openssl rand -base64 32)"
export WB_ACCESS_KEY="<自己设一个口令>"
docker compose up -d --build
curl -s localhost:8080/api/health
```

期望：`{"ok":true,"cloud":true,"push":true,...}`

- [ ] `WB_SECRET` 已设为固定值并记下来（换掉后已存的凭据解密失败，必须重新绑定）
- [ ] `curl -s localhost:8080/api/cloud/accounts` 返回 403（说明口令鉴权生效）
- [ ] 带上口令再请求：`curl -s -H "X-Access-Key: <口令>" localhost:8080/api/cloud/accounts` 返回 200

## 2. HTTPS

用 Caddy 最省事，`Caddyfile`：

```
checkin.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

- [ ] 浏览器打开 `https://checkin.example.com` 能看到登录页
- [ ] 地址栏是小锁（推送和 Service Worker 都要求安全上下文）

## 3. 装到手机主屏

- [ ] iOS Safari：分享 → 添加到主屏幕；Android Chrome：菜单 → 安装应用
- [ ] 从主屏图标打开，处于全屏（没有地址栏）
- [ ] 断网后重新打开，仍能进入外壳（离线缓存生效）

## 4. 登录绑定

- [ ] 点「使用 WorkBuddy 账号登录」→「打开官方页面」，登录成功后回到 App
- [ ] 从客户端登录态里复制 `accessToken`，粘贴到「授权信息」
- [ ] UID 自动识别成功（识别不到时手动填客户端里的数字 UID）
- [ ] 绑定后首页显示「待签到 / 今日可得」，而不是「未连接签到服务」

异常：提示「访问口令不正确」→ 去「我的 → 访问口令」填 `WB_ACCESS_KEY`。

## 5. 手动签到

- [ ] 点「立即签到」，出现「签到成功，+N 积分」
- [ ] 再点一次（或强刷）显示「今日已签到」，不会重复加积分（幂等）
- [ ] 「记录」页出现当天记录，日历上当天有标记

## 6. 云端代签

- [ ] 「我的 → 云端代签」打开，确认弹窗
- [ ] 开关变绿，副标题变成「服务器每天 HH:MM 替你签到」
- [ ] 点「立即在云端执行一次」，提示云端签到完成
- [ ] 服务器上确认：
      `curl -H "X-Access-Key: <口令>" 'localhost:8080/api/cloud/results?uid=<UID>'`
      能看到对应记录
- [ ] 检查落盘是密文：`grep -c accessToken data/accounts.json` 或直接看文件，不应出现明文令牌
- [ ] 把执行时间改成一分钟后，关掉 App 等两分钟，再打开看记录里是否有云端签到

## 7. 推送

- [ ] 「我的 → 签到结果通知」打开，浏览器弹出通知权限，允许
- [ ] 点「发送测试通知」，通知栏出现「签到助手 · 通知已开启」
- [ ] 手机切到桌面，等云端签到时间到，通知栏出现签到结果
- [ ] 点通知能回到 App

iOS 注意：需要 16.4+ 且先「添加到主屏幕」再开通知，否则拿不到权限。

## 8. APK

- [ ] GitHub Actions 里 `Android APK` 跑通，下载 `workbuddy-checkin-debug` 的产物
- [ ] 安装后首次打开，页面正常显示登录页
- [ ] 「我的 → 服务器地址」填 `https://checkin.example.com`，「访问口令」填同一个值
- [ ] 绑定账号、签到、云端开关都正常

## 9. 安全自查

- [ ] `data/` 目录权限 700，文件 600
- [ ] 仓库里没有 `data/`、没有 token、没有 `WB_SECRET`
- [ ] 公网部署时 `WB_ACCESS_KEY` 非空
- [ ] 不再使用的账号点「解除全部绑定」，服务端凭据被删除
- [ ] 部署密钥（Deploy key）只对这一个仓库、只开 write，不再用就删掉

## 10. 故障对照

| 现象 | 先查什么 |
|---|---|
| 首页提示未连接服务 | 服务是否在跑；「服务器地址」是否填对；HTTPS 证书是否有效 |
| 401 / 需要重新绑定 | accessToken 过期；重新粘贴一次（客户端登录态里取新的） |
| 403 / 访问口令不正确 | 服务端 `WB_ACCESS_KEY` 与 App 里填的是否一致 |
| 签到成功但没推送 | 是否 HTTPS；通知权限是否允许；是否点过「发送测试通知」 |
| 云端不执行 | 账号是否 `enabled`；`needsRebind` 是否为 true；服务器时区与设定时间 |
| APK 里一直转圈 | 服务器地址是否带 `http(s)://`；后端是否开了 CORS（本项目已默认允许） |
