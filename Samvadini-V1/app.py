#app.py
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import speech_recognition as sr
from googletrans import Translator
from gtts import gTTS
from gtts.lang import tts_langs
import os
#import pywhatkit
import wikipedia
import datetime
import pyjokes
import cohere
import requests
from emotion_detection import detect_emotion
from dotenv import load_dotenv

app = Flask(__name__)
CORS(app)

# Load environment variables
load_dotenv()
COHERE_API_KEY = os.getenv("COHERE_API_KEY")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY")
CITY_NAME = "Pune"

co = cohere.Client(COHERE_API_KEY)

# Ensure audio directory exists
AUDIO_DIR = os.path.join("static", "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

# Emotion to speech parameters mapping (G11)
EMOTION_PARAMS = {
    "joy": {"rate": 160, "volume": 1.0},
    "sadness": {"rate": 90, "volume": 0.7},
    "anger": {"rate": 200, "volume": 1.0},
    "fear": {"rate": 110, "volume": 0.6},
    "surprise": {"rate": 180, "volume": 0.9},
    "love": {"rate": 140, "volume": 0.95},
    "neutral": {"rate": 125, "volume": 0.85}
}

@app.route("/")
def index():
    return render_template("index.html")

# G10: AI Voice Assistant
@app.route("/ask", methods=["POST"])
def ask():
    data = request.json
    query = data.get("query", "")
    response = process_command_from_web(query)
    audio_path = generate_audio(response, "en")
    return jsonify({"response": response, "audio": audio_path})

def get_weather():
    url = f"https://api.openweathermap.org/data/2.5/weather?q={CITY_NAME}&appid={WEATHER_API_KEY}&units=metric"
    response = requests.get(url)
    data = response.json()
    if data["cod"] == 200:
        temp = data["main"]["temp"]
        description = data["weather"][0]["description"]
        return f"The current temperature in {CITY_NAME} is {temp}°C with {description}."
    else:
        return "Sorry, I couldn't fetch the weather right now."

def get_cohere_response(prompt):
    try:
        response = co.chat(message=prompt, model="command-r")
        return response.text.strip()
    except Exception as e:
        return f"Cohere error: {e}"

def process_command_from_web(command):
    command = command.lower()

    if 'play' in command:
        return "Please ask a correct question."
        #song = command.replace('play', '').strip()
        #pywhatkit.playonyt(song)
        #return f"Playing {song}"

    elif 'how are you' in command:
        return "I'm doing great! Thanks for asking. What can I help you with?"

    elif 'date' in command:
        return str(datetime.date.today())

    elif 'time' in command:
        return datetime.datetime.now().strftime('%H:%M')

    elif 'weather' in command:
        return get_weather()

    elif "who is" in command or "what is" in command:
        person = command.replace('who is', '').replace('what is', '').strip()
        return wikipedia.summary(person, 1)

    elif 'joke' in command:
        return pyjokes.get_joke()

    elif 'ask ai' in command:
        prompt = command.replace('ask ai', '').strip()
        return get_cohere_response(prompt)

    else:
        return "Please ask a correct question."

# G11: Text-to-Audio with Emotion Detection
@app.route('/text-to-audio', methods=['POST'])
def text_to_audio():
    try:
        text = request.form['text'].strip()
        if not text:
            return jsonify({'error': 'No text provided'}), 400

        emotions = detect_emotion(text)
        
        total_weight = sum(e["confidence"] for e in emotions)
        speech_params = {"rate": 0, "volume": 0}
        
        for emotion in emotions:
            weight = emotion["confidence"] / total_weight
            params = EMOTION_PARAMS.get(emotion["emotion"], EMOTION_PARAMS["neutral"])
            for key in speech_params:
                speech_params[key] += params[key] * weight

        audio_path = generate_audio(text, "en", speech_params)
        return jsonify({
            "status": "success",
            "emotions": emotions,
            "speech_params": speech_params,
            "audio": audio_path,
            "text_length": len(text)
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# G13: Speech-to-Text Translation with TTS
@app.route('/translate-speak', methods=['POST'])
def translate_speak():
    try:
        data = request.json
        input_text = data.get("text", "")
        target_lang = data.get("lang", "kn")  # Default to Kannada

        translator = Translator()
        translated = translator.translate(input_text, dest=target_lang)
        translated_text = translated.text

        audio_path = generate_audio(translated_text, target_lang)
        return jsonify({
            "status": "success",
            "original": input_text,
            "translated": translated_text,
            "lang": target_lang,
            "audio": audio_path
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# Helper function to generate audio using gTTS
def generate_audio(text, lang, params=None):
    try:
        available_langs = tts_langs()
        if lang.lower() not in available_langs:
            raise ValueError(f"gTTS does not support the language '{lang}'")

        rate = params.get("rate", 150) if params else 150
        slow = rate < 125  # gTTS uses slow=True for slower speech
        tts = gTTS(text=text, lang=lang, slow=slow)
        audio_filename = f"output_{hash(text)}_{lang}.mp3"
        audio_path = os.path.join(AUDIO_DIR, audio_filename)
        tts.save(audio_path)
        return f"/static/audio/{audio_filename}"
    except Exception as e:
        raise Exception(f"TTS error: {e}")

if __name__ == '__main__':
    app.run(debug=True, port=5500)