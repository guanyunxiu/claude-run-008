import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WS_URL } from '../api/client';
import { ensureRoot } from '../model/tree';

const COLORS = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#e64980', '#2f9e44'];

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  clientId: number;
}

export interface CollabSession {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  connected: boolean;
  synced: boolean;
  peers: PresenceUser[];
}

interface SessionResources {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
}

/**
 * 建立一篇文档的协同会话：
 * - HocuspocusProvider：WebSocket 房间（文档即房间），带 JWT 鉴权
 * - IndexeddbPersistence：本地离线缓存
 * - awareness：在线用户状态（头像、光标）
 *
 * 注意：资源在 useEffect 中创建/销毁（而非 useMemo），
 * 否则 React StrictMode 双挂载会把 useMemo 缓存的 provider 提前销毁。
 */
export function useCollaboration(
  documentId: string | undefined,
  user: { id: string; name: string } | null,
): CollabSession | null {
  const [resources, setResources] = useState<SessionResources | null>(null);
  const [connected, setConnected] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  const [peers, setPeers] = useState<PresenceUser[]>([]);

  // 创建/销毁会话资源
  useEffect(() => {
    if (!documentId) return;
    const ydoc = new Y.Doc();
    const token = localStorage.getItem('token') || '';
    const provider = new HocuspocusProvider({
      url: WS_URL,
      name: `document:${documentId}`,
      document: ydoc,
      token,
    });
    const idb = new IndexeddbPersistence(`mindmap-${documentId}`, ydoc);

    // 构造后立即同步挂监听，不会错过任何事件
    const onSynced = () => {
      ensureRoot(ydoc);
      setHasSynced(true);
    };
    const onStatus = ({ status }: { status: string }) => {
      setConnected(status === 'connected');
    };
    provider.on('synced', onSynced);
    provider.on('status', onStatus);
    // 用当前状态兜底，防止连接事件先于监听注册
    setConnected(provider.status === 'connected');
    idb.on('synced', () => ensureRoot(ydoc));

    setResources({ ydoc, provider });

    return () => {
      provider.destroy();
      idb.destroy();
      ydoc.destroy();
      setResources(null);
      setConnected(false);
      setHasSynced(false);
      setPeers([]);
    };
  }, [documentId]);

  // awareness：广播本地用户信息，订阅在线列表
  useEffect(() => {
    const provider = resources?.provider;
    if (!provider || !user) return;
    const color = COLORS[Math.abs(hashCode(user.id)) % COLORS.length];
    provider.setAwarenessField('user', {
      id: user.id,
      name: user.name,
      color,
    });
    const awareness = provider.awareness;
    if (!awareness) return;
    const update = () => {
      const list: PresenceUser[] = [];
      awareness.getStates().forEach((state: any, clientId: number) => {
        if (state.user) list.push({ ...state.user, clientId });
      });
      setPeers(list);
    };
    awareness.on('change', update);
    update();
    return () => {
      awareness.off('change', update);
    };
  }, [resources, user]);

  if (!resources) return null;
  return {
    ydoc: resources.ydoc,
    provider: resources.provider,
    connected,
    // 已同步 = 完成过首次同步 且 当前在线（断线立即降级为未同步）
    synced: connected && hasSynced,
    peers,
  };
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
