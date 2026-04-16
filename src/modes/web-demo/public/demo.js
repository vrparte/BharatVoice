const logsEl = document.getElementById('logs');
const responseTextEl = document.getElementById('responseText');
const audioPlayerEl = document.getElementById('audioPlayer');
const transcriptEl = document.getElementById('transcript');
const verticalEl = document.getElementById('vertical');
const languageEl = document.getElementById('language');
const reconnectBtn = document.getElementById('connectBtn');
const micBtn = document.getElementById('sendBtn');
const sendTextBtn = document.getElementById('sendTextBtn');
const promptHintEl = document.getElementById('promptHint');
const demoTimerEl = document.getElementById('demoTimer');
const demoSummaryEl = document.getElementById('demoSummary');
const summaryListEl = document.getElementById('summaryList');
const restartDemoBtn = document.getElementById('restartDemoBtn');
const statusBadgeEl = document.getElementById('statusBadge');
const statusHeadingEl = document.getElementById('statusHeading');
const statusDetailEl = document.getElementById('statusDetail');
const convScenarioLabelEl = document.getElementById('convScenarioLabel');
const outStateValEl = document.getElementById('out-state-val');
const outIntentValEl = document.getElementById('out-intent-val');
const outTurnsValEl = document.getElementById('out-turns-val');
const outNameValEl = document.getElementById('out-name-val');
const outDateValEl = document.getElementById('out-date-val');
const outTimeValEl = document.getElementById('out-time-val');
const outExtraValEl = document.getElementById('out-extra-val');
const starterButtons = Array.from(document.querySelectorAll('[data-starter]'));
const samplePromptButtons = Array.from(document.querySelectorAll('[data-sample]'));
const SESSION_STORAGE_KEY = 'bharatvoice.webdemo.sessionId';
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_BASE_URL = `${WS_PROTOCOL}//${window.location.host}/ws/voice`;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const THEMES = {
  dental: { icon: 'D', color: '#0b5cab', name: 'Dental' },
  auto: { icon: 'A', color: '#0f766e', name: 'Auto' },
  legal: { icon: 'L', color: '#6b21a8', name: 'Legal' }
};
const LANGUAGE_MODES = {
  hinglish: {
    recognition: 'hi-IN',
    audio: 'hi-en',
    heading: 'Hinglish mode active'
  },
  hindi: {
    recognition: 'hi-IN',
    audio: 'hi-en',
    heading: 'Hindi mode active'
  },
  english: {
    recognition: 'en-IN',
    audio: 'hi-en',
    heading: 'English mode active'
  }
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
let turnCount = 0;
const MAX_TURNS = 20;
let currentConversationState = 'GREETING';
let lastIntent = '-';
let lastConfidence = '-';
let collectedSnapshot = {};
let missingSnapshot = [];
const DEMO_DURATION_SECONDS = 300;
let demoStartedAt = 0;
let demoRemainingSeconds = DEMO_DURATION_SECONDS;
let demoTimerInterval = null;
let demoExpired = false;
let endAfterPlaybackReason = null;
let currentLanguageMode = languageEl && typeof languageEl.value === 'string' ? languageEl.value : 'hinglish';

const AUDIO_INPUT_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
const DEBUG_MODE =
  window.location.hostname === 'localhost' || new URLSearchParams(window.location.search).get('debug') === '1';
if (DEBUG_MODE) {
  const dc = document.getElementById('debugCard');
  if (dc) dc.style.display = 'block';
}

const styleEl = document.createElement('style');
styleEl.textContent = `
  .mic-idle,.mic-listening,.mic-processing,.mic-speaking { color:#fff; border:0; border-radius:999px; }
  .mic-idle,.mic-listening { background:var(--bv-color,#0b5cab); }
  .mic-processing { background:#b45309; }
  .mic-speaking { background:#5b21b6; }
  .demo-meta { margin:0 0 10px; padding:12px; border:1px solid #d6e3f3; border-radius:16px; background:#f8fbff; }
  .demo-row { display:flex; gap:10px; flex-wrap:wrap; font-size:12px; color:#1f3552; }
  .demo-chip { padding:4px 8px; border-radius:999px; background:#eaf2fb; }
  .thinking { font-size:12px; color:#b45309; display:none; margin-top:8px; }
  .chat-log { margin:0 0 10px; display:flex; flex-direction:column; gap:8px; max-height:230px; overflow:auto; }
  .bubble { max-width:92%; padding:10px 12px; border-radius:14px; line-height:1.45; font-size:13px; }
  .bubble-user { align-self:flex-end; background:#dbeafe; color:#1e3a5f; }
  .bubble-ai { align-self:flex-start; background:#eef8f1; color:#14532d; }
  .collected { margin-top:8px; font-size:12px; color:#1f3552; }
  .debug-panel { margin-top:8px; padding:8px; background:#0f172a; color:#d1fae5; border-radius:8px; font-size:11px; white-space:pre-wrap; display:none; }
`;
document.head.appendChild(styleEl);

const responseCardEl = responseTextEl.closest('.response-block');
const metaEl = document.createElement('div');
metaEl.className = 'demo-meta';
const metaRowEl = document.createElement('div');
metaRowEl.className = 'demo-row';
const stateChipEl = document.createElement('span');
stateChipEl.className = 'demo-chip';
const turnChipEl = document.createElement('span');
turnChipEl.className = 'demo-chip';
const thinkingEl = document.createElement('div');
thinkingEl.className = 'thinking';
const collectedEl = document.createElement('div');
collectedEl.className = 'collected';
const debugEl = document.createElement('div');
debugEl.className = 'debug-panel';
const chatLogEl = document.createElement('div');
chatLogEl.className = 'chat-log';

metaRowEl.appendChild(stateChipEl);
metaRowEl.appendChild(turnChipEl);
metaEl.appendChild(metaRowEl);
metaEl.appendChild(collectedEl);
metaEl.appendChild(thinkingEl);
metaEl.appendChild(debugEl);
if (responseCardEl) {
  responseCardEl.insertBefore(metaEl, responseTextEl);
  responseCardEl.insertBefore(chatLogEl, responseTextEl);
}

const getLanguageMode = () => LANGUAGE_MODES[currentLanguageMode] || LANGUAGE_MODES.hinglish;

const formatCountdown = (seconds) => {
  const safeSeconds = Math.max(0, seconds);
  const mins = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

const renderTimer = () => {
  if (!demoTimerEl) {
    return;
  }
  demoTimerEl.textContent = formatCountdown(demoRemainingSeconds);
};

const stopDemoTimer = () => {
  if (!demoTimerInterval) {
    return;
  }
  clearInterval(demoTimerInterval);
  demoTimerInterval = null;
};

const showDemoSummary = (reason) => {
  if (!demoSummaryEl || !summaryListEl) {
    return;
  }
  const summaryItems = [
    `Vertical selected: ${verticalEl.value}`,
    `Turns completed: ${turnCount}`,
    `Final state: ${currentConversationState}`,
    `Captured name: ${collectedSnapshot.name || 'not captured'}`,
    `Captured date/time: ${collectedSnapshot.date || '-'} / ${collectedSnapshot.time || '-'}`,
    `Captured phone: ${collectedSnapshot.phone || 'not captured'}`,
    `Outcome: ${reason}`
  ];
  summaryListEl.innerHTML = summaryItems.map((item) => `<li>${item}</li>`).join('');
  demoSummaryEl.hidden = false;
};

const endDemo = (reason) => {
  if (demoExpired) {
    return;
  }
  demoExpired = true;
  stopDemoTimer();
  stopTypingIndicator();
  stopMediaCapture();
  if (recognition && state === 'listening') {
    recognition.stop();
  }
  transcriptEl.disabled = true;
  verticalEl.disabled = true;
  micBtn.disabled = true;
  if (sendTextBtn) {
    sendTextBtn.disabled = true;
  }
  showDemoSummary(reason);
  if (promptHintEl) {
    promptHintEl.textContent = reason;
  }
  setState('idle', reason);
};

const startDemoTimer = () => {
  if (demoExpired || demoTimerInterval) {
    return;
  }
  if (demoStartedAt === 0) {
    demoStartedAt = Date.now();
  }
  renderTimer();
  demoTimerInterval = setInterval(() => {
    demoRemainingSeconds -= 1;
    renderTimer();
    if (demoRemainingSeconds <= 0) {
      endDemo('Demo ended: 5 minutes complete. Review the summary and restart if needed.');
    }
  }, 1000);
};

const resetDemo = () => {
  demoExpired = false;
  endAfterPlaybackReason = null;
  demoStartedAt = 0;
  demoRemainingSeconds = DEMO_DURATION_SECONDS;
  stopDemoTimer();
  renderTimer();
  turnCount = 0;
  currentConversationState = 'GREETING';
  lastIntent = '-';
  lastConfidence = '-';
  collectedSnapshot = {};
  missingSnapshot = [];
  finalTranscript = '';
  chatLogEl.innerHTML = '';
  responseTextEl.textContent = 'No response yet.';
  if (promptHintEl) {
    promptHintEl.textContent = 'Click the mic, ask one question, and wait for voice reply.';
  }
  transcriptEl.disabled = false;
  verticalEl.disabled = false;
  micBtn.disabled = false;
  if (sendTextBtn) {
    sendTextBtn.disabled = false;
  }
  if (demoSummaryEl) {
    demoSummaryEl.hidden = true;
  }
  sessionId = null;
  localStorage.removeItem(SESSION_STORAGE_KEY);
  // Force-close the existing socket so the server creates a brand-new session
  // rather than reusing the old activeSession with previously collected data.
  if (socket) {
    socket.onclose = null; // suppress auto-reconnect triggered by close event
    socket.close();
    socket = null;
  }
  document.querySelectorAll('.oc-item').forEach((el) => el.classList.remove('is-captured'));
  const studioEl = document.querySelector('.studio');
  if (studioEl) {
    studioEl.removeAttribute('data-state');
    studioEl.classList.remove('demo-started');
  }
  renderMeta();
  setState('idle', 'Ready');
  void connectWebSocket();
};

const log = (message, payload) => {
  if (!logsEl) return;
  const timestamp = new Date().toISOString();
  const suffix = payload ? ` ${JSON.stringify(payload)}` : '';
  logsEl.textContent = `${timestamp} ${message}${suffix}\n${logsEl.textContent}`;
};

const applyTheme = (vertical) => {
  const theme = THEMES[vertical] || THEMES.dental;
  document.documentElement.style.setProperty('--bv-color', theme.color);
  document.documentElement.style.setProperty('--bv-vertical-name', `"${theme.name}"`);
};

const applyLanguageMode = () => {
  currentLanguageMode = languageEl && typeof languageEl.value === 'string' ? languageEl.value : 'hinglish';
  const mode = getLanguageMode();
  if (recognition) {
    recognition.lang = mode.recognition;
  }
  if (statusDetailEl && state === 'idle' && !demoExpired) {
    statusDetailEl.textContent = `${mode.heading}. Choose a starter or ask your own question.`;
  }
};

const renderCollected = () => {
  const name = collectedSnapshot.name || '-';
  const date = collectedSnapshot.date || '-';
  const time = collectedSnapshot.time || '-';
  const phone = collectedSnapshot.phone || '-';
  collectedEl.textContent = `Collected Info: name=${name}, date=${date}, time=${time}, phone=${phone}`;
};

const renderDebug = () => {
  if (!DEBUG_MODE) {
    debugEl.style.display = 'none';
    return;
  }
  debugEl.style.display = 'block';
  debugEl.textContent =
    `Current state: ${currentConversationState}\n` +
    `Last intent: ${lastIntent}\n` +
    `Confidence: ${lastConfidence}\n` +
    `Collected: ${JSON.stringify(collectedSnapshot)}\n` +
    `Missing: ${JSON.stringify(missingSnapshot)}`;
};

const CONV_STATE_LABELS = {
  IDLE: 'Idle', GREETING: 'Greeting', COLLECTING_INFO: 'Collecting info',
  CONFIRMING: 'Confirming', BOOKING: 'Booked', CLOSING: 'Complete', FALLBACK: 'Clarifying'
};

const SCENARIO_DISPLAY_NAMES = { dental: 'Dental Clinic', auto: 'Auto Service', legal: 'Legal Office' };

const setOutcomeVal = (el, value) => {
  if (!el) return;
  const hasValue = value && value !== '-' && value !== '—';
  el.textContent = hasValue ? value : '';
  const item = el.closest('.oc-item');
  if (item) item.classList.toggle('is-captured', hasValue);
};

const renderOutcomes = () => {
  setOutcomeVal(outStateValEl, CONV_STATE_LABELS[currentConversationState] || currentConversationState);
  const intentLabel = lastIntent !== '-' ? lastIntent.replace(/_/g, ' ') : null;
  setOutcomeVal(outIntentValEl, intentLabel);
  if (outTurnsValEl) outTurnsValEl.textContent = `${turnCount} / ${MAX_TURNS}`;
  setOutcomeVal(outNameValEl, collectedSnapshot.name || null);
  setOutcomeVal(outDateValEl, collectedSnapshot.date || null);
  setOutcomeVal(outTimeValEl, collectedSnapshot.time || null);
  const extra = collectedSnapshot.doctor || collectedSnapshot.carModel || collectedSnapshot.caseType || collectedSnapshot.service || null;
  setOutcomeVal(outExtraValEl, extra);
};

const renderMeta = () => {
  stateChipEl.textContent = `State: ${currentConversationState}`;
  turnChipEl.textContent = `Turn ${turnCount} of ${MAX_TURNS}`;
  renderCollected();
  renderDebug();
  renderOutcomes();
};

const addChatBubble = (role, text) => {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role === 'user' ? 'bubble-user' : 'bubble-ai'}`;
  bubble.textContent = text;
  chatLogEl.appendChild(bubble);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
};

const setState = (nextState, statusText) => {
  state = nextState;
  const studioEl = document.querySelector('.studio');
  if (studioEl) {
    studioEl.setAttribute('data-state', nextState);
    if (nextState !== 'idle') studioEl.classList.add('demo-started');
  }
  micBtn.className = 'btn btn-primary';
  micBtn.classList.add(`mic-${nextState}`);
  micBtn.disabled = demoExpired || nextState === 'processing' || nextState === 'speaking';
  if (sendTextBtn) {
    sendTextBtn.className = 'btn btn-secondary';
    sendTextBtn.disabled = demoExpired || nextState === 'processing' || nextState === 'speaking';
  }
  const stateLabel =
    nextState === 'idle'
      ? 'Ready'
      : nextState === 'listening'
        ? 'Listening'
        : nextState === 'processing'
          ? 'Thinking'
          : 'Speaking';
  if (statusBadgeEl) {
    statusBadgeEl.className = `status-pill status-${nextState}`;
    statusBadgeEl.textContent = stateLabel;
  }
  if (statusHeadingEl) {
    statusHeadingEl.textContent =
      nextState === 'idle'
        ? 'Ready to start'
        : nextState === 'listening'
          ? 'Listening for caller input'
          : nextState === 'processing'
            ? 'Thinking...'
            : 'Playing the assistant reply';
  }
  if (statusDetailEl) {
    statusDetailEl.textContent =
      statusText ||
      (nextState === 'idle'
        ? `${getLanguageMode().heading}. Click the mic or use a starter prompt.`
        : nextState === 'listening'
          ? 'Speak naturally. The demo will stop listening automatically after a short clip.'
          : nextState === 'processing'
            ? 'Transcribing and preparing the response...'
            : 'The voice response is currently playing.');
  }
  thinkingEl.style.display = nextState === 'processing' ? 'block' : 'none';
  if (nextState === 'processing') {
    thinkingEl.textContent = 'AI receptionist is preparing a reply...';
  }
  const voiceSupported = Boolean(SpeechRecognition || canUseMediaInput());
  micBtn.textContent =
    nextState === 'idle'
      ? voiceSupported && !forceTextInputMode
        ? 'Start Mic'
        : 'Voice unavailable'
      : nextState === 'listening'
        ? 'Listening...'
        : nextState === 'processing'
          ? 'Responding...'
          : 'Speaking...';
};

const startTypingIndicator = () => {
  let dots = 0;
  clearInterval(typingTimer);
  typingTimer = setInterval(() => {
    dots = (dots + 1) % 4;
    responseTextEl.textContent = `Processing${'.'.repeat(dots)}`;
    thinkingEl.textContent = `AI thinking${'.'.repeat(dots)}`;
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
  const languageMode = getLanguageMode();
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
        connectionSpeed: navigator.connection?.effectiveType?.includes('2g') ? 'slow' : 'normal',
        preferredLanguage: currentLanguageMode
      }
    })
  );
  if (promptHintEl) {
    promptHintEl.textContent = `${languageMode.heading}. Click the mic or send a transcript.`;
  }
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
      recognition.lang = getLanguageMode().recognition;
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
      addChatBubble('assistant', data.greeting);
    }
    setState('idle', 'Ready — tap Start Mic and ask your question.');
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
    turnCount += 1;
    addChatBubble('assistant', data.text || '');
    if (typeof data.state === 'string') {
      currentConversationState = data.state;
    }
    if (data.context && typeof data.context === 'object') {
      collectedSnapshot = data.context.collected || collectedSnapshot;
      missingSnapshot = Array.isArray(data.context.missing) ? data.context.missing : missingSnapshot;
    }
    if (data.debug && typeof data.debug === 'object') {
      lastIntent = data.debug.intent || lastIntent;
      lastConfidence =
        typeof data.debug.confidence === 'number' ? data.debug.confidence.toFixed(2) : lastConfidence;
    }
    renderMeta();
    if (turnCount >= MAX_TURNS) {
      endAfterPlaybackReason = 'Demo completed: 5 turns reached. Review summary and restart for another scenario.';
    }
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
      addChatBubble('user', data.text);
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
  if (demoExpired) {
    setState('idle', 'Demo finished. Click Restart Demo to begin a new guided call.');
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setState('idle', `WebSocket disconnected. ${MSG.retry}`);
    return;
  }

  const transcript = text.trim();
  if (!transcript) {
    setState('idle', `${MSG.sttTimeout} ${MSG.retry}`);
    return;
  }

  startDemoTimer();
  addChatBubble('user', transcript);
  setState('processing', 'AI receptionist is preparing the response...');
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
  if (demoExpired) {
    stopMediaCapture();
    return;
  }
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
      language: getLanguageMode().audio,
      mimeType: audioType,
      fileName: `browser-mic-${Date.now()}.${audioType.includes('ogg') ? 'ogg' : 'webm'}`,
      audioBase64: base64
    })
  );
  stopMediaCapture();
};

const startMediaCapture = async () => {
  if (demoExpired) {
    setState('idle', 'Demo finished. Click Restart Demo to begin a new guided call.');
    return;
  }
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

  startDemoTimer();
  setState('listening', 'Listening now. Speak naturally. Auto-stop in 4 sec.');
  mediaRecorder.start();
  mediaRecordTimeout = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }, 4000);
};

const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
  recognition.lang = getLanguageMode().recognition;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    finalTranscript = '';
    speechNetworkFailures = 0;
    if (forceTextInputMode) {
      forceTextInputMode = false;
    }
    startDemoTimer();
    setState('listening', 'Listening now. Start speaking.');
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
  if (demoExpired) {
    setState('idle', 'Demo finished. Click Restart Demo to begin a new guided call.');
    return;
  }
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

sendTextBtn?.addEventListener('click', () => {
  if (demoExpired) {
    setState('idle', 'Demo finished. Click Restart Demo to begin a new guided call.');
    return;
  }
  sendTranscript(transcriptEl.value);
});

verticalEl.addEventListener('change', () => {
  applyTheme(verticalEl.value);
  if (socket && socket.readyState === WebSocket.OPEN) {
    sendInit();
  }
});

languageEl?.addEventListener('change', () => {
  applyLanguageMode();
  setState('idle', `${getLanguageMode().heading}. Ready for the next prompt.`);
});

starterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const sample = button.getAttribute('data-sample');
    const nextVertical = button.getAttribute('data-vertical');
    starterButtons.forEach((item) => item.classList.toggle('is-active', item === button));
    if (nextVertical && verticalEl.value !== nextVertical) {
      verticalEl.value = nextVertical;
      applyTheme(verticalEl.value);
      if (socket && socket.readyState === WebSocket.OPEN) {
        sendInit();
      }
    }
    if (!sample) {
      return;
    }
    transcriptEl.value = sample;
    transcriptEl.focus();
    setState('idle', `Starter loaded for ${THEMES[verticalEl.value]?.name || 'demo'} mode.`);
    if (promptHintEl) {
      promptHintEl.textContent = `Starter loaded: "${sample}"`;
    }
    const tp = document.querySelector('.type-panel');
    if (tp && !tp.open) tp.open = true;
  });
});

samplePromptButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const sample = button.getAttribute('data-sample');
    if (!sample) {
      return;
    }
    transcriptEl.value = sample;
    transcriptEl.focus();
    if (promptHintEl) {
      promptHintEl.textContent = `Sample loaded: "${sample}"`;
    }
  });
});

window.addEventListener('message', (event) => {
  const payload = event.data;
  if (!payload || typeof payload !== 'object') {
    return;
  }
  if (payload.type !== 'bharatvoice:sample_prompt' || typeof payload.text !== 'string') {
    return;
  }
  transcriptEl.value = payload.text;
  transcriptEl.focus();
  setState('idle', 'Prompt loaded from the homepage hero. Ready to send.');
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

audioPlayerEl.addEventListener('ended', () => {
  if (endAfterPlaybackReason) {
    const reason = endAfterPlaybackReason;
    endAfterPlaybackReason = null;
    endDemo(reason);
    return;
  }
  if (!demoExpired) {
    setState('idle', 'Ready for next question');
  }
});

restartDemoBtn?.addEventListener('click', () => {
  resetDemo();
});

// ── Scenario card selection (wires to hidden #vertical select) ──────────────
const scenarioCards = Array.from(document.querySelectorAll('[data-scenario-key]'));
scenarioCards.forEach((card) => {
  card.addEventListener('click', () => {
    const key = card.getAttribute('data-scenario-key');
    if (!key || !verticalEl) return;
    verticalEl.value = key;
    scenarioCards.forEach((c) => c.classList.toggle('is-active', c === card));
    applyTheme(key);
    if (convScenarioLabelEl) {
      convScenarioLabelEl.textContent = SCENARIO_DISPLAY_NAMES[key] || key;
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendInit();
    }
  });
});

// ── Language pill selection (wires to hidden #language select) ───────────────
const langPills = Array.from(document.querySelectorAll('[data-lang-key]'));
langPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const key = pill.getAttribute('data-lang-key');
    if (!key || !languageEl) return;
    languageEl.value = key;
    langPills.forEach((p) => p.classList.toggle('is-active', p === pill));
    applyLanguageMode();
    setState('idle', `${getLanguageMode().heading}. Ready for the next prompt.`);
  });
});

applyTheme(verticalEl.value);
applyLanguageMode();
if (convScenarioLabelEl) {
  convScenarioLabelEl.textContent = SCENARIO_DISPLAY_NAMES[verticalEl.value] || verticalEl.value;
}
renderTimer();
renderMeta();
setState('idle', 'Ready');
void connectWebSocket();

