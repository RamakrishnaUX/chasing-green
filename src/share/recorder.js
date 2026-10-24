// Records about 15 seconds of the game canvas (plus game audio when available) with MediaRecorder.

export class ClipRecorder {
  constructor(canvas, getAudioStream) {
    this.canvas = canvas;
    this.getAudioStream = getAudioStream;
    this.recording = false;
  }

  static supported() {
    return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  }

  pickType() {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    return types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  }

  start(seconds = 15, onTick, onDone) {
    if (this.recording || !ClipRecorder.supported()) return false;
    const stream = this.canvas.captureStream(30);
    const audio = this.getAudioStream?.();
    audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
    const mimeType = this.pickType();
    let rec;
    try { rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined); }
    catch { return false; }
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      this.recording = false;
      clearInterval(this.timer);
      const type = rec.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunks, { type });
      onDone?.(blob, type.includes('mp4') ? 'mp4' : 'webm');
    };
    this.recording = true;
    rec.start(500);
    const t0 = performance.now();
    this.timer = setInterval(() => {
      const left = Math.max(0, seconds - (performance.now() - t0) / 1000);
      onTick?.(left);
      if (left <= 0 && rec.state === 'recording') rec.stop();
    }, 250);
    this.rec = rec;
    return true;
  }

  stop() { if (this.rec && this.rec.state === 'recording') this.rec.stop(); }
}
