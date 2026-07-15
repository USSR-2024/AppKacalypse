"""
LiveKit caption-agent — живые субтитры с переводом RU↔ES.
Заходит во все активные комнаты, слушает аудио участников, режет речь по VAD
(silero), распознаёт faster-whisper'ом, переводит NLLB на противоположный язык и
публикует ОБА варианта через LiveKit Transcription API. Клиент показывает каждому
зрителю сегмент на его языке.

ENV:
  LIVEKIT_URL   ws://127.0.0.1:7880   (агент на том же хосте, что LiveKit)
  LIVEKIT_API_KEY / LIVEKIT_API_SECRET
  ASR_MODEL     модель faster-whisper (по умолчанию medium)
  CAPTION_ROOM  (опц.) сразу зайти в конкретную комнату
"""
import asyncio
import json
import os
import uuid
import numpy as np
import requests
import torch

from livekit import rtc, api
from faster_whisper import WhisperModel
from silero_vad import load_silero_vad, VADIterator
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:7880")
API_KEY = os.environ["LIVEKIT_API_KEY"]
API_SECRET = os.environ["LIVEKIT_API_SECRET"]
ASR_MODEL = os.environ.get("ASR_MODEL", "medium")
BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8081")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
SR = 16000
NLLB = {"ru": "rus_Cyrl", "es": "spa_Latn"}

print(f"[agent] faster-whisper '{ASR_MODEL}' на GPU…", flush=True)
asr = WhisperModel(ASR_MODEL, device="cuda", compute_type="float16")
print("[agent] silero-vad…", flush=True)
vad_model = load_silero_vad()
print("[agent] NLLB-200 (перевод)…", flush=True)
_tok = AutoTokenizer.from_pretrained("facebook/nllb-200-distilled-600M")
_mt = AutoModelForSeq2SeqLM.from_pretrained("facebook/nllb-200-distilled-600M").to("cuda").eval()
print("[agent] модели готовы", flush=True)


# Фразы-галлюцинации Whisper (зашиты из ютуб-концовок; в реальном созвоне не встречаются).
HALLUC = (
    "негода", "продолжение следует", "субтитр", "dimatorzok", "amara.org",
    "спасибо за просмотр", "подписывайтесь", "ставьте лайк", "редактор а.",
    "gracias por ver", "subtítulos", "suscríbete",
)


def _halluc(t: str) -> bool:
    low = t.lower()
    return any(h in low for h in HALLUC)


def transcribe(pcm_f32: np.ndarray, lang: str):
    """→ (текст, определённый_язык). Отсекает тишину/шум и галлюцинации по уверенности."""
    segments, info = asr.transcribe(
        pcm_f32,
        language=None if lang == "auto" else lang,
        beam_size=1, vad_filter=False, condition_on_previous_text=False,
        no_speech_threshold=0.6, log_prob_threshold=-1.0,
    )
    parts = []
    for s in segments:
        if getattr(s, "no_speech_prob", 0.0) > 0.6:      # почти наверняка тишина
            continue
        if getattr(s, "avg_logprob", 0.0) < -1.3:        # совсем низкая уверенность → мусор
            continue
        t = s.text.strip()
        if t and not _halluc(t):
            parts.append(t)
    return " ".join(parts).strip(), info.language


def translate(text: str, src: str, tgt: str) -> str:
    _tok.src_lang = NLLB[src]
    inputs = _tok(text, return_tensors="pt").to("cuda")
    with torch.no_grad():
        out = _mt.generate(
            **inputs,
            forced_bos_token_id=_tok.convert_tokens_to_ids(NLLB[tgt]),
            max_length=256, num_beams=1,
        )
    return _tok.batch_decode(out, skip_special_tokens=True)[0].strip()


# Очередь речевых сегментов. Один воркер = одно распознавание за раз (без гонок на GPU,
# результаты не «перемешиваются», сохраняется порядок).
seg_queue: asyncio.Queue = asyncio.Queue()

PREROLL = int(SR * 0.3)   # 300мс до детекта — чтобы не терять начало фразы
MIN_SEG = int(SR * 0.18)  # короче 180мс — почти наверняка не речь


async def process_track(room, track, participant):
    try:
        meta = json.loads(participant.metadata or "{}")
    except Exception:
        meta = {}
    cfg_lang = meta.get("lang", "auto")
    name = participant.name or participant.identity
    print(f"[agent] слушаю {name} (lang={cfg_lang})", flush=True)

    vad_iter = VADIterator(vad_model, sampling_rate=SR, min_silence_duration_ms=700)
    stream = rtc.AudioStream(track, sample_rate=SR, num_channels=1)
    buf = np.zeros(0, dtype=np.float32)
    window = np.zeros(0, dtype=np.float32)
    recent = np.zeros(0, dtype=np.float32)  # хвост аудио для пре-ролла
    collecting = False

    async for ev in stream:
        samples = np.frombuffer(ev.frame.data, dtype=np.int16).astype(np.float32) / 32768.0
        window = np.concatenate([window, samples])
        while len(window) >= 512:
            chunk = window[:512]
            window = window[512:]
            if collecting:
                buf = np.concatenate([buf, chunk])
            res = vad_iter(chunk, return_seconds=False)
            if res and "start" in res and not collecting:
                collecting = True
                buf = np.concatenate([recent, chunk])   # пре-ролл + начало речи
            elif res and "end" in res and collecting:
                collecting = False
                seg, buf = buf, np.zeros(0, dtype=np.float32)
                if len(seg) > MIN_SEG:
                    seg_queue.put_nowait((room, track, participant, name, seg, cfg_lang))
            recent = np.concatenate([recent, chunk])[-PREROLL:]  # обновляем хвост


async def handle_segment(room, track, participant, name, seg, cfg_lang):
    """ASR → перевод → публикация обоих языков. В отдельной задаче, чтобы не тормозить чтение аудио."""
    loop = asyncio.get_event_loop()
    try:
        text, det = await loop.run_in_executor(None, transcribe, seg, cfg_lang)
        if not text:
            return
        src = cfg_lang if cfg_lang in ("ru", "es") else ("ru" if det == "ru" else "es")
        tgt = "es" if src == "ru" else "ru"
        translated = await loop.run_in_executor(None, translate, text, src, tgt)
        print(f"[caption] {name} {src}: {text}  |  {tgt}: {translated}", flush=True)

        # Публикуем субтитр как data-сообщение (топик 'captions') — обе языковые версии.
        # Клиент фильтрует по языку зрителя. Надёжнее Transcription API (нет version-нюансов).
        by = {src: text, tgt: translated}
        payload = json.dumps({
            "id": uuid.uuid4().hex,
            "name": name,
            "ru": by.get("ru", ""),
            "es": by.get("es", ""),
        }).encode("utf-8")
        await room.local_participant.publish_data(payload, reliable=True, topic="captions")
    except Exception as e:
        print(f"[agent] ошибка сегмента: {e}", flush=True)


async def seg_worker():
    """Единственный потребитель очереди: распознаёт+переводит сегменты по одному."""
    while True:
        item = await seg_queue.get()
        try:
            await handle_segment(*item)
        except Exception as e:
            print(f"[agent] воркер: {e}", flush=True)
        finally:
            seg_queue.task_done()


async def join_room(room_name: str, active: dict):
    room = rtc.Room()

    @room.on("track_subscribed")
    def on_track(track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            asyncio.create_task(process_track(room, track, participant))

    @room.on("disconnected")
    def on_disc(reason=None):
        active.pop(room_name, None)
        print(f"[agent] отключился от '{room_name}'", flush=True)

    token = (
        api.AccessToken(API_KEY, API_SECRET)
        .with_identity("caption-agent").with_name("Субтитры")
        .with_grants(api.VideoGrants(
            room_join=True, room=room_name,
            can_subscribe=True, can_publish=False, can_publish_data=True, hidden=True,
        )).to_jwt()
    )
    await room.connect(LIVEKIT_URL, token, options=rtc.RoomOptions(auto_subscribe=True))
    active[room_name] = room
    print(f"[agent] вошёл в '{room_name}' (участников: {len(room.remote_participants)})", flush=True)


def fetch_caption_rooms() -> set:
    """Комнаты с включёнными субтитрами (бэкенд, гейт по WORKER_TOKEN)."""
    r = requests.get(
        f"{BACKEND_URL}/api/caption-worker/rooms",
        headers={"X-Worker-Token": WORKER_TOKEN}, timeout=5,
    )
    r.raise_for_status()
    return set(r.json())


async def main():
    active: dict = {}
    loop = asyncio.get_event_loop()
    asyncio.create_task(seg_worker())  # серийный обработчик сегментов

    # Прогрев CUDA-ядер, чтобы ПЕРВОЕ реальное распознавание/перевод не тормозили.
    try:
        await loop.run_in_executor(None, transcribe, np.zeros(int(SR * 0.5), dtype=np.float32), "ru")
        await loop.run_in_executor(None, translate, "привет", "ru", "es")
        print("[agent] прогрев выполнен", flush=True)
    except Exception as e:
        print(f"[agent] прогрев пропущен: {e}", flush=True)

    print("[agent] слежу за комнатами с субтитрами (опрос 2с)…", flush=True)
    while True:
        try:
            wanted = await loop.run_in_executor(None, fetch_caption_rooms)
        except Exception as e:
            print(f"[agent] ошибка опроса бэка: {e}", flush=True)
            await asyncio.sleep(2)
            continue
        # заходим в новые комнаты с субтитрами
        for name in wanted - set(active):
            try:
                await join_room(name, active)
            except Exception as e:
                print(f"[agent] не смог войти в '{name}': {e}", flush=True)
        # выходим из тех, где субтитры выключили или встреча закрылась
        for name in set(active) - wanted:
            room = active.pop(name, None)
            if room:
                try:
                    await room.disconnect()
                except Exception:
                    pass
                print(f"[agent] вышел из '{name}' (субтитры выкл/встреча закрыта)", flush=True)
        await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(main())
