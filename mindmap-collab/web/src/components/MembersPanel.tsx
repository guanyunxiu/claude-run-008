import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../stores/auth';

interface Member {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
}

const ROLE_LABEL: Record<string, string> = {
  owner: '所有者',
  editor: '可编辑',
  viewer: '只读',
};

/** 工作区成员管理：列表、按邮箱邀请、移除（仅所有者） */
export function MembersPanel({ workspaceId }: { workspaceId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');
  const me = useAuth((s) => s.user);

  const load = useCallback(async () => {
    const { data } = await api.get(`/workspaces/${workspaceId}/members`);
    setMembers(data);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/workspaces/${workspaceId}/members`, {
        email: email.trim(),
        role,
      });
      setEmail('');
      load();
    } catch (err: any) {
      setError(err.response?.data?.message || '邀请失败');
    }
  };

  const remove = async (member: Member) => {
    if (!window.confirm(`确定将 ${member.user.name} 移出工作区吗？`)) return;
    await api.delete(`/workspaces/${workspaceId}/members/${member.user.id}`);
    load();
  };

  const isOwner = members.some((m) => m.user.id === me?.id && m.role === 'owner');

  return (
    <section className="members-panel">
      <h2>成员管理</h2>
      <form className="create-form" onSubmit={invite}>
        <input
          type="email"
          placeholder="输入对方注册邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="editor">可编辑</option>
          <option value="viewer">只读</option>
        </select>
        <button type="submit">邀请成员</button>
      </form>
      {error && <p className="auth-error">{error}</p>}
      <ul className="members-list">
        {members.map((m) => (
          <li key={m.id}>
            <span className="member-name">{m.user.name}</span>
            <span className="member-email">{m.user.email}</span>
            <span className="member-role">{ROLE_LABEL[m.role] || m.role}</span>
            {isOwner && m.role !== 'owner' && (
              <button className="danger" onClick={() => remove(m)}>
                移除
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
