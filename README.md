# Squawk

Radio practice for student pilots.

- **AI mode:** you talk on the radio; Gemini plays the tower and ElevenLabs speaks its reply. Every call
  is graded against the expected phraseology.
- **Human mode:** a controller on a Mac (spacebar push-to-talk) and a pilot on a Raspberry Pi (kiosk
  browser, USB headset, GPIO17 button) talk to each other through the server, half-duplex like a real
  radio. AI grades every transmission in the background, and an AI flight instructor (CFI) speaks to
  the pilot only when a mistake is safety-relevant.

A session is in human mode while a controller (`role=atc`) is connected; otherwise it is in AI mode.

```
web/     Next.js cockpit UI (/fly, /debrief)
server/  FastAPI: STT (ElevenLabs) -> grading + tower (Gemini) -> TTS (ElevenLabs), WebSocket sessions
pi/      Raspberry Pi: GPIO PTT button + Grove LCD client, Chromium kiosk script
docs/    api-contract.md, the REST + WebSocket contract shared by web, server and pi
```

The training scenario (airport, runway 27, tower 118.5, callsign N123SQ, expected calls per phase)
lives in `server/scenarios/vfr_pattern.json`.

---

## 1. Server

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt     # runtime deps + pytest
cp .env.example .env                    # then fill in keys (see below)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

`--host 0.0.0.0` makes the server reachable from the Pi on your LAN. Check it with:

```bash
curl http://localhost:8000/health
# {"status":"ok","missingEnv":[],"demoMode":false}
```

Run the tests (offline; they force DEMO_MODE and skip MongoDB):

```bash
cd server
pytest
```

### Server environment (`server/.env`)

| var | required | purpose |
|---|---|---|
| `GEMINI_API_KEY` | yes* | grading + AI tower |
| `ELEVENLABS_API_KEY` | yes* | speech-to-text + text-to-speech |
| `ELEVENLABS_ATC_VOICE_ID` | yes* | tower voice |
| `ELEVENLABS_CFI_VOICE_ID` | no | instructor voice (defaults to the tower voice) |
| `DEMO_MODE` | no | `true` = no AI calls at all; canned transcripts, replies and scores |
| `MONGODB_URI` | no | MongoDB Atlas URI. Empty = keep transmissions in memory |
| `MONGODB_DB` | no | default `squawk` |
| `CORS_ORIGINS` | no | comma-separated web origins, e.g. `http://localhost:3000,http://192.168.1.20:3000`, or `*` |
| `GEMINI_MODEL` | no | comma-separated fallback chain, default `gemini-3.5-flash-lite,gemini-3.8-flash` |
| `SCENARIO` | no | scenario file in `server/scenarios/`, default `vfr_pattern` |

\* The demo never freezes: without these keys, in `DEMO_MODE`, or when any AI call fails or takes more
than 5 s, the server falls back to canned replies and placeholder scores. `/health` lists any missing keys.

---

## 2. Web

```bash
cd web
cp .env.example .env.local      # NEXT_PUBLIC_SERVER_URL=http://<server-ip>:8000
npm install
npm run dev -- --hostname 0.0.0.0
```

Open `http://localhost:3000/fly`.

---

## 3. Running AI mode (one computer)

1. Start the server and web app (sections 1 and 2).
2. Open `http://localhost:3000/fly?role=pilot&session=DEMO`.
3. Hold the talk button (or the spacebar), make your call, then release. The tower answers by voice, and
   the radio log shows your score and issues.
4. Open the debrief at `/debrief/DEMO`.

Use `DEMO_MODE=true` when you have no keys or no reliable internet.

## 4. Running human mode (Mac controller + Pi pilot)

Everything runs on the Mac except the pilot cockpit. Find the Mac's LAN IP
(`ipconfig getifaddr en0`); this README uses `192.168.1.20`.

1. **Mac:** in `server/.env`, set `CORS_ORIGINS=http://localhost:3000,http://192.168.1.20:3000`.
   In `web/.env.local`, set `NEXT_PUBLIC_SERVER_URL=http://192.168.1.20:8000`. Start the server and web app.
2. **Mac (controller):** open `http://localhost:3000/fly?role=atc&session=DEMO`. Hold the spacebar to talk.
3. **Pi (pilot):** start the button/LCD client and the kiosk (section 5). The kiosk opens
   `/fly?role=pilot&session=DEMO`.
4. Only one side can transmit at a time. If you key up while the other side is talking, you get "frequency busy".

## 5. Raspberry Pi

Hardware (Grove Base HAT):
- **Grove button on port D16** (GPIO16). It drives the pin HIGH when pressed, so the client uses a
  pull-down (`PTT_GPIO=16`, `PTT_PULL_UP=false`, the defaults). For a bare button wired between a GPIO
  pin and GND, set `PTT_PULL_UP=true` and `PTT_GPIO` to that pin.
- **Grove LCD RGB Backlight on any I2C port** of the HAT (all on bus 1): text at `0x3e`, RGB at `0x62`.
  Enable I2C with `sudo raspi-config` → Interface Options → I2C, then check with `i2cdetect -y 1`.
- A USB headset, set as the default input and output device.

Setup. On a **Raspberry Pi 5**, gpiozero needs the system `lgpio` backend, so install it with apt and
let the venv see system packages:

```bash
sudo apt install python3-gpiozero python3-lgpio
cd pi
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

In `pi/.env`, set `PI_SERVER_WS_URL=ws://<server-LAN-IP>:8000` (for example `ws://192.168.1.20:8000`;
not `localhost`, which would point at the Pi itself). The client adds `/ws/session/<PI_SESSION_ID>?role=device`
itself. Also set `WEB_URL=http://<server-LAN-IP>:3000` for the kiosk. Then start the button + LCD client
(it reconnects automatically):

```bash
cd pi
source .venv/bin/activate
python ptt.py
```

In a second terminal, on the Pi desktop:

```bash
cd pi
./kiosk.sh
```

LCD line 1 shows `TWR 118.5`. Line 2 shows the phase and the status: **red/TX** while you transmit,
**green/RX** while radio audio plays, **blue** when idle, `BUSY` while the controller transmits, and
`OFFLINE` when there is no connection.

Pressing the Pi button sends `ptt.down`/`ptt.up` as `role=device`. The server treats the device as the
pilot for the frequency lock and tells the pilot browser (`device.ptt`) to start or stop recording.

---

## API

See [docs/api-contract.md](docs/api-contract.md).

## Sponsor stack

Gemini · ElevenLabs · MongoDB Atlas · DigitalOcean · Tiger Data · Solana
