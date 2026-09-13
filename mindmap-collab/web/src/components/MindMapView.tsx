import { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from 'reactflow';
import dagre from 'dagre';
import type * as Y from 'yjs';
import {
  NodesSnapshot,
  ROOT_ID,
  childrenOf,
  createNode,
  deleteSubtree,
  flattenVisible,
  moveNode,
  toggleCollapsed,
  updateText,
} from '../model/tree';
import { MindNode, type MindNodeData } from './MindNode';

const NODE_W = 180;
const NODE_H = 44;

const nodeTypes = { mind: MindNode };

interface Props {
  ydoc: Y.Doc;
  snap: NodesSnapshot;
}

/** 导图视图：dagre 自动布局，拖拽节点到另一节点上换父，空白处拖动同级排序 */
export function MindMapView({ ydoc, snap }: Props) {
  const { getIntersectingNodes } = useReactFlow();
  const [nodes, setNodes] = useState<Node<MindNodeData>[]>([]);
  // 记录每个节点的布局坐标，拖拽排序时用于比较
  const layoutPos = useRef(new Map<string, { x: number; y: number }>());

  // 由快照推导可见节点 + dagre 布局
  const layout = useMemo(() => {
    // 注意：新文档首次打开时根节点可能尚未创建，必须过滤掉快照中不存在的 id
    const visible = [ROOT_ID, ...flattenVisible(snap).map((n) => n.id)].filter(
      (id) => snap.has(id),
    );
    const visibleSet = new Set(visible);

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 20, ranksep: 90, marginx: 30, marginy: 30 });
    g.setDefaultEdgeLabel(() => ({}));
    visible.forEach((id) => g.setNode(id, { width: NODE_W, height: NODE_H }));
    visible.forEach((id) => {
      const parentId = snap.get(id)?.parentId;
      if (parentId && visibleSet.has(parentId)) g.setEdge(parentId, id);
    });
    dagre.layout(g);

    const pos = new Map<string, { x: number; y: number }>();
    const rfNodes: Node<MindNodeData>[] = visible.map((id) => {
      const n = snap.get(id)!;
      const p = g.node(id);
      const position = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
      pos.set(id, position);
      return {
        id,
        type: 'mind',
        position,
        data: {
          text: n.text,
          isRoot: id === ROOT_ID,
          collapsed: n.collapsed,
          childCount: childrenOf(snap, id).length,
          onToggle: () => toggleCollapsed(ydoc, id),
          onAddChild: () =>
            createNode(ydoc, id, childrenOf(snap, id).length, ''),
          onCommitText: (text: string) => updateText(ydoc, id, text),
        },
      };
    });

    const rfEdges: Edge[] = visible
      .filter((id) => {
        const parentId = snap.get(id)?.parentId;
        return parentId && visibleSet.has(parentId);
      })
      .map((id) => ({
        id: `e-${snap.get(id)!.parentId}-${id}`,
        source: snap.get(id)!.parentId!,
        target: id,
        type: 'bezier',
        style: { stroke: '#b1b1b7', strokeWidth: 1.5 },
      }));

    return { rfNodes, rfEdges, pos };
  }, [snap, ydoc]);

  // 快照变化 → 同步到 React Flow 受控状态
  useEffect(() => {
    layoutPos.current = layout.pos;
    setNodes(layout.rfNodes);
  }, [layout]);

  const onNodesChange = (changes: NodeChange[]) =>
    setNodes((ns) => applyNodeChanges(changes, ns));

  /** 拖拽结束：落在其他节点上 → 变为其子节点；否则按纵向位置在同级重排 */
  const onNodeDragStop = (_: any, node: Node) => {
    if (node.id === ROOT_ID) return;
    const intersections = getIntersectingNodes(node).filter(
      (n) => n.id !== node.id,
    );
    if (intersections.length > 0) {
      const target = intersections[intersections.length - 1];
      moveNode(ydoc, node.id, target.id, childrenOf(snap, target.id).length);
      return;
    }
    const parentId = snap.get(node.id)?.parentId;
    if (!parentId) return;
    const siblings = childrenOf(snap, parentId).filter((n) => n.id !== node.id);
    const y = node.position.y;
    const index = siblings.filter(
      (s) => (layoutPos.current.get(s.id)?.y ?? 0) < y,
    ).length;
    moveNode(ydoc, node.id, parentId, index);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={layout.rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      onNodesDelete={(deleted) =>
        deleted.forEach((n) => n.id !== ROOT_ID && deleteSubtree(ydoc, n.id))
      }
      deleteKeyCode={['Backspace', 'Delete']}
      fitView
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
