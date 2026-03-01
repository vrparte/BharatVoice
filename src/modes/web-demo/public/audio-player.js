(function bootstrapAudioPlayer() {
  class BharatVoiceAudioPlayer {
    constructor(options) {
      this.audioEl = options.audioEl;
      this.mountEl = options.mountEl;
      this.onMetric = options.onMetric;
      this.onIssue = options.onIssue;
      this.chunks = [];
      this.currentMeta = null;
      this.currentObjectUrl = null;
      this.latestBlob = null;
      this.playbackRequestedAt = 0;
      this.waveCanvas = document.createElement('canvas');
      this.waveCanvas.width = 420;
      this.waveCanvas.height = 56;
      this.waveCanvas.style.width = '100%';
      this.waveCanvas.style.maxWidth = '420px';
      this.waveCanvas.style.marginTop = '8px';
      this.mountEl.appendChild(this.waveCanvas);
      this.ctx2d = this.waveCanvas.getContext('2d');
      this.controls = this.createControls();
      this.mountEl.appendChild(this.controls);
      this.setupAudioGraph();
      this.bindEvents();
    }

    createControls() {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.gap = '8px';
      wrap.style.marginTop = '8px';

      this.pauseBtn = document.createElement('button');
      this.pauseBtn.type = 'button';
      this.pauseBtn.textContent = 'Pause';
      this.pauseBtn.disabled = true;

      this.replayBtn = document.createElement('button');
      this.replayBtn.type = 'button';
      this.replayBtn.textContent = 'Replay';
      this.replayBtn.disabled = true;

      this.downloadBtn = document.createElement('button');
      this.downloadBtn.type = 'button';
      this.downloadBtn.textContent = 'Download';
      this.downloadBtn.disabled = true;

      wrap.append(this.pauseBtn, this.replayBtn, this.downloadBtn);
      return wrap;
    }

    setupAudioGraph() {
      const ContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!ContextCtor) {
        return;
      }
      this.audioContext = new ContextCtor();
      this.sourceNode = this.audioContext.createMediaElementSource(this.audioEl);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      this.waveData = new Uint8Array(this.analyser.frequencyBinCount);
    }

    bindEvents() {
      this.pauseBtn.addEventListener('click', () => {
        if (this.audioEl.paused) {
          this.audioEl.play().catch(() => {});
          this.pauseBtn.textContent = 'Pause';
        } else {
          this.audioEl.pause();
          this.pauseBtn.textContent = 'Resume';
        }
      });

      this.replayBtn.addEventListener('click', () => {
        this.audioEl.currentTime = 0;
        this.audioEl.play().catch(() => {});
      });

      this.downloadBtn.addEventListener('click', () => {
        if (!this.latestBlob) {
          return;
        }
        const url = URL.createObjectURL(this.latestBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bharatvoice-response-${Date.now()}.${this.currentMeta?.format || 'wav'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      });

      this.audioEl.addEventListener('playing', () => {
        if (this.playbackRequestedAt > 0) {
          this.onMetric?.({
            type: 'playback_start',
            playbackStartMs: Date.now() - this.playbackRequestedAt
          });
        }
        this.startWaveRender();
      });

      this.audioEl.addEventListener('ended', () => this.stopWaveRender());
      this.audioEl.addEventListener('pause', () => this.stopWaveRender());
      this.audioEl.addEventListener('stalled', () => {
        this.onIssue?.('Audio stalled during playback.');
      });
    }

    beginStream(meta) {
      this.currentMeta = meta;
      this.chunks = [];
      this.playbackRequestedAt = 0;
      this.pauseBtn.disabled = true;
      this.replayBtn.disabled = true;
      this.downloadBtn.disabled = true;
    }

    appendChunk(chunk) {
      if (!(chunk instanceof Uint8Array)) {
        return;
      }
      this.chunks.push(chunk);
    }

    async endStream(meta) {
      if (!this.currentMeta || !meta || this.currentMeta.streamId !== meta.streamId) {
        this.onIssue?.('Audio stream metadata mismatch.');
        return;
      }

      const merged = this.mergeChunks(this.chunks);
      let payload = merged;
      if (this.currentMeta.compression === 'deflate') {
        try {
          payload = await this.inflateDeflate(merged);
        } catch {
          this.onIssue?.('Audio decompression failed. Falling back to raw payload.');
        }
      }

      this.latestBlob = new Blob([payload], { type: this.currentMeta.mimeType || 'audio/wav' });
      if (this.currentObjectUrl) {
        URL.revokeObjectURL(this.currentObjectUrl);
      }
      this.currentObjectUrl = URL.createObjectURL(this.latestBlob);
      this.audioEl.src = this.currentObjectUrl;
      this.pauseBtn.disabled = false;
      this.replayBtn.disabled = false;
      this.downloadBtn.disabled = false;
      this.playbackRequestedAt = Date.now();
      await this.resumeAudioContext();
      await this.audioEl.play();
      this.onMetric?.({ type: 'stream_complete', bytes: payload.byteLength, metrics: meta.metrics || {} });
    }

    mergeChunks(chunks) {
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return merged;
    }

    async inflateDeflate(payload) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream unavailable');
      }
      const ds = new DecompressionStream('deflate');
      const decompressedStream = new Blob([payload]).stream().pipeThrough(ds);
      const arrayBuffer = await new Response(decompressedStream).arrayBuffer();
      return new Uint8Array(arrayBuffer);
    }

    async resumeAudioContext() {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    }

    startWaveRender() {
      if (!this.analyser || !this.ctx2d || !this.waveData) {
        return;
      }
      const render = () => {
        if (this.audioEl.paused) {
          return;
        }
        this.analyser.getByteFrequencyData(this.waveData);
        this.ctx2d.clearRect(0, 0, this.waveCanvas.width, this.waveCanvas.height);
        const barWidth = this.waveCanvas.width / this.waveData.length;
        for (let i = 0; i < this.waveData.length; i += 1) {
          const value = this.waveData[i] / 255;
          const barHeight = value * this.waveCanvas.height;
          this.ctx2d.fillStyle = '#0b5cab';
          this.ctx2d.fillRect(i * barWidth, this.waveCanvas.height - barHeight, Math.max(1, barWidth - 1), barHeight);
        }
        this.waveFrame = requestAnimationFrame(render);
      };
      this.stopWaveRender();
      render();
    }

    stopWaveRender() {
      if (this.waveFrame) {
        cancelAnimationFrame(this.waveFrame);
        this.waveFrame = null;
      }
      if (this.ctx2d) {
        this.ctx2d.clearRect(0, 0, this.waveCanvas.width, this.waveCanvas.height);
      }
    }
  }

  window.BharatVoiceAudioPlayer = BharatVoiceAudioPlayer;
})();
