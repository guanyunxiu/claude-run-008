// 核心树模型逻辑冒烟测试：用 esbuild 打包后由 node 执行
import * as Y from 'yjs';
import {
  ROOT_ID,
  ensureRoot,
  createNode,
  childrenOf,
  readSnapshot,
  indentNode,
  outdentNode,
  moveNode,
  deleteSubtree,
  flattenVisible,
  toggleCollapsed,
  updateText,
} from '../web/src/model/tree.ts';

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}
function names(doc, parentId) {
  return childrenOf(readSnapshot(doc), parentId).map((n) => n.text);
}

// ---------- 单文档操作 ----------
console.log('== 基本增删改 ==');
const doc = new Y.Doc();
ensureRoot(doc);
const a = createNode(doc, ROOT_ID, 0, 'A');
const b = createNode(doc, ROOT_ID, 1, 'B');
const c = createNode(doc, ROOT_ID, 2, 'C');
assert(JSON.stringify(names(doc, ROOT_ID)) === '["A","B","C"]', '按序创建三个子节点');

const b1 = createNode(doc, b, 0, 'B1');
assert(JSON.stringify(names(doc, b)) === '["B1"]', 'B 下创建子节点 B1');

updateText(doc, b1, 'B1-renamed');
assert(readSnapshot(doc).get(b1).text === 'B1-renamed', '文本更新');

console.log('== 缩进 / 反缩进 ==');
indentNode(doc, c); // C 应成为 B 的最后一个子节点
assert(JSON.stringify(names(doc, b)) === '["B1-renamed","C"]', 'C 缩进为 B 的子节点');
assert(JSON.stringify(names(doc, ROOT_ID)) === '["A","B"]', '根层级剩 A、B');

outdentNode(doc, c); // C 回到根层级，位于 B 之后
assert(JSON.stringify(names(doc, ROOT_ID)) === '["A","B","C"]', 'C 反缩进回根层级');

console.log('== 移动（换父 / 排序） ==');
moveNode(doc, a, b, 0); // A 移到 B 下，位置 0
assert(JSON.stringify(names(doc, b)) === '["A","B1-renamed"]', 'A 移动到 B 下首位');
moveNode(doc, a, b, 2); // 同级重排到末尾
assert(JSON.stringify(names(doc, b)) === '["B1-renamed","A"]', 'A 重排到 B 下末位');

console.log('== 环检测 ==');
moveNode(doc, b, b1, 0); // 不允许：B 移到自己的后代下
assert(readSnapshot(doc).get(b).parentId === ROOT_ID, '禁止移动到自己的子树（环检测）');

console.log('== 折叠与可见性 ==');
toggleCollapsed(doc, b);
const visible = flattenVisible(readSnapshot(doc)).map((n) => n.text);
assert(!visible.includes('B1-renamed') && !visible.includes('A'), '折叠后后代不可见');
toggleCollapsed(doc, b);
assert(flattenVisible(readSnapshot(doc)).some((n) => n.text === 'A'), '展开后后代可见');

console.log('== 删除子树 ==');
deleteSubtree(doc, b);
const snap = readSnapshot(doc);
assert(!snap.has(b) && !snap.has(b1) && !snap.has(a), '删除 B 级联删除后代');
assert(JSON.stringify(names(doc, ROOT_ID)) === '["C"]', '根层级只剩 C');

// ---------- 双客户端同步（模拟基础冲突合并） ----------
console.log('== 双客户端同步 ==');
const doc1 = new Y.Doc();
const doc2 = new Y.Doc();
doc1.on('update', (u) => Y.applyUpdate(doc2, u));
doc2.on('update', (u) => Y.applyUpdate(doc1, u));

ensureRoot(doc1);
const x = createNode(doc1, ROOT_ID, 0, 'X');
assert(readSnapshot(doc2).get(x)?.text === 'X', 'doc1 创建节点实时同步到 doc2');

// 离线并发编辑 → 交换更新 → 收敛
const y = createNode(doc1, ROOT_ID, 1, 'Y');
const state1 = Y.encodeStateAsUpdate(doc1);
const state2 = Y.encodeStateAsUpdate(doc2);
const doc3 = new Y.Doc(); // 第三个客户端离线拿到旧状态
Y.applyUpdate(doc3, state2);
const z1 = createNode(doc1, ROOT_ID, 2, 'from-1');
const z3 = createNode(doc3, ROOT_ID, 2, 'from-3');
// 交换更新
Y.applyUpdate(doc3, Y.encodeStateAsUpdate(doc1, Y.encodeStateVector(doc3)));
Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc3, Y.encodeStateVector(doc1)));
const t1 = names(doc1, ROOT_ID).join(',');
const t3 = names(doc3, ROOT_ID).join(',');
assert(t1 === t3, `并发创建后两端收敛一致（"${t1}"）`);
assert(t1.includes('from-1') && t1.includes('from-3'), '双方并发新增都保留（CRDT 合并）');

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
