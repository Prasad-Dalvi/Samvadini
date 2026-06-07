# app.py — Samvadini (Groq AI Edition)
import warnings
import logging
warnings.filterwarnings("ignore")
logging.getLogger("transformers").setLevel(logging.ERROR)
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

from flask import Flask, request, jsonify, render_template, Response
from flask_cors import CORS
from googletrans import Translator
from gtts import gTTS
from gtts.lang import tts_langs
import os
import wikipediaapi as wikipedia
import datetime
import pyjokes
import requests
import json
import re
from emotion_detection import detect_emotion
from dotenv import load_dotenv

app = Flask(__name__)
CORS(app)

# Load .env using absolute path — works no matter where you run app.py from
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_BASE_DIR, ".env"), override=True)

GROQ_API_KEY    = os.getenv("GROQ_API_KEY", "").strip()
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "").strip()
CITY_NAME       = os.getenv("CITY_NAME", "Mumbai").strip()

# Show key status on startup (safe — only shows first/last 4 chars)
if GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here":
    print(f"\u2705 Groq key loaded: {GROQ_API_KEY[:4]}...{GROQ_API_KEY[-4:]}")
else:
    print("\u26a0\ufe0f  Groq API key NOT found - check your .env file")

AUDIO_DIR = os.path.join("static", "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

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

# ── Groq AI ────────────────────────────────────────────────────────────────────
def get_groq_response(prompt, system_prompt=None):
    if not GROQ_API_KEY or GROQ_API_KEY == "your_groq_api_key_here":
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
        "model": "llama3-8b-8192",
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
            headers=headers, json=payload, timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip() or None
    except requests.exceptions.Timeout:
        return None
    except requests.exceptions.RequestException:
        return None
    except Exception:
        return None

def smart_fallback_response(command):
    cmd = command.lower()
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

# ── Helpers ────────────────────────────────────────────────────────────────────
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
    available_langs = tts_langs()
    lang_lower = lang.lower()
    base_lang  = lang_lower.split("-")[0]
    if lang_lower not in available_langs and base_lang in available_langs:
        lang_lower = base_lang
    if lang_lower not in available_langs:
        raise ValueError(f"gTTS does not support language '{lang}'")
    rate = params.get("rate", 150) if params else 150
    slow = rate < 115
    tts  = gTTS(text=text, lang=lang_lower, slow=slow)
    ts   = int(datetime.datetime.now().timestamp() * 1000)
    fname = f"output_{abs(hash(text))}_{lang_lower}_{ts}.mp3"
    path  = os.path.join(AUDIO_DIR, fname)
    tts.save(path)
    return f"/static/audio/{fname}"

def process_command_from_web(command):
    cmd = command.lower()
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

# ══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/favicon.ico")
def favicon():
    # Return an inline SVG emoji favicon — no file needed
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">\xf0\x9f\xa4\x9f</text></svg>'
    return Response(svg, mimetype="image/svg+xml")

@app.route("/ask", methods=["POST"])
def ask():
    data  = request.json or {}
    query = data.get("query", "").strip()
    if not query:
        return jsonify({"error": "Empty query"}), 400
    response = process_command_from_web(query)
    audio_path = None
    try:
        audio_path = generate_audio(response, "en")
    except Exception as e:
        print(f"[ask] audio generation failed: {e}")
    return jsonify({"response": response, "audio": audio_path})

@app.route("/text-to-audio", methods=["POST"])
def text_to_audio():
    try:
        text = ((request.json or {}).get("text", "") if request.is_json
                else request.form.get("text", "")).strip()
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
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/translate-speak", methods=["POST"])
def translate_speak():
    try:
        data        = request.json or {}
        input_text  = data.get("text", "").strip()
        target_lang = data.get("lang", "mr")
        if not input_text:
            return jsonify({"status": "error", "message": "No text provided"}), 400
        translator      = Translator()
        translated      = translator.translate(input_text, dest=target_lang)
        translated_text = translated.text
        audio_path      = None
        try:
            audio_path = generate_audio(translated_text, target_lang)
        except Exception as e:
            print(f"[translate_speak] audio generation failed: {e}")
        return jsonify({
            "status": "success", "original": input_text,
            "translated": translated_text, "lang": target_lang,
            "audio": audio_path,
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/gesture", methods=["POST"])
def handle_gesture():
    data    = request.json or {}
    gesture = data.get("gesture", "").lower()
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
    try:
        audio_path = generate_audio(feedback, "en")
    except Exception:
        audio_path = None
    return jsonify({"gesture": gesture, "action": action,
                    "feedback": feedback, "audio": audio_path})

@app.route("/smart-summary", methods=["POST"])
def smart_summary():
    try:
        data = request.json or {}
        text = data.get("text", "").strip()
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
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "app": "Samvadini",
        "groq_configured":    bool(GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here"),
        "weather_configured": bool(WEATHER_API_KEY and WEATHER_API_KEY != "your_openweathermap_api_key_here"),
        "city":      CITY_NAME,
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

@app.route("/speak", methods=["POST"])
def speak():
    try:
        data  = request.json or {}
        text  = data.get("text", "").strip()
        lang  = data.get("lang", "en")
        speed = data.get("speed", "normal")
        if not text:
            return jsonify({"error": "No text provided"}), 400
        rate_map = {"slow": 80, "normal": 150, "fast": 200}
        params   = {"rate": rate_map.get(speed, 150), "volume": 0.9}
        audio    = None
        try:
            audio = generate_audio(text, lang, params)
        except Exception as e:
            print(f"[speak] audio generation failed: {e}")
        return jsonify({"status": "success", "audio": audio, "speed": speed})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ── Run ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    print("\n✅ Samvadini running → http://127.0.0.1:5500\n")
    app.run(debug=False, port=5500)