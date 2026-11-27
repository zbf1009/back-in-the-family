/** 使用现有 Blob／object URL 下载约定，不解析或改写原始导出字节。 */
export function downloadJsonBytes(filename: string, bytes: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}
