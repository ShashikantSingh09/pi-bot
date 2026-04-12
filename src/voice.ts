import { mkdirSync } from "fs";
import { unlink } from "fs/promises";

const WHISPER_BIN = process.env.WHISPER_BIN ?? "/home/pi/whisper.cpp/build/bin/whisper-cli";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "/home/pi/whisper.cpp/models/ggml-base.bin";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL"; // Sarah
const TMP_DIR = "/home/pi/AI/data/tmp";

mkdirSync(TMP_DIR, { recursive: true });

/**
 * Transcribe a voice message (OGG/Opus) to text using whisper.cpp
 */
export async function transcribe(oggPath: string): Promise<string> {
  const wavPath = `${TMP_DIR}/${Date.now()}.wav`;

  try {
    // Convert OGG to WAV (16kHz mono, required by whisper)
    const ffmpeg = Bun.spawn(
      ["ffmpeg", "-y", "-i", oggPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
      { stdout: "pipe", stderr: "pipe" }
    );
    await ffmpeg.exited;

    // Run whisper.cpp
    const whisper = Bun.spawn(
      [WHISPER_BIN, "-m", WHISPER_MODEL, "-f", wavPath, "--no-timestamps", "-l", "auto"],
      { stdout: "pipe", stderr: "pipe" }
    );

    const stdout = await new Response(whisper.stdout).text();
    const exitCode = await whisper.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(whisper.stderr).text();
      throw new Error(`Whisper failed (exit ${exitCode}): ${stderr.slice(0, 200)}`);
    }

    return stdout.trim();
  } finally {
    await unlink(wavPath).catch(() => {});
  }
}

/**
 * Convert text to speech using ElevenLabs API, returns path to OGG file
 */
export async function synthesize(text: string): Promise<string> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY not set");
  }

  const oggPath = `${TMP_DIR}/${Date.now()}-tts.ogg`;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs API error (${res.status}): ${body.slice(0, 200)}`);
  }

  // ElevenLabs returns MP3, convert to OGG (Telegram voice format)
  const mp3Path = `${TMP_DIR}/${Date.now()}-tts.mp3`;
  await Bun.write(mp3Path, await res.arrayBuffer());

  const ffmpeg = Bun.spawn(
    ["ffmpeg", "-y", "-i", mp3Path, "-c:a", "libopus", "-b:a", "64k", oggPath],
    { stdout: "pipe", stderr: "pipe" }
  );
  await ffmpeg.exited;
  await unlink(mp3Path).catch(() => {});

  return oggPath;
}

/**
 * Clean up a TTS output file after sending
 */
export async function cleanupTTS(oggPath: string): Promise<void> {
  await unlink(oggPath).catch(() => {});
}
