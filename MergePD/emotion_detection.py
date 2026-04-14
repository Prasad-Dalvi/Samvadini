# emotion_detection.py — Samvadini
# Changes vs original:
#  - Removed module-level pipeline() call (caused crash if transformers unavailable)
#  - Now lazy-loaded via app.py's get_emotion_classifier()
#  - This file kept for backward compatibility; actual logic lives in app.py

import warnings
warnings.filterwarnings("ignore")


def detect_emotion(text):
    """
    Detect emotion from text.
    Returns list of dicts: [{"emotion": str, "confidence": float}, ...]

    NOTE: This function is a thin shim. The real implementation (with lazy loading
    and crash protection) is in app.py's detect_emotion(). If you use this module
    standalone, it will attempt to load the model directly.
    """
    try:
        from transformers import pipeline
        classifier = pipeline(
            "text-classification",
            model="bhadresh-savani/distilbert-base-uncased-emotion",
            top_k=None,
        )
        results = classifier(text[:512])
        emotions = [
            {"emotion": r["label"], "confidence": r["score"]}
            for r in results[0]
        ]
        emotions.sort(key=lambda x: x["confidence"], reverse=True)
        if not emotions or emotions[0]["confidence"] < 0.4:
            emotions.insert(0, {"emotion": "neutral", "confidence": 1.0})
        return emotions[:3]
    except Exception:
        return [{"emotion": "neutral", "confidence": 1.0}]