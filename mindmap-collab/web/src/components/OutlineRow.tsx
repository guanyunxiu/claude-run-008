import { useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface OutlineItem {
  id: string;
  parentId: string | null;
  text: string;
  collapsed: boolean;
  depth: number;
  childCount: number;
}

interface Props {
  item: OutlineItem;
  /** 拖拽中：投影计算出的临时缩进深度 */
  projectedDepth?: number;
  readOnly?: boolean;
  focusRequested: boolean;
  onFocusHandled: () => void;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onKeyCommand: (command: 'enter' | 'indent' | 'outdent' | 'delete') => void;
}

/** 大纲行：拖拽手柄 + 折叠箭头 + 文本输入 */
export function OutlineRow({
  item,
  projectedDepth,
  readOnly = false,
  focusRequested,
  onFocusHandled,
  onToggle,
  onTextChange,
  onKeyCommand,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: readOnly });

  useEffect(() => {
    if (focusRequested && inputRef.current) {
      inputRef.current.focus();
      onFocusHandled();
    }
  }, [focusRequested, onFocusHandled]);

  const depth = projectedDepth ?? item.depth;

  return (
    <div
      ref={setNodeRef}
      className={`outline-row ${isDragging ? 'outline-row-dragging' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        paddingLeft: depth * 24 + 4,
      }}
    >
      <span
        className="outline-handle"
        {...(readOnly ? {} : { ...attributes, ...listeners })}
      >
        ⠿
      </span>
      {item.childCount > 0 ? (
        <button className="outline-toggle" onClick={onToggle}>
          {item.collapsed ? '▸' : '▾'}
        </button>
      ) : (
        <span className="outline-toggle outline-toggle-empty" />
      )}
      <input
        ref={inputRef}
        className="outline-input"
        value={item.text}
        placeholder="输入内容…"
        readOnly={readOnly}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (readOnly) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            onKeyCommand('enter');
          } else if (e.key === 'Tab') {
            e.preventDefault();
            onKeyCommand(e.shiftKey ? 'outdent' : 'indent');
          } else if (
            e.key === 'Backspace' &&
            (e.target as HTMLInputElement).value === ''
          ) {
            e.preventDefault();
            onKeyCommand('delete');
          }
        }}
      />
    </div>
  );
}
