import type { PresenceUser } from '../collab/useCollaboration';

/** 在线用户头像条（数据来自 Yjs awareness） */
export function PresenceBar({ peers }: { peers: PresenceUser[] }) {
  return (
    <div className="presence-bar" title="在线用户">
      {peers.map((p) => (
        <span
          key={p.clientId}
          className="presence-avatar"
          style={{ backgroundColor: p.color }}
          title={p.name}
        >
          {p.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      <span className="presence-count">{peers.length} 人在线</span>
    </div>
  );
}
