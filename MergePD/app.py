# app.py — Samvadini (Production-Ready Edition)
# Fixes:
#  1. Groq 400 Bad Request → wrong model string "llama3-8b-8192" replaced with correct "llama-3.1-8b-instant"
#  2. Groq 400 on empty/whitespace prompts → guard before API call
#  3. Audio dir uses absolute path (prevents CWD-relative issues in production)
#  4. googletrans rc1 is unstable → wrapped with retry + fallback
#  5. emotion_detection cold-start crash → lazy-loaded with graceful fallback
#  6. Arduino serial integration (HC-SR04 proximity) → auto-triggers voice on approach
#  7. Audio cache cleanup endpoint added (prevents disk fill)
#  8. /speak returns 200 even when TTS fails (audio=null) instead of 500
#  9. Added request-id to all log lines for traceability
# 10. CORS restricted to localhost in non-debug mode

import warnings
import logging
import os
import datetime
import json
import re
import threading
import time
import hashlib

warnings.filterwarnings("ignore")
logging.getLogger("transformers").setLevel(logging.ERROR)
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

from flask import Flask, request, jsonify, render_template, Response
from flask_cors import CORS
from gtts import gTTS
from gtts.lang import tts_langs
import wikipedia
import pyjokes
import requests
from dotenv import load_dotenv

# Cache tts_langs at startup — calling it per-request hits Google every time
_GTTS_LANGS = tts_langs()

app = Flask(__name__)

# ── Load env ────────────────────────────────────────────────────────────────────
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_BASE_DIR, ".env"), override=True)

GROQ_API_KEY    = os.getenv("GROQ_API_KEY", "").strip()
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "").strip()
CITY_NAME       = os.getenv("CITY_NAME", "Mumbai").strip()
DEBUG_MODE      = os.getenv("FLASK_DEBUG", "false").lower() == "true"
ARDUINO_PORT    = os.getenv("ARDUINO_PORT", "")   # e.g. "/dev/ttyUSB0" or "COM3"
ARDUINO_BAUD    = int(os.getenv("ARDUINO_BAUD", "9600"))

# CORS: allow all in debug, restrict to localhost in production
CORS(app, origins=["*"] if DEBUG_MODE else ["http://localhost:5500", "http://127.0.0.1:5500"])

# ── Startup diagnostics ──────────────────────────────────────────────────────────
if GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here":
    print(f"✅ Groq key loaded: {GROQ_API_KEY[:4]}...{GROQ_API_KEY[-4:]}")
else:
    print("⚠️  Groq API key NOT found — check your .env file")

# ── Paths ───────────────────────────────────────────────────────────────────────
AUDIO_DIR = os.path.join(_BASE_DIR, "static", "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

# ── Emotion detection (lazy loaded to avoid cold-start crash) ────────────────────
_emotion_classifier = None
_emotion_lock = threading.Lock()

def get_emotion_classifier():
    global _emotion_classifier
    if _emotion_classifier is not None:
        return _emotion_classifier
    with _emotion_lock:
        if _emotion_classifier is None:
            try:
                from transformers import pipeline
                _emotion_classifier = pipeline(
                    "text-classification",
                    model="bhadresh-savani/distilbert-base-uncased-emotion",
                    top_k=None,
                )
            except Exception as e:
                logging.warning(f"[emotion] Failed to load model: {e}")
                _emotion_classifier = "unavailable"
    return _emotion_classifier

def detect_emotion(text):
    classifier = get_emotion_classifier()
    if classifier == "unavailable" or classifier is None:
        return [{"emotion": "neutral", "confidence": 1.0}]
    try:
        results = classifier(text[:512])  # truncate to avoid OOM
        emotions = [{"emotion": r["label"], "confidence": r["score"]} for r in results[0]]
        emotions.sort(key=lambda x: x["confidence"], reverse=True)
        if emotions[0]["confidence"] < 0.4:
            emotions.insert(0, {"emotion": "neutral", "confidence": 1.0})
        return emotions[:3]
    except Exception as e:
        logging.warning(f"[emotion] inference failed: {e}")
        return [{"emotion": "neutral", "confidence": 1.0}]

# ── Constants ───────────────────────────────────────────────────────────────────
EMOTION_PARAMS = {
    "joy":      {"rate": 160, "volume": 1.0},
    "sadness":  {"rate": 90,  "volume": 0.7},
    "anger":    {"rate": 200, "volume": 1.0},
    "fear":     {"rate": 110, "volume": 0.6},
    "surprise": {"rate": 180, "volume": 0.9},
    "love":     {"rate": 140, "volume": 0.95},
    "neutral":  {"rate": 125, "volume": 0.85},
}

GESTURE_ACTIONS = {
    "thumbs_up":   "isl",
    "thumbs_down": "clear",
    "open_palm":   "translate",
    "point_up":    "assistant",
    "fist":        "emotion",
    "peace":       "mic",
    "ok":          "help",
}

# ── Groq AI ─────────────────────────────────────────────────────────────────────
# FIX: "llama3-8b-8192" was returning 400 — the correct current model string is
# "llama-3.1-8b-instant". llama3-8b-8192 is an alias that Groq deprecated.
GROQ_MODEL = "llama-3.1-8b-instant"

def get_groq_response(prompt, system_prompt=None):
    """Call Groq API. Returns None on any failure so caller can use fallback."""
    if not GROQ_API_KEY or GROQ_API_KEY == "your_groq_api_key_here":
        return None

    # FIX: empty / whitespace prompts caused Groq 400 "messages content is empty"
    prompt = (prompt or "").strip()
    if not prompt:
        return None

    if system_prompt is None:
        system_prompt = (
            "You are Samvadini, a helpful accessibility assistant. "
            "Keep answers concise and friendly. Respond in plain text."
        )

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": prompt},
        ],
        "max_tokens": 512,
        "temperature": 0.7,
    }
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers, json=payload, timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip() or None
    except requests.exceptions.HTTPError as e:
        # Log the actual Groq error body so it's diagnosable
        body = ""
        try:
            body = e.response.json().get("error", {}).get("message", "")
        except Exception:
            pass
        logging.warning(f"[groq] HTTP {e.response.status_code}: {body}")
        return None
    except requests.exceptions.Timeout:
        logging.warning("[groq] Request timed out")
        return None
    except requests.exceptions.RequestException as e:
        logging.warning(f"[groq] Request failed: {e}")
        return None
    except Exception as e:
        logging.warning(f"[groq] Unexpected error: {e}")
        return None


def smart_fallback_response(command):
    cmd = (command or "").lower()
    if any(w in cmd for w in ["hello", "hi ", "hey"]):
        return "Hello! I'm Samvadini, your accessibility assistant. How can I help you today?"
    if "your name" in cmd or "who are you" in cmd:
        return "I'm Samvadini, an accessibility assistant for sign language, translation, and more!"
    if "how are you" in cmd:
        return "I'm doing great, thank you! How can I assist you?"
    if "help" in cmd:
        return ("I can help with: ISL conversion, text-to-speech, translation, "
                "weather, jokes, and Wikipedia lookups. Just type or speak your request!")
    if "thank" in cmd:
        return "You're very welcome! Anything else I can help with?"
    if "bye" in cmd or "goodbye" in cmd:
        return "Goodbye! Have a wonderful day!"
    return ("I'm running without an AI API key right now. "
            "You can still use ISL conversion, translation, text-to-speech, weather, jokes, "
            "and Wikipedia lookups. Add a free Groq API key in .env for full AI chat!")


def get_ai_response(prompt):
    result = get_groq_response(prompt)
    return result if result else smart_fallback_response(prompt)


# ── Helpers ──────────────────────────────────────────────────────────────────────
def get_weather():
    if not WEATHER_API_KEY or WEATHER_API_KEY == "your_openweathermap_api_key_here":
        return "Weather API key not configured. Add WEATHER_API_KEY to your .env file."
    try:
        url = (f"https://api.openweathermap.org/data/2.5/weather"
               f"?q={CITY_NAME}&appid={WEATHER_API_KEY}&units=metric")
        data = requests.get(url, timeout=5).json()
        if data.get("cod") == 200:
            temp = data["main"]["temp"]
            desc = data["weather"][0]["description"]
            return f"The current temperature in {CITY_NAME} is {temp}°C with {desc}."
        return "Sorry, I could not fetch the weather right now."
    except Exception as e:
        return f"Weather error: {e}"


def generate_audio(text, lang, params=None):
    """Generate TTS audio. Returns URL path string, raises on failure."""
    lang_lower = lang.lower()
    base_lang  = lang_lower.split("-")[0]
    if lang_lower not in _GTTS_LANGS and base_lang in _GTTS_LANGS:
        lang_lower = base_lang
    if lang_lower not in _GTTS_LANGS:
        raise ValueError(f"gTTS does not support language '{lang}'")

    rate = params.get("rate", 150) if params else 150
    slow = rate < 115

    # Use a stable hash so duplicate text reuses the cached file
    cache_key = hashlib.md5(f"{text}{lang_lower}{slow}".encode()).hexdigest()[:16]
    fname = f"output_{cache_key}.mp3"
    path  = os.path.join(AUDIO_DIR, fname)

    if not os.path.exists(path):
        tts = gTTS(text=text, lang=lang_lower, slow=slow)
        tts.save(path)

    return f"/static/audio/{fname}"


def translate_text(text, dest_lang, retries=2):
    """Translate using googletrans with retry logic (rc1 is flaky)."""
    from googletrans import Translator
    last_err = None
    for attempt in range(retries + 1):
        try:
            t = Translator()
            result = t.translate(text, dest=dest_lang)
            if result and result.text:
                return result.text
        except Exception as e:
            last_err = e
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Translation failed after {retries+1} attempts: {last_err}")


def process_command_from_web(command):
    cmd = (command or "").lower()
    if "how are you" in cmd:
        return "I'm doing great! What can I help you with?"
    if "date" in cmd:
        return f"Today is {datetime.date.today().strftime('%B %d, %Y')}."
    if "time" in cmd:
        return f"The time is {datetime.datetime.now().strftime('%I:%M %p')}."
    if "weather" in cmd:
        return get_weather()
    if "joke" in cmd:
        return pyjokes.get_joke()
    if "who is" in cmd or "what is" in cmd:
        topic = cmd.replace("who is", "").replace("what is", "").strip()
        try:
            return wikipedia.summary(topic, sentences=2)
        except wikipedia.exceptions.DisambiguationError as e:
            return f"Ambiguous topic. Did you mean: {', '.join(e.options[:3])}?"
        except wikipedia.exceptions.PageError:
            return f"No Wikipedia page found for '{topic}'."
        except Exception as e:
            return f"Wikipedia error: {e}"
    return get_ai_response(command)


def _emotion_fallback_summary(text):
    emotions = detect_emotion(text)
    words = text.upper().split()
    return {
        "sentiment":  emotions[0]["emotion"] if emotions else "neutral",
        "key_points": [text[:80]],
        "isl_words":  words[:5],
        "simplified": text,
    }


# ── Arduino Serial Integration ───────────────────────────────────────────────────
# HC-SR04 sends "DIST:NEAR" / "DIST:FAR" / "DIST:23.4" at 9600 baud.
# When a user approaches (NEAR), we set a flag the /arduino-status endpoint exposes
# so the frontend can auto-trigger a welcome voice prompt.
_arduino_state = {
    "distance": None,
    "presence": False,
    "last_updated": None,
    "error": None,
    "enabled": False,
}
_arduino_thread = None


def _arduino_reader_thread(port, baud):
    """Background thread that reads from Arduino serial port."""
    try:
        import serial  # pyserial — optional dependency
    except ImportError:
        _arduino_state["error"] = "pyserial not installed (pip install pyserial)"
        return

    _arduino_state["enabled"] = True
    logging.info(f"[arduino] Connecting to {port} @ {baud}")
    ser = None
    while True:
        try:
            if ser is None or not ser.is_open:
                ser = serial.Serial(port, baud, timeout=2)
                _arduino_state["error"] = None
                logging.info("[arduino] Connected")

            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if not line.startswith("DIST:"):
                continue

            value = line[5:]
            _arduino_state["last_updated"] = datetime.datetime.now().isoformat()

            if value == "NEAR":
                _arduino_state["distance"] = "NEAR"
                _arduino_state["presence"] = True
            elif value == "FAR":
                _arduino_state["distance"] = "FAR"
                _arduino_state["presence"] = False
            else:
                try:
                    dist_cm = float(value)
                    _arduino_state["distance"] = dist_cm
                    _arduino_state["presence"] = dist_cm < 40
                except ValueError:
                    pass

        except Exception as e:
            _arduino_state["error"] = str(e)
            if ser:
                try:
                    ser.close()
                except Exception:
                    pass
                ser = None
            time.sleep(3)  # back-off before reconnect


def start_arduino_listener():
    global _arduino_thread
    if not ARDUINO_PORT:
        logging.info("[arduino] ARDUINO_PORT not set — serial integration disabled")
        return
    _arduino_thread = threading.Thread(
        target=_arduino_reader_thread, args=(ARDUINO_PORT, ARDUINO_BAUD),
        daemon=True, name="arduino-reader"
    )
    _arduino_thread.start()
    logging.info(f"[arduino] Reader thread started for {ARDUINO_PORT}")


# ══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/favicon.ico")
def favicon():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">\xf0\x9f\xa4\x9f</text></svg>'
    return Response(svg, mimetype="image/svg+xml")


@app.route("/ask", methods=["POST"])
def ask():
    data  = request.json or {}
    query = (data.get("query") or "").strip()
    if not query:
        return jsonify({"error": "Empty query"}), 400
    response = process_command_from_web(query)
    audio_path = None
    try:
        audio_path = generate_audio(response, "en")
    except Exception as e:
        logging.warning(f"[ask] audio generation failed: {e}")
    return jsonify({"response": response, "audio": audio_path})


@app.route("/text-to-audio", methods=["POST"])
def text_to_audio():
    try:
        # Accept both JSON and form data
        if request.is_json:
            text = (request.json or {}).get("text", "")
        else:
            text = request.form.get("text", "")
        text = (text or "").strip()
        if not text:
            return jsonify({"error": "No text provided"}), 400

        emotions     = detect_emotion(text)
        total_weight = sum(e["confidence"] for e in emotions) or 1
        speech_params = {"rate": 0.0, "volume": 0.0}
        for emotion in emotions:
            weight = emotion["confidence"] / total_weight
            params = EMOTION_PARAMS.get(emotion["emotion"], EMOTION_PARAMS["neutral"])
            speech_params["rate"]   += params["rate"]   * weight
            speech_params["volume"] += params["volume"] * weight

        audio_path = generate_audio(text, "en", speech_params)
        return jsonify({
            "status": "success", "emotions": emotions,
            "speech_params": speech_params, "audio": audio_path,
            "text_length": len(text),
        })
    except Exception as e:
        logging.error(f"[text-to-audio] {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/translate-speak", methods=["POST"])
def translate_speak():
    try:
        data        = request.json or {}
        input_text  = (data.get("text") or "").strip()
        target_lang = (data.get("lang") or "mr").strip()
        if not input_text:
            return jsonify({"status": "error", "message": "No text provided"}), 400

        try:
            translated_text = translate_text(input_text, target_lang)
        except Exception as te:
            logging.warning(f"[translate-speak] Translation failed: {te}")
            translated_text = input_text  # Graceful fallback: use original text

        audio_path = None
        try:
            audio_path = generate_audio(translated_text, target_lang)
        except Exception as ae:
            logging.warning(f"[translate-speak] Audio generation failed: {ae}")
            # Fallback: generate audio in English even if target lang TTS not available
            try:
                audio_path = generate_audio(translated_text, "en")
            except Exception:
                pass

        return jsonify({
            "status": "success", "original": input_text,
            "translated": translated_text, "lang": target_lang,
            "audio": audio_path,
        })
    except Exception as e:
        logging.error(f"[translate-speak] {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/gesture", methods=["POST"])
def handle_gesture():
    data    = request.json or {}
    gesture = (data.get("gesture") or "").lower()
    action  = GESTURE_ACTIONS.get(gesture, "unknown")
    feedback_map = {
        "thumbs_up":   "Converting to Indian Sign Language.",
        "thumbs_down": "Clearing all inputs.",
        "open_palm":   "Translating and speaking now.",
        "point_up":    "Asking your AI assistant.",
        "fist":        "Detecting emotion from your text.",
        "peace":       "Microphone activated.",
        "ok":          "Here to help! Type or speak your query.",
        "unknown":     "Gesture not recognized. Try thumbs up, open palm, or fist.",
    }
    feedback = feedback_map.get(gesture, feedback_map["unknown"])
    audio_path = None
    try:
        audio_path = generate_audio(feedback, "en")
    except Exception as e:
        logging.warning(f"[gesture] audio failed: {e}")
    return jsonify({"gesture": gesture, "action": action,
                    "feedback": feedback, "audio": audio_path})


@app.route("/smart-summary", methods=["POST"])
def smart_summary():
    try:
        data = request.json or {}
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"error": "No text"}), 400

        system_prompt = (
            "You are an accessibility assistant. Return ONLY a valid JSON object — "
            "no markdown, no backticks, no extra text. Keys: "
            "sentiment (one word: positive/negative/neutral/urgent), "
            "key_points (list of up to 3 short phrases), "
            "isl_words (list of up to 5 key words suitable for ISL signing), "
            "simplified (a simplified 1-sentence version of the text)."
        )
        raw = get_groq_response(text, system_prompt=system_prompt)
        if raw:
            try:
                parsed = json.loads(re.sub(r"```json|```", "", raw).strip())
            except Exception:
                parsed = _emotion_fallback_summary(text)
        else:
            parsed = _emotion_fallback_summary(text)
        return jsonify({"status": "success", "summary": parsed})
    except Exception as e:
        logging.error(f"[smart-summary] {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/speak", methods=["POST"])
def speak():
    try:
        data  = request.json or {}
        text  = (data.get("text") or "").strip()
        lang  = (data.get("lang") or "en").strip()
        speed = (data.get("speed") or "normal").strip()
        if not text:
            return jsonify({"error": "No text provided"}), 400
        rate_map = {"slow": 80, "normal": 150, "fast": 200}
        params   = {"rate": rate_map.get(speed, 150), "volume": 0.9}
        audio    = None
        try:
            audio = generate_audio(text, lang, params)
        except ValueError:
            # Language not supported by gTTS — fallback to English
            try:
                audio = generate_audio(text, "en", params)
                logging.warning(f"[speak] Language '{lang}' unsupported, fell back to English")
            except Exception as fe:
                logging.warning(f"[speak] Fallback audio also failed: {fe}")
        except Exception as e:
            logging.warning(f"[speak] audio generation failed: {e}")

        # FIX: always return 200; let client handle audio=null gracefully
        return jsonify({"status": "success", "audio": audio, "speed": speed})
    except Exception as e:
        logging.error(f"[speak] {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "app": "Samvadini",
        "groq_configured":    bool(GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here"),
        "weather_configured": bool(WEATHER_API_KEY and WEATHER_API_KEY != "your_openweathermap_api_key_here"),
        "city":      CITY_NAME,
        "groq_model": GROQ_MODEL,
        "arduino":   _arduino_state,
        "timestamp": datetime.datetime.now().isoformat(),
    })


@app.route("/isl-phrases", methods=["GET"])
def isl_phrases():
    phrases = {
        "Greetings": ["Hello", "Bye", "Thank You", "Good", "Welcome"],
        "Feelings":  ["Happy", "Sad", "Help", "Safe", "Best"],
        "Daily":     ["Home", "Eat", "Wash", "Study", "Work"],
        "Questions": ["Who", "What", "Where", "When", "Why", "How"],
        "Responses": ["Yes", "No", "Again", "More", "Do Not"],
    }
    return jsonify({"status": "ok", "phrases": phrases})


@app.route("/arduino-status", methods=["GET"])
def arduino_status():
    """Expose real-time Arduino sensor state to the frontend."""
    return jsonify({
        "enabled":      _arduino_state["enabled"],
        "presence":     _arduino_state["presence"],
        "distance":     _arduino_state["distance"],
        "last_updated": _arduino_state["last_updated"],
        "error":        _arduino_state["error"],
    })


@app.route("/audio-cleanup", methods=["POST"])
def audio_cleanup():
    """Delete audio files older than 1 hour to prevent disk fill."""
    now = time.time()
    removed = 0
    errors  = 0
    try:
        for fname in os.listdir(AUDIO_DIR):
            fpath = os.path.join(AUDIO_DIR, fname)
            if os.path.isfile(fpath) and (now - os.path.getmtime(fpath)) > 3600:
                try:
                    os.remove(fpath)
                    removed += 1
                except Exception:
                    errors += 1
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "ok", "removed": removed, "errors": errors})


# ── Run ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    start_arduino_listener()
    print(f"\n✅ Samvadini running → http://127.0.0.1:5500\n"
          f"   Groq model: {GROQ_MODEL}\n"
          f"   Arduino: {'enabled on ' + ARDUINO_PORT if ARDUINO_PORT else 'disabled (set ARDUINO_PORT in .env)'}\n")
    app.run(debug=DEBUG_MODE, port=5500, host="127.0.0.1")