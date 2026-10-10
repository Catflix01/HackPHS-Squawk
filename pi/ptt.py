"""Raspberry Pi push-to-talk client for Squawk.

- GPIO17 button (to GND) -> {"type":"ptt.down"} / {"type":"ptt.up"} as role=device.
- Grove LCD RGB Backlight on I2C bus 1: frequency + phase text, colour shows radio state
  (red = transmitting, green = receiving, blue = idle).
- Reconnects to the server forever; the button keeps working the LCD while offline.

Runs on a Mac too (no GPIO/I2C): the LCD is printed to the console instead.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

from websocket import WebSocketApp

BUTTON_PIN = 17
LCD_TEXT_ADDR = 0x3E
LCD_RGB_ADDR = 0x62

IDLE = (0, 0, 255)
TRANSMITTING = (255, 0, 0)
RECEIVING = (0, 255, 0)


def load_env_file(path: Path) -> None:
    """Minimal .env loader (KEY=VALUE lines) so no extra dependency is needed."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class GroveLcd:
    """Grove LCD RGB Backlight: AIP31068/HD44780 text at 0x3e, PCA9633 RGB at 0x62."""

    def __init__(self, bus_number: int = 1) -> None:
        self._lock = threading.Lock()
        self._bus = None
        self._last: tuple | None = None
        try:
            from smbus2 import SMBus

            self._bus = SMBus(bus_number)
            self._init_display()
        except Exception as exc:  # no I2C (dev machine) or LCD unplugged
            print(f"[LCD] hardware unavailable ({exc}); printing to console")
            self._bus = None

    def _command(self, cmd: int) -> None:
        self._bus.write_byte_data(LCD_TEXT_ADDR, 0x80, cmd)

    def _init_display(self) -> None:
        self._command(0x01)  # clear
        time.sleep(0.05)
        self._command(0x0C)  # display on, cursor off
        self._command(0x28)  # 2 lines, 5x8 font
        time.sleep(0.05)
        # PCA9633 backlight: wake up, PWM-controlled outputs
        self._bus.write_byte_data(LCD_RGB_ADDR, 0x00, 0x00)
        self._bus.write_byte_data(LCD_RGB_ADDR, 0x01, 0x00)
        self._bus.write_byte_data(LCD_RGB_ADDR, 0x08, 0xAA)

    def show(self, line1: str, line2: str, rgb: tuple[int, int, int]) -> None:
        state = (line1, line2, rgb)
        with self._lock:
            if state == self._last:
                return
            self._last = state
            if self._bus is None:
                print(f"[LCD] {line1:<16} | {line2:<16} | rgb={rgb}")
                return
            try:
                for row_cmd, text in ((0x80, line1), (0xC0, line2)):
                    self._command(row_cmd)  # cursor to start of row
                    for char in text[:16].ljust(16):  # overwrite in place: no clear = no flicker
                        self._bus.write_byte_data(LCD_TEXT_ADDR, 0x40, ord(char) if ord(char) < 128 else ord("?"))
                red, green, blue = rgb
                self._bus.write_byte_data(LCD_RGB_ADDR, 0x04, red)
                self._bus.write_byte_data(LCD_RGB_ADDR, 0x03, green)
                self._bus.write_byte_data(LCD_RGB_ADDR, 0x02, blue)
            except OSError as exc:  # loose I2C cable: keep the radio working
                print(f"[LCD] write failed: {exc}")
                self._last = None


class PttClient:
    def __init__(self, ws_url: str, freq_label: str) -> None:
        self.ws_url = ws_url
        self.freq_label = freq_label
        self.lcd = GroveLcd()
        self.ws: WebSocketApp | None = None
        self.connected = False
        self.phase = "taxi"
        self.transmitting = False
        self.receiving = False
        self.busy_holder: str | None = None
        self.flash_until = 0.0
        self.flash_text = ""

    # -- display ---------------------------------------------------------
    def refresh(self) -> None:
        if not self.connected:
            status, colour = "OFFLINE", IDLE
        elif self.transmitting:
            status, colour = "TX", TRANSMITTING
        elif self.receiving:
            status, colour = "RX", RECEIVING
        elif self.busy_holder == "atc":
            status, colour = "BUSY", IDLE
        else:
            status, colour = "", IDLE
        if time.monotonic() < self.flash_until:
            status = self.flash_text
        # 16x2: "TWR 118.5" / "TAKEOFF       TX"
        self.lcd.show(self.freq_label, f"{self.phase.upper():<9}{status:>7}", colour)

    def flash(self, text: str, seconds: float = 1.5) -> None:
        self.flash_text = text
        self.flash_until = time.monotonic() + seconds
        self.refresh()
        threading.Timer(seconds + 0.05, self.refresh).start()

    # -- websocket -------------------------------------------------------
    def send(self, event_type: str) -> None:
        ws = self.ws
        if ws is None or not self.connected:
            return
        try:
            ws.send(json.dumps({"type": event_type}))
        except Exception as exc:
            print(f"send failed: {exc}")

    def on_open(self, _ws) -> None:
        print("connected")
        self.connected = True
        self.refresh()

    def on_close(self, _ws, *_args) -> None:
        self.connected = False
        self.transmitting = False
        self.receiving = False
        self.busy_holder = None
        self.refresh()

    def on_error(self, _ws, error) -> None:
        print(f"websocket error: {error}")

    def on_message(self, _ws, raw: str) -> None:
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            return
        kind = message.get("type")
        if kind == "session.state":
            self.phase = message.get("phase") or self.phase
            self.busy_holder = message.get("freqHolder")
        elif kind == "phase.changed":
            self.phase = message.get("phase") or self.phase
        elif kind == "freq.busy":
            self.busy_holder = message.get("holder")
        elif kind == "freq.clear":
            self.busy_holder = None
        elif kind == "ptt.denied":
            self.transmitting = False
            self.flash("BUSY")
            return
        elif kind == "rx":
            self.receiving = message.get("state") == "started"
        else:
            return  # transmissions etc. are for the browser
        self.refresh()

    # -- button ----------------------------------------------------------
    def button_down(self) -> None:
        if not self.connected:
            self.flash("NO LINK")
            return
        self.transmitting = True
        self.refresh()
        self.send("ptt.down")

    def button_up(self) -> None:
        was_transmitting = self.transmitting
        self.transmitting = False
        self.refresh()
        if was_transmitting:
            self.send("ptt.up")

    def attach_button(self):
        try:
            from gpiozero import Button

            button = Button(BUTTON_PIN, pull_up=True, bounce_time=0.03)
            button.when_pressed = self.button_down
            button.when_released = self.button_up
            return button
        except Exception as exc:
            print(f"GPIO unavailable ({exc}); running without the PTT button")
            return None

    def run(self) -> None:
        self.button = self.attach_button()  # keep a reference so it isn't garbage-collected
        self.refresh()
        delay = 1.0
        while True:
            print(f"connecting to {self.ws_url}")
            self.ws = WebSocketApp(
                self.ws_url,
                on_open=self.on_open,
                on_close=self.on_close,
                on_error=self.on_error,
                on_message=self.on_message,
            )
            started = time.monotonic()
            try:
                self.ws.run_forever(ping_interval=10, ping_timeout=5)
            except Exception as exc:
                print(f"websocket crashed: {exc}")
            self.on_close(self.ws)
            # back off up to 10 s, but reconnect fast after a long healthy connection
            delay = 1.0 if time.monotonic() - started > 30 else min(delay * 2, 10.0)
            time.sleep(delay)


def build_ws_url() -> str:
    base = os.getenv("PI_SERVER_WS_URL", "ws://localhost:8000").rstrip("/")
    session = os.getenv("PI_SESSION_ID", "DEMO")
    if "/ws/session/" in base:  # accept a full URL too
        url = base
    else:
        url = f"{base}/ws/session/{session}"
    if "role=" not in url:
        url += ("&" if "?" in url else "?") + "role=device"
    return url


def main() -> None:
    load_env_file(Path(__file__).resolve().parent / ".env")
    PttClient(build_ws_url(), os.getenv("PI_FREQ_LABEL", "TWR 118.5")).run()


if __name__ == "__main__":
    main()
