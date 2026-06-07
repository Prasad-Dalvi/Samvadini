from flask import Flask, request, jsonify, render_template, send_from_directory
from emotion_detection import detect_emotion
import pyttsx3
import os
import time
from flask_cors import CORS

app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

EMOTION_PARAMS = {
    "joy": {"rate": 160, "volume": 1.0, "pitch": 120},
    "sadness": {"rate": 90, "volume": 0.7, "pitch": 80},
    "anger": {"rate": 200, "volume": 1.0, "pitch": 150},
    "fear": {"rate": 110, "volume": 0.6, "pitch": 90},
    "surprise": {"rate": 180, "volume": 0.9, "pitch": 130},
    "love": {"rate": 140, "volume": 0.95, "pitch": 110},
    "neutral": {"rate": 125, "volume": 0.85, "pitch": 100}
}

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/text-to-audio', methods=['POST'])
def text_to_audio():
    try:
        text = request.form['text'].strip()
        if not text:
            return jsonify({'error': 'No text provided'}), 400

        # Generate unique audio filename
        timestamp = str(int(time.time()))
        audio_filename = f"output_{timestamp}.wav"
        audio_path = os.path.join('static', audio_filename)

        # Emotion detection
        emotions = detect_emotion(text)
        total_weight = sum(e["confidence"] for e in emotions)
        speech_params = {"rate": 0, "volume": 0, "pitch": 0}

        # Calculate speech parameters
        for emotion in emotions:
            weight = emotion["confidence"] / total_weight
            params = EMOTION_PARAMS.get(emotion["emotion"], EMOTION_PARAMS["neutral"])
            for key in speech_params:
                speech_params[key] += params[key] * weight

        # Generate speech
        engine = pyttsx3.init()
        engine.setProperty('rate', int(speech_params["rate"]))
        engine.setProperty('volume', speech_params["volume"])
        
        try:
            engine.setProperty('pitch', int(speech_params["pitch"]))
        except:
            pass

        engine.save_to_file(text, audio_path)
        engine.runAndWait()

        return jsonify({
            "status": "success",
            "emotions": emotions,
            "speech_params": speech_params,
            "audio_url": f"/static/{audio_filename}?t={timestamp}"
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/generate-signs', methods=['POST'])
def generate_signs():
    try:
        text = request.form['text'].upper()
        sequence = []
        valid_chars = [c for c in text if c.isalpha() or c == ' ']
        
        for i, char in enumerate(valid_chars):
            sequence.append('BLANK.png' if char == ' ' else f'{char}.png')
            if i != len(valid_chars) - 1:
                sequence.append('STAND.png')
        
        return jsonify({"sequence": sequence})
    
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/static/letters/<filename>')
def serve_letter(filename):
    return send_from_directory('static/letters', filename)

if __name__ == '__main__':
    os.makedirs('static/letters', exist_ok=True)
    app.run(debug=True, port=8080)