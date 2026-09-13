import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../stores/auth';

interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  members: Array<{ role: string; user: { id: string; name: string } }>;
  _count: { documents: number };
}

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState('');
  const { user, loadMe, logout } = useAuth();
  const navigate = useNavigate();

  const load = async () => {
    const { data } = await api.get('/workspaces');
    setWorkspaces(data);
  };

  useEffect(() => {
    loadMe();
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api.post('/workspaces', { name: name.trim() });
    setName('');
    load();
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>我的工作区</h1>
        <div className="header-right">
          <span className="user-name">{user?.name}</span>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            退出登录
          </button>
        </div>
      </header>
      <form className="create-form" onSubmit={create}>
        <input
          placeholder="新工作区名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">创建工作区</button>
      </form>
      <div className="card-grid">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className="card"
            onClick={() => navigate(`/w/${ws.id}`)}
          >
            <h3>{ws.name}</h3>
            <p>
              {ws._count.documents} 篇文档 · {ws.members.length} 名成员
            </p>
          </div>
        ))}
        {workspaces.length === 0 && (
          <p className="empty-tip">还没有工作区，先创建一个吧。</p>
        )}
      </div>
    </div>
  );
}
