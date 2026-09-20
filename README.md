# 实时在线聊天室

面向高并发场景的 Web 在线聊天室，支持群聊、私聊、在线状态实时更新、历史消息持久化、图片 / 富文本 / 代码块。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 18 + TypeScript + Vite，Socket.IO Client，markdown-it + highlight.js + DOMPurify |
| 后端 | Node.js + TypeScript，Fastify，Socket.IO，better-sqlite3 |
| 数据库 | SQLite（WAL 模式，单写多读），数据文件持久化在 Docker 卷中 |
| 部署 | 多阶段 Dockerfile，docker compose 一键启动，无任何外部服务依赖 |

## 一键运行（Docker）

```bash
docker compose up -d --build
```

启动后访问 <http://localhost:3000> 。

- 端口可通过环境变量调整：`HOST_PORT=8080 docker compose up -d --build`
- 数据（SQLite 数据库 + 上传图片）保存在命名卷 `chat-data` 中，容器重建不丢失
- 停止：`docker compose down`（加 `-v` 会同时删除数据卷）

## 本地开发

需要 Node.js 22+。

```bash
# 终端 1：后端（默认 http://localhost:3001）
cd backend
npm install
npm run dev

# 终端 2：前端（默认 http://localhost:5173，自动代理到后端）
cd frontend
npm install
npm run dev
```

**端口占用自动切换**：如果默认端口已被占用，后端会自动尝试 3002、3003…
（最多 10 个），前端 Vite 同理自动选用下一个可用端口。后端把实际监听端口
写入 `backend/.dev-port`，前端开发代理每次请求动态读取该文件，因此后端
换端口无需重启前端。

## 功能清单

1. **用户名登录**：进入时输入用户名，服务端全局唯一性校验，重复会被拒绝
2. **群聊**：消息经 WebSocket 实时广播给所有在线用户
3. **在线列表**：上线 / 下线实时广播 presence，列表即时更新
4. **历史消息**：所有消息落库 SQLite，刷新页面后自动拉取最近 50 条；网络抖动时 Socket.IO 连接状态恢复（10 秒内）无感续连，服务器重启后自动用原用户名重新加入并同步历史
5. **私聊**：点击在线用户发起私聊，消息仅推送给双方，私聊记录独立持久化，重新打开会话时加载历史
6. **图片 / 富文本 / 代码块**：
   - 工具栏一键插入加粗、斜体、删除线、链接、引用、列表、行内代码、围栏代码块
   - 代码块按语言语法高亮，带语言标签与一键复制
   - 输入框支持「编辑 / 预览」切换：插入代码块后自动进入实时预览，代码块以
     高亮样式渲染，而不是展示 ```` ``` ```` 源码
   - 图片可点击工具栏上传，也可直接 **Ctrl/⌘+V 粘贴剪贴板截图**
     （PNG/JPEG/GIF/WebP，≤5MB），自动上传后插入消息；上传在原生 HTTP 层
     用 busboy 流式解析，服务端校验真实文件头，防可执行文件伪装
   - 消息按 Markdown 渲染并经 DOMPurify 消毒，防 XSS；图片可点击放大
7. **日间 / 夜间主题**：右上角按钮在「跟随系统 → 日间 → 夜间」之间循环，
   跟随系统模式下通过 `prefers-color-scheme` 自动响应系统深浅色切换，选择
   持久化到 localStorage
8. **已读回执（群聊）**：自己发送的消息下方显示「N 人已读 / 未读」，点击可
   查看已读用户名列表；停留在大厅底部即自动上报已读位置
9. **回到底部**：消息列表滚动离开底部时，底部浮现「↓ 回到底部」按钮，点击
   平滑滚回最新消息

## 高并发设计要点

- **WebSocket 长连接**：Socket.IO 基于 Engine.IO，单连接多路复用，支持断线自动重连与离线消息缓冲
- **SQLite WAL**：`journal_mode=WAL` + `synchronous=NORMAL` + 64MB 内存缓存 + 5s busy timeout，读不阻塞写、写不阻塞读；消息写入为预处理语句（prepared statement）
- **事件循环友好**：better-sqlite3 同步 API 配合极短写入事务，避免异步驱动的连接池开销；单条写入为微秒级
- **背压保护**：Socket.IO 帧大小限制、每用户滑动窗口限流（5 秒 15 条）、上传大小与文件头校验
- **已读回执**：`message_receipts` 表以 `(message_id, reader)` 复合主键幂等记录；
  客户端上报「已读至某条」，服务端仅批量广播最近 50 条消息的计数（不是逐用户
  名单），并做 500ms 防抖合并；客户端侧 600ms 节流，N 人同时已读只产生一次
  扇出风暴的一小部分；点击「N 人已读」才按需查询完整名单
- **HTTP 层**：Fastify（高吞吐）、响应压缩、静态资源与 API 同源部署，无需额外网关
- **横向扩展预留**：会话与在线状态集中在 `realtime.ts`，多实例时只需接入 Socket.IO Redis adapter（受“不依赖外部服务”约束，本项目默认单实例）

## 架构

```
frontend/                 React SPA
  src/
    App.tsx               登录 / 重连状态机
    components/           Login、ChatApp、Sidebar、MessageList、Composer
    lib/                  Markdown 渲染消毒、格式化
backend/
  src/
    index.ts      入口
    app.ts        Fastify（REST / 静态资源 / 上传劫持）
    realtime.ts   Socket.IO（加入、群聊、私聊、presence、已读回执、断线恢复）
    rawUpload.ts  原生 HTTP 层 busboy 图片上传（Fastify onRequest 劫持）
    db.ts         SQLite 初始化、WAL 调优、消息查询、已读回执表
    session.ts    内存会话与用户名校验
    rateLimit.ts  滑动窗口限流
    routes.ts     历史记录 REST API
  scripts/
    smoke.ts      端到端功能测试（19 项）
    receipts.ts   已读回执端到端测试
    reconnect.ts  重连 / 用户名接管测试
    loadtest.ts   高并发压测
Dockerfile        前端构建 → 后端构建 → 运行时（非 root 用户）
docker-compose.yml 单服务 + 数据卷 + 健康检查
```

## 测试

`backend` 目录下，服务运行时（本地 3001 或 Docker 3000）：

```bash
# 功能：登录/重名/群聊/私聊/在线列表/上下线/历史/上传鉴权/伪装图片
SMOKE_URL=http://localhost:3000 node --import tsx scripts/smoke.ts

# 已读回执：消息计数、已读用户列表、批量广播、非法参数
SMOKE_URL=http://localhost:3000 node --import tsx scripts/receipts.ts

# 重连：活跃连接不可冒名、断线宽限期内同名可接管
SMOKE_URL=http://localhost:3000 node --import tsx scripts/reconnect.ts

# 压测：默认 200 用户 × 20 条消息（参数：用户数 每用户消息数）
LOADTEST_URL=http://localhost:3000 node --import tsx scripts/loadtest.ts 200 20
```

验证结果（本机 Docker，200 用户）：4000 条消息、80 万次扇出全部到达，零服务端错误；SQLite 历史在容器重启后仍然存在。
