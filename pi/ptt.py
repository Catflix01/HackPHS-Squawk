"""Raspberry Pi push-to-talk client for Squawk.

Button wiring:
- GPIO17
- Internal pull-up enabled
- Press = transmit start, release = transmit stop
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass

from gpiozero import Button
from websocket import WebSocketApp


@dataclass
class GroveLcdStub:
    """Placeholder Grove LCD RGB Backlight integration points."""

    def set_text(self, text: str) -> None:
        print(f"[LCD] {text}")

    def set_backlight(self, red: int, green: int, blue: int) -> None:
        print(f"[LCD] backlight=({red}, {green}, {blue})")


class PttClient:
    def __init__(self, ws_url: str) -> None:
        self.ws_url = ws_url
        self.lcd = GroveLcdStub()
        self.ws: WebSocketApp | None = None

    def _send(self, event_type: str) -> None:
        if not self.ws or not self.ws.sock or not self.ws.sock.connected:
            return
        self.ws.send(json.dumps({"type": event_type, "sender": "pi"}))

    def on_open(self, ws: WebSocketApp) -> None:
        self.lcd.set_text("Squawk Ready")
        self.lcd.set_backlight(0, 0, 255)  # Blue idle

    def on_close(self, ws: WebSocketApp, *_args) -> None:
        self.lcd.set_text("Disconnected")

    def on_message(self, ws: WebSocketApp, message: str) -> None:
        payload = json.loads(message)
        if payload.get("type") == "atc.talking" and payload.get("state") == "started":
            self.lcd.set_text("ATC Talking")
            self.lcd.set_backlight(0, 255, 0)  # Green for ATC audio
        elif payload.get("type") == "atc.talking":
            self.lcd.set_text("Ready")
            self.lcd.set_backlight(0, 0, 255)

    def button_down(self) -> None:
        self.lcd.set_text("Transmitting")
        self.lcd.set_backlight(255, 0, 0)  # Red transmitting
        self._send("ptt.down")

    def button_up(self) -> None:
        self.lcd.set_text("Ready")
        self.lcd.set_backlight(0, 0, 255)
        self._send("ptt.up")

    def run(self) -> None:
        while True:
            self.ws = WebSocketApp(
                self.ws_url,
                on_open=self.on_open,
                on_close=self.on_close,
                on_message=self.on_message,
            )

            button = Button(17, pull_up=True)
            button.when_pressed = self.button_down
            button.when_released = self.button_up

            try:
                self.ws.run_forever(ping_interval=20, ping_timeout=10)
            except Exception as exc:  # pragma: no cover - hardware/network runtime path
                print(f"WebSocket error: {exc}")
            finally:
                button.close()

            time.sleep(2)


def main() -> None:
    ws_url = os.getenv("PI_SERVER_WS_URL", "ws://localhost:8000/ws/session/demo")
    print(f"Connecting to {ws_url}")
    PttClient(ws_url).run()


if __name__ == "__main__":
    main()
