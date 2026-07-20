import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env.js';

// Файлы документов — отдельный бакет `documents` (не `recordings`): у него включён
// Object Lock, а его нельзя включить на существующем бакете, только при создании.
// Бакет НЕ публичный: наружу файлы отдаёт только бэкенд, проверив права.
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  forcePathStyle: true,   // MinIO требует path-style
});

/** Залить тело версии. Возвращает sha256 и размер — считаем на лету, второй раз файл не читаем. */
export async function putVersion(key: string, body: Buffer, contentType: string): Promise<{ hash: string; size: number }> {
  await s3.send(new PutObjectCommand({
    Bucket: env.S3_DOCS_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return { hash: createHash('sha256').update(body).digest('hex'), size: body.length };
}

export async function getVersionStream(key: string): Promise<Readable> {
  const r = await s3.send(new GetObjectCommand({ Bucket: env.S3_DOCS_BUCKET, Key: key }));
  return r.Body as Readable;
}

/** Файл целиком в память + Content-Length. DS плохо переваривает chunked без длины (ТЗ §4.7),
 *  документы мелкие → буфер безопасен. */
export async function getVersionBuffer(key: string): Promise<{ body: Buffer; contentType: string }> {
  const r = await s3.send(new GetObjectCommand({ Bucket: env.S3_DOCS_BUCKET, Key: key }));
  const body = Buffer.from(await (r.Body as Readable & { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray!());
  return { body, contentType: r.ContentType || 'application/octet-stream' };
}

/** Только для отката незавершённой загрузки: подписанный оригинал удалить не даст Object Lock. */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_DOCS_BUCKET, Key: key }));
}
