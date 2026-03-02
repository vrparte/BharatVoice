const logsEl = document.getElementById('logs');
const responseTextEl = document.getElementById('responseText');
const audioPlayerEl = document.getElementById('audioPlayer');
const transcriptEl = document.getElementById('transcript');
const verticalEl = document.getElementById('vertical');
const reconnectBtn = document.getElementById('connectBtn');
const micBtn = document.getElementById('sendBtn');
const actionsEl = document.querySelector('.actions');
const SESSION_STORAGE_KEY = 'bharatvoice.webdemo.sessionId';
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_BASE_URL = `${WS_PROTOCOL}//${window.location.host}/ws/voice`;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const THEMES = {
  dental: { icon: 'D', color: '#0b5cab', name: 'Dental' },
  auto: { icon: 'A', color: '#0f766e', name: 'Auto' },
  legal: { icon: 'L', color: '#6b21a8', name: 'Legal' }
};
const MSG = {
  retry: 'Kripya fir se koshish karein.',
  internet: 'Internet connection check karein.',
  audioIssue: 'Audio sunne mein problem hai, text padhein.',
  sttTimeout: "Didn't catch that, please speak clearly.",
  browserFallback: 'Voice support nahi mila. Kripya Chrome/Edge use karein ya text type karein.'
};

let socket = null;
let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
let state = 'idle';
let typingTimer = null;
let sttTimeout = null;
let finalTranscript = '';
let activeStreamId = null;
let responseStartedAt = 0;
let audioPlayer = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let manualReconnect = false;
let forceTextInputMode = false;
let speechNetworkRetryDone = false;
let speechNetworkFailures = 0;
let speechRecoveryTimer = null;
let mediaRecorder = null;
let mediaStream = null;
let mediaRecordTimeout = null;
let mediaChunks = [];

const AUDIO_INPUT_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];

const statusEl = document.createElement('div');
statusEl.className = 'status';
actionsEl.appendChild(statusEl);

const styleEl = document.createElement('style');
styleEl.textContent = `
  .status { font-size:13px; color:var(--bv-color,#1e3a5f); align-self:center; margin-left:auto; }
  .mic-idle,.mic-listening,.mic-processing,.mic-speaking { color:#fff; border:0; border-radius:8px; }
  .mic-idle,.mic-listening { background:var(--bv-color,#0b5cab); }
  .mic-processing { background:#b45309; }
  .mic-speaking { background:#5b21b6; }
`;
document.head.appendChild(styleEl);

const log = (message, payload) => {
  const timestamp = new Date().toISOString();
  const suffix = payload ? ` ${JSON.stringify(payload)}` : '';
  logsEl.textContent = `${timestamp} ${message}${suffix}\n${logsEl.textContent}`;
};

const applyTheme = (vertical) => {
  const theme = THEMES[vertical] || THEMES.dental;
  document.documentElement.style.setProperty('--bv-color', theme.color);
  statusEl.textContent = `${theme.icon} ${theme.name} mode ready`;
};

const setState = (nextState, statusText) => {
  state = nextState;
  micBtn.className = '';
  micBtn.classList.add(`mic-${nextState}`);
  micBtn.disabled = nextState === 'processing' || nextState === 'speaking';
  if (statusText) {
    statusEl.textContent = statusText;
  }
  micBtn.textContent =
    nextState === 'idle'
      ? SpeechRecognition && !forceTextInputMode
        ? 'Start Mic'
        : 'Send Text'
      : nextState === 'listening'
        ? 'Listening...'
        : nextState === 'processing'
          ? 'Processing...'
          : 'Speaking...';
};

const startTypingIndicator = () => {
  let dots = 0;
  clearInterval(typingTimer);
  typingTimer = setInterval(() => {
    dots = (dots + 1) % 4;
    responseTextEl.textContent = `Processing${'.'.repeat(dots)}`;
  }, 250);
};

const stopTypingIndicator = () => {
  clearInterval(typingTimer);
  typingTimer = null;
};

const loadAudioPlayerModule = async () => {
  if (window.BharatVoiceAudioPlayer) {
    return;
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/demo/audio-player.js';
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const ensureAudioPlayer = async () => {
  if (audioPlayer) {
    return;
  }
  await loadAudioPlayerModule();
  audioPlayer = new window.BharatVoiceAudioPlayer({
    audioEl: audioPlayerEl,
    mountEl: audioPlayerEl.parentElement,
    onMetric: (metric) => {
      log('audio.metric', metric);
      if (metric.type === 'playback_start') {
        setState('speaking', `Playback started in ${metric.playbackStartMs}ms`);
      }
    },
    onIssue: (issue) => {
      log('audio.issue', { issue });
      setState('idle', `${MSG.audioIssue} ${MSG.retry}`);
    }
  });
};

const buildWebSocketUrl = () => {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set('sessionId', sessionId);
  }
  params.set('vertical', verticalEl.value);
  return `${WS_BASE_URL}?${params.toString()}`;
};

const sendAnalyticsEvent = (eventName, payload) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: 'analytics',
      eventName,
      sessionId: sessionId || undefined,
      payload
    })
  );
};

const sendInit = () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: 'init',
      vertical: verticalEl.value,
      sessionId: sessionId || undefined,
      preloadVoices: true,
      audio: {
        formats: ['ogg', 'mp3', 'wav'],
        compression: 'deflate',
        supportsDeflate: typeof DecompressionStream !== 'undefined',
        connectionSpeed: navigator.connection?.effectiveType?.includes('2g') ? 'slow' : 'normal'
      }
    })
  );
};

const scheduleSpeechRecovery = () => {
  if (speechRecoveryTimer) {
    clearTimeout(speechRecoveryTimer);
  }
  speechRecoveryTimer = setTimeout(() => {
    forceTextInputMode = false;
    speechNetworkFailures = 0;
    speechNetworkRetryDone = false;
    if (recognition) {
      recognition.lang = 'hi-IN';
    }
    setState('idle', 'Speech service retry enabled. Aap mic dobara try kar sakte hain.');
  }, 30000);
};

const scheduleReconnect = () => {
  if (manualReconnect) {
    return;
  }
  if (reconnectAttempts >= 5) {
    setState('idle', `WebSocket unavailable. Please use Chrome/Edge. ${MSG.internet}`);
    log('ws.reconnect.stopped', { attempts: reconnectAttempts });
    return;
  }
  reconnectAttempts += 1;
  const backoff = Math.min(1000 * 2 ** (reconnectAttempts - 1), 15000);
  setState('idle', `Reconnect in ${Math.round(backoff / 1000)}s... ${MSG.retry}`);
  reconnectTimer = setTimeout(() => {
    void connectWebSocket();
  }, backoff);
};

const handleSocketJson = async (data) => {
  if (data.type === 'session' || data.type === 'init') {
    sessionId = data.sessionId;
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    if (data.vertical) {
      verticalEl.value = data.vertical;
      applyTheme(data.vertical);
    }
    if (data.greeting) {
      responseTextEl.textContent = data.greeting;
    }
    log('session.ready', { sessionId, vertical: verticalEl.value });
    return;
  }

  if (data.type === 'session_recovered') {
    sessionId = data.sessionId;
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    stopTypingIndicator();
    responseTextEl.textContent = data.contextSummary
      ? `Previous context: ${data.contextSummary}`
      : 'New session started.';
    setState('idle', data.message || MSG.retry);
    return;
  }

  if (data.type === 'response') {
    stopTypingIndicator();
    responseStartedAt = Date.now();
    responseTextEl.textContent = data.text;
    activeStreamId = data.streamId || null;
    if (data.audioUnavailable) {
      setState('idle', `${MSG.audioIssue} ${MSG.retry}`);
      return;
    }
    setState('processing', 'Receiving audio stream...');
    return;
  }

  if (data.type === 'transcript') {
    if (typeof data.text === 'string') {
      transcriptEl.value = data.text;
      log('asr.transcript', { text: data.text });
    }
    return;
  }

  if (data.type === 'audio_start') {
    if (!audioPlayer || (activeStreamId && data.streamId !== activeStreamId)) {
      return;
    }
    audioPlayer.beginStream(data);
    log('audio.start', {
      streamId: data.streamId,
      format: data.format,
      compression: data.compression,
      totalBytes: data.totalBytes
    });
    return;
  }

  if (data.type === 'audio_end') {
    if (!audioPlayer || (activeStreamId && data.streamId !== activeStreamId)) {
      return;
    }
    await audioPlayer.endStream(data);
    const playbackWaitMs = responseStartedAt > 0 ? Date.now() - responseStartedAt : 0;
    log('audio.end', { streamId: data.streamId, playbackWaitMs, metrics: data.metrics || {} });
    setState('speaking', 'Playing AI response...');
    return;
  }

  if (data.type === 'error') {
    stopTypingIndicator();
    setState('idle', `${data.message || 'Unknown server error.'} ${MSG.retry}`);
    log('server.error', { message: data.message || 'Unknown server error' });
  }
};

const connectWebSocket = async () => {
  await ensureAudioPlayer();

  if (socket && socket.readyState === WebSocket.OPEN) {
    sendInit();
    return;
  }

  try {
    socket = new WebSocket(buildWebSocketUrl());
    socket.binaryType = 'arraybuffer';
  } catch {
    setState('idle', `WebSocket init failed. Please use Chrome/Edge. ${MSG.internet}`);
    log('ws.error', { message: 'WebSocket construction failed' });
    scheduleReconnect();
    return;
  }

  reconnectBtn.disabled = true;
  reconnectBtn.textContent = 'Connected';
  setState('idle', 'Connecting...');

  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    manualReconnect = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    sendInit();
  });

  socket.addEventListener('message', async (event) => {
    if (typeof event.data !== 'string') {
      if (audioPlayer) {
        const chunk = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array();
        if (chunk.byteLength > 0) {
          audioPlayer.appendChunk(chunk);
        }
      }
      return;
    }

    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      log('ws.invalid_json', { payload: event.data });
      return;
    }
    await handleSocketJson(data);
  });

  socket.addEventListener('close', () => {
    reconnectBtn.disabled = false;
    reconnectBtn.textContent = 'Reconnect';
    setState('idle', `Disconnected. ${MSG.internet}`);
    log('ws.closed');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    setState('idle', `WebSocket failed. Please use Chrome/Edge. ${MSG.internet}`);
    log('ws.error', { message: 'socket error event' });
  });
};

const sendTranscript = (text) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setState('idle', `WebSocket disconnected. ${MSG.retry}`);
    return;
  }

  const transcript = text.trim();
  if (!transcript) {
    setState('idle', `${MSG.sttTimeout} ${MSG.retry}`);
    return;
  }

  setState('processing', 'AI is thinking...');
  startTypingIndicator();
  socket.send(
    JSON.stringify({
      type: 'transcript',
      text: transcript,
      vertical: verticalEl.value,
      sessionId: sessionId || undefined
    })
  );
};

const canUseMediaInput = () => {
  return typeof MediaRecorder !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
};

const toBase64 = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const stopMediaCapture = () => {
  if (mediaRecordTimeout) {
    clearTimeout(mediaRecordTimeout);
    mediaRecordTimeout = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  mediaRecorder = null;
  mediaChunks = [];
};

const sendRecordedAudio = async () => {
  if (!socket || socket.readyState !== WebSocket.OPEN || mediaChunks.length === 0) {
    stopMediaCapture();
    return;
  }

  const audioType =
    mediaRecorder && typeof mediaRecorder.mimeType === 'string' && mediaRecorder.mimeType
      ? mediaRecorder.mimeType
      : 'audio/webm';
  const blob = new Blob(mediaChunks, { type: audioType });
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = toBase64(arrayBuffer);

  setState('processing', 'Transcribing voice...');
  startTypingIndicator();
  socket.send(
    JSON.stringify({
      type: 'audio_input',
      sessionId: sessionId || undefined,
      vertical: verticalEl.value,
      language: 'hi-en',
      mimeType: audioType,
      fileName: `browser-mic-${Date.now()}.${audioType.includes('ogg') ? 'ogg' : 'webm'}`,
      audioBase64: base64
    })
  );
  stopMediaCapture();
};

const startMediaCapture = async () => {
  if (!canUseMediaInput()) {
    setState('idle', `Mic capture unsupported. ${MSG.retry}`);
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setState('idle', `WebSocket disconnected. ${MSG.retry}`);
    return;
  }

  const mimeType = AUDIO_INPUT_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaChunks = [];
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);
  } catch {
    setState('idle', `Mic permission denied or unavailable. ${MSG.retry}`);
    return;
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      mediaChunks.push(event.data);
    }
  };

  mediaRecorder.onerror = () => {
    stopMediaCapture();
    setState('idle', `Mic recording error. ${MSG.retry}`);
  };

  mediaRecorder.onstop = () => {
    void sendRecordedAudio();
  };

  setState('listening', 'Listening... बोलने के बाद 4 sec में auto-stop');
  mediaRecorder.start();
  mediaRecordTimeout = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }, 4000);
};

const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
  recognition.lang = 'hi-IN';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    finalTranscript = '';
    speechNetworkFailures = 0;
    if (forceTextInputMode) {
      forceTextInputMode = false;
    }
    setState('listening', 'Listening...');
    sttTimeout = setTimeout(() => {
      recognition.stop();
      setState('idle', `${MSG.sttTimeout} ${MSG.retry}`);
    }, 7000);
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const phrase = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += `${phrase} `;
      } else {
        interim += phrase;
      }
    }
    transcriptEl.value = `${finalTranscript}${interim}`.trim();
  };

  recognition.onerror = (event) => {
    clearTimeout(sttTimeout);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      setState('idle', `Mic permission denied. ${MSG.retry}`);
      return;
    }
    if (event.error === 'network') {
      speechNetworkFailures += 1;
      if (!speechNetworkRetryDone && recognition.lang !== 'en-IN') {
        speechNetworkRetryDone = true;
        recognition.lang = 'en-IN';
        setState('idle', 'Speech network issue detected. Retrying once with fallback language...');
        setTimeout(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            recognition.start();
          }
        }, 350);
        return;
      }

      if (speechNetworkFailures >= 3) {
        forceTextInputMode = true;
        setState(
          'idle',
          `Speech service unavailable right now. Type transcript and click Send Text. ${MSG.retry}`
        );
        scheduleSpeechRecovery();
      } else {
        setState('idle', `Speech network issue. Mic ko fir se try karein ya text bhejein. ${MSG.retry}`);
      }
      log('stt.fallback', {
        reason: 'network_error',
        lang: recognition.lang,
        failures: speechNetworkFailures
      });
      return;
    }
    setState('idle', `Speech error: ${event.error}. ${MSG.retry}`);
  };

  recognition.onend = () => {
    clearTimeout(sttTimeout);
    if (state === 'listening') {
      sendTranscript(finalTranscript || transcriptEl.value);
    }
  };
} else {
  setState('idle', MSG.browserFallback);
  log('browser.fallback', { reason: 'SpeechRecognition unsupported' });
}

micBtn.addEventListener('click', () => {
  if (canUseMediaInput()) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      void connectWebSocket().then(() => {
        setTimeout(() => {
          void startMediaCapture();
        }, 300);
      });
      return;
    }
    void startMediaCapture();
    return;
  }

  if (!recognition) {
    sendTranscript(transcriptEl.value);
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    void connectWebSocket().then(() => {
      setTimeout(() => recognition.start(), 300);
    });
    return;
  }
  recognition.start();
});

verticalEl.addEventListener('change', () => {
  applyTheme(verticalEl.value);
  if (socket && socket.readyState === WebSocket.OPEN) {
    sendInit();
  }
});

reconnectBtn.addEventListener('click', () => {
  manualReconnect = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  void connectWebSocket();
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const ctaType = target.getAttribute('data-cta-type');
  if (ctaType !== 'pricing' && ctaType !== 'contact') {
    return;
  }
  sendAnalyticsEvent('conversion_clicked', { ctaType });
  log('analytics.conversion_clicked', { ctaType, sessionId });
});

audioPlayerEl.addEventListener('ended', () => setState('idle', 'Ready'));

applyTheme(verticalEl.value);
setState('idle', 'Ready');
void connectWebSocket();
