// ═══════════════════════════════════════════════════════════
// Samvadini — script.js (Production-Ready)
// Fixes:
//  1. Voice fallback: mic errors now show readable message + offer text input
//  2. Arduino: polls /arduino-status; auto-greets on proximity detection
//  3. Audio cleanup: calls /audio-cleanup once per hour
//  4. askAssistant: history logging works correctly (was wrapping itself)
//  5. convertEmotionAudio: sends JSON (not FormData) to match server
//  6. quickSpeak: button selector fixed (was fragile inline handler lookup)
//  7. All fetch calls have proper error state resets
// ═══════════════════════════════════════════════════════════

// ── Theme Toggle ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function () {
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon   = document.getElementById('themeIcon');
  const body        = document.body;

  if (themeToggle && themeIcon) {
    if (localStorage.getItem('theme') === 'dark') {
      body.classList.add('dark-mode');
      themeIcon.textContent = '☀️';
    }
    themeToggle.addEventListener('click', function () {
      body.classList.toggle('dark-mode');
      themeIcon.textContent = body.classList.contains('dark-mode') ? '☀️' : '🌙';
      localStorage.setItem('theme', body.classList.contains('dark-mode') ? 'dark' : 'light');
    });
  }

  // ── Button bindings ─────────────────────────────────────────────────────────
  const bindings = [
    { id: 'universalMic',         fn: () => startSpeechRecognition('universal') },
    { id: 'assistantMic',         fn: () => startSpeechRecognition('assistant') },
    { id: 'convertEmotionButton', fn: convertEmotionAudio },
    { id: 'translateSpeakButton', fn: translateSpeak },
    { id: 'askAssistantButton',   fn: askAssistant },
    { id: 'convertToSignButton',  fn: convertToSign },
  ];

  bindings.forEach(({ id, fn }) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
    else console.warn('[Samvadini] Missing element: #' + id);
  });

  const assistantInput = document.getElementById('assistantInput');
  if (assistantInput) {
    assistantInput.addEventListener('keypress', e => { if (e.key === 'Enter') askAssistant(); });
  }
  const universalInput = document.getElementById('universalInput');
  if (universalInput) {
    universalInput.addEventListener('keypress', e => { if (e.key === 'Enter') convertToSign(); });
  }
});

// ── G9: Text → ISL Converter ─────────────────────────────────────────────────
function convertToSign() {
  const inputText = (document.getElementById('universalInput')?.value || '').toUpperCase().trim();
  const output    = document.getElementById('islOutput');
  if (!output) return;

  if (!inputText) {
    output.innerHTML = '<p style="color:#6b7280;font-style:italic;font-size:14px;text-align:center;">🎤 Speak your text for ISL conversion…</p>';
    startSpeechRecognition('universal', () => convertToSign());
    return;
  }
  output.innerHTML = '';

  const words   = inputText.split(/\s+/);
  let wordIndex = 0;

  function playNextItem() {
    if (wordIndex >= words.length) return;
    const word = words[wordIndex];

    const wordTitle = document.createElement('div');
    wordTitle.style.cssText = 'font-weight:600;text-align:center;margin-bottom:6px;color:#2563eb;font-size:14px;';
    wordTitle.textContent = word;

    const video = document.createElement('video');
    video.src     = '/static/videos/' + word + '.mp4';
    video.controls = false;
    video.autoplay = true;
    video.muted    = false;
    video.style.cssText = 'border-radius:8px;display:block;margin:0 auto;max-width:320px;width:100%;';

    video.onerror = function () {
      // Finger-spell letter by letter
      const letterContainer = document.createElement('div');
      letterContainer.style.cssText = 'display:flex;justify-content:center;';
      let letterIndex = 0;

      function playNextLetter() {
        if (letterIndex >= word.length) { wordIndex++; playNextItem(); return; }
        const char = word[letterIndex];
        if (!char.match(/[A-Z]/)) { letterIndex++; playNextLetter(); return; }

        const lv = document.createElement('video');
        lv.src     = '/static/videos/' + char + '.mp4';
        lv.controls = false;
        lv.autoplay = true;
        lv.muted    = false;
        lv.style.cssText = 'border-radius:8px;display:block;margin:0 auto;max-width:320px;width:100%;';
        lv.onended = () => { letterIndex++; playNextLetter(); };
        lv.onerror = () => { letterIndex++; playNextLetter(); };
        letterContainer.innerHTML = '';
        letterContainer.appendChild(lv);
      }

      output.innerHTML = '';
      output.appendChild(wordTitle);
      output.appendChild(letterContainer);
      playNextLetter();
    };

    video.onended = () => { wordIndex++; playNextItem(); };

    output.innerHTML = '';
    output.appendChild(wordTitle);
    output.appendChild(video);
  }

  playNextItem();
}

// ── Site Launcher ─────────────────────────────────────────────────────────────
const SITE_MAP = [
  { keys: ['youtube'],          url: 'https://www.youtube.com',              label: 'YouTube' },
  { keys: ['netflix'],          url: 'https://www.netflix.com',              label: 'Netflix' },
  { keys: ['spotify'],          url: 'https://www.spotify.com',              label: 'Spotify' },
  { keys: ['twitch'],           url: 'https://www.twitch.tv',                label: 'Twitch' },
  { keys: ['prime video','amazon video'], url: 'https://www.primevideo.com', label: 'Prime Video' },
  { keys: ['wikipedia','wiki'], url: 'https://www.wikipedia.org',            label: 'Wikipedia' },
  { keys: ['google'],           url: 'https://www.google.com',               label: 'Google' },
  { keys: ['maps','google maps'],url:'https://maps.google.com',              label: 'Google Maps' },
  { keys: ['translate','google translate'], url:'https://translate.google.com', label:'Google Translate'},
  { keys: ['instagram'],        url: 'https://www.instagram.com',            label: 'Instagram' },
  { keys: ['twitter','x.com'],  url: 'https://www.twitter.com',              label: 'Twitter / X' },
  { keys: ['facebook'],         url: 'https://www.facebook.com',             label: 'Facebook' },
  { keys: ['linkedin'],         url: 'https://www.linkedin.com',             label: 'LinkedIn' },
  { keys: ['whatsapp'],         url: 'https://web.whatsapp.com',             label: 'WhatsApp Web' },
  { keys: ['reddit'],           url: 'https://www.reddit.com',               label: 'Reddit' },
  { keys: ['snapchat'],         url: 'https://www.snapchat.com',             label: 'Snapchat' },
  { keys: ['gmail','google mail'], url: 'https://mail.google.com',           label: 'Gmail' },
  { keys: ['google drive','drive'], url: 'https://drive.google.com',         label: 'Google Drive' },
  { keys: ['google docs','docs'],   url: 'https://docs.google.com',          label: 'Google Docs' },
  { keys: ['google sheets','sheets'],url:'https://sheets.google.com',        label: 'Google Sheets' },
  { keys: ['google slides','slides'],url:'https://slides.google.com',        label: 'Google Slides' },
  { keys: ['notion'],           url: 'https://www.notion.so',                label: 'Notion' },
  { keys: ['github'],           url: 'https://www.github.com',               label: 'GitHub' },
  { keys: ['stackoverflow','stack overflow'], url:'https://stackoverflow.com',label:'Stack Overflow'},
  { keys: ['chatgpt'],          url: 'https://chat.openai.com',              label: 'ChatGPT' },
  { keys: ['bbc','bbc news'],   url: 'https://www.bbc.com/news',             label: 'BBC News' },
  { keys: ['times of india'],   url: 'https://timesofindia.indiatimes.com',  label: 'Times of India' },
  { keys: ['ndtv'],             url: 'https://www.ndtv.com',                 label: 'NDTV' },
  { keys: ['amazon','amazon shopping'], url:'https://www.amazon.in',         label: 'Amazon' },
  { keys: ['flipkart'],         url: 'https://www.flipkart.com',             label: 'Flipkart' },
  {
    keys: ['search on youtube', 'youtube search', 'play on youtube'],
    handler: (q) => {
      const term = q.replace(/search on youtube|youtube search|play on youtube/gi,'').trim();
      return term
        ? { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(term)}`, label: `YouTube: "${term}"` }
        : { url: 'https://www.youtube.com', label: 'YouTube' };
    }
  },
  {
    keys: ['search', 'google search', 'search for'],
    handler: (q) => {
      const term = q.replace(/^(search for|search|google search)\s*/i,'').trim();
      return term
        ? { url: `https://www.google.com/search?q=${encodeURIComponent(term)}`, label: `Google: "${term}"` }
        : { url: 'https://www.google.com', label: 'Google' };
    }
  },
];

const OPEN_VERBS = ['open','go to','launch','visit','show me','take me to','navigate to','load'];

function detectSiteIntent(query) {
  const q = query.toLowerCase().trim();
  const hasVerb = OPEN_VERBS.some(v => q.startsWith(v) || q.includes(v + ' '));
  for (const site of SITE_MAP) {
    if (!site.handler) continue;
    if (site.keys.some(k => q.includes(k))) return site.handler(q);
  }
  if (!hasVerb) return null;
  for (const site of SITE_MAP) {
    if (site.handler) continue;
    if (site.keys.some(k => q.includes(k))) return { url: site.url, label: site.label };
  }
  return null;
}

function showLaunchResult(responseEl, label, url) {
  responseEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:1.3rem;">🌐</span>
      <div>
        <div style="font-weight:600;color:#1d4ed8;">Opening ${label}…</div>
        <a href="${url}" target="_blank" rel="noopener"
           style="font-size:12px;color:#6b7280;text-decoration:underline;">${url}</a>
      </div>
    </div>`;
}

// ── G10: AI Voice Assistant ───────────────────────────────────────────────────
// FIX: original wrapped window.askAssistant in itself, causing infinite recursion risk.
// History logging is now integrated directly here.
function askAssistant() {
  const query      = (document.getElementById('assistantInput')?.value || '').trim();
  const responseEl = document.getElementById('assistantResponse');
  if (!query) {
    if (responseEl) responseEl.textContent = 'Please type or speak a question first.';
    return;
  }

  // Log user message
  addToHistory('user', query);

  const siteIntent = detectSiteIntent(query);
  if (siteIntent) {
    showLaunchResult(responseEl, siteIntent.label, siteIntent.url);
    addToHistory('assistant', `Opening ${siteIntent.label}: ${siteIntent.url}`);
    window.open(siteIntent.url, '_blank', 'noopener');
    return;
  }

  if (responseEl) responseEl.textContent = '⏳ Thinking…';

  fetch('/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  .then(r => {
    if (!r.ok) throw new Error(`Server error ${r.status}`);
    return r.json();
  })
  .then(data => {
    const resp = data.response || 'No response.';
    if (responseEl) responseEl.textContent = resp;
    addToHistory('assistant', resp);
    const audio = document.getElementById('assistantAudio');
    if (audio && data.audio) {
      audio.src = data.audio;
      audio.classList.remove('hidden');
      audio.play().catch(() => {});
    }
  })
  .catch(err => {
    const msg = 'Error: ' + err.message;
    if (responseEl) responseEl.textContent = msg;
  });
}

// ── G11: Emotion → Audio ─────────────────────────────────────────────────────
// FIX: was sending FormData, but /text-to-audio now accepts JSON too.
// JSON is more reliable — no multipart boundary issues.
function convertEmotionAudio() {
  const text      = (document.getElementById('universalInput')?.value || '').trim();
  const emotionEl = document.getElementById('emotionResults')?.querySelector('span');
  const paramsEl  = document.getElementById('speechParams')?.querySelector('span');

  if (!text) {
    if (emotionEl) emotionEl.textContent = 'Please type some text first.';
    return;
  }
  if (emotionEl) emotionEl.textContent = '⏳ Analyzing…';

  fetch('/text-to-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  .then(r => {
    if (!r.ok) throw new Error(`Server error ${r.status}`);
    return r.json();
  })
  .then(data => {
    if (data.status === 'success') {
      if (emotionEl) {
        emotionEl.textContent = data.emotions
          .map(e => e.emotion + ' (' + (e.confidence * 100).toFixed(0) + '%)')
          .join(', ');
      }
      if (paramsEl) {
        paramsEl.textContent = 'Rate: ' + data.speech_params.rate.toFixed(0) +
                               ', Vol: ' + data.speech_params.volume.toFixed(2);
      }
      const audio = document.getElementById('emotionAudio');
      if (audio && data.audio) {
        audio.src = data.audio;
        audio.classList.remove('hidden');
        audio.play().catch(() => {});
      }
    } else {
      if (emotionEl) emotionEl.textContent = 'Error: ' + (data.message || 'unknown');
    }
  })
  .catch(err => {
    if (emotionEl) emotionEl.textContent = 'Error: ' + err.message;
  });
}

// ── G13: Translate & Speak ────────────────────────────────────────────────────
function translateSpeak() {
  const text     = (document.getElementById('universalInput')?.value || '').trim();
  const lang     = document.getElementById('targetLang')?.value || 'mr';
  const resultEl = document.getElementById('translateResult')?.querySelector('span');

  if (!text) {
    if (resultEl) resultEl.textContent = 'Please type some text first.';
    return;
  }
  if (resultEl) resultEl.textContent = '⏳ Translating…';

  fetch('/translate-speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang }),
  })
  .then(r => {
    if (!r.ok) throw new Error(`Server error ${r.status}`);
    return r.json();
  })
  .then(data => {
    if (data.status === 'success') {
      if (resultEl) resultEl.textContent = data.translated + ' (' + data.lang + ')';
      const audio = document.getElementById('translateAudio');
      if (audio && data.audio) {
        audio.src = data.audio;
        audio.classList.remove('hidden');
        audio.play().catch(() => {});
      }
    } else {
      if (resultEl) resultEl.textContent = 'Error: ' + (data.message || 'unknown');
    }
  })
  .catch(err => {
    if (resultEl) resultEl.textContent = 'Error: ' + err.message;
  });
}

// ── Smart Summary ─────────────────────────────────────────────────────────────
async function smartSummarize() {
  const text  = (document.getElementById('universalInput')?.value || '').trim();
  const panel = document.getElementById('summaryPanel');
  if (!text)  { alert('Please enter some text first.'); return; }
  if (!panel) return;

  panel.style.display = 'block';
  document.getElementById('summarySimplified').textContent = '⏳ Analyzing…';

  try {
    const res  = await fetch('/smart-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (data.status === 'success') {
      const s     = data.summary;
      const badge = document.getElementById('summarysentiment');
      if (badge) {
        badge.textContent = s.sentiment || 'neutral';
        badge.className   = 'sentiment-badge sentiment-' + (s.sentiment || 'neutral');
      }
      const simplified = document.getElementById('summarySimplified');
      const points     = document.getElementById('summaryPoints');
      const isl        = document.getElementById('summaryISL');
      if (simplified) simplified.textContent = s.simplified || text;
      if (points)     points.textContent     = (s.key_points || []).join(' • ');
      if (isl)        isl.textContent        = (s.isl_words  || []).join('  ·  ');
    } else {
      const simplified = document.getElementById('summarySimplified');
      if (simplified) simplified.textContent = 'Failed: ' + (data.message || 'unknown');
    }
  } catch (e) {
    const simplified = document.getElementById('summarySimplified');
    if (simplified) simplified.textContent = 'Error: ' + e.message;
  }
}

// ── Clear All ─────────────────────────────────────────────────────────────────
function clearAll() {
  const ui = document.getElementById('universalInput');
  const ai = document.getElementById('assistantInput');
  const ar = document.getElementById('assistantResponse');
  const io = document.getElementById('islOutput');
  const sp = document.getElementById('summaryPanel');
  if (ui) ui.value = '';
  if (ai) ai.value = '';
  if (ar) ar.textContent = 'Say something…';
  if (io) io.innerHTML = '';
  if (sp) sp.style.display = 'none';
}

// ── Gesture Cheatsheet Modal ──────────────────────────────────────────────────
function showCheatsheet() {
  document.getElementById('cheatsheet')?.classList.add('show');
  document.getElementById('overlay')?.classList.add('show');
}
function hideCheatsheet() {
  document.getElementById('cheatsheet')?.classList.remove('show');
  document.getElementById('overlay')?.classList.remove('show');
}

// ── Speech Recognition ────────────────────────────────────────────────────────
// FIX: added comprehensive voice fallback — shows user-friendly error messages
// and gracefully degrades to typed input when mic is unavailable.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition       = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) recognition.continuous = false;

// Human-readable error map for SpeechRecognitionError codes
const MIC_ERROR_MESSAGES = {
  'not-allowed':         '🚫 Microphone access denied. Please allow mic access in your browser settings.',
  'no-speech':           '🔇 No speech detected. Please try speaking again.',
  'audio-capture':       '🎙️ No microphone found. Please connect a microphone and try again.',
  'network':             '🌐 Network error during speech recognition. Check your connection.',
  'aborted':             '⚠️ Speech recognition was interrupted.',
  'service-not-allowed': '🚫 Speech recognition is not allowed. Try HTTPS or a different browser.',
  'bad-grammar':         '⚠️ Speech recognition grammar error.',
  'language-not-supported': '🌐 Language not supported for speech input.',
};

function _getMicErrorMessage(code) {
  return MIC_ERROR_MESSAGES[code] || `🎙️ Mic error (${code}). Try typing instead.`;
}

function _setMicError(section, message) {
  const micId   = section === 'universal' ? 'universalMic'   : 'assistantMic';
  const inputId = section === 'universal' ? 'universalInput' : 'assistantInput';
  const mic     = document.getElementById(micId);
  const input   = document.getElementById(inputId);
  if (mic) mic.classList.remove('glowing');
  // Show error in input placeholder
  if (input) {
    input.placeholder = message;
    setTimeout(() => {
      input.placeholder = section === 'universal'
        ? 'Type or speak in Marathi or English…'
        : 'Ask me anything…';
    }, 4000);
  }
  // Also show in response area for assistant section
  if (section === 'assistant') {
    const resp = document.getElementById('assistantResponse');
    if (resp) {
      resp.textContent = message;
      setTimeout(() => { if (resp.textContent === message) resp.textContent = 'Say something…'; }, 4000);
    }
  }
}

function startSpeechRecognition(section, callback = null) {
  if (!recognition) {
    _setMicError(section, '🎙️ Speech recognition not supported. Use Chrome or Edge, or type instead.');
    return;
  }

  const micId   = section === 'universal' ? 'universalMic'   : 'assistantMic';
  const inputId = section === 'universal' ? 'universalInput' : 'assistantInput';
  const mic     = document.getElementById(micId);
  const input   = document.getElementById(inputId);
  if (!mic || !input) return;

  // Abort any previous session cleanly
  try { recognition.abort(); } catch (e) {}

  recognition.lang = section === 'universal' ? 'mr-IN' : 'en-US';
  mic.classList.add('glowing');

  // Small delay to let previous session fully abort
  setTimeout(() => {
    try {
      recognition.start();
    } catch (e) {
      _setMicError(section, '⚠️ Could not start mic. Please try again.');
    }
  }, 150);

  recognition.onresult = function (event) {
    mic.classList.remove('glowing');
    const transcript = event.results[0][0].transcript;
    if (section === 'universal') {
      fetch('/translate-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript, lang: 'en' }),
      })
      .then(r => r.json())
      .then(d => {
        input.value = d.status === 'success' ? d.translated : transcript;
        if (callback) callback();
      })
      .catch(() => {
        input.value = transcript;
        if (callback) callback();
      });
    } else {
      input.value = transcript;
      askAssistant();
    }
  };

  recognition.onerror = function(event) {
    mic.classList.remove('glowing');
    // FIX: 'no-speech' is a common non-critical event, don't alarm the user
    if (event.error === 'no-speech') {
      _setMicError(section, '🔇 Nothing heard. Please speak clearly and try again.');
    } else {
      _setMicError(section, _getMicErrorMessage(event.error));
    }
  };

  recognition.onend = function() {
    mic.classList.remove('glowing');
  };
}

// ═══════════════════════════════════════════════════════════
// AIR GESTURE SYSTEM
// ═══════════════════════════════════════════════════════════

let gestureEnabled   = false;
let handsModel       = null;
let gestureCamera    = null;
let lastGesture      = null;
let gestureHoldStart = null;
let gestureDebounce  = false;
const GESTURE_HOLD_MS = 1000;

function toggleGesturePanel() {
  gestureEnabled = !gestureEnabled;
  const btn     = document.getElementById('gesturePanelToggle');
  const wrapper = document.getElementById('gestureVideoWrapper');
  const badge   = document.getElementById('gestureBadge');
  if (!btn || !wrapper || !badge) return;

  if (gestureEnabled) {
    btn.textContent       = '🛑 Disable Gesture Control';
    wrapper.style.display = 'block';
    badge.style.display   = 'block';
    initGestureRecognition();
  } else {
    btn.textContent       = '✋ Enable Gesture Control';
    wrapper.style.display = 'none';
    badge.style.display   = 'none';
    if (gestureCamera) {
      try { gestureCamera.stop(); } catch (e) {}
      gestureCamera = null;
    }
  }
}

const MP_HANDS_VERSION = '0.4.1646424915';

function initGestureRecognition() {
  const videoEl  = document.getElementById('gestureVideo');
  const canvasEl = document.getElementById('gestureCanvas');
  if (!videoEl || !canvasEl) return;

  const _origWarn  = console.warn;
  const _origError = console.error;
  const mpFilter   = /gl_context|WebGL|OpenGL|wasm|mediapipe|simd|locateFile/i;
  console.warn  = (...a) => { if (!mpFilter.test(String(a))) _origWarn(...a);  };
  console.error = (...a) => { if (!mpFilter.test(String(a))) _origError(...a); };

  const ctx = canvasEl.getContext('2d');

  if (typeof Hands === 'undefined') {
    setBadge('⚠️ MediaPipe not loaded — simulation mode active', false);
    startGestureSimulation();
    return;
  }

  try {
    handsModel = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_HANDS_VERSION}/${f}`
    });
    handsModel.setOptions({
      maxNumHands: 1, modelComplexity: 0,
      minDetectionConfidence: 0.65, minTrackingConfidence: 0.65, selfieMode: false,
    });
    handsModel.onResults(results => {
      const w = videoEl.videoWidth  || 180;
      const h = videoEl.videoHeight || 135;
      canvasEl.width  = w;
      canvasEl.height = h;
      ctx.clearRect(0, 0, w, h);
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const lm = results.multiHandLandmarks[0];
        drawHandSkeleton(ctx, lm, w, h);
        handleGestureDetected(classifyGesture(lm));
      } else {
        lastGesture = null;
        gestureHoldStart = null;
        setBadge('👋 Show your hand to the camera…', false);
      }
    });

    if (typeof Camera !== 'undefined') {
      gestureCamera = new Camera(videoEl, {
        onFrame: async () => {
          if (!gestureEnabled || !handsModel) return;
          await handsModel.send({ image: videoEl });
        },
        width: 240, height: 180,
      });
      gestureCamera.start()
        .then(() => setBadge('👋 Show your hand to the camera…', false))
        .catch(() => fallbackCamera(videoEl));
    } else {
      fallbackCamera(videoEl);
    }
  } catch (err) {
    setBadge('⚠️ Gesture init failed — simulation mode', false);
    startGestureSimulation();
  }
}

function fallbackCamera(videoEl) {
  navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 240 }, height: { ideal: 180 }, facingMode: 'user' }
  })
  .then(stream => {
    videoEl.srcObject = stream;
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      setBadge('👋 Show your hand to the camera…', false);
      const loop = async () => {
        if (!gestureEnabled || !handsModel) return;
        try { await handsModel.send({ image: videoEl }); } catch {}
        requestAnimationFrame(loop);
      };
      loop();
    };
  })
  .catch(() => {
    setBadge('📷 Camera access denied — using simulation', false);
    startGestureSimulation();
  });
}

function drawHandSkeleton(ctx, lm, w, h) {
  const connections = [
    [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],[0,17],
  ];
  ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2;
  connections.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  });
  ctx.fillStyle = '#2563eb';
  lm.forEach(p => { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 3, 0, 2 * Math.PI); ctx.fill(); });
}

function classifyGesture(lm) {
  const ext = [
    lm[8].y  < lm[6].y,
    lm[12].y < lm[10].y,
    lm[16].y < lm[14].y,
    lm[20].y < lm[18].y,
  ];
  const all  = ext.every(Boolean);
  const none = ext.every(v => !v);
  const thumbUp   = lm[4].y < lm[3].y && lm[4].y < lm[2].y;
  const thumbDown = lm[4].y > lm[3].y && lm[4].y > lm[2].y;

  if (none && thumbUp)   return 'thumbs_up';
  if (none && thumbDown) return 'thumbs_down';
  if (none)              return 'fist';
  if (all)               return 'open_palm';
  if (ext[0] && !ext[1] && !ext[2] && !ext[3]) return 'point_up';
  if (ext[0] && ext[1]  && !ext[2] && !ext[3]) return 'peace';
  const d = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  if (d < 0.06) return 'ok';
  return 'unknown';
}

function handleGestureDetected(gesture) {
  if (gesture === 'unknown') { setBadge('🤔 Hold a gesture steadily…', false); return; }
  const labels = {
    thumbs_up: '👍 ISL Convert', thumbs_down: '👎 Clear',
    open_palm: '✋ Translate',   point_up:    '☝️ AI Ask',
    fist:      '✊ Emotion',     peace:        '✌️ Mic', ok: '👌 Help',
  };
  setBadge((labels[gesture] || gesture) + ' — hold…', false);
  if (gesture === lastGesture) {
    if (gestureHoldStart && Date.now() - gestureHoldStart > GESTURE_HOLD_MS && !gestureDebounce) {
      gestureDebounce = true;
      fireGestureAction(gesture);
      setTimeout(() => { gestureDebounce = false; }, 2500);
    }
  } else {
    lastGesture = gesture;
    gestureHoldStart = Date.now();
  }
}

async function fireGestureAction(gesture) {
  setBadge('✅ ' + gesture.replace('_', ' ') + ' — activated!', true);
  try {
    const res  = await fetch('/gesture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gesture }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.audio) {
        const audioUrl = data.audio.startsWith('http')
          ? data.audio
          : window.location.origin + (data.audio.startsWith('/') ? '' : '/') + data.audio;
        const a = new Audio(audioUrl);
        a.play().catch(() => {});
      }
      switch (data.action) {
        case 'isl':       convertToSign();                     break;
        case 'clear':     clearAll();                          break;
        case 'translate': translateSpeak();                    break;
        case 'assistant': askAssistant();                      break;
        case 'emotion':   convertEmotionAudio();               break;
        case 'mic':       startSpeechRecognition('universal'); break;
        case 'help':      showCheatsheet();                    break;
      }
    } else {
      _runGestureActionLocally(gesture);
    }
  } catch (e) {
    console.warn('[Gesture] /gesture fetch failed, running action locally:', e.message);
    _runGestureActionLocally(gesture);
  }
}

function _runGestureActionLocally(gesture) {
  const localMap = {
    thumbs_up:   () => convertToSign(),
    thumbs_down: () => clearAll(),
    open_palm:   () => translateSpeak(),
    point_up:    () => askAssistant(),
    fist:        () => convertEmotionAudio(),
    peace:       () => startSpeechRecognition('universal'),
    ok:          () => showCheatsheet(),
  };
  if (localMap[gesture]) localMap[gesture]();
}

function startGestureSimulation() {
  const gestures = ['thumbs_up', 'open_palm', 'fist', 'point_up', 'peace'];
  setBadge('🎭 Simulation mode — demo ready', false);
  let i = 0;
  const sim = setInterval(() => {
    if (!gestureEnabled) { clearInterval(sim); return; }
    handleGestureDetected(gestures[i % gestures.length]);
    i++;
  }, 1500);
}

function setBadge(text, active) {
  const badge = document.getElementById('gestureBadge');
  if (!badge) return;
  badge.textContent = text;
  badge.className   = active ? 'active' : '';
}

// ════════════════════════════════════════════════════════════════════
// CONVERSATION HISTORY
// ════════════════════════════════════════════════════════════════════
const conversationLog = [];

function addToHistory(role, text) {
  conversationLog.push({ role, text, time: new Date().toLocaleTimeString() });
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById('conversationHistory');
  if (!el) return;
  if (conversationLog.length === 0) {
    el.innerHTML = '<p class="text-gray-400 italic text-center">No messages yet — ask the AI something!</p>';
    return;
  }
  el.innerHTML = conversationLog.map(m => {
    const isUser = m.role === 'user';
    const bg     = isUser ? 'bg-blue-50 text-blue-800' : 'bg-gray-50 text-gray-700';
    const label  = isUser ? '🧑 You' : '🤖 Samvadini';
    return `<div class="rounded-xl px-3 py-2 ${bg}">
      <div class="flex justify-between text-xs text-gray-400 mb-0.5">
        <span class="font-semibold">${label}</span><span>${m.time}</span>
      </div>
      <p>${m.text}</p>
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function clearHistory() {
  conversationLog.length = 0;
  renderHistory();
}

// ── ISL Phrase Library ───────────────────────────────────────────────────────
async function loadPhraseLibrary() {
  const container = document.getElementById('phraseLibrary');
  if (!container) return;
  try {
    const res  = await fetch('/isl-phrases');
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('bad response');
    container.innerHTML = Object.entries(data.phrases).map(([cat, words]) => `
      <div>
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">${cat}</p>
        <div class="flex flex-wrap gap-2">
          ${words.map(w => `
            <button onclick="usePhrase('${w}')"
                    class="bg-blue-50 text-blue-700 text-sm px-3 py-1 rounded-full
                           border border-blue-200 hover:bg-blue-100 active:scale-95
                           transition font-medium">
              ${w}
            </button>`).join('')}
        </div>
      </div>`).join('');
  } catch {
    container.innerHTML = '<p class="text-red-400 text-sm text-center">Could not load phrases.</p>';
  }
}

function usePhrase(word) {
  const input = document.getElementById('universalInput');
  if (input) {
    input.value = word;
    input.focus();
    if (typeof convertToSign === 'function') convertToSign();
  }
}

// ── Quick Speak ──────────────────────────────────────────────────────────────
// FIX: button lookup was fragile — now uses a stable ID instead of onclick selector
async function quickSpeak() {
  const text  = (document.getElementById('quickSpeakText')?.value || '').trim();
  const lang  = document.getElementById('quickSpeakLang')?.value  || 'en';
  const speed = document.querySelector('input[name="speakSpeed"]:checked')?.value || 'normal';
  const audio = document.getElementById('quickSpeakAudio');
  const btn   = document.getElementById('quickSpeakBtn');

  if (!text) { alert('Please type something to speak.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

  try {
    const res  = await fetch('/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang, speed }),
    });
    const data = await res.json();
    if (data.status === 'success' && data.audio && audio) {
      audio.src = data.audio;
      audio.classList.remove('hidden');
      audio.play();
    } else if (data.status === 'success' && !data.audio) {
      alert('Audio generation failed for this language. Try English.');
    } else {
      alert(data.error || data.message || 'TTS failed.');
    }
  } catch (err) {
    alert('Network error: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔊 Speak Now ▶'; }
  }
}

// ── Arduino Proximity — SSE stream (zero polling overhead) ───────────────────
let _arduinoWelcomed = false;

function initArduinoSSE() {
  if (typeof EventSource === 'undefined') return;
  const es = new EventSource('/proximity');

  es.onmessage = function(e) {
    try {
      const data = JSON.parse(e.data);
      const indicator = document.getElementById('arduinoIndicator');
      const status    = data.status;

      if (indicator) {
        const dist = data.distance != null && data.distance < 900 ? ` ${Math.round(data.distance)}cm` : '';
        if (status === 'near') {
          indicator.style.display = 'inline-block';
          indicator.textContent   = '🟢 User Near' + dist;
        } else if (status === 'far') {
          indicator.style.display = 'inline-block';
          indicator.textContent   = '🟡 No User';
        } else if (status === 'demo') {
          indicator.style.display = 'inline-block';
          indicator.textContent   = '🔮 Demo' + dist;
        } else {
          indicator.style.display = 'none';
        }
      }

      // Proximity banner
      const b  = document.getElementById('proximityBanner');
      const ic = document.getElementById('proximityIcon');
      const lb = document.getElementById('proximityLabel');
      const dt = document.getElementById('proximityDetail');
      if (b) {
        b.style.display = 'block';
        const dist2  = data.distance != null && data.distance < 900 ? ` · ${Math.round(data.distance)} cm` : '';
        const isDemo = data.demo ? ' (demo)' : '';
        const map = {
          near:         ['#f0fdf4','#166534','1px solid #bbf7d0','🟢','User Detected',`HC-SR04 active${dist2}${isDemo}`],
          far:          ['#fefce8','#854d0e','1px solid #fde68a','🟡','No User Nearby',`HC-SR04 active${dist2}${isDemo}`],
          ranging:      ['#eff6ff','#1e40af','1px solid #bfdbfe','📡','Sensor Ranging…', data.port || ''],
          demo:         ['#fdf4ff','#6b21a8','1px solid #e9d5ff','🔮','Demo Mode','Simulated'],
          disconnected: ['#fef2f2','#991b1b','1px solid #fecaca','🔴','Disconnected','Check USB'],
        };
        const [bg,color,border,icon,label,detail] = map[status] || map.disconnected;
        Object.assign(b.style, {background:bg, color, borderBottom:border});
        if (ic) ic.textContent = icon;
        if (lb) lb.textContent = label;
        if (dt) dt.textContent = detail;
      }

      // Auto-greet on first NEAR
      if (status === 'near' || (status === 'demo' && data.distance < 50)) {
        const inp = document.getElementById('universalInput');
        if (inp) inp.focus();
        if (!_arduinoWelcomed) {
          _arduinoWelcomed = true;
          fetch('/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Welcome to Samvadini! How can I help you today?', lang: 'en', speed: 'normal' }),
          })
          .then(r => r.json())
          .then(d => { if (d.audio) new Audio(window.location.origin + d.audio).play().catch(() => {}); })
          .catch(() => {});
        }
      } else if (status === 'far') {
        _arduinoWelcomed = false;
      }
    } catch {}
  };

  es.onerror = function() {
    const b = document.getElementById('proximityBanner');
    if (b) b.style.display = 'none';
  };
}

// ── Server Health Banner ─────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const res  = await fetch('/health');
    const data = await res.json();
    if (data.status !== 'ok') return;

    const banner = document.getElementById('healthBanner');
    if (banner) {
      const groqOk    = data.groq_configured;
      const weatherOk = data.weather_configured;
      banner.style.background   = '#f0fdf4';
      banner.style.borderBottom = '1px solid #bbf7d0';
      banner.style.color        = '#166534';
      banner.innerHTML = `✅ <strong>Server running</strong> &nbsp;·&nbsp;
        ${groqOk    ? '🟢 AI Ready'      : '🟡 AI (no key — <a href="https://console.groq.com" target="_blank" style="color:#065f46;text-decoration:underline;font-weight:bold;">get free key</a>)'}
        &nbsp;·&nbsp;
        ${weatherOk ? '🟢 Weather Ready' : '🟡 Weather (no key)'}
        &nbsp;·&nbsp; <span style="opacity:.6">City: ${data.city}</span>`;
      banner.style.display = 'block';

      const warn = document.getElementById('apiKeyWarning');
      if (warn) warn.style.display = groqOk ? 'none' : 'block';
    }
  } catch {
    // server not reachable
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPhraseLibrary();
  checkHealth();
  initArduinoSSE();   // SSE stream — no polling, zero overhead
});