import { mkdirSync } from "fs";
import { unlink } from "fs/promises";

const WHISPER_BIN = process.env.WHISPER_BIN ?? "/home/pi/whisper.cpp/build/bin/whisper-cli";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "/home/pi/whisper.cpp/models/ggml-base.bin";
const PIPER_BIN = process.env.PIPER_BIN ?? "/home/pi/piper/piper/piper";
const PIPER_MODEL = process.env.PIPER_MODEL ?? "/home/pi/piper/voices/en_US-lessac-medium.onnx";
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
 * Convert text to speech using piper, returns path to OGG file
 */
export async function synthesize(text: string): Promise<string> {
  const wavPath = `${TMP_DIR}/${Date.now()}-tts.wav`;
  const oggPath = `${TMP_DIR}/${Date.now()}-tts.ogg`;

  try {
    // Run piper to generate WAV
    const piper = Bun.spawn(
      [PIPER_BIN, "--model", PIPER_MODEL, "--output_file", wavPath],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          LD_LIBRARY_PATH: "/home/pi/piper/piper",
        },
      }
    );

    piper.stdin.write(text);
    piper.stdin.end();

    const exitCode = await piper.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(piper.stderr).text();
      throw new Error(`Piper failed (exit ${exitCode}): ${stderr.slice(0, 200)}`);
    }

    // Convert WAV to OGG (Telegram voice format)
    const ffmpeg = Bun.spawn(
      ["ffmpeg", "-y", "-i", wavPath, "-c:a", "libopus", "-b:a", "64k", oggPath],
      { stdout: "pipe", stderr: "pipe" }
    );
    await ffmpeg.exited;

    return oggPath;
  } finally {
    await unlink(wavPath).catch(() => {});
  }
}

/**
 * Clean up a TTS output file after sending
 */
export async function cleanupTTS(oggPath: string): Promise<void> {
  await unlink(oggPath).catch(() => {});
}
