/** Keep one disabled source for this foreground session. Each recording owns
 * a clone, so a late recorder callback cannot stop the next recording. */
export function createVoiceMicrophone(request: () => Promise<MediaStream>) {
  let retained: MediaStream | null = null;
  let pending: Promise<MediaStream> | null = null;
  let epoch = 0;
  const recordings = new Set<MediaStream>();
  const stop = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());

  function source(): Promise<MediaStream> {
    const tracks = retained?.getAudioTracks() || [];
    if (tracks.length && tracks.every((track) => track.readyState === "live")) return Promise.resolve(retained!);
    if (pending) return pending;
    if (retained) stop(retained);
    retained = null;
    const ticket = epoch;
    const acquisition = request().then((stream) => {
      if (ticket !== epoch) {
        stop(stream);
        throw new DOMException("录音申请已取消", "AbortError");
      }
      stream.getTracks().forEach((track) => { track.enabled = false; });
      retained = stream;
      return stream;
    }).finally(() => { if (pending === acquisition) pending = null; });
    pending = acquisition;
    return acquisition;
  }

  return {
    async acquire() {
      const ticket = epoch;
      const stream = await source();
      if (ticket !== epoch) throw new DOMException("录音申请已取消", "AbortError");
      const recording = stream.clone();
      recording.getAudioTracks().forEach((track) => { track.enabled = true; });
      recordings.add(recording);
      return recording;
    },
    finish(stream: MediaStream) {
      recordings.delete(stream);
      stop(stream);
    },
    release() {
      epoch++;
      pending = null;
      if (retained) stop(retained);
      retained = null;
      for (const stream of recordings) stop(stream);
      recordings.clear();
    }
  };
}
