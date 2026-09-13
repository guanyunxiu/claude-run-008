import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface SnapshotMeta {
  id: string;
  label: string | null;
  createdAt: string;
  size: number;
}

interface Props {
  documentId: string;
  open: boolean;
  onClose: () => void;
}

/** 版本历史面板：快照列表、预览、恢复 */
export function HistoryPanel({ documentId, open, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`/documents/${documentId}/snapshots`);
    setSnapshots(data);
  }, [documentId]);

  useEffect(() => {
    if (open) {
      load();
      setPreviewId(null);
      setPreviewText('');
    }
  }, [open, load]);

  const preview = async (id: string) => {
    setLoading(true);
    try {
      const { data } = await api.get(
        `/documents/${documentId}/snapshots/${id}/preview`,
      );
      setPreviewId(id);
      setPreviewText(data.text);
    } finally {
      setLoading(false);
    }
  };

  const restore = async (id: string) => {
    if (!window.confirm('确定恢复到该版本吗？当前内容会被覆盖（会自动保留一个恢复前快照）。')) {
      return;
    }
    await api.post(`/documents/${documentId}/snapshots/${id}/restore`);
    await load();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="history-panel">
      <div className="history-header">
        <strong>版本历史</strong>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="history-list">
        {snapshots.length === 0 && (
          <p className="history-empty">暂无快照（每 5 分钟或 100 次操作自动生成）</p>
        )}
        {snapshots.map((s) => (
          <div key={s.id} className="history-item">
            <div className="history-item-info">
              <span className="history-label">{s.label || 'snapshot'}</span>
              <span className="history-time">
                {new Date(s.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="history-actions">
              <button disabled={loading} onClick={() => preview(s.id)}>
                预览
              </button>
              <button onClick={() => restore(s.id)}>恢复</button>
            </div>
            {previewId === s.id && (
              <pre className="history-preview">{previewText}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
