// Minimal RIFF/WAVE PCM parser.
// Returns header fields, peak/rms envelope (256 buckets), and a Float32Array of
// the first channel suitable for Web Audio playback. Hand-rolled DataView walk;
// matches the spec faithfully enough for the demo samples.

const TEXT = (bytes, off, len) => {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[off + i]);
  return s;
};

export function parseWav(bytes) {
  if (bytes.length < 44) throw new Error('WAV too short');
  if (TEXT(bytes, 0, 4) !== 'RIFF' || TEXT(bytes, 8, 4) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = dv.getUint32(4, true);

  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;
  let off = 12;
  const chunks = [];
  while (off + 8 <= bytes.length) {
    const id   = TEXT(bytes, off, 4);
    const size = dv.getUint32(off + 4, true);
    chunks.push({ id, off, size });
    if (id === 'fmt ') {
      fmt = {
        format:     dv.getUint16(off + 8, true),
        channels:   dv.getUint16(off + 10, true),
        sampleRate: dv.getUint32(off + 12, true),
        byteRate:   dv.getUint32(off + 16, true),
        blockAlign: dv.getUint16(off + 20, true),
        bitsPerSample: dv.getUint16(off + 22, true),
        chunkOffset: off,
      };
    } else if (id === 'data') {
      dataOff = off + 8;
      dataLen = size;
    }
    // Chunk sizes are word-aligned (round up to even).
    off += 8 + size + (size & 1);
  }
  if (!fmt) throw new Error('WAV missing fmt chunk');
  if (dataOff < 0) throw new Error('WAV missing data chunk');
  if (fmt.format !== 1 && fmt.format !== 3) {
    throw new Error(`WAV format ${fmt.format} not supported (PCM/float only)`);
  }

  // Decode first channel into Float32 in [-1, 1]. PCM only.
  const ch = fmt.channels;
  const bps = fmt.bitsPerSample;
  const bytesPerSample = bps / 8;
  const totalFrames = Math.floor(dataLen / fmt.blockAlign);
  const samples = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    const base = dataOff + i * fmt.blockAlign;
    let v = 0;
    if (fmt.format === 3 && bps === 32) {
      v = dv.getFloat32(base, true);
    } else if (bps === 16) {
      v = dv.getInt16(base, true) / 32768;
    } else if (bps === 8) {
      v = (bytes[base] - 128) / 128;
    } else if (bps === 24) {
      const a = bytes[base], b = bytes[base+1], c = bytes[base+2];
      let s = a | (b << 8) | (c << 16);
      if (s & 0x800000) s |= ~0xFFFFFF; // sign-extend
      v = s / 8388608;
    } else if (bps === 32) {
      v = dv.getInt32(base, true) / 2147483648;
    }
    samples[i] = v;
  }

  // Build a peak/rms envelope across BUCKET buckets for the waveform canvas.
  const BUCKETS = 256;
  const env = new Array(BUCKETS);
  const stride = Math.max(1, Math.floor(samples.length / BUCKETS));
  for (let b = 0; b < BUCKETS; b++) {
    const start = b * stride;
    const end = Math.min(samples.length, (b + 1) * stride);
    let mn = 0, mx = 0, sq = 0, n = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i];
      if (s < mn) mn = s;
      if (s > mx) mx = s;
      sq += s * s;
      n++;
    }
    env[b] = { min: mn, max: mx, rms: n ? Math.sqrt(sq / n) : 0 };
  }

  return {
    fmt,
    chunks,
    riffSize,
    dataOff,
    dataLen,
    totalFrames,
    duration: totalFrames / fmt.sampleRate,
    samples,
    envelope: env,
  };
}
