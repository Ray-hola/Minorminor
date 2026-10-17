import * as zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

export const zstdAvailable = typeof zlib.createZstdDecompress === 'function';

// Decode a small in-memory prefix; never unpack files on disk. Both compressed
// input, decompression window and output are bounded independently.
export async function readCompressedSessionPrefix(handle, limit = 32768, format = 'zstd') {
  if (!Number.isInteger(limit) || limit < 1 || limit > 262144) throw new Error('压缩会话读取范围无效');
  if (!['zstd', 'gzip'].includes(format)) throw new Error('不支持的压缩会话格式');
  if (format === 'zstd' && !zstdAvailable) throw new Error('当前 Node.js 不支持 Zstandard 解码');
  let bytesRead = 0;
  const input = Readable.from((async function* () {
    while (bytesRead < 262144) {
      const buffer = Buffer.alloc(Math.min(16384, 262144 - bytesRead));
      const result = await handle.read(buffer, 0, buffer.length, bytesRead);
      if (!result.bytesRead) break;
      bytesRead += result.bytesRead; yield buffer.subarray(0, result.bytesRead);
    }
  })());
  const decoder = format === 'gzip' ? zlib.createGunzip() : zlib.createZstdDecompress({ params: { [zlib.constants.ZSTD_d_windowLogMax]: 23 } });
  const timer = setTimeout(() => decoder.destroy(new Error('压缩会话读取超时')), 2500);
  const chunks = []; let length = 0;
  input.on('error', error => decoder.destroy(error)); input.pipe(decoder);
  try {
    for await (const chunk of decoder) {
      const part = chunk.subarray(0, limit - length); chunks.push(part); length += part.length;
      if (length >= limit) break;
    }
    return { contents: Buffer.concat(chunks, length), bytesRead, truncated: length >= limit };
  } finally { clearTimeout(timer); input.unpipe(decoder); input.destroy(); decoder.destroy(); await finished(input).catch(() => {}); }
}
