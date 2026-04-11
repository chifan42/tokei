# Tokei Firmware

ESP32-S3 firmware for the Waveshare ESP32-S3-RLCD-4.2 board. Pulls the Tokei worker `/v1/summary` every hour and renders the Tokei split layout on the 4.2" reflective LCD.

## Prerequisites

- PlatformIO Core (install: `pipx install platformio` or via VS Code PlatformIO extension)
- USB-C cable to flash
- WiFi credentials

## First flash

1. Copy `include/config.h.example` to `include/config.h` and fill in:
   - `TOKEI_WORKER_URL` (your deployed worker URL)
   - `TOKEI_BEARER_TOKEN` (matches the worker secret)
2. Connect the board via USB-C
3. `pio run -e esp32s3 -t upload`
4. `pio device monitor` to watch serial output
5. On first boot the device opens a "Tokei Setup" WiFi AP. Connect with your phone, select your home WiFi, and save.
6. The screen should render the first summary within a minute.

## Native unit tests

```bash
pio test -e native
```

## Layout reference

See `docs/superpowers/specs/2026-04-11-tokei-design.md` §4.3 for the 4-zone layout and error states.
