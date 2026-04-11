# Tokei Firmware Implementation · Execution Report

**Plan:** `docs/superpowers/plans/2026-04-12-tokei-firmware.md`
**Date:** 2026-04-12

## Task Status

| # | Task | Status | Commit SHA |
|---|------|--------|------------|
| 1  | Scaffold platformio project                      | DONE | 47601e8 |
| 2  | Vendor Waveshare BSP                              | DONE | a468c30 |
| 3  | LVGL hello world on vendor BSP                    | DONE | e0fbeaf |
| 4  | TokeiSummary struct                               | DONE | 219eb06 |
| 5  | Summary parser + native unit tests                | DONE | f740cc5 |
| 6  | State machine + native unit tests                 | DONE | b9bf420 |
| 7  | Network wrapper (WiFi + NTP + HTTPS)              | DONE | 12c4cf5 |
| 8  | API client                                        | DONE | 80be17b |
| 9  | Sensors (SHTC3 + battery)                         | DONE | a895407 |
| 10 | LVGL UI layout                                    | DONE | a4cede2 |
| 11 | Main loop wiring                                  | DONE | b2270ab |
| 12 | Final compile + test sweep                        | DONE | n/a (run-only) |
| 13 | Execution report + manual flash guide             | DONE | (this commit) |

## Test Summary

- Unity native tests: 16/16 passed (8 summary_parser + 8 state_machine)
- Target build: SUCCESS
  - RAM:   40.1% (131,360 / 327,680 bytes)
  - Flash: 43.9% (1,381,365 / 3,145,728 bytes)

## Deviations from Plan

1. **BSP header names differ from plan placeholders.** The plan assumed `bsp_board.h` and `lv_port_disp.h`; the actual vendor files are `display_bsp.h` (ST7305 SPI driver class) and `lvgl_bsp.h` (LVGL port with FreeRTOS task). Adapted `lvgl_setup.cpp` accordingly.

2. **Vendor BSP patched with missing FreeRTOS includes.** `display_bsp.cpp` needed `#include <freertos/task.h>` and `lvgl_bsp.cpp` needed `#include <freertos/task.h>` + `#include <freertos/semphr.h>`. These are present in the Arduino IDE environment but not auto-included by PlatformIO's library builder.

3. **LVGL initialization uses vendor's FreeRTOS task model.** The vendor BSP runs `lv_timer_handler()` in a dedicated FreeRTOS task via `Lvgl_PortInit()`, rather than the plan's manual `lv_tick_inc()` + `lv_timer_handler()` in `loop()`. `lvgl_setup_tick()` is a no-op; the vendor task handles it.

4. **Test directory structure changed from `test/native/` to `test/test_*/`.** PlatformIO 6.x requires test suite directories to follow the `test_<name>/` convention for proper discovery. Files moved to `test/test_summary_parser/` and `test/test_state_machine/`.

5. **UNIT_TEST guards added to hardware-dependent source files.** `main.cpp`, `lvgl_setup.cpp`, `network.cpp`, `api.cpp`, `sensors.cpp`, and `ui.cpp` are wrapped in `#ifndef UNIT_TEST` to allow native test compilation.

6. **Sensor pins adjusted to match vendor BSP.** I2C: SDA=GPIO13, SCL=GPIO14 (from vendor `user_config.h`). Battery ADC: GPIO4/ADC_CHANNEL_3 with 3x voltage divider (from vendor `adc_bsp.cpp`). Plan assumed GPIO1 with 2x divider.

7. **Font flags added to platformio.ini.** `-DLV_FONT_MONTSERRAT_14=1 -DLV_FONT_MONTSERRAT_28=1 -DLV_FONT_MONTSERRAT_48=1` added to `build_flags` because LVGL's default config does not enable the larger font sizes.

8. **`lib_ignore = waveshare_bsp` added to `[env:native]`.** The vendor BSP uses ESP32-specific headers that cannot compile on the native platform.

## Manual Steps For User

1. Plug the Waveshare ESP32-S3-RLCD-4.2 into USB-C.
2. `cd firmware && cp include/config.h.example include/config.h`
3. Edit `include/config.h` to set `TOKEI_BEARER_TOKEN` to the real token.
4. `pio run -e esp32s3 -t upload`
5. `pio device monitor` to verify boot messages.
6. On first run: join the "Tokei-Setup" WiFi AP from phone, configure home WiFi.
7. Screen should render the Tokei layout within a minute.

## Known Follow-ups

- Built-in Montserrat fonts don't include CJK glyphs; Chinese quotes render as boxes until `lv_font_conv` is used with a CJK TTF
- No TLS pinning on the HTTPS client (`setInsecure`); add once worker cert is stable
- Battery ADC calibration uses simple linear mapping; the vendor's `adc_bsp.cpp` uses ESP-IDF curve fitting calibration which is more accurate — consider switching if battery readings are inaccurate
- PCF85063 RTC not used; NTP via ESP32 SNTP client is sufficient for 1h polling cadence
- Seeed SHT35 library is in `lib_deps` but unused (SHTC3 driven directly via Wire); can be removed to save flash
