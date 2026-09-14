// 恢复快照语义集成测试（对应 bug 3 备份顺序 / bug 4 离线删除不复活）
// 直接复用服务端 CollaborationService.restoreSnapshot 的合并式恢复逻辑
const Y = require('yjs');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

// 与 CollaborationService.restoreSnapshot 中 applySnapshot 完全一致的合并式恢复
function applySnapshot(doc, snapshotState) {
  const tmp = new Y.Doc();
  Y.applyUpdate(tmp, snapshotState);
  const snapshotNodes = tmp.getMap('nodes');
  const nodes = doc.getMap('nodes');
  doc.transact(() => {
    [...nodes.keys()].forEach((k) => {
      if (!snapshotNodes.has(k)) nodes.delete(k);
    });
    snapshotNodes.forEach((snapNode, key) => {
      const existing = nodes.get(key);
      if (existing) {
        snapNode.forEach((v, field) => {
          if (existing.get(field) !== v) existing.set(field, v);
        });
      } else {
        const copy = new Y.Map();
        snapNode.forEach((v, k) => copy.set(k, v));
        nodes.set(key, copy);
      }
    });
  });
  tmp.destroy();
}

const mk = (doc, id, parentId, text, order) => {
  const m = new Y.Map();
  m.set('parentId', parentId); m.set('text', text); m.set('collapsed', false); m.set('order', order);
  doc.getMap('nodes').set(id, m);
};
const nodeIds = (doc) => [...doc.getMap('nodes').keys()].sort();

console.log('== 合并式恢复：离线删除不复活 ==');
// 服务端文档：root + A + B
const server = new Y.Doc();
mk(server, 'root', null, '中心主题', 0);
mk(server, 'A', 'root', '节点A', 0);
mk(server, 'B', 'root', '节点B', 1);

// 快照 S：root + A（B 还不存在时的版本）
const snapshotDoc = new Y.Doc();
mk(snapshotDoc, 'root', null, '中心主题', 0);
mk(snapshotDoc, 'A', 'root', '节点A', 0);
const snapshotState = Y.encodeStateAsUpdate(snapshotDoc);

// 客户端离线：拿到服务端状态后删除 A（未同步给服务端）
const client = new Y.Doc();
Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
client.getMap('nodes').delete('A');
assert(!nodeIds(client).includes('A'), '客户端离线删除了 A');

// 服务端恢复快照 S（合并式）
applySnapshot(server, snapshotState);
assert(nodeIds(server).includes('A') && !nodeIds(server).includes('B'), '恢复后服务端回到快照内容（A 在、B 删）');

// 客户端重连：双向交换更新
Y.applyUpdate(client, Y.encodeStateAsUpdate(server, Y.encodeStateVector(client)));
Y.applyUpdate(server, Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)));

assert(!nodeIds(client).includes('A'), '客户端的离线删除不被恢复复活');
assert(!nodeIds(server).includes('A'), '客户端的删除同步回服务端（delete-wins）');
assert(!nodeIds(client).includes('B') && !nodeIds(server).includes('B'), '两端一致：B 被快照恢复删除');
assert(
  JSON.stringify(nodeIds(client)) === JSON.stringify(nodeIds(server)),
  `两端收敛一致（${nodeIds(server).join(',')}）`,
);

console.log('== 合并式恢复：保留 item 身份 ==');
// 再次构造：root + A，快照里 A 的文本不同
const s2 = new Y.Doc();
mk(s2, 'root', null, '中心主题', 0);
mk(s2, 'A', 'root', '旧文本', 0);
const srv2 = new Y.Doc();
mk(srv2, 'root', null, '中心主题', 0);
mk(srv2, 'A', 'root', '新文本', 0);
// 恢复前 A 的 Y.Map 引用
const beforeMap = srv2.getMap('nodes').get('A');
applySnapshot(srv2, Y.encodeStateAsUpdate(s2));
const afterMap = srv2.getMap('nodes').get('A');
assert(beforeMap === afterMap, '存在的 key 原地更新（Y.Map 引用不变）');
assert(afterMap.get('text') === '旧文本', '字段被快照值覆盖');

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
