import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';
import { api } from '../api/client';
import { useAuth } from '../stores/auth';
import { useCollaboration, type CollabSession } from '../collab/useCollaboration';
import { useNodesSnapshot } from '../hooks/useNodesSnapshot';
import { MindMapView } from '../components/MindMapView';
import { OutlineView } from '../components/OutlineView';
import { PresenceBar } from '../components/PresenceBar';
import { HistoryPanel } from '../components/HistoryPanel';
import { ExportMenu } from '../components/ExportMenu';

/**
 * 编辑器页：左侧导图 + 右侧大纲（可拖宽、可折叠），共享同一 Y.Doc 双向同步。
 */
export function EditorPage() {
  const { id: documentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loadMe } = useAuth();
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<string>('editor');
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    loadMe();
  }, []);

  useEffect(() => {
    if (!documentId) return;
    api.get(`/documents/${documentId}`).then(({ data }) => {
      setTitle(data.title);
      setRole(data.role || 'editor');
    });
  }, [documentId]);

  const collab = useCollaboration(documentId, user);
  const readOnly = role === 'viewer';

  if (!documentId) return null;

  const rename = async (next: string) => {
    setTitle(next);
    if (next.trim()) {
      await api.patch(`/documents/${documentId}`, { title: next.trim() });
    }
  };

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
          readOnly={readOnly}
        />
        {readOnly && <span className="readonly-badge">只读</span>}
        {collab && (
          <span
            className={`sync-status ${collab.synced ? 'synced' : ''} ${
              collab.connected ? '' : 'disconnected'
            }`}
          >
            {!collab.connected
              ? '连接断开，重连中…'
              : collab.synced
                ? '已同步'
                : '同步中…'}
          </span>
        )}
        {collab && <PresenceBar peers={collab.peers} />}
        <ExportMenu documentId={documentId} />
        <button onClick={() => setHistoryOpen(true)}>版本历史</button>
      </header>
      {collab ? (
        <EditorWorkspace
          documentId={documentId}
          collab={collab}
          readOnly={readOnly}
          historyOpen={historyOpen}
          onCloseHistory={() => setHistoryOpen(false)}
        />
      ) : (
        <div className="editor-loading">正在连接协同服务…</div>
      )}
    </div>
  );
}

/** 会话建立后的工作区（左右分屏 + 可拖宽/折叠的大纲侧栏） */
function EditorWorkspace({
  documentId,
  collab,
  readOnly,
  historyOpen,
  onCloseHistory,
}: {
  documentId: string;
  collab: CollabSession;
  readOnly: boolean;
  historyOpen: boolean;
  onCloseHistory: () => void;
}) {
  const snap = useNodesSnapshot(collab.ydoc);
  const containerRef = useRef<HTMLDivElement>(null);
  const [outlinePct, setOutlinePct] = useState(38);
  const [outlineOpen, setOutlineOpen] = useState(true);

  /** 拖动分隔条调整大纲宽度（20% ~ 70%） */
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const total = container.getBoundingClientRect().width;
    const startX = e.clientX;
    const startPct = outlinePct;
    const onMove = (ev: MouseEvent) => {
      const next = startPct + ((startX - ev.clientX) / total) * 100;
      setOutlinePct(Math.min(70, Math.max(20, next)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="editor-split" ref={containerRef}>
      <div className="editor-pane editor-pane-map">
        <ReactFlowProvider>
          <MindMapView ydoc={collab.ydoc} snap={snap} readOnly={readOnly} />
        </ReactFlowProvider>
      </div>
      <div
        className="editor-divider"
        onMouseDown={outlineOpen ? startResize : undefined}
        title={outlineOpen ? '拖动调整宽度' : ''}
      >
        <button
          className="outline-collapse-btn"
          title={outlineOpen ? '收起大纲' : '展开大纲'}
          onClick={() => setOutlineOpen((v) => !v)}
        >
          {outlineOpen ? '⟩' : '⟨'}
        </button>
      </div>
      <div
        className="editor-pane editor-pane-outline"
        style={{
          width: outlineOpen ? `${outlinePct}%` : 0,
          visibility: outlineOpen ? 'visible' : 'hidden',
        }}
      >
        <OutlineView ydoc={collab.ydoc} snap={snap} readOnly={readOnly} />
      </div>
      <HistoryPanel
        documentId={documentId}
        open={historyOpen}
        onClose={onCloseHistory}
      />
    </div>
  );
}
