import { Readable } from 'node:stream';
import {
  EgressClient, EncodedFileOutput, EncodedFileType, S3Upload, WebhookReceiver,
} from 'livekit-server-sdk';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env.js';

// LiveKit Egress: комнату пишет отдельный сервис akc-egress (Chrome-композитор на 158),
// бэкенд лишь стартует/останавливает задачу через HTTP API и получает результат вебхуком.
const egress = new EgressClient(env.LIVEKIT_HTTP_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

// Приёмник вебхуков LiveKit — проверяет подпись (JWT в Authorization + sha256 тела).
const webhook = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

// S3-клиент к MinIO (в сети appkacalypse_default). Для скачивания mp4 на том расшифровок.
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  forcePathStyle: true, // MinIO требует path-style
});

// Запустить запись комнаты (RoomComposite grid → mp4 в MinIO). Возвращает egressId и ключ файла.
export async function startRecording(roomName: string, ts: number): Promise<{ egressId: string; key: string }> {
  const key = `${roomName}/${ts}.mp4`;
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: key,
    output: {
      case: 's3',
      value: new S3Upload({
        accessKey: env.S3_ACCESS_KEY,
        secret: env.S3_SECRET_KEY,
        region: env.S3_REGION,
        // endpoint, который видит egress (host-network) — обычно 127.0.0.1:9000
        endpoint: env.S3_EGRESS_ENDPOINT,
        bucket: env.S3_BUCKET,
        forcePathStyle: true,
      }),
    },
  });
  const info = await egress.startRoomCompositeEgress(roomName, { file: output }, { layout: 'grid' });
  return { egressId: info.egressId, key };
}

// Остановить запись. Идемпотентно на уровне вызова (ошибку глушим — задача могла уже завершиться).
export async function stopRecording(egressId: string): Promise<void> {
  await egress.stopEgress(egressId).catch(() => {});
}

// Проверить подпись вебхука LiveKit и вернуть событие.
export async function receiveWebhook(body: string, authHeader: string) {
  return webhook.receive(body, authHeader);
}

// Скачать объект из MinIO как Node Readable-стрим.
export async function getRecordingStream(key: string): Promise<Readable> {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  return res.Body as Readable;
}
