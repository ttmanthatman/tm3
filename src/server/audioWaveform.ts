import { spawn } from "node:child_process";

const MIN_BAR_HEIGHT = 0.08;
const WAVEFORM_FRAME_HEIGHT = 128;
const MAX_WAVEFORM_BARS = 512;
const ANALYSIS_TIMEOUT_MS = 2 * 60 * 1000;

export function waveformFromGrayFrame(frame: Buffer, width: number, height: number) {
  if (!width || !height || frame.length < width * height) return [];
  const levels = Array.from({ length: width }, (_, x) => {
    let paintedPixels = 0;
    for (let y = 0; y < height; y += 1) {
      if (frame[y * width + x] > 8) paintedPixels += 1;
    }
    return paintedPixels / height;
  });
  const maximum = Math.max(...levels);
  if (maximum <= 0) return levels.map(() => MIN_BAR_HEIGHT);
  return levels.map((level) => Math.min(1, Math.max(MIN_BAR_HEIGHT, level / maximum)));
}

export function mergeAudioWaveformPayload(payload: unknown, waveform: number[]) {
  const existing = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return { ...existing, kind: "audio", waveform };
}

export async function analyzeAudioWaveform(filePath: string, bars = 256) {
  const width = Math.max(1, Math.min(MAX_WAVEFORM_BARS, Math.round(Number(bars)) || 256));
  const expectedBytes = width * WAVEFORM_FRAME_HEIGHT;
  return new Promise<number[]>((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        filePath,
        "-filter_complex",
        `aformat=channel_layouts=mono,showwavespic=s=${width}x${WAVEFORM_FRAME_HEIGHT}:colors=white:scale=lin,format=gray`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1"
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    let errorText = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
      finish(() => reject(new Error("audio waveform analysis timed out")));
    }, ANALYSIS_TIMEOUT_MS);

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > expectedBytes) {
        ffmpeg.kill("SIGKILL");
        finish(() => reject(new Error("audio waveform frame is larger than expected")));
        return;
      }
      chunks.push(chunk);
    });
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      if (errorText.length < 4_000) errorText += String(chunk).slice(0, 4_000 - errorText.length);
    });
    ffmpeg.on("error", (error) => finish(() => reject(error)));
    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(errorText || `ffmpeg exited ${code}`)));
        return;
      }
      const waveform = waveformFromGrayFrame(Buffer.concat(chunks, bytes), width, WAVEFORM_FRAME_HEIGHT);
      finish(() => (waveform.length ? resolve(waveform) : reject(new Error("audio waveform is empty"))));
    });
  });
}
