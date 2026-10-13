/** Each recording owns a fresh source. Never retain capture just to retain
 * permission: on iOS an interrupted live track can remain muted indefinitely. */
export function createVoiceMicrophone(request: () => Promise<MediaStream>) {
  let epoch = 0;
  const recordings = new Set<MediaStream>();
  const pendingInputs = new Set<() => void>();
  const stop = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());

  async function waitForInput(stream: MediaStream) {
    const tracks = stream.getAudioTracks();
    const readable = () => tracks.length > 0 && tracks.every((track) => track.readyState === "live" && track.enabled && !track.muted);
    if (readable()) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        pendingInputs.delete(cancel);
        for (const track of tracks) {
          track.removeEventListener("unmute", check);
          track.removeEventListener("ended", check);
        }
      };
      const fail = (error: DOMException) => { cleanup(); reject(error); };
      const cancel = () => fail(new DOMException("录音申请已取消", "AbortError"));
      const check = () => {
        if (!tracks.length || tracks.some((track) => track.readyState === "ended" || !track.enabled)) {
          fail(new DOMException("麦克风输入已停止", "NotReadableError"));
        } else if (readable()) { cleanup(); resolve(); }
      };
      const timer = setTimeout(() => fail(new DOMException("麦克风没有提供音频输入，请重试", "NotReadableError")), 10_000);
      pendingInputs.add(cancel);
      for (const track of tracks) {
        track.addEventListener("unmute", check);
        track.addEventListener("ended", check);
      }
      check();
    });
  }

  return {
    async acquire() {
      const ticket = epoch;
      const stream = await request();
      if (ticket !== epoch) {
        stop(stream);
        throw new DOMException("录音申请已取消", "AbortError");
      }
      recordings.add(stream);
      try {
        await waitForInput(stream);
        if (ticket !== epoch) throw new DOMException("录音申请已取消", "AbortError");
        return stream;
      } catch (error) {
        recordings.delete(stream);
        stop(stream);
        throw error;
      }
    },
    finish(stream: MediaStream) {
      recordings.delete(stream);
      stop(stream);
    },
    release() {
      epoch++;
      for (const cancel of pendingInputs) cancel();
      for (const stream of recordings) stop(stream);
      recordings.clear();
    }
  };
}
