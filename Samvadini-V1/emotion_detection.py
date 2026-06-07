from transformers import pipeline

emotion_classifier = pipeline(
    "text-classification",
    model="bhadresh-savani/distilbert-base-uncased-emotion",
    return_all_scores=True
)

def detect_emotion(text):
    results = emotion_classifier(text)
    emotions = []
    
    for result in results[0]:
        emotions.append({
            "emotion": result["label"],
            "confidence": result["score"]
        })
    
    emotions.sort(key=lambda x: x["confidence"], reverse=True)
    
    if emotions[0]["confidence"] < 0.4:
        emotions.insert(0, {
            "emotion": "neutral",
            "confidence": 1.0
        })
    
    return emotions[:3]