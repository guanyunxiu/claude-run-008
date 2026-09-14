// 测试实时在线文档（内存路径）+ 特殊字符的导出
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { RedisService } = require('../dist/redis/redis.service');
const { CollaborationService } = require('../dist/collaboration/collaboration.service');
const { JwtService } = require('@nestjs/jwt');
const Y = require('yjs');

const db = {
  users: [{ id: 'u1', email: 'a@b.c', name: 'Alice', passwordHash: 'x' }],
  members: [{ id: 'm1', userId: 'u1', workspaceId: 'w1', role: 'owner' }],
  documents: [{ id: 'd1', title: 'T', workspaceId: 'w1', createdById: 'u1', yjsState: null }],
};
const prismaMock = {
  $connect: async () => {}, $disconnect: async () => {},
  user: { findUnique: async ({ where }) => db.users.find((u) => u.id === where.id) || null },
  workspaceMember: { findUnique: async ({ where }) => db.members.find((m) => m.userId === where.userId_workspaceId.userId) || null },
  document: {
    findUnique: async ({ where, select }) => {
      const d = db.documents.find((x) => x.id === where.id) || null;
      if (!d || !select) return d;
      const out = {}; for (const k of Object.keys(select)) if (select[k]) out[k] = d[k]; return out;
    },
    update: async ({ where, data }) => Object.assign(db.documents.find((x) => x.id === where.id), data),
  },
  snapshot: { create: async ({ data }) => data },
};
const redisMock = { addPresence: async () => {}, removePresence: async () => {}, onModuleInit() {}, onModuleDestroy() {} };

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue(prismaMock)
    .overrideProvider(RedisService).useValue(redisMock)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  const server = app.getHttpServer();
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  // 模拟在线协同文档：直接把 Y.Doc 放进 hocuspocus 的 documents
  const collab = moduleRef.get(CollaborationService);
  const live = new Y.Doc();
  const nodes = live.getMap('nodes');
  const mk = (id, parentId, text, order) => {
    const m = new Y.Map();
    m.set('parentId', parentId); m.set('text', text); m.set('collapsed', false); m.set('order', order);
    nodes.set(id, m);
  };
  mk('root', null, '根 & <特殊> "字符" 😀', 0);
  mk('a', 'root', '含换行\n的文本', 0);
  collab.server.documents.set('document:d1', live);

  const jwt = moduleRef.get(JwtService, { strict: false });
  const token = jwt.sign({ sub: 'u1', email: 'a@b.c' });
  for (const format of ['markdown', 'opml']) {
    const res = await fetch(`http://127.0.0.1:${port}/documents/d1/export?format=${format}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`--- live ${format}: HTTP ${res.status} ---`);
    console.log((await res.text()).slice(0, 200));
  }
  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('ERR:', e); process.exit(1); });
