# Squawk

Squawk is a Duolingo-style ATC radio practice app for student pilots. The demo loop is:

1. Hold push-to-talk (spacebar in web, or GPIO button on Pi).
2. Speak a radio call.
3. Get AI ATC feedback and hear a realistic ATC voice response.

## Monorepo structure

- `/web` — Next.js (App Router + TypeScript + Tailwind) cockpit UI
- `/server` — FastAPI backend (STT + LLM + TTS + MongoDB)
- `/pi` — Raspberry Pi push-to-talk client stub

---

## 1) Server (`/server`)

### Features

- `POST /transmit` accepts `audio` (webm), `sessionId`, and `phase`
- Uses service wrappers in `app/services/`:
  - `stt.py` (ElevenLabs speech-to-text)
  - `llm.py` (Gemini Flash ATC reply + score + issues)
  - `tts.py` (ElevenLabs text-to-speech)
- Saves transmission docs to MongoDB collection `transmissions`
- `GET /health` shows missing env vars for clear startup warnings
- `WebSocket /ws/session/{sessionId}` relays `ptt.down`, `ptt.up`, and `atc.talking`

### Run server locally

```bash
cd /home/runner/work/HackPHS-Squawk/HackPHS-Squawk/server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### Test server quickly

```bash
curl http://localhost:8000/health
```

---

## 2) Web (`/web`)

### `/fly` cockpit page includes

- Frequency panel (`TWR 118.5`) in monospace
- Clickable phase strip: Taxi, Takeoff, Pattern, Landing
- Hold-to-talk button using `MediaRecorder`
- Spacebar push-to-talk support
- WebSocket sync for Pi `ptt.down`/`ptt.up`
- Radio log with pilot + ATC lines and score
- ATC audio playback from base64 MP3
- Web Audio API background loops (`engine.mp3`, `wind.mp3`)
- Phase-based gain profile and ducking while ATC speaks
- On-screen warnings for missing env/audio/server availability

### Run web locally

```bash
cd /home/runner/work/HackPHS-Squawk/HackPHS-Squawk/web
cp .env.example .env.local
npm install
npm run dev
```

Open: `http://localhost:3000/fly`

### Test web quickly

- Hold the cockpit button and speak
- Release to transmit and receive transcript + ATC reply
- Press/hold spacebar to use keyboard push-to-talk
- Confirm warnings appear if `engine.mp3` or `wind.mp3` are missing

---

## 3) Raspberry Pi stub (`/pi`)

### Features

- `ptt.py` uses `gpiozero.Button(17, pull_up=True)`
- Sends `{"type":"ptt.down"}` on press
- Sends `{"type":"ptt.up"}` on release
- WebSocket URL is env-driven
- Grove LCD RGB Backlight placeholders:
  - red while transmitting
  - green while ATC is talking
  - blue when idle

### Run Pi script

```bash
cd /home/runner/work/HackPHS-Squawk/HackPHS-Squawk/pi
python -m venv .venv
source .venv/bin/activate
pip install gpiozero websocket-client
cp .env.example .env
export $(grep -v '^#' .env | xargs)
python ptt.py
```

### Test Pi integration

- Start server and web first
- Run Pi script
- Press GPIO17 button and confirm web recording starts/stops

---

## Environment variables

See:

- `/server/.env.example`
- `/web/.env.example`
- `/pi/.env.example`
- root `/.env.example` (quick reference)

Do **not** commit real keys.

---

## Sponsor stack

- Gemini
- ElevenLabs
- MongoDB Atlas
- DigitalOcean
- Tiger Data
- Solana

---

## SETUP CHECKLIST

- `/.gitignore` — ignore `.env`, Python cache/venv, and Next/node build artifacts
- `/.env.example` — root reference for all server/web/pi env vars with fake placeholder values
- `/server/requirements.txt` — FastAPI + runtime dependencies
- `/server/.env.example` — server env vars and comments
- `/server/app/main.py` — API routes (`/health`, `/transmit`) and session WebSocket relay
- `/server/app/services/stt.py` — ElevenLabs STT wrapper
- `/server/app/services/llm.py` — Gemini Flash ATC JSON generation wrapper
- `/server/app/services/tts.py` — ElevenLabs TTS wrapper
- `/web/.env.example` — web env vars and comments
- `/web/app/page.tsx` — simple landing page linking to `/fly`
- `/web/app/fly/page.tsx` — cockpit UI, recording flow, WebSocket events, audio playback, warnings
- `/web/app/layout.tsx` — app metadata/title
- `/web/app/globals.css` — dark cockpit base theme
- `/web/public/audio/README.md` — required audio assets and format guidance
- `/pi/.env.example` — Pi WebSocket env var and comment
- `/pi/ptt.py` — GPIO17 push-to-talk client + Grove LCD stubs
