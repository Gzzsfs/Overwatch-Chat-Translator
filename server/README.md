# Overwatch Translation Proxy

面向公开用户分发时，客户端不内置 DeepSeek Key，而是登录本服务获取设备令牌，再通过本服务转发翻译请求。

## 本地启动

```powershell
copy .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY
npm install
npm run migrate
npm run dev
```

Docker 方式：

```powershell
$env:DEEPSEEK_API_KEY="sk-..."
docker compose up --build
```

## 后台账号

第一版不开放公开注册。先迁移数据库，再后台创建账号：

```powershell
npm run migrate
npm run create-user -- user@example.com "password123" "Player"
npm run reset-password -- user@example.com "new-password123"
npm run disable-user -- user@example.com
npm run enable-user -- user@example.com
npm run revoke-device -- user@example.com "<deviceId>"
```

## 隐私边界

数据库不会保存聊天原文，也不会接收截图。服务只记录账号、设备、请求数、字符数、错误码和延迟，用于鉴权、限流和排错。
