# 协同思维导图与大纲同步工具

基于 Yjs CRDT 的实时协同思维导图 + 大纲双视图编辑器。

## 功能

- **用户体系**：注册 / 登录（JWT）、工作区、文档 CRUD
- **导图视图**：节点增删改、拖拽换父与同级排序、折叠/展开、dagre 自动布局
- **大纲视图**：树形编辑、Tab 缩进 / Shift+Tab 反缩进、拖拽换父/排序、折叠、行内文本编辑（Enter 新建、空行 Backspace 删除）
- **双向同步**：导图与大纲并排显示，共享同一 `Y.Doc`，任一侧修改另一侧实时更新
- **协作基础**：WebSocket 房间（每文档一个房间）、在线用户头像（awareness）、Yjs CRDT 自动冲突合并
- **版本历史**：每 5 分钟或 100 次操作自动快照；历史列表 / 预览 / 一键恢复
- **导出**：Markdown（remark 序列化）、OPML 2.0（xmlbuilder2）
- **存储**：PostgreSQL 存文档元数据与 Yjs 二进制快照；Redis 存在线状态与 Pub/Sub

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript + Vite + React Flow + dagre + dnd-kit + Zustand + Yjs + @hocuspocus/provider + y-indexeddb |
| 后端 | NestJS + Hocuspocus + Yjs + JWT |
| 存储 | PostgreSQL + Prisma、Redis + ioredis |
| 导出 | remark + xmlbuilder2 |

## 目录结构

```
mindmap-collab/
├── docker-compose.yml        # PostgreSQL + Redis
├── server/                   # NestJS 后端
│   ├── prisma/schema.prisma  # User / Workspace / Document / Snapshot
│   └── src/
│       ├── auth/             # 注册登录、JWT
│       ├── workspaces/       # 工作区
│       ├── documents/        # 文档 CRUD + 在线状态查询
│       ├── collaboration/    # Hocuspocus 协同服务（鉴权/落库/快照/在线状态）
│       ├── snapshots/        # 版本历史（列表/预览/恢复）
│       └── export/           # Markdown / OPML 导出
└── web/                      # React 前端
    └── src/
        ├── model/tree.ts     # 共享 Yjs 树模型（双视图共同操作）
        ├── collab/           # Y.Doc / Provider / awareness
        ├── components/       # MindMapView / OutlineView / ...
        └── pages/            # 登录 / 工作区 / 文档列表 / 编辑器
```

## 快速开始

```bash
# 1. 启动 PostgreSQL 和 Redis
docker compose up -d

# 2. 安装依赖
npm install

# 3. 配置后端环境变量
cp server/.env.example server/.env

# 4. 初始化数据库
npm run prisma:generate
npm run prisma:migrate -w server

# 5. 同时启动后端(3000/1234)与前端(5173)
npm run dev
```

打开 http://localhost:5173 ，注册账号 → 创建工作区 → 新建文档。

**多账号协同**：再注册第二个账号（可用浏览器隐身窗口），在工作区详情的「成员管理」中
按邮箱把第二个账号邀请进工作区；第二个账号登录后即可在自己的工作区列表看到该工作区，
两个账号打开同一文档即可实时协同（在线头像、双向同步）。

## 数据模型（Yjs 共享结构）

导图与大纲操作同一份数据：

```
ydoc.getMap('nodes') : Y.Map<nodeId, Y.Map<{
  parentId: string | null   // 父节点
  text: string              // 文本
  collapsed: boolean        // 折叠状态
  order: number             // 同级排序
}>>
```

任一视图通过事务修改该结构，另一侧通过 `observeDeep` 拿到新快照重渲染；
多客户端之间由 Hocuspocus 转发 Yjs 更新，CRDT 保证冲突自动收敛。

## 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /auth/register、/auth/login | 注册 / 登录 |
| GET/POST | /workspaces | 工作区列表 / 创建 |
| GET/POST | /workspaces/:id/members | 成员列表 / 按邮箱邀请 |
| DELETE | /workspaces/:id/members/:userId | 移除成员（仅所有者） |
| GET/POST | /workspaces/:id/documents | 文档列表 / 新建 |
| GET/PATCH/DELETE | /documents/:id | 文档详情 / 重命名 / 删除 |
| GET | /documents/:id/presence | 在线用户（Redis） |
| GET | /documents/:id/snapshots | 快照列表 |
| GET | /documents/:id/snapshots/:sid/preview | 快照预览 |
| POST | /documents/:id/snapshots/:sid/restore | 恢复快照 |
| GET | /documents/:id/export?format=markdown\|opml | 导出 |
| WS | ws://localhost:1234/document:[:id] | 协同房间（Hocuspocus） |
