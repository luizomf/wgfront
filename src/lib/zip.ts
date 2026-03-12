import { zipSync, strToU8 } from 'fflate';
import { downloadBlob } from './download';

interface ZipEntry {
  filename: string;
  content: string;
}

export function downloadZip(entries: ZipEntry[], zipFilename: string): void {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    files[entry.filename] = strToU8(entry.content);
  }
  const zipped = zipSync(files);
  const blob = new Blob([zipped], { type: 'application/zip' });
  downloadBlob(blob, zipFilename);
}
