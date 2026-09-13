import { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Panel,
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
  clearManualPositions,
  createNode,
  deleteSubtree,
  flattenVisible,
  moveNode,
  setPosition,
  setSize,
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

/**
 * 导图视图：
 * - dagre 自动布局（未手动拖过的节点）
 * - 拖到空白处 → 保持落点（自由坐标持久化到 Yjs）
 * - 拖到其他节点上 → 变为其子节点并回归自动布局
 * - 节点可缩放，尺寸持久化并参与 dagre 布局
 */
export function MindMapView({ ydoc, snap }: Props) {
  const { getIntersectingNodes } = useReactFlow();
  const [nodes, setNodes] = useState<Node<MindNodeData>[]>([]);
  // 拖拽中不应用远端布局重置，避免打断当前拖拽
  const dragging = useRef(false);

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
    visible.forEach((id) => {
      const n = snap.get(id)!;
      g.setNode(id, {
        width: n.width ?? NODE_W,
        height: n.height ?? NODE_H,
      });
    });
    visible.forEach((id) => {
      const parentId = snap.get(id)?.parentId;
      if (parentId && visibleSet.has(parentId)) g.setEdge(parentId, id);
    });
    dagre.layout(g);

    const rfNodes: Node<MindNodeData>[] = visible.map((id) => {
      const n = snap.get(id)!;
      const w = n.width ?? NODE_W;
      const h = n.height ?? NODE_H;
      const p = g.node(id);
      // 有手动坐标用手动坐标，否则用 dagre 布局坐标
      const position =
        n.x != null && n.y != null
          ? { x: n.x, y: n.y }
          : { x: p.x - w / 2, y: p.y - h / 2 };
      return {
        id,
        type: 'mind',
        position,
        style: { width: w, height: h },
        data: {
          text: n.text,
          isRoot: id === ROOT_ID,
          collapsed: n.collapsed,
          childCount: childrenOf(snap, id).length,
          onToggle: () => toggleCollapsed(ydoc, id),
          onAddChild: () =>
            createNode(ydoc, id, childrenOf(snap, id).length, ''),
          onCommitText: (text: string) => updateText(ydoc, id, text),
          onResize: (width: number, height: number) =>
            setSize(ydoc, id, width, height),
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

    return { rfNodes, rfEdges };
  }, [snap, ydoc]);

  // 快照变化 → 同步到 React Flow 受控状态（拖拽中除外）
  useEffect(() => {
    if (!dragging.current) setNodes(layout.rfNodes);
  }, [layout]);

  const onNodesChange = (changes: NodeChange[]) =>
    setNodes((ns) => applyNodeChanges(changes, ns));

  /** 拖拽结束：落在其他节点上 → 变为其子节点；落在空白处 → 保持落点 */
  const onNodeDragStop = (_: any, node: Node) => {
    dragging.current = false;
    const intersections = getIntersectingNodes(node).filter(
      (n) => n.id !== node.id,
    );
    if (node.id !== ROOT_ID && intersections.length > 0) {
      const target = intersections[intersections.length - 1];
      ydoc.transact(() => {
        moveNode(ydoc, node.id, target.id, childrenOf(snap, target.id).length);
        // 换父后回归自动布局
        setPosition(ydoc, node.id, null, null);
      });
      return;
    }
    // 空白处落点：持久化自由坐标（根节点也可拖动）
    setPosition(ydoc, node.id, node.position.x, node.position.y);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={layout.rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStart={() => {
        dragging.current = true;
      }}
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
      <Panel position="top-left">
        <button
          className="map-toolbar-btn"
          title="清除所有手动拖动的位置，重新自动布局"
          onClick={() => clearManualPositions(ydoc)}
        >
          自动布局
        </button>
      </Panel>
    </ReactFlow>
  );
}
