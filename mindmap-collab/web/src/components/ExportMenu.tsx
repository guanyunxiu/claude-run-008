import { api } from '../api/client';

/** 导出菜单：Markdown / OPML */
export function ExportMenu({ documentId }: { documentId: string }) {
  const download = async (format: 'markdown' | 'opml') => {
    const { data, headers } = await api.get(`/documents/${documentId}/export`, {
      params: { format },
      responseType: 'blob',
    });
    const disposition: string = headers['content-disposition'] || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const filename = match?.[1] || `mindmap.${format === 'opml' ? 'opml' : 'md'}`;
    const url = URL.createObjectURL(data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="export-menu">
      <button onClick={() => download('markdown')}>导出 Markdown</button>
      <button onClick={() => download('opml')}>导出 OPML</button>
    </div>
  );
}
