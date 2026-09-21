# 💬 高并发在线聊天室

从零实现的 Web 在线聊天室：**React 18 + TypeScript（Vite）** 前端、**Node.js + Express + Socket.IO** 后端、**SQLite（better-sqlite3，WAL 模式）** 存储、**Docker Compose** 一键部署，无任何外部服务依赖。

## 功能一览

| # | 需求 | 实现 |
|---|------|------|
| 1 | 用户名唯一 | 用户名 2-16 位（中英文/数字/下划线），服务端内存在线表 + DB 唯一约束双重保证，重复用户名被拒绝；同一用户刷新/多标签页允许重连 |
| 2 | 实时群聊 | Socket.IO WebSocket 广播，消息实时送达所有在线用户 |
| 3 | 在线用户列表 | 上线/下线（含全部标签页关闭后）实时广播更新，侧栏显示人数与在线状态 |
| 4 | 聊天记录持久化 | 消息落库 SQLite，刷新/重进自动拉取最近 100 条，支持上翻分页 |
| 5 | 私聊 | 点击在线用户发起私聊，消息仅投递给收发双方（基于个人房间），私聊历史同样持久化、可随时回看 |
| 6 | 图片 / 富文本 / 代码块 | TipTap 富文本编辑器：粗体、斜体、下划线、删除线、列表、引用、链接、图片（按钮/粘贴/拖拽上传）、代码块（16 种语言，输入时实时语法高亮 + 语言标签） |
| 7 | 日 / 夜间模式 | 侧栏一键切换「浅色 → 深色 → 跟随系统」，跟随系统时自动响应 OS 外观变化，选择持久化到 localStorage，深浅主题各有一套语法高亮配色 |
| 8 | 粘贴图片 | 剪贴板中的图片（含系统截图）可直接 Ctrl/⌘+V 粘贴进输入框，自动上传并插入 |
| 9 | 群聊已读回执 | 贴底浏览自动上报已读游标（落库），自己发的群消息实时显示「N 人已读」；重进/翻页历史也带已读数 |
| 10 | 消息布局 | 消息区改为头像 + 昵称 + 气泡的标准布局，连续消息头像列对齐 |
| 11 | 回到底部 | 上翻离开底部时出现「↓ 回到底部」悬浮按钮，点击平滑滚回最新消息 |

**安全**：富文本在服务端（sanitize-html 白名单）与客户端（DOMPurify）双重净化，防存储型 XSS；图片上传做魔数校验（防伪造类型）、5MB 大小限制、随机文件名。

## 一键运行（Docker）

前置：已安装 Docker（含 Compose 插件）。

```bash
docker compose up --build -d      # 构建并后台启动
# 打开浏览器访问 http://localhost:3000
docker compose logs -f            # 查看日志
docker compose down               # 停止
```

SQLite 数据库与上传的图片持久化在 Docker volume `chat-data`（挂载到容器 `/app/data`），容器重建/重启后聊天记录仍在。

想开两个窗口自测：用浏览器普通窗口 + 无痕窗口，分别输入不同用户名即可。

## 本地开发

```bash
# 终端 1：后端（http://localhost:3000，tsx 热重载）
cd server && npm install && npm run dev

# 终端 2：前端（http://localhost:5173，已配置代理转发 socket/api/uploads）
cd web && npm install && npm run dev
```

## 测试

```bash
cd server
npm test          # 端到端集成测试（22 项断言：查重/广播/私聊隔离/持久化/XSS/上传/下线）
npm run test:load # 高并发压测：100 用户 × 每人 10 条消息 = 10 万次广播，零丢失
```

本地实测（Mac）：100 用户并发进入 149ms，1000 条消息写入 731ms，全部客户端精确收到 1000 条。

## 目录结构

```
chat-room-b/
├── docker-compose.yml        # 一键编排（单容器：API + WebSocket + 静态页面）
├── Dockerfile                # 三阶段构建：web 构建 → server 构建 → 运行时
├── server/
│   └── src/
│       ├── index.ts          # Express + Socket.IO 启动入口、优雅关停
│       ├── chat.ts           # 核心：加入/群聊/私聊/在线状态/历史 事件处理
│       ├── db.ts             # SQLite 初始化（WAL + 索引）
│       ├── sanitize.ts       # 富文本白名单净化
│       ├── upload.ts         # 图片上传（multer + 魔数校验）
│       ├── config.ts         # 路径/端口配置（环境变量）
│       └── types.ts          # 通信协议类型
└── web/
    └── src/
        ├── App.tsx           # 全局状态：消息、会话、在线列表、断线重连
        ├── api.ts            # socket 事件封装 + 图片上传
        ├── components/       # Login / ChatRoom / MessageList / MessageBubble / RichTextEditor
        └── highlight.ts      # 精简语法高亮（只打包常用语言）
```

## 架构与高并发设计要点

- **实时通道**：Socket.IO 房间模型——`public` 房间承载群广播；每个用户名一个 `user:<name>` 个人房间承载私聊定向投递，天然支持同一用户多标签页。
- **数据库**：better-sqlite3 同步 API 配合 WAL 模式（多读单写不互斥）、`synchronous=NORMAL`、`busy_timeout`；消息表按群聊/私聊建索引，写入即序列化，无线程竞争。
- **消息流**：服务端净化 → 落库 → 带自增 ID 广播；客户端按 ID 去重，刷新走历史重拉，最终一致。
- **连接健壮性**：客户端自动重连并以原用户名静默重新加入；服务端按"用户名 → 多个 socket"维护在线状态，最后一个连接断开才判定下线。
- **无外部依赖**：数据库是本地文件，图片存本地磁盘并由 Express 静态托管，不依赖 Redis/对象存储等任何外部服务。

## 主要通信协议

| 事件 | 方向 | 说明 |
|------|------|------|
| `join(username) → ack` | C→S | 进入聊天室，ack 返回用户信息与最近群聊 |
| `presence:update` | S→C | 在线用户列表（上线/下线实时推送） |
| `public:send(html) → ack` / `public:message` | 双向 | 群聊 |
| `dm:send({to, content}) → ack` / `dm:message` | 双向 | 私聊 |
| `dm:open(peer) → ack` | C→S | 拉取与某人的私聊历史 |
| `public:history(beforeId) → ack` | C→S | 上翻加载更早的群聊 |
| `public:read(messageId)` / `public:read {upTo, counts}` | 双向 | 群聊已读游标上报 / 最近窗口内各消息已读数广播 |
| `POST /api/upload/image` | HTTP | multipart 图片上传，返回 `/uploads/xxx` |
