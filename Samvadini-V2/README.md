# Samvadini — Accessibility Assistant

## 🚀 Quick Start (3 steps)

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Get a FREE Groq API key (optional but recommended for full AI chat)
- Go to **https://console.groq.com** → Sign up free → Create API key
- No credit card required. Generous free tier.
- Open `.env` and replace `your_groq_api_key_here` with your key

### 3. Run the app
```bash
python app.py
```
Then open **http://localhost:5500** in your browser.

---

## 🔑 Environment Variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Optional | Free AI chat (get at console.groq.com) |
| `WEATHER_API_KEY` | Optional | Weather feature (get at openweathermap.org) |
| `CITY_NAME` | Optional | Your city for weather (default: Mumbai) |

> **The app works without any API keys.** ISL conversion, translation, text-to-speech, emotion detection, jokes, and Wikipedia all work offline. Only AI chat and weather need keys.

---

## ✨ Features
- 🤟 **Indian Sign Language (ISL)** — converts text to sign language videos
- 🗣️ **Emotion-aware TTS** — speaks with emotional tone
- 🌐 **Translation** — translate and speak in multiple languages
- 🤖 **AI Assistant** — powered by Groq (Llama 3, free)
- 🌤️ **Weather** — real-time weather updates
- 😂 **Jokes** — random jokes
- 📖 **Wikipedia** — quick lookups
