import * as Y from 'yjs';
import { MindNode } from '../collaboration/tree.util';

/** 版本向量 {clientId: clock} */
export type Vector = Record<string, number>;

export function decodeVector(doc: Y.Doc): Vector {
  const out: Vector = {};
  Y.decodeStateVector(Y.encodeStateVector(doc)).forEach((clock, client) => {
    out[String(client)] = clock;
  });
  return out;
}

/** 共同祖先向量：逐 client 取最小值（双方共同拥有的内容） */
export function vectorMin(a: Vector, b: Vector): Vector {
  const out: Vector = {};
  for (const [client, clock] of Object.entries(a)) {
    if (b[client] != null) out[client] = Math.min(clock, b[client]);
  }
  return out;
}

export function vectorClockSum(v: Vector | null | undefined): number {
  if (!v) return 0;
  return Object.values(v).reduce((a, b) => a + b, 0);
}

/* ---------- 冲突检测 ---------- */

export type ConflictType = 'attribute' | 'delete-modify' | 'order' | 'structure';

export interface ConflictInfo {
  key: string;
  nodeId: string;
  type: ConflictType;
  field?: string;
  base: MindNode | null;
  ours: MindNode | null;
  theirs: MindNode | null;
}

const ATTRIBUTE_FIELDS: Array<keyof MindNode> = ['text', 'collapsed'];

/**
 * 三方冲突检测：base（共同祖先）、ours（目标分支）、theirs（源分支）
 * - 属性冲突：同一字段双方均改且结果不同
 * - 删除-修改冲突：一方删除、另一方修改
 * - 顺序冲突：同父节点双方均调整顺序且结果不同
 * - 结构冲突：同一节点被移动到不同父节点
 */
export function detectConflicts(
  base: Map<string, MindNode>,
  ours: Map<string, MindNode>,
  theirs: Map<string, MindNode>,
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  const ids = new Set<string>([
    ...base.keys(),
    ...ours.keys(),
    ...theirs.keys(),
  ]);

  for (const nodeId of ids) {
    const b = base.get(nodeId) ?? null;
    const o = ours.get(nodeId) ?? null;
    const t = theirs.get(nodeId) ?? null;

    if (o && t) {
      if (!b) continue; // 双方各自新建（id 相同概率极低），不视为冲突
      // 属性冲突
      for (const field of ATTRIBUTE_FIELDS) {
        const oChanged = o[field] !== b[field];
        const tChanged = t[field] !== b[field];
        if (oChanged && tChanged && o[field] !== t[field]) {
          conflicts.push({
            key: `${nodeId}:attribute:${field}`,
            nodeId,
            type: 'attribute',
            field,
            base: b,
            ours: o,
            theirs: t,
          });
        }
      }
      // 结构冲突：双方都移动了该节点且目标父节点不同
      if (
        o.parentId !== b.parentId &&
        t.parentId !== b.parentId &&
        o.parentId !== t.parentId
      ) {
        conflicts.push({
          key: `${nodeId}:structure`,
          nodeId,
          type: 'structure',
          field: 'parentId',
          base: b,
          ours: o,
          theirs: t,
        });
      }
      // 顺序冲突：同父、双方都改了顺序且结果不同
      if (
        o.parentId === t.parentId &&
        o.order !== b.order &&
        t.order !== b.order &&
        o.order !== t.order
      ) {
        conflicts.push({
          key: `${nodeId}:order`,
          nodeId,
          type: 'order',
          field: 'order',
          base: b,
          ours: o,
          theirs: t,
        });
      }
    } else if (b && ((o && !t) || (!o && t))) {
      // 删除-修改冲突：一方删除，另一方相对 base 有修改
      const survivor = (o ?? t)!;
      const modified =
        survivor.text !== b.text ||
        survivor.parentId !== b.parentId ||
        survivor.collapsed !== b.collapsed;
      if (modified) {
        conflicts.push({
          key: `${nodeId}:delete-modify`,
          nodeId,
          type: 'delete-modify',
          base: b,
          ours: o,
          theirs: t,
        });
      }
    }
  }
  return conflicts;
}

/** 冲突解决策略：ours / theirs / manual（manual 目前支持文本类字段） */
export interface Resolution {
  strategy: 'ours' | 'theirs' | 'manual';
  manualValue?: string;
}

/** 在合并后的文档上应用冲突解决结果 */
export function applyResolutions(
  doc: Y.Doc,
  conflicts: ConflictInfo[],
  resolutions: Record<string, Resolution>,
) {
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  for (const conflict of conflicts) {
    const res = resolutions[conflict.key];
    if (!res) continue;
    const chosen =
      res.strategy === 'ours'
        ? conflict.ours
        : res.strategy === 'theirs'
          ? conflict.theirs
          : conflict.ours
            ? { ...conflict.ours, text: res.manualValue ?? conflict.ours.text }
            : { ...conflict.theirs!, text: res.manualValue ?? conflict.theirs!.text };

    if (!chosen) {
      // 选择了删除侧
      deleteSubtree(nodes, conflict.nodeId);
      continue;
    }
    const existing = nodes.get(conflict.nodeId);
    if (existing) {
      existing.set('parentId', chosen.parentId);
      existing.set('text', chosen.text);
      existing.set('collapsed', chosen.collapsed);
      existing.set('order', chosen.order);
    } else {
      const ynode = new Y.Map<unknown>();
      ynode.set('parentId', chosen.parentId);
      ynode.set('text', chosen.text);
      ynode.set('collapsed', chosen.collapsed);
      ynode.set('order', chosen.order);
      nodes.set(conflict.nodeId, ynode);
    }
  }
}

function deleteSubtree(nodes: Y.Map<Y.Map<unknown>>, id: string) {
  nodes.forEach((ynode, childId) => {
    if (ynode.get('parentId') === id) deleteSubtree(nodes, childId);
  });
  nodes.delete(id);
}

/* ---------- 版本 diff ---------- */

export interface DiffEntry {
  type: 'added' | 'removed' | 'modified' | 'moved' | 'reordered';
  nodeId: string;
  text: string;
  detail: string;
}

export function diffNodes(
  a: Map<string, MindNode>,
  b: Map<string, MindNode>,
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const [id, nb] of b) {
    const na = a.get(id);
    if (!na) {
      entries.push({ type: 'added', nodeId: id, text: nb.text, detail: `新增「${nb.text}」` });
    }
  }
  for (const [id, na] of a) {
    const nb = b.get(id);
    if (!nb) {
      entries.push({ type: 'removed', nodeId: id, text: na.text, detail: `删除「${na.text}」` });
      continue;
    }
    if (na.text !== nb.text) {
      entries.push({
        type: 'modified',
        nodeId: id,
        text: nb.text,
        detail: `「${na.text}」→「${nb.text}」`,
      });
    }
    if (na.parentId !== nb.parentId) {
      entries.push({
        type: 'moved',
        nodeId: id,
        text: nb.text,
        detail: `移动「${nb.text}」（${na.parentId} → ${nb.parentId}）`,
      });
    } else if (na.order !== nb.order) {
      entries.push({
        type: 'reordered',
        nodeId: id,
        text: nb.text,
        detail: `排序「${nb.text}」（${na.order} → ${nb.order}）`,
      });
    }
  }
  return entries;
}
