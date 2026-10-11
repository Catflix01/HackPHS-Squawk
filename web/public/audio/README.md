# Cockpit loop audio

The cockpit background noise is a single looping file:

- `cockpit1.mp3`: engine and wind noise for the whole flight (lowercase filename; Linux servers are case-sensitive)

The `/fly` page plays it in a loop for the pilot role only. Its volume changes with the flight phase
(taxi 0.25, takeoff 0.7, pattern 0.45, landing 0.3), and it ducks while radio audio plays. If the file
is missing, the page shows a warning.

Recommended specs:

- Length: **30-60 seconds**
- Format: **MP3**, seamless loop (no clicks at the loop point)
- Loudness: normalized; the phase gains above assume a reasonably loud source file
