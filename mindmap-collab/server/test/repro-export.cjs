// 完整 Nest 应用上下文复现导出 500（Prisma/Redis 用内存 mock）
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { RedisService } = require('../dist/redis/redis.service');
const { JwtService } = require('@nestjs/jwt');
const Y = require('yjs');

// ---- 内存 mock ----
const db = {
  users: [{ id: 'u1', email: 'a@b.c', name: 'Alice', passwordHash: 'x' }],
  members: [{ id: 'm1', userId: 'u1', workspaceId: 'w1', role: 'owner' }],
  documents: [],
};
const prismaMock = {
  $connect: async () => {},
  $disconnect: async () => {},
  user: { findUnique: async ({ where }) => db.users.find((u) => u.id === where.id || u.email === where.email) || null },
  workspaceMember: {
    findUnique: async ({ where }) =>
      db.members.find((m) => m.userId === where.userId_workspaceId.userId && m.workspaceId === where.userId_workspaceId.workspaceId) || null,
  },
  document: {
    findUnique: async ({ where, select }) => {
      const d = db.documents.find((x) => x.id === where.id) || null;
      if (!d || !select) return d;
      const out = {};
      for (const k of Object.keys(select)) if (select[k]) out[k] = d[k];
      return out;
    },
    update: async ({ where, data }) => {
      const d = db.documents.find((x) => x.id === where.id);
      Object.assign(d, data);
      return d;
    },
  },
  snapshot: { create: async ({ data }) => data, findMany: async () => [], findUnique: async () => null },
};
const redisMock = {
  addPresence: async () => {}, removePresence: async () => {}, getPresence: async () => [],
  client: {}, publisher: {}, subscriber: {},
  onModuleInit() {}, onModuleDestroy() {},
};

async function main() {
  // 造一篇有内容的文档状态
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');
  const mk = (id, parentId, text, order) => {
    const m = new Y.Map();
    m.set('parentId', parentId); m.set('text', text); m.set('collapsed', false); m.set('order', order);
    nodes.set(id, m);
  };
  mk('root', null, '产品规划', 0);
  mk('a', 'root', '目标', 0);
  db.documents.push({
    id: 'd1', title: '测试文档', workspaceId: 'w1', createdById: 'u1',
    yjsState: Buffer.from(Y.encodeStateAsUpdate(doc)),
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue(prismaMock)
    .overrideProvider(RedisService).useValue(redisMock)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  const server = app.getHttpServer();
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const jwt = moduleRef.get(JwtService, { strict: false });
  const token = jwt.sign({ sub: 'u1', email: 'a@b.c' });

  for (const format of ['markdown', 'opml']) {
    const res = await fetch(`http://127.0.0.1:${port}/documents/d1/export?format=${format}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.text();
    console.log(`--- ${format}: HTTP ${res.status} ---`);
    console.log(body.slice(0, 300));
  }

  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
