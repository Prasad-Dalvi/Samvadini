// Ensure the DOM is fully loaded before attaching event listeners
document.addEventListener("DOMContentLoaded", function() {
    console.log("DOM fully loaded, attaching event listeners...");

    // Day/Night Mode Toggle
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const body = document.body;

    if (themeToggle && themeIcon) {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            body.classList.add('dark-mode');
            themeIcon.textContent = '☀️';
        } else {
            themeIcon.textContent = '🌙';
        }

        themeToggle.addEventListener('click', function() {
            console.log("Theme toggle clicked");
            body.classList.toggle('dark-mode');
            themeIcon.textContent = body.classList.contains('dark-mode') ? '☀️' : '🌙';
            localStorage.setItem('theme', body.classList.contains('dark-mode') ? 'dark' : 'light');
        });
    } else {
        console.error("Theme toggle elements not found.");
    }

    // Attach event listeners to buttons
    const buttons = [
        { id: 'universalMic', handler: () => startSpeechRecognition('universal'), log: 'Universal mic' },
        { id: 'assistantMic', handler: () => startSpeechRecognition('assistant'), log: 'Assistant mic' },
        { selector: '#convertEmotionButton', handler: convertEmotionAudio, log: 'Convert to Audio button' },
        { selector: '#translateSpeakButton', handler: translateSpeak, log: 'Translate & Speak button' },
        { selector: '#askAssistantButton', handler: askAssistant, log: 'Ask Assistant button' },
        { selector: '#convertToSignButton', handler: convertToSign, log: 'Convert to ISL button' }
    ];

    buttons.forEach(button => {
        const element = button.id ? document.getElementById(button.id) : document.querySelector(button.selector);
        if (element) {
            element.addEventListener('click', () => {
                console.log(`${button.log} clicked`);
                button.handler();
            });
        } else {
            console.error(`${button.log} not found.`);
        }
    });

    // Attach keypress listener for assistant input
    const assistantInput = document.getElementById('assistantInput');
    if (assistantInput) {
        assistantInput.addEventListener('keypress', handleAssistantKeyPress);
    } else {
        console.error("Assistant input not found.");
    }

});

// G9: Text-to-ISL Converter
function convertToSign() {
    const inputText = document.getElementById('universalInput')?.value.toUpperCase().trim();
    const output = document.getElementById('islOutput');
    if (!inputText || !output) {
        console.error("Input text or ISL output element not found.");
        return;
    }
    output.innerHTML = '';

    const words = inputText.split(/\s+/);
    let wordIndex = 0;

    function playNextItem() {
        if (wordIndex < words.length) {
            const word = words[wordIndex];
            const wordTitle = document.createElement('div');
            wordTitle.className = 'word-title';
            wordTitle.textContent = word;

            const video = document.createElement('video');
            video.src = `/static/videos/${word}.mp4`;
            video.controls = false;
            video.autoplay = true;
            video.muted = false;

            video.onerror = function () {
                const letterContainer = document.createElement('div');
                letterContainer.className = 'letter-container';
                let letterIndex = 0;

                function playNextLetter() {
                    if (letterIndex < word.length) {
                        const char = word[letterIndex];
                        if (char.match(/[A-Z]/)) {
                            const letterVideo = document.createElement('video');
                            letterVideo.src = `/static/videos/${char}.mp4`;
                            letterVideo.controls = false;
                            letterVideo.autoplay = true;
                            letterVideo.muted = false;

                            letterVideo.onended = function () {
                                letterIndex++;
                                playNextLetter();
                            };

                            letterContainer.innerHTML = '';
                            letterContainer.appendChild(letterVideo);
                        } else {
                            letterIndex++;
                            playNextLetter();
                        }
                    } else {
                        wordIndex++;
                        playNextItem();
                    }
                }

                output.innerHTML = '';
                output.appendChild(wordTitle);
                output.appendChild(letterContainer);
                playNextLetter();
            };

            video.onended = function () {
                wordIndex++;
                playNextItem();
            };

            output.innerHTML = '';
            output.appendChild(wordTitle);
            output.appendChild(video);
        }
    }

    playNextItem();
}

// G10: AI Voice Assistant
function askAssistant() {
    const query = document.getElementById('assistantInput')?.value.trim();
    if (!query) {
        console.error("Assistant input is empty.");
        return;
    }

    fetch('/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
    })
    .then(response => response.json())
    .then(data => {
        const assistantResponse = document.getElementById('assistantResponse');
        if (assistantResponse) {
            assistantResponse.innerText = data.response || 'Error processing request.';
        }
        const audio = document.getElementById('assistantAudio');
        if (audio && data.audio) {
            audio.src = data.audio;
            audio.style.display = 'block';
            audio.play();
        }
    })
    .catch(error => {
        console.error('Error in askAssistant:', error);
        const assistantResponse = document.getElementById('assistantResponse');
        if (assistantResponse) {
            assistantResponse.innerText = 'Error processing request.';
        }
    });
}

function handleAssistantKeyPress(event) {
    if (event.key === 'Enter') {
        console.log("Enter key pressed in assistant input");
        askAssistant();
    }
}

// G11: Text-to-Audio with Emotion Detection
function convertEmotionAudio() {
    const text = document.getElementById('universalInput')?.value.trim();
    if (!text) {
        console.error("Universal input is empty for emotion audio.");
        return;
    }

    const formData = new FormData();
    formData.append('text', text);

    fetch('/text-to-audio', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        const emotionResults = document.getElementById('emotionResults')?.querySelector('span');
        const speechParams = document.getElementById('speechParams')?.querySelector('span');
        if (data.status === 'success') {
            if (emotionResults) {
                const emotions = data.emotions.map(e => `${e.emotion}: ${e.confidence.toFixed(2)}`).join(', ');
                emotionResults.innerText = emotions;
            }
            if (speechParams) {
                const params = `Rate: ${data.speech_params.rate.toFixed(0)}, Volume: ${data.speech_params.volume.toFixed(2)}`;
                speechParams.innerText = params;
            }
            const audio = document.getElementById('emotionAudio');
            if (audio && data.audio) {
                audio.src = data.audio;
                audio.style.display = 'block';
                audio.play();
            }
        } else {
            if (emotionResults) {
                emotionResults.innerText = 'Error: ' + data.message;
            }
        }
    })
    .catch(error => {
        console.error('Error in convertEmotionAudio:', error);
        const emotionResults = document.getElementById('emotionResults')?.querySelector('span');
        if (emotionResults) {
            emotionResults.innerText = 'Error processing request.';
        }
    });
}

// G13: Speech-to-Text Translation with TTS
function translateSpeak() {
    const text = document.getElementById('universalInput')?.value.trim();
    const lang = document.getElementById('targetLang')?.value;
    if (!text) {
        console.error("Universal input is empty for translation.");
        return;
    }

    fetch('/translate-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang })
    })
    .then(response => response.json())
    .then(data => {
        const translateResult = document.getElementById('translateResult')?.querySelector('span');
        const translateSpeechParams = document.getElementById('translateSpeechParams')?.querySelector('span');
        if (data.status === 'success') {
            if (translateResult) {
                translateResult.innerText = `${data.translated} (${data.lang})`;
            }
            if (translateSpeechParams) {
                const params = `Rate: ${data.speech_params.rate.toFixed(0)}, Volume: ${data.speech_params.volume.toFixed(2)}`;
                translateSpeechParams.innerText = params;
            }
            const audio = document.getElementById('translateAudio');
            if (audio && data.audio) {
                audio.src = data.audio;
                audio.style.display = 'block';
                audio.play();
            }
        } else {
            if (translateResult) {
                translateResult.innerText = 'Error: ' + data.message;
            }
            if (translateSpeechParams) {
                translateSpeechParams.innerText = '';
            }
        }
    })
    .catch(error => {
        console.error('Error in translateSpeak:', error);
        const translateResult = document.getElementById('translateResult')?.querySelector('span');
        if (translateResult) {
            translateResult.innerText = 'Error processing request.';
        }
        const translateSpeechParams = document.getElementById('translateSpeechParams')?.querySelector('span');
        if (translateSpeechParams) {
            translateSpeechParams.innerText = '';
        }
    });
}

// Speech Recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

function startSpeechRecognition(section) {
    if (!recognition) {
        alert("Speech recognition is not supported in your browser. Please use Chrome.");
        return;
    }

    let mic, input;
    if (section === 'universal') {
        mic = document.getElementById('universalMic');
        input = document.getElementById('universalInput');
        recognition.lang = 'mr-IN'; // Marathi
    } else if (section === 'assistant') {
        mic = document.getElementById('assistantMic');
        input = document.getElementById('assistantInput');
        recognition.lang = 'en-US'; // English
    }

    if (!mic || !input) {
        console.error(`Mic or input element not found for section: ${section}`);
        return;
    }

    mic.classList.add('glowing');
    recognition.start();

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        if (section === 'universal') {
            fetch('/translate-speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: transcript, lang: 'en' })
            })
            .then(response => response.json())
            .then(data => {
                input.value = data.status === 'success' ? data.translated : transcript;
                mic.classList.remove('glowing');
            })
            .catch(error => {
                console.error('Translation error in speech recognition:', error);
                input.value = transcript;
                mic.classList.remove('glowing');
            });
        } else {
            input.value = transcript;
            mic.classList.remove('glowing');
            if (section === 'assistant') {
                askAssistant();
            }
        }
    };

    recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        mic.classList.remove('glowing');
    };

    recognition.onend = function() {
        mic.classList.remove('glowing');
    };
}