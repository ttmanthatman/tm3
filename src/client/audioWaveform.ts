export type WaveformGeometry = {
  canvasWidthPx: number;
  barWidthPx: number;
  gapPx: number;
  barCount: number;
  usedWidthPx: number;
  offsetPx: number;
};

export function computeWaveformGeometry(cssWidth: number, devicePixelRatio = 1): WaveformGeometry {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const canvasWidthPx = Math.max(0, Math.round(Math.max(0, cssWidth) * dpr));
  const barWidthPx = Math.max(2, Math.round(2 * dpr));
  const gapPx = Math.max(1, Math.round(dpr));
  const stridePx = barWidthPx + gapPx;
  const barCount = canvasWidthPx > 0 ? Math.max(1, Math.floor((canvasWidthPx + gapPx) / stridePx)) : 0;
  const usedWidthPx = barCount ? barCount * barWidthPx + (barCount - 1) * gapPx : 0;

  return {
    canvasWidthPx,
    barWidthPx,
    gapPx,
    barCount,
    usedWidthPx,
    offsetPx: Math.max(0, Math.floor((canvasWidthPx - usedWidthPx) / 2))
  };
}

export function resampleWaveform(source: number[], targetCount: number) {
  const count = Math.max(0, Math.floor(targetCount));
  if (!count) return [];
  const samples = source.length ? source.map(normalizeSample) : [0.18];
  if (samples.length === 1) return Array.from({ length: count }, () => samples[0]);

  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : (index * (samples.length - 1)) / (count - 1);
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const mix = position - left;
    return normalizeSample(samples[left] * (1 - mix) + samples[right] * mix);
  });
}

export function resolveMessageWaveform(source: unknown, seed: number, fallbackCount = 48) {
  if (Array.isArray(source)) {
    const computed = source
      .slice(0, 512)
      .map((sample) => Number(sample))
      .filter(Number.isFinite)
      .map(normalizeSample);
    if (computed.length) return computed;
  }
  return Array.from({ length: fallbackCount }, (_, index) => {
    const value = Math.abs(Math.sin((index + 1) * 1.37 + seed * 0.013) * 0.75 + Math.sin(index * 0.41) * 0.25);
    return Math.min(1, Math.max(0.16, value));
  });
}

function normalizeSample(value: number) {
  if (!Number.isFinite(value)) return 0.08;
  return Math.min(1, Math.max(0.08, value));
}
