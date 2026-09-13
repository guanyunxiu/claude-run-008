import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';

interface DocMeta {
  id: string;
  title: string;
  updatedAt: string;
  createdBy: { id: string; name: string };
  _count: { snapshots: number };
}

export function DocumentsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [title, setTitle] = useState('');
  const navigate = useNavigate();

  const load = async () => {
    const { data } = await api.get(`/workspaces/${workspaceId}/documents`);
    setDocs(data);
  };

  useEffect(() => {
    load();
  }, [workspaceId]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await api.post(`/workspaces/${workspaceId}/documents`, {
      title: title.trim() || '未命名文档',
    });
    setTitle('');
    navigate(`/doc/${data.id}`);
  };

  const rename = async (doc: DocMeta) => {
    const next = window.prompt('新的文档标题', doc.title);
    if (!next?.trim()) return;
    await api.patch(`/documents/${doc.id}`, { title: next.trim() });
    load();
  };

  const remove = async (doc: DocMeta) => {
    if (!window.confirm(`确定删除「${doc.title}」吗？该操作不可撤销。`)) return;
    await api.delete(`/documents/${doc.id}`);
    load();
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <button className="link-btn" onClick={() => navigate('/')}>
            ← 工作区
          </button>
          <h1>文档列表</h1>
        </div>
      </header>
      <form className="create-form" onSubmit={create}>
        <input
          placeholder="新文档标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit">新建文档</button>
      </form>
      <table className="doc-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>创建者</th>
            <th>快照数</th>
            <th>更新时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id}>
              <td>
                <button className="link-btn" onClick={() => navigate(`/doc/${doc.id}`)}>
                  {doc.title}
                </button>
              </td>
              <td>{doc.createdBy.name}</td>
              <td>{doc._count.snapshots}</td>
              <td>{new Date(doc.updatedAt).toLocaleString()}</td>
              <td className="doc-actions">
                <button onClick={() => rename(doc)}>重命名</button>
                <button className="danger" onClick={() => remove(doc)}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {docs.length === 0 && <p className="empty-tip">暂无文档，点击上方创建。</p>}
    </div>
  );
}
