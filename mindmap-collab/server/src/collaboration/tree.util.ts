import * as Y from 'yjs';

export interface MindNode {
  id: string;
  parentId: string | null;
  text: string;
  collapsed: boolean;
  order: number;
}

export const ROOT_ID = 'root';

/** 从 Y.Doc 中读取所有节点为普通对象 */
export function readNodes(doc: Y.Doc): Map<string, MindNode> {
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  const result = new Map<string, MindNode>();
  nodes.forEach((ynode, id) => {
    result.set(id, {
      id,
      parentId: (ynode.get('parentId') as string) ?? null,
      text: (ynode.get('text') as string) ?? '',
      collapsed: (ynode.get('collapsed') as boolean) ?? false,
      order: (ynode.get('order') as number) ?? 0,
    });
  });
  return result;
}

export interface TreeNode extends MindNode {
  children: TreeNode[];
}

/** 把扁平节点表组装成树（按 order 排序） */
export function buildTree(nodes: Map<string, MindNode>): TreeNode | null {
  const root = nodes.get(ROOT_ID);
  if (!root) return null;
  const childrenOf = (parentId: string): TreeNode[] =>
    [...nodes.values()]
      .filter((n) => n.parentId === parentId)
      .sort((a, b) =>
        a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1,
      )
      .map((n) => ({ ...n, children: childrenOf(n.id) }));
  return { ...root, children: childrenOf(ROOT_ID) };
}
