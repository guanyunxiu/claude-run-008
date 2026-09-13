import { useEffect, useMemo, useState } from 'react';
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

/**
 * 建立一篇文档的协同会话：
 * - HocuspocusProvider：WebSocket 房间（文档即房间），带 JWT 鉴权
 * - IndexeddbPersistence：本地离线缓存
 * - awareness：在线用户状态（头像、光标）
 */
export function useCollaboration(
  documentId: string | undefined,
  user: { id: string; name: string } | null,
) {
  const [hasSynced, setHasSynced] = useState(false);
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<PresenceUser[]>([]);

  const ydoc = useMemo(() => new Y.Doc(), [documentId]);

  const provider = useMemo(() => {
    if (!documentId) return null;
    const token = localStorage.getItem('token') || '';
    return new HocuspocusProvider({
      url: WS_URL,
      name: `document:${documentId}`,
      document: ydoc,
      token,
    });
  }, [documentId, ydoc]);

  const idb = useMemo(() => {
    if (!documentId) return null;
    return new IndexeddbPersistence(`mindmap-${documentId}`, ydoc);
  }, [documentId, ydoc]);

  // awareness：广播本地用户信息，订阅在线列表
  useEffect(() => {
    if (!provider || !user) return;
    const color =
      COLORS[Math.abs(hashCode(user.id)) % COLORS.length];
    provider.setAwarenessField('user', {
      id: user.id,
      name: user.name,
      color,
    });
    const awareness = provider.awareness;
    if (!awareness) return;
    const update = () => {
      const states = awareness.getStates();
      const list: PresenceUser[] = [];
      states.forEach((state: any, clientId: number) => {
        if (state.user) list.push({ ...state.user, clientId });
      });
      setPeers(list);
    };
    awareness.on('change', update);
    update();
    return () => {
      awareness.off('change', update);
    };
  }, [provider, user]);

  // 首次同步完成后确保根节点存在；同时跟踪连接状态（断线时及时反馈）
  useEffect(() => {
    if (!provider) return;
    const onSynced = () => {
      ensureRoot(ydoc);
      setHasSynced(true);
    };
    const onStatus = ({ status }: { status: string }) => {
      setConnected(status === 'connected');
    };
    provider.on('synced', onSynced);
    provider.on('status', onStatus);
    if (idb) {
      idb.on('synced', () => ensureRoot(ydoc));
    }
    return () => {
      provider.off('synced', onSynced);
      provider.off('status', onStatus);
    };
  }, [provider, idb, ydoc]);

  // 卸载时释放连接
  useEffect(() => {
    return () => {
      provider?.destroy();
      idb?.destroy();
      ydoc.destroy();
    };
  }, [provider, idb, ydoc]);

  // 已同步 = 至少完成过一次同步 且 当前处于连接状态（断线立即变为未同步）
  return { ydoc, provider, connected, synced: connected && hasSynced, peers };
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
