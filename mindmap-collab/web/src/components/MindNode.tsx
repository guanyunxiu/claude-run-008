import { useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

export interface MindNodeData {
  text: string;
  isRoot: boolean;
  collapsed: boolean;
  childCount: number;
  onToggle: () => void;
  onAddChild: () => void;
  onCommitText: (text: string) => void;
}

/** 导图自定义节点：文本（双击编辑）、折叠按钮、添加子节点按钮 */
export function MindNode({ data, selected }: NodeProps<MindNodeData>) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(data.text);

  useEffect(() => setValue(data.text), [data.text]);

  const commit = () => {
    setEditing(false);
    if (value !== data.text) data.onCommitText(value);
  };

  return (
    <div
      className={`mind-node ${data.isRoot ? 'mind-node-root' : ''} ${
        selected ? 'mind-node-selected' : ''
      }`}
      onDoubleClick={() => setEditing(true)}
    >
      <Handle type="target" position={Position.Left} className="mind-handle" />
      {editing ? (
        <input
          className="mind-node-input nodrag"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setValue(data.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span className="mind-node-text">{data.text || '空节点'}</span>
      )}
      {data.childCount > 0 && (
        <button
          className="mind-node-collapse nodrag"
          title={data.collapsed ? '展开' : '折叠'}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggle();
          }}
        >
          {data.collapsed ? data.childCount : '−'}
        </button>
      )}
      <button
        className="mind-node-add nodrag"
        title="添加子节点"
        onClick={(e) => {
          e.stopPropagation();
          data.onAddChild();
        }}
      >
        +
      </button>
      <Handle type="source" position={Position.Right} className="mind-handle" />
    </div>
  );
}
