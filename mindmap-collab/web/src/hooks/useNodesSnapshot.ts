import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { NodesSnapshot, readSnapshot } from '../model/tree';

/**
 * 订阅 Y.Doc 的 nodes 映射，任何变更（本地或远端）都产生新的不可变快照，
 * 触发 React 重渲染 —— 这是导图/大纲双向同步的绑定层。
 */
export function useNodesSnapshot(ydoc: Y.Doc): NodesSnapshot {
  const [snap, setSnap] = useState<NodesSnapshot>(() => readSnapshot(ydoc));

  useEffect(() => {
    const map = ydoc.getMap('nodes');
    const handler = () => setSnap(readSnapshot(ydoc));
    map.observeDeep(handler);
    handler();
    return () => map.unobserveDeep(handler);
  }, [ydoc]);

  return snap;
}
