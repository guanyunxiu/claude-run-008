import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';
import { api } from '../api/client';
import { useAuth } from '../stores/auth';
import { useCollaboration } from '../collab/useCollaboration';
import { useNodesSnapshot } from '../hooks/useNodesSnapshot';
import { MindMapView } from '../components/MindMapView';
import { OutlineView } from '../components/OutlineView';
import { PresenceBar } from '../components/PresenceBar';
import { HistoryPanel } from '../components/HistoryPanel';
import { ExportMenu } from '../components/ExportMenu';

/**
 * 编辑器页：左侧导图 + 右侧大纲，共享同一 Y.Doc 双向同步。
 */
export function EditorPage() {
  const { id: documentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loadMe } = useAuth();
  const [title, setTitle] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    loadMe();
  }, []);

  useEffect(() => {
    if (!documentId) return;
    api.get(`/documents/${documentId}`).then(({ data }) => setTitle(data.title));
  }, [documentId]);

  const { ydoc, connected, synced, peers } = useCollaboration(documentId, user);
  const snap = useNodesSnapshot(ydoc);

  const rename = async (next: string) => {
    setTitle(next);
    if (next.trim()) {
      await api.patch(`/documents/${documentId}`, { title: next.trim() });
    }
  };

  if (!documentId) return null;

  return (
    <div className="editor-page">
      <header className="editor-toolbar">
        <button className="link-btn" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <input
          className="doc-title-input"
          value={title}
          onChange={(e) => rename(e.target.value)}
          placeholder="文档标题"
        />
        <span
          className={`sync-status ${synced ? 'synced' : ''} ${
            connected ? '' : 'disconnected'
          }`}
        >
          {!connected ? '连接断开，重连中…' : synced ? '已同步' : '同步中…'}
        </span>
        <PresenceBar peers={peers} />
        <ExportMenu documentId={documentId} />
        <button onClick={() => setHistoryOpen(true)}>版本历史</button>
      </header>
      <div className="editor-split">
        <div className="editor-pane editor-pane-map">
          <ReactFlowProvider>
            <MindMapView ydoc={ydoc} snap={snap} />
          </ReactFlowProvider>
        </div>
        <div className="editor-pane editor-pane-outline">
          <OutlineView ydoc={ydoc} snap={snap} />
        </div>
        <HistoryPanel
          documentId={documentId}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      </div>
    </div>
  );
}
