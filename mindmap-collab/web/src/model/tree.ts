import * as Y from 'yjs';

/**
 * 共享数据模型：导图视图与大纲视图操作同一份 Y.Doc。
 * 结构：ydoc.getMap('nodes') => Y.Map<nodeId, Y.Map<{parentId, text, collapsed, order}>>
 * 同级顺序用整数 order 表示，插入/移动后对同级重排为 0..n。
 */

export const ROOT_ID = 'root';

export interface MindNode {
  id: string;
  parentId: string | null;
  text: string;
  collapsed: boolean;
  order: number;
  /** 手动拖拽后的自由坐标（null 表示跟随自动布局） */
  x: number | null;
  y: number | null;
  /** 手动调整的尺寸（null 表示默认尺寸） */
  width: number | null;
  height: number | null;
}

export type NodesSnapshot = Map<string, MindNode>;

export function getNodesMap(doc: Y.Doc) {
  return doc.getMap<Y.Map<unknown>>('nodes');
}

/** 读取整棵节点表为普通对象快照（供 React 渲染） */
export function readSnapshot(doc: Y.Doc): NodesSnapshot {
  const map = getNodesMap(doc);
  const snap: NodesSnapshot = new Map();
  map.forEach((ynode, id) => {
    snap.set(id, {
      id,
      parentId: (ynode.get('parentId') as string) ?? null,
      text: (ynode.get('text') as string) ?? '',
      collapsed: (ynode.get('collapsed') as boolean) ?? false,
      order: (ynode.get('order') as number) ?? 0,
      x: (ynode.get('x') as number) ?? null,
      y: (ynode.get('y') as number) ?? null,
      width: (ynode.get('width') as number) ?? null,
      height: (ynode.get('height') as number) ?? null,
    });
  });
  return snap;
}

/** 确保根节点存在（并发下双方同时创建会收敛为同一 key） */
export function ensureRoot(doc: Y.Doc) {
  const map = getNodesMap(doc);
  if (!map.has(ROOT_ID)) {
    doc.transact(() => {
      if (map.has(ROOT_ID)) return;
      const root = new Y.Map<unknown>();
      root.set('parentId', null);
      root.set('text', '中心主题');
      root.set('collapsed', false);
      root.set('order', 0);
      map.set(ROOT_ID, root);
    });
  }
}

/* ---------- 基于快照的纯函数（渲染用） ---------- */

/** 同级排序：order 相同（并发插入）时用节点 id 做确定性 tie-break，保证各端一致 */
function compareNodes(a: { id: string; order: number }, b: { id: string; order: number }) {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function childrenOf(snap: NodesSnapshot, parentId: string): MindNode[] {
  return [...snap.values()]
    .filter((n) => n.parentId === parentId)
    .sort(compareNodes);
}

/** 可见节点（折叠节点的后代被隐藏），返回按树序展开的扁平列表 */
export function flattenVisible(
  snap: NodesSnapshot,
): Array<MindNode & { depth: number }> {
  const out: Array<MindNode & { depth: number }> = [];
  const walk = (parentId: string, depth: number) => {
    for (const child of childrenOf(snap, parentId)) {
      out.push({ ...child, depth });
      if (!child.collapsed) walk(child.id, depth + 1);
    }
  };
  walk(ROOT_ID, 0);
  return out;
}

export function isDescendantOf(
  snap: NodesSnapshot,
  maybeDescendant: string,
  ancestor: string,
): boolean {
  let cur = snap.get(maybeDescendant);
  while (cur && cur.parentId) {
    if (cur.parentId === ancestor) return true;
    cur = snap.get(cur.parentId);
  }
  return false;
}

/* ---------- Yjs 变更操作（任一视图调用，另一侧通过 observe 自动刷新） ---------- */

function siblingIds(doc: Y.Doc, parentId: string | null): string[] {
  const map = getNodesMap(doc);
  const ids: string[] = [];
  map.forEach((ynode, id) => {
    if ((ynode.get('parentId') ?? null) === parentId) ids.push(id);
  });
  return ids.sort((a, b) => {
    const oa = (map.get(a)?.get('order') as number) ?? 0;
    const ob = (map.get(b)?.get('order') as number) ?? 0;
    if (oa !== ob) return oa - ob;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function rewriteOrders(doc: Y.Doc, parentId: string | null, orderedIds: string[]) {
  const map = getNodesMap(doc);
  orderedIds.forEach((id, i) => map.get(id)?.set('order', i));
  // parentId 参数仅用于语义清晰
  void parentId;
}

let idCounter = 0;
export function newNodeId() {
  return `n_${Date.now().toString(36)}_${(idCounter++).toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** 在 parentId 的 index 处新建节点，返回新节点 id */
export function createNode(
  doc: Y.Doc,
  parentId: string,
  index: number,
  text = '',
): string {
  const id = newNodeId();
  doc.transact(() => {
    const map = getNodesMap(doc);
    const siblings = siblingIds(doc, parentId);
    siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, id);
    const ynode = new Y.Map<unknown>();
    ynode.set('parentId', parentId);
    ynode.set('text', text);
    ynode.set('collapsed', false);
    ynode.set('order', 0);
    map.set(id, ynode);
    rewriteOrders(doc, parentId, siblings);
    // 父节点若处于折叠状态则展开，保证新节点可见
    map.get(parentId)?.set('collapsed', false);
  });
  return id;
}

export function updateText(doc: Y.Doc, id: string, text: string) {
  getNodesMap(doc).get(id)?.set('text', text);
}

/** 记录手动拖拽位置（传 null 清除，回到自动布局） */
export function setPosition(
  doc: Y.Doc,
  id: string,
  x: number | null,
  y: number | null,
) {
  const node = getNodesMap(doc).get(id);
  if (!node) return;
  doc.transact(() => {
    node.set('x', x);
    node.set('y', y);
  });
}

/** 记录手动调整的节点尺寸 */
export function setSize(doc: Y.Doc, id: string, width: number, height: number) {
  const node = getNodesMap(doc).get(id);
  if (!node) return;
  doc.transact(() => {
    node.set('width', width);
    node.set('height', height);
  });
}

/** 清除所有节点的手动坐标，恢复全量自动布局 */
export function clearManualPositions(doc: Y.Doc) {
  doc.transact(() => {
    getNodesMap(doc).forEach((ynode) => {
      ynode.set('x', null);
      ynode.set('y', null);
    });
  });
}

export function setCollapsed(doc: Y.Doc, id: string, collapsed: boolean) {
  getNodesMap(doc).get(id)?.set('collapsed', collapsed);
}

export function toggleCollapsed(doc: Y.Doc, id: string) {
  const node = getNodesMap(doc).get(id);
  if (node) node.set('collapsed', !(node.get('collapsed') as boolean));
}

/** 删除节点及其整个子树 */
export function deleteSubtree(doc: Y.Doc, id: string) {
  if (id === ROOT_ID) return;
  doc.transact(() => {
    const map = getNodesMap(doc);
    const parentId = map.get(id)?.get('parentId') as string | null;
    const removeRec = (nodeId: string) => {
      map.forEach((ynode, childId) => {
        if (ynode.get('parentId') === nodeId) removeRec(childId);
      });
      map.delete(nodeId);
    };
    removeRec(id);
    if (parentId) {
      rewriteOrders(
        doc,
        parentId,
        siblingIds(doc, parentId),
      );
    }
  });
}

/**
 * 移动节点到 newParentId 的 index 位置（拖拽换父 / 同级排序的核心）。
 * 带环检测：不能移动到自己的子树里。
 */
export function moveNode(
  doc: Y.Doc,
  id: string,
  newParentId: string,
  index: number,
) {
  if (id === ROOT_ID || id === newParentId) return;
  doc.transact(() => {
    const map = getNodesMap(doc);
    const node = map.get(id);
    if (!node) return;
    // 环检测：沿 newParentId 向上走，遇到 id 则放弃
    let cur: string | null = newParentId;
    while (cur) {
      if (cur === id) return;
      cur = (map.get(cur)?.get('parentId') as string) ?? null;
    }
    const oldParentId = (node.get('parentId') as string) ?? null;
    // 先从旧父级的兄弟列表移除并重排
    if (oldParentId) {
      rewriteOrders(
        doc,
        oldParentId,
        siblingIds(doc, oldParentId).filter((s) => s !== id),
      );
    }
    // 插入新父级的 index 处
    const siblings = siblingIds(doc, newParentId).filter((s) => s !== id);
    siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, id);
    node.set('parentId', newParentId);
    rewriteOrders(doc, newParentId, siblings);
  });
}

/** 缩进：成为上一个兄弟的最后一个子节点 */
export function indentNode(doc: Y.Doc, id: string) {
  const map = getNodesMap(doc);
  const parentId = map.get(id)?.get('parentId') as string | null;
  if (!parentId || id === ROOT_ID) return;
  const siblings = siblingIds(doc, parentId);
  const idx = siblings.indexOf(id);
  if (idx <= 0) return;
  const prevSibling = siblings[idx - 1];
  const targetIndex = siblingIds(doc, prevSibling).length;
  moveNode(doc, id, prevSibling, targetIndex);
  // 展开新父节点保证可见
  map.get(prevSibling)?.set('collapsed', false);
}

/** 反缩进：成为父节点的下一个兄弟 */
export function outdentNode(doc: Y.Doc, id: string) {
  const map = getNodesMap(doc);
  const parentId = map.get(id)?.get('parentId') as string | null;
  if (!parentId || parentId === ROOT_ID || id === ROOT_ID) return;
  const grandId = map.get(parentId)?.get('parentId') as string | null;
  if (!grandId) return;
  const parentSiblings = siblingIds(doc, grandId);
  const parentIdx = parentSiblings.indexOf(parentId);
  moveNode(doc, id, grandId, parentIdx + 1);
}
