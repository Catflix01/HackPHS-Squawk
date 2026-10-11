# Squawk API contract

The `/web` app and the `/pi` client are built against this. **Do not rename fields or message types.**
Server default: `http://localhost:8000` (WebSocket: `ws://localhost:8000`).

## Modes

- **ai**: no `atc` client is connected to the session. The pilot talks; Gemini plays the tower;
  ElevenLabs speaks the reply.
- **human**: an `atc` client (controller on a Mac) is connected. The pilot and controller hear each other's
  original audio, half-duplex. AI grades every transmission in the background, and an AI CFI speaks to
  the pilot only when a mistake is safety-relevant.

Phases: `"taxi" | "takeoff" | "pattern" | "landing"` (unknown values are treated as `"taxi"`).

---

## REST

### `GET /health`

```json
{"status": "ok", "missingEnv": ["GEMINI_API_KEY"], "demoMode": false}
```

`missingEnv` lists the required keys that are not set (`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`,
`ELEVENLABS_ATC_VOICE_ID`). The server still works without them by using canned fallbacks.

### `POST /transmit` (multipart/form-data)

| field       | type          | notes                                   |
|-------------|---------------|-----------------------------------------|
| `audio`     | file (webm)   | the recorded transmission               |
| `sessionId` | string        |                                         |
| `role`      | `"pilot"` \| `"atc"` | the sender                       |
| `phase`     | phase string  |                                         |

Response: `{"ok": true, "transmissionId": "..."}` (the `id` of the broadcast `transmission`).

Server pipeline: transcribe → grade with Gemini against the expected call → save → broadcast
`transmission` over the WebSocket. The HTTP response returns once that first broadcast is sent.
- **Human mode:** the broadcast includes the ORIGINAL audio (`audioBase64`, `mimeType` = upload type,
  normally `audio/webm`) so the other side hears it.
- **AI mode, role=pilot:** the server also generates the tower reply, runs TTS on it, and broadcasts a
  second `transmission` with `speaker: "ai_atc"` (`mimeType: "audio/mpeg"`). If the pilot's call was a
  correct readback, the tower stays silent and no `ai_atc` message is sent (as on a real frequency).
- If grading returns a CFI alert for a pilot call, the server runs TTS on it with the CFI voice and sends
  `cfi.alert` to the pilot only (after the `ai_atc` reply, if there is one).

### `GET /debrief/{sessionId}`

```json
{
  "sessionId": "DEMO",
  "averageScore": 87,
  "transmissions": [
    {"id": "...", "speaker": "pilot", "phase": "taxi", "transcript": "...", "expectedCall": "...",
     "score": 90, "issues": ["..."], "createdAt": "2026-10-10T20:20:08.257015+00:00"}
  ],
  "cfiAlerts": [
    {"id": "...", "transmissionId": "...", "phase": "taxi", "text": "...", "createdAt": "..."}
  ]
}
```

- `averageScore`: the rounded mean of the **pilot** transmission scores, or `0` if there are none.
- `transmissions` are in chronological order. For `ai_atc` entries, `score` is `null`, `issues` is `[]`
  and `expectedCall` is `""`.

### `GET /lessons`

```json
{"lessons": [{"id": "unit1", "title": "Radio basics", "brief": "...", "scenarioId": "vfr_pattern", "flashcardCount": 5}]}
```

### `GET /lessons/{id}`

```json
{
  "id": "unit1",
  "title": "Radio basics",
  "brief": "...",
  "scenarioId": "vfr_pattern",
  "flashcards": [{"id": "u1-wilco", "front": "What does \"wilco\" mean?", "back": "..."}]
}
```

Unknown id → 404. Lessons are JSON files in `server/lessons/`. `scenarioId` is the `/fly` scenario
to practise with.

### `POST /planner` (JSON)

```json
{"lessonDates": ["2026-11-05"], "examDates": ["2026-11-12"], "minutesPerDay": 20, "startDate": "2026-11-01"}
```

All dates are `YYYY-MM-DD`. `lessonDates` are flight lessons. `minutesPerDay` is 5–240 (default 20).
`startDate` defaults to today. Invalid input → 422.

Response:

```json
{
  "planId": "a1b2c3d4e5f6",
  "planItems": [{"date": "2026-11-01", "type": "practice", "title": "Radio practice: ...", "minutes": 20}]
}
```

- One item per day, from `startDate` through the last lesson or exam date, at least 14 and at most 30 days.
- `type`, from highest priority to lowest:

  | type | when | minutes |
  |---|---|---|
  | `exam` | an exam date | short warm-up, at most 10 |
  | `flight` | a flight lesson date | short warm-up, at most 10 |
  | `light` | the day before a flight lesson | half of `minutesPerDay` |
  | `review` | the 3 days before an exam | 1.5× `minutesPerDay` |
  | `practice` / `flashcards` / `lesson` | other days, rotating in that order | `minutesPerDay` |

- Plans are kept in memory, and also saved to MongoDB when `MONGODB_URI` is set.

### `GET /planner/{planId}.ics`

Returns a `text/calendar` file (sent as an attachment) with one all-day event per plan item,
summarised as `"<title> (<minutes> min)"`. Unknown plan → 404.

---

## WebSocket `/ws/session/{sessionId}?role=pilot|atc|device`

`role` defaults to `pilot`. An invalid role is closed with code 1008.

### Client → server

| message | meaning |
|---|---|
| `{"type":"ptt.down"}` / `{"type":"ptt.up"}` | key / unkey the mic (subject to the frequency lock) |
| `{"type":"phase.set","phase":"taxi"}` | change the phase for everyone |
| `{"type":"rx","state":"started"\|"stopped"}` | pilot browser reports when radio audio starts or stops playing; forwarded to the device |

### Server → client

| message | who gets it |
|---|---|
| `{"type":"session.state","phase","mode":"ai"\|"human","peers":["pilot","atc","device"],"freqHolder":null\|"pilot"\|"atc"}` | everyone; sent on connect and whenever peers, phase or freqHolder change |
| `{"type":"freq.busy","holder":"pilot"\|"atc"}` | everyone, when someone keys up on a clear frequency |
| `{"type":"freq.clear"}` | everyone, when the holder unkeys or disconnects |
| `{"type":"ptt.denied","reason":"freq_busy"}` | only the requester |
| `{"type":"device.ptt","state":"down"\|"up"}` | pilot browsers, when the Pi button is pressed or released (only if the press was granted) |
| `{"type":"phase.changed","phase"}` | everyone |
| `{"type":"transmission","id","speaker":"pilot"\|"atc"\|"ai_atc","phase","transcript","expectedCall","score","issues":[],"audioBase64":string\|null,"mimeType":"audio/webm"\|"audio/mpeg"}` | everyone in the session. **Clients play audio only if `speaker` != their own role.** |
| `{"type":"cfi.alert","text","audioBase64","mimeType":"audio/mpeg"}` | pilot only |
| `{"type":"rx","state":"started"\|"stopped"}` | device only (forwarded from the pilot browser) |

### Frequency lock (half-duplex)

- `device` counts as `pilot` for the lock (the Pi button is the pilot's PTT).
- The first `ptt.down` on a clear frequency wins: `freq.busy` + `session.state` go to everyone.
- A `ptt.down` from the other side while the frequency is held → `ptt.denied` to that requester only.
- `ptt.up` from the holder's side (or the holder disconnecting) → `freq.clear` + `session.state`.
- A PTT held longer than 60 s (e.g. a crashed tab) can be taken over by the other side.

### Nullable fields (fallbacks)

- `audioBase64` is `null` when there is no audio: AI-mode pilot transmissions (nobody needs to hear
  their own voice), DEMO_MODE, or TTS that failed or took longer than 5 s. Show the transcript instead.
- `score` is `null` only for `ai_atc`.
- If STT fails, `transcript` is `"(transcription unavailable)"` and the score is a placeholder.
