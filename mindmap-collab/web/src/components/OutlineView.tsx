import { useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type * as Y from 'yjs';
import {
  NodesSnapshot,
  ROOT_ID,
  childrenOf,
  createNode,
  deleteSubtree,
  flattenVisible,
  indentNode,
  isDescendantOf,
  moveNode,
  outdentNode,
  toggleCollapsed,
  updateText,
} from '../model/tree';
import { OutlineRow, type OutlineItem } from './OutlineRow';

const INDENT_WIDTH = 24;

interface FlatItem extends OutlineItem {}

interface Projection {
  depth: number;
  parentId: string;
}

/**
 * 根据拖拽水平偏移计算投影深度与目标父节点
 * （dnd-kit 官方 Sortable Tree 算法）
 */
function getProjection(
  items: FlatItem[],
  activeId: string,
  overId: string,
  dragOffset: number,
): Projection {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const activeItem = items[activeIndex];
  const newItems = arrayMove(items, activeIndex, overIndex);
  const previousItem = newItems[overIndex - 1];
  const nextItem = newItems[overIndex + 1];
  const dragDepth = Math.round(dragOffset / INDENT_WIDTH);
  const projectedDepth = activeItem.depth + dragDepth;
  const maxDepth = previousItem ? previousItem.depth + 1 : 0;
  const minDepth = nextItem ? nextItem.depth : 0;

  let depth = projectedDepth;
  if (projectedDepth >= maxDepth) depth = maxDepth;
  else if (projectedDepth < minDepth) depth = minDepth;

  let parentId: string = ROOT_ID;
  if (depth > 0 && previousItem) {
    if (depth === previousItem.depth) {
      parentId = previousItem.parentId ?? ROOT_ID;
    } else if (depth > previousItem.depth) {
      parentId = previousItem.id;
    } else {
      const parent = newItems
        .slice(0, overIndex)
        .reverse()
        .find((i) => i.depth === depth);
      parentId = parent?.parentId ?? ROOT_ID;
    }
  }
  return { depth, parentId };
}

interface Props {
  ydoc: Y.Doc;
  snap: NodesSnapshot;
}

/** 大纲视图：树形列表，支持拖拽换父/排序、Tab 缩进、Shift+Tab 反缩进、回车新建 */
export function OutlineView({ ydoc, snap }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  const [projected, setProjected] = useState<Projection | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // 可见节点扁平化（拖拽时排除被拖节点的后代，避免拖进自己的子树）
  const items = useMemo<FlatItem[]>(() => {
    const flat = flattenVisible(snap).map((n) => ({
      id: n.id,
      parentId: n.parentId,
      text: n.text,
      collapsed: n.collapsed,
      depth: n.depth,
      childCount: childrenOf(snap, n.id).length,
    }));
    if (!activeId) return flat;
    return flat.filter((i) => !isDescendantOf(snap, i.id, activeId));
  }, [snap, activeId]);

  const resetDrag = () => {
    setActiveId(null);
    setOffsetLeft(0);
    setProjected(null);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as string);
  };

  const onDragMove = ({ delta }: DragMoveEvent) => {
    setOffsetLeft(delta.x);
  };

  const onDragOver = ({ over }: any) => {
    if (activeId && over) {
      setProjected(
        getProjection(items, activeId, over.id as string, offsetLeft),
      );
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && projected && active.id !== over.id) {
      const activeIndex = items.findIndex((i) => i.id === active.id);
      const overIndex = items.findIndex((i) => i.id === over.id);
      if (activeIndex >= 0 && overIndex >= 0) {
        const newItems = arrayMove(items, activeIndex, overIndex);
        // 目标父级下，位于插入点之前的兄弟数量即插入下标
        const index = newItems
          .slice(0, overIndex)
          .filter((i) => i.parentId === projected.parentId).length;
        moveNode(ydoc, active.id as string, projected.parentId, index);
      }
    } else if (over && projected && active.id === over.id) {
      // 原地拖放：仅可能改变了层级
      const current = snap.get(active.id as string);
      if (current && current.parentId !== projected.parentId) {
        const index = childrenOf(snap, projected.parentId).length;
        moveNode(ydoc, active.id as string, projected.parentId, index);
      }
    }
    resetDrag();
  };

  /** 行内键盘命令 */
  const handleCommand = (item: FlatItem, command: 'enter' | 'indent' | 'outdent' | 'delete') => {
    switch (command) {
      case 'enter': {
        const siblings = childrenOf(snap, item.parentId ?? ROOT_ID);
        const idx = siblings.findIndex((s) => s.id === item.id);
        const newId = createNode(
          ydoc,
          item.parentId ?? ROOT_ID,
          idx + 1,
          '',
        );
        setFocusId(newId);
        break;
      }
      case 'indent':
        indentNode(ydoc, item.id);
        setFocusId(item.id);
        break;
      case 'outdent':
        outdentNode(ydoc, item.id);
        setFocusId(item.id);
        break;
      case 'delete': {
        const flat = flattenVisible(snap);
        const idx = flat.findIndex((f) => f.id === item.id);
        const prev = flat[idx - 1];
        deleteSubtree(ydoc, item.id);
        if (prev) setFocusId(prev.id);
        break;
      }
    }
  };

  return (
    <div className="outline-view">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={resetDrag}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <OutlineRow
              key={item.id}
              item={item}
              projectedDepth={
                activeId === item.id && projected ? projected.depth : undefined
              }
              focusRequested={focusId === item.id}
              onFocusHandled={() => setFocusId(null)}
              onToggle={() => toggleCollapsed(ydoc, item.id)}
              onTextChange={(text) => updateText(ydoc, item.id, text)}
              onKeyCommand={(cmd) => handleCommand(item, cmd)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        className="outline-add-root"
        onClick={() => {
          const id = createNode(
            ydoc,
            ROOT_ID,
            childrenOf(snap, ROOT_ID).length,
            '',
          );
          setFocusId(id);
        }}
      >
        + 添加主题
      </button>
    </div>
  );
}
