# Caption-agent — база от whisperx:local (там уже torch 2.2.2 cu121 + ct2 4.4.0 +
# cudnn8 + faster-whisper, вся борьба с зависимостями решена). Добавляем LiveKit
# rtc SDK, silero-vad и (позже) NLLB для перевода.
FROM whisperx:local

RUN pip install --no-cache-dir \
    "livekit==1.1.*" \
    "livekit-api" \
    "silero-vad" \
    "transformers" \
    "sentencepiece" \
    "requests"

WORKDIR /app
COPY agent.py /app/agent.py

CMD ["python3", "/app/agent.py"]
