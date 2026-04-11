# Tokei Firmware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Arduino + LVGL firmware for the Waveshare ESP32-S3-RLCD-4.2 board that pulls `/v1/summary` from the Tokei worker once per hour and renders the Tokei split layout on the 400×300 reflective LCD.

**Architecture:** Arduino framework on ESP32-S3 via PlatformIO. LVGL v9 for the UI layer on top of the vendor's ST7305 SPI driver (vendored from `waveshareteam/ESP32-S3-RLCD-4.2/02_Example/Arduino/09_LVGL_V9_Test`). WiFiManager handles provisioning, NTP keeps RTC accurate, HTTPClient + ArduinoJson consume `/v1/summary`. A simple state machine drives OK / STALE / FAIL_BADGE / WIFI_OFF / FIRST_SYNC_PENDING screens. Board sensors (SHTC3 temp/humidity, PCF85063 RTC, battery ADC) feed the status bar without going through the network.

**Tech Stack:** C++17 · PlatformIO (`platform = espressif32`, `board = esp32-s3-devkitc-1`) · Arduino framework · LVGL v9 · ArduinoJson 7 · WiFi / WiFiManager / HTTPClient · vendor ST7305 BSP · Unity for native-env unit tests

**Spec Reference:** `docs/superpowers/specs/2026-04-11-tokei-design.md`

**Worker API (already deployed):** `https://tokei-worker.chifan.workers.dev/v1/summary` returns the JSON defined in `fixtures/summaries/` (to be created in Task 15 for test fixtures).

**Scope:** This plan covers only the Firmware subsystem. Worker and Collector are separate plans already executed. Hardware flashing is left to the user at the very end; the agent's job ends at a clean `pio run` build.

---

## File Structure

### Firmware package

| Path | Responsibility |
|---|---|
| `firmware/platformio.ini` | PlatformIO project config: boards, envs (esp32s3 + native), libs |
| `firmware/README.md` | Flash instructions, first-time WiFi setup, troubleshooting |
| `firmware/include/config.h` | User-editable compile-time config + secrets placeholder |
| `firmware/include/config.h.example` | Committed template for users to copy |
| `firmware/include/tokei_summary.h` | TokeiSummary struct (shared header) |
| `firmware/src/main.cpp` | Arduino `setup()` + `loop()` wiring everything |
| `firmware/src/network.cpp` + `.h` | WiFi + NTP + HTTP client wrapper |
| `firmware/src/api.cpp` + `.h` | GET /v1/summary + parse into TokeiSummary |
| `firmware/src/summary_parser.cpp` + `.h` | Pure JSON → TokeiSummary logic (unit-testable from native env) |
| `firmware/src/sensors.cpp` + `.h` | SHTC3 + PCF85063 RTC + battery ADC readers |
| `firmware/src/state_machine.cpp` + `.h` | FirmwareState enum + transition logic |
| `firmware/src/ui.cpp` + `.h` | LVGL layout builder: status bar + hero + tool list + quote |
| `firmware/lib/waveshare_bsp/` | Vendored BSP from `09_LVGL_V9_Test` (ST7305 driver, pin map, display init) |
| `firmware/test/native/test_summary_parser.cpp` | Unity tests for summary_parser on native env |
| `firmware/test/native/test_state_machine.cpp` | Unity tests for state transitions |
| `firmware/data/` | Empty placeholder for future SPIFFS assets |

---

## Task 1: Scaffold firmware package with PlatformIO

**Files:**
- Create: `firmware/platformio.ini`
- Create: `firmware/README.md`
- Create: `firmware/include/config.h.example`
- Create: `firmware/src/main.cpp` (minimal stub)

- [ ] **Step 1: Create firmware directory tree**

```bash
mkdir -p /Users/chichi/workspace/xx/tokei/firmware/{src,include,lib,test,data}
```

- [ ] **Step 2: Write platformio.ini**

`firmware/platformio.ini`:

```ini
; Tokei firmware
; - env:esp32s3 builds the production firmware targeting Waveshare ESP32-S3-RLCD-4.2
; - env:native runs unit tests on the host for pure-logic modules

[platformio]
default_envs = esp32s3
src_dir = src
include_dir = include
lib_dir = lib
test_dir = test

[env]
build_flags =
    -std=gnu++17
    -DTOKEI_VERSION_STRING=\"0.0.1\"
build_unflags = -std=gnu++11

[env:esp32s3]
platform = espressif32@^6.8.0
board = esp32-s3-devkitc-1
framework = arduino
monitor_speed = 115200
upload_speed = 921600
board_build.partitions = huge_app.csv

; Board-specific CPU/flash config for Waveshare ESP32-S3-RLCD-4.2
board_build.flash_mode = qio
board_build.flash_size = 16MB
board_upload.flash_size = 16MB
board_build.psram_type = opi
board_build.arduino.memory_type = qio_opi

build_flags =
    ${env.build_flags}
    -DBOARD_HAS_PSRAM
    -DARDUINO_USB_CDC_ON_BOOT=1
    -DLV_CONF_INCLUDE_SIMPLE=1
    -I${PROJECT_DIR}/lib/waveshare_bsp

lib_deps =
    lvgl/lvgl@~9.2.2
    bblanchon/ArduinoJson@^7.2.0
    tzapu/WiFiManager@^2.0.17
    https://github.com/Seeed-Studio/Seeed_SHT35.git

[env:native]
platform = native
build_flags =
    -std=gnu++17
    -DUNIT_TEST
    -I${PROJECT_DIR}/include
    -I${PROJECT_DIR}/src
lib_deps =
    bblanchon/ArduinoJson@^7.2.0
    throwtheswitch/Unity@^2.6.0
test_build_src = true
```

Note on `lib_deps`:
- `lvgl/lvgl@~9.2.x` matches the vendor's `09_LVGL_V9_Test` version range
- The SHT35 lib Seeed ships is close enough to SHTC3 that we can reuse its I2C patterns; the vendor BSP in Task 2 may also supply its own SHTC3 helper in which case we drop the Seeed dependency. Revisit after Task 2 is cloned.

- [ ] **Step 3: Write firmware/README.md**

`firmware/README.md`:

```markdown
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
```

- [ ] **Step 4: Write config.h.example**

`firmware/include/config.h.example`:

```cpp
// Copy this file to config.h and fill in your values.
// config.h is gitignored so secrets do not leak.
#pragma once

// Worker endpoint. Include the https:// prefix.
#define TOKEI_WORKER_URL "https://tokei-worker.chifan.workers.dev"

// Bearer token that matches the worker's TOKEI_BEARER_TOKEN secret.
#define TOKEI_BEARER_TOKEN "put-your-token-here"

// How often to pull /v1/summary (milliseconds). Default 1 hour.
#define TOKEI_POLL_INTERVAL_MS (60UL * 60UL * 1000UL)

// NTP server for RTC sync.
#define TOKEI_NTP_SERVER "pool.ntp.org"
#define TOKEI_NTP_TZ "CST-8"  // Asia/Shanghai UTC+8
```

- [ ] **Step 5: Write minimal main.cpp stub**

`firmware/src/main.cpp`:

```cpp
#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    Serial.println("Tokei firmware booting (stub)");
}

void loop() {
    delay(1000);
}
```

- [ ] **Step 6: Update top-level .gitignore to exclude config.h and PlatformIO build artifacts**

The existing `.gitignore` already excludes `.pio/` (at the `firmware` line `.pio/`). Add `firmware/include/config.h` explicitly.

```bash
cd /Users/chichi/workspace/xx/tokei
```

Append to `.gitignore`:

```
# firmware secrets
firmware/include/config.h
```

- [ ] **Step 7: Commit**

```bash
cd /Users/chichi/workspace/xx/tokei
git add firmware/ .gitignore
git commit -m "chore(firmware): scaffold platformio project with minimal main stub"
```

---

## Task 2: Vendor Waveshare BSP from `09_LVGL_V9_Test`

**Files:**
- Create: `firmware/lib/waveshare_bsp/` (vendored subset)
- Create: `firmware/lib/waveshare_bsp/README.md` (provenance + license)

The Waveshare vendor repo is large (~8000 files). We only need the BSP pieces that drive ST7305, I2C bus, pin map, and the LVGL display flush callback. The subdirectory we care about is `02_Example/Arduino/09_LVGL_V9_Test/src/app_bsp`.

- [ ] **Step 1: Clone the vendor repo to a temp location**

```bash
git clone --depth 1 https://github.com/waveshareteam/ESP32-S3-RLCD-4.2 /tmp/waveshare-rlcd-src
```

If the clone already exists from prior research, skip the error and continue.

- [ ] **Step 2: Copy only the BSP directory**

```bash
SRC=/tmp/waveshare-rlcd-src/02_Example/Arduino/09_LVGL_V9_Test/src/app_bsp
DST=/Users/chichi/workspace/xx/tokei/firmware/lib/waveshare_bsp
mkdir -p "$DST"
cp -R "$SRC"/* "$DST/"
```

Expected: `DST` now contains `ST7305.*`, `bsp_board.*`, `bsp_i2c.*`, `lv_port_disp.*`, and similar headers/source files.

- [ ] **Step 3: Write lib README with provenance**

`firmware/lib/waveshare_bsp/README.md`:

```markdown
# Waveshare ESP32-S3-RLCD-4.2 BSP

Vendored from:
https://github.com/waveshareteam/ESP32-S3-RLCD-4.2
Subpath: 02_Example/Arduino/09_LVGL_V9_Test/src/app_bsp

Contains the ST7305 reflective LCD driver, I2C bus helper, board pin
map, and LVGL v9 display port bindings.

License: Waveshare's repository license (check upstream LICENSE file).
No modifications; if patches become necessary, record them at the
bottom of this file.
```

- [ ] **Step 4: Verify compile (first time will fail until Task 3)**

```bash
cd /Users/chichi/workspace/xx/tokei/firmware
pio run -e esp32s3 2>&1 | tail -20 || true
```

Expected: build either succeeds or fails with missing includes. Do NOT try to fix at this point; Task 3 wires includes.

- [ ] **Step 5: Commit**

```bash
cd /Users/chichi/workspace/xx/tokei
git add firmware/lib/waveshare_bsp/
git commit -m "chore(firmware): vendor waveshare esp32-s3-rlcd-4.2 bsp"
```

---

## Task 3: Compile baseline: LVGL hello world backed by vendor BSP

**Files:**
- Modify: `firmware/src/main.cpp`
- Create: `firmware/src/lvgl_setup.cpp` + `.h`

The goal is to get `pio run -e esp32s3` to finish with 0 errors, flashing a "TOKEI" splash to the screen. This proves the whole toolchain works before we layer Tokei logic on top.

- [ ] **Step 1: Create lvgl_setup.cpp that initializes LVGL and wires it to the BSP**

`firmware/src/lvgl_setup.h`:

```cpp
#pragma once
#include <lvgl.h>

void lvgl_setup_init();
void lvgl_setup_tick();
```

`firmware/src/lvgl_setup.cpp`:

```cpp
#include "lvgl_setup.h"
#include <Arduino.h>
#include "waveshare_bsp/bsp_board.h"
#include "waveshare_bsp/lv_port_disp.h"

static uint32_t last_tick_ms = 0;

void lvgl_setup_init() {
    bsp_board_init();
    lv_init();
    lv_port_disp_init();
    last_tick_ms = millis();
}

void lvgl_setup_tick() {
    uint32_t now = millis();
    uint32_t elapsed = now - last_tick_ms;
    if (elapsed > 0) {
        lv_tick_inc(elapsed);
        last_tick_ms = now;
    }
    lv_timer_handler();
}
```

Note: exact header names (`bsp_board.h`, `lv_port_disp.h`) depend on what the vendor ships. After Task 2 you should `ls firmware/lib/waveshare_bsp/` and replace the include paths with the actual filenames. Common variants include `BSP_Board.h`, `LV_Port_Disp.h`, or `app_bsp.h` aggregator header.

- [ ] **Step 2: Rewrite main.cpp for a minimal splash**

`firmware/src/main.cpp`:

```cpp
#include <Arduino.h>
#include <lvgl.h>
#include "lvgl_setup.h"

void setup() {
    Serial.begin(115200);
    delay(100);
    Serial.println("Tokei firmware booting");

    lvgl_setup_init();

    lv_obj_t* screen = lv_scr_act();
    lv_obj_set_style_bg_color(screen, lv_color_white(), 0);

    lv_obj_t* label = lv_label_create(screen);
    lv_label_set_text(label, "TOKEI\n"
                             "Booting...");
    lv_obj_set_style_text_color(label, lv_color_black(), 0);
    lv_obj_center(label);
}

void loop() {
    lvgl_setup_tick();
    delay(5);
}
```

- [ ] **Step 3: Build**

```bash
cd /Users/chichi/workspace/xx/tokei/firmware
pio run -e esp32s3 2>&1 | tail -30
```

Expected: `SUCCESS` at the end with RAM/flash usage printed. If include paths fail, fix them based on actual vendor file names (see Task 2 note) and retry ONCE.

- [ ] **Step 4: Commit**

```bash
cd /Users/chichi/workspace/xx/tokei
git add firmware/src/lvgl_setup.cpp firmware/src/lvgl_setup.h firmware/src/main.cpp
git commit -m "feat(firmware): lvgl hello world on vendor bsp baseline"
```

---

## Task 4: TokeiSummary struct

**Files:**
- Create: `firmware/include/tokei_summary.h`

- [ ] **Step 1: Write the header**

`firmware/include/tokei_summary.h`:

```cpp
#pragma once
#include <stdint.h>
#include <time.h>

#define TOKEI_MAX_TOOLS 6
#define TOKEI_TOOL_NAME_LEN 32
#define TOKEI_QUOTE_TEXT_LEN 256
#define TOKEI_QUOTE_ATTR_LEN 64
#define TOKEI_QUOTE_CATEGORY_LEN 32

struct ToolEntry {
    char name[TOKEI_TOOL_NAME_LEN];
    int64_t today_tokens;
    int64_t month_tokens;
    float today_usd;
    float month_usd;
};

struct TokeiSummary {
    int64_t today_total_tokens;
    float today_total_usd;
    int64_t month_total_tokens;
    float month_total_usd;
    int sparkline_7d[7];  // k tokens/day oldest to newest
    ToolEntry tools[TOKEI_MAX_TOOLS];
    uint8_t tool_count;
    char quote_text[TOKEI_QUOTE_TEXT_LEN];
    char quote_attr[TOKEI_QUOTE_ATTR_LEN];
    char quote_category[TOKEI_QUOTE_CATEGORY_LEN];
    time_t sync_ts;
    int64_t fallback_priced_tokens;
    bool valid;  // false = no data rendered yet (first boot)
};
```

- [ ] **Step 2: Commit**

```bash
git add firmware/include/tokei_summary.h
git commit -m "feat(firmware): tokei summary struct header"
```

---

## Task 5: Summary parser with native unit test

**Files:**
- Create: `firmware/src/summary_parser.cpp` + `.h`
- Create: `firmware/test/native/test_summary_parser.cpp`

- [ ] **Step 1: Write failing native test**

`firmware/test/native/test_summary_parser.cpp`:

```cpp
#include <unity.h>
#include <string.h>
#include "summary_parser.h"
#include "tokei_summary.h"

static const char* SAMPLE = R"({
  "today": {
    "total_tokens": 1160000,
    "total_usd": 4.72,
    "tools": [
      {"name": "claude_code", "tokens": 847000, "usd": 3.40},
      {"name": "cursor",      "tokens": 312000, "usd": 1.32}
    ]
  },
  "month": {"total_tokens": 17200000, "total_usd": 77.80},
  "sparkline_7d": [850, 1100, 620, 1400, 980, 1500, 1160],
  "quote": {
    "text": "Premature optimization is the root of all evil.",
    "attr": "Donald Knuth",
    "category": "computing",
    "lang": "en"
  },
  "sync_ts": 1744370400,
  "fallback_priced_tokens": 0
})";

void setUp(void) {}
void tearDown(void) {}

void test_parses_today_total_tokens(void) {
    TokeiSummary s{};
    bool ok = tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_TRUE(ok);
    TEST_ASSERT_EQUAL_INT64(1160000, s.today_total_tokens);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 4.72f, s.today_total_usd);
}

void test_parses_tools_with_correct_order(void) {
    TokeiSummary s{};
    tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_EQUAL_UINT8(2, s.tool_count);
    TEST_ASSERT_EQUAL_STRING("claude_code", s.tools[0].name);
    TEST_ASSERT_EQUAL_INT64(847000, s.tools[0].today_tokens);
    TEST_ASSERT_EQUAL_STRING("cursor", s.tools[1].name);
    TEST_ASSERT_EQUAL_INT64(312000, s.tools[1].today_tokens);
}

void test_parses_month_total(void) {
    TokeiSummary s{};
    tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_EQUAL_INT64(17200000, s.month_total_tokens);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 77.80f, s.month_total_usd);
}

void test_parses_sparkline_7d(void) {
    TokeiSummary s{};
    tokei::parseSummary(SAMPLE, s);
    int expected[7] = {850, 1100, 620, 1400, 980, 1500, 1160};
    for (int i = 0; i < 7; i++) {
        TEST_ASSERT_EQUAL_INT(expected[i], s.sparkline_7d[i]);
    }
}

void test_parses_quote(void) {
    TokeiSummary s{};
    tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_EQUAL_STRING("Premature optimization is the root of all evil.", s.quote_text);
    TEST_ASSERT_EQUAL_STRING("Donald Knuth", s.quote_attr);
    TEST_ASSERT_EQUAL_STRING("computing", s.quote_category);
}

void test_parses_sync_ts_and_valid_flag(void) {
    TokeiSummary s{};
    bool ok = tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_TRUE(ok);
    TEST_ASSERT_EQUAL_INT64(1744370400, s.sync_ts);
    TEST_ASSERT_TRUE(s.valid);
}

void test_rejects_malformed_json(void) {
    TokeiSummary s{};
    bool ok = tokei::parseSummary("not json", s);
    TEST_ASSERT_FALSE(ok);
    TEST_ASSERT_FALSE(s.valid);
}

void test_tool_count_capped_at_max(void) {
    // Build a JSON with 8 tools but struct only holds 6
    const char* many = R"({
      "today": {"total_tokens": 0, "total_usd": 0, "tools": [
        {"name":"t1","tokens":1,"usd":0},
        {"name":"t2","tokens":1,"usd":0},
        {"name":"t3","tokens":1,"usd":0},
        {"name":"t4","tokens":1,"usd":0},
        {"name":"t5","tokens":1,"usd":0},
        {"name":"t6","tokens":1,"usd":0},
        {"name":"t7","tokens":1,"usd":0},
        {"name":"t8","tokens":1,"usd":0}
      ]},
      "month": {"total_tokens": 0, "total_usd": 0},
      "sparkline_7d": [0,0,0,0,0,0,0],
      "quote": {"text":"x","attr":"y","category":"computing","lang":"en"},
      "sync_ts": 0,
      "fallback_priced_tokens": 0
    })";
    TokeiSummary s{};
    tokei::parseSummary(many, s);
    TEST_ASSERT_EQUAL_UINT8(TOKEI_MAX_TOOLS, s.tool_count);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_parses_today_total_tokens);
    RUN_TEST(test_parses_tools_with_correct_order);
    RUN_TEST(test_parses_month_total);
    RUN_TEST(test_parses_sparkline_7d);
    RUN_TEST(test_parses_quote);
    RUN_TEST(test_parses_sync_ts_and_valid_flag);
    RUN_TEST(test_rejects_malformed_json);
    RUN_TEST(test_tool_count_capped_at_max);
    return UNITY_END();
}
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd firmware && pio test -e native 2>&1 | tail -20
```

Expected: FAIL with `summary_parser.h: No such file or directory`.

- [ ] **Step 3: Implement summary_parser**

`firmware/src/summary_parser.h`:

```cpp
#pragma once
#include "tokei_summary.h"

namespace tokei {

/** Parses /v1/summary JSON into a TokeiSummary struct.
 *  Returns false if JSON is malformed or required fields are missing.
 *  On failure, out.valid is set to false.
 */
bool parseSummary(const char* json, TokeiSummary& out);

}  // namespace tokei
```

`firmware/src/summary_parser.cpp`:

```cpp
#include "summary_parser.h"
#include <ArduinoJson.h>
#include <string.h>

namespace tokei {

static void copyString(char* dest, size_t destLen, const char* src) {
    if (src == nullptr) {
        dest[0] = '\0';
        return;
    }
    strncpy(dest, src, destLen - 1);
    dest[destLen - 1] = '\0';
}

bool parseSummary(const char* json, TokeiSummary& out) {
    out.valid = false;
    out.tool_count = 0;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
        return false;
    }

    JsonObjectConst today = doc["today"].as<JsonObjectConst>();
    if (today.isNull()) return false;
    out.today_total_tokens = today["total_tokens"].as<int64_t>();
    out.today_total_usd = today["total_usd"].as<float>();

    JsonArrayConst tools = today["tools"].as<JsonArrayConst>();
    uint8_t tool_count = 0;
    for (JsonObjectConst t : tools) {
        if (tool_count >= TOKEI_MAX_TOOLS) break;
        copyString(out.tools[tool_count].name,
                   TOKEI_TOOL_NAME_LEN,
                   t["name"].as<const char*>());
        out.tools[tool_count].today_tokens = t["tokens"].as<int64_t>();
        out.tools[tool_count].today_usd = t["usd"].as<float>();
        out.tools[tool_count].month_tokens = 0;  // populated below via merge if present
        out.tools[tool_count].month_usd = 0;
        tool_count++;
    }
    out.tool_count = tool_count;

    JsonObjectConst month = doc["month"].as<JsonObjectConst>();
    if (!month.isNull()) {
        out.month_total_tokens = month["total_tokens"].as<int64_t>();
        out.month_total_usd = month["total_usd"].as<float>();
    } else {
        out.month_total_tokens = 0;
        out.month_total_usd = 0;
    }

    JsonArrayConst spark = doc["sparkline_7d"].as<JsonArrayConst>();
    for (int i = 0; i < 7; i++) {
        out.sparkline_7d[i] = (i < (int)spark.size()) ? spark[i].as<int>() : 0;
    }

    JsonObjectConst quote = doc["quote"].as<JsonObjectConst>();
    if (!quote.isNull()) {
        copyString(out.quote_text, TOKEI_QUOTE_TEXT_LEN, quote["text"].as<const char*>());
        copyString(out.quote_attr, TOKEI_QUOTE_ATTR_LEN, quote["attr"].as<const char*>());
        copyString(out.quote_category, TOKEI_QUOTE_CATEGORY_LEN, quote["category"].as<const char*>());
    } else {
        out.quote_text[0] = '\0';
        out.quote_attr[0] = '\0';
        out.quote_category[0] = '\0';
    }

    out.sync_ts = static_cast<time_t>(doc["sync_ts"].as<int64_t>());
    out.fallback_priced_tokens = doc["fallback_priced_tokens"].as<int64_t>();
    out.valid = true;
    return true;
}

}  // namespace tokei
```

- [ ] **Step 4: Run test, expect pass**

```bash
pio test -e native 2>&1 | tail -20
```

Expected: 8/8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add firmware/src/summary_parser.cpp firmware/src/summary_parser.h firmware/test/native/test_summary_parser.cpp
git commit -m "feat(firmware): summary json parser with native unity tests"
```

---

## Task 6: State machine

**Files:**
- Create: `firmware/src/state_machine.cpp` + `.h`
- Create: `firmware/test/native/test_state_machine.cpp`

- [ ] **Step 1: Write failing test**

`firmware/test/native/test_state_machine.cpp`:

```cpp
#include <unity.h>
#include "state_machine.h"

using tokei::FirmwareState;
using tokei::StateMachine;

void setUp(void) {}
void tearDown(void) {}

void test_initial_state_is_first_sync_pending(void) {
    StateMachine sm;
    TEST_ASSERT_EQUAL_INT((int)FirmwareState::FIRST_SYNC_PENDING, (int)sm.state());
}

void test_first_successful_sync_transitions_to_ok(void) {
    StateMachine sm;
    sm.onSyncSuccess(1000);
    TEST_ASSERT_EQUAL_INT((int)FirmwareState::OK, (int)sm.state());
}

void test_first_sync_failure_without_wifi_is_wifi_off(void) {
    StateMachine sm;
    sm.setWifiConnected(false);
    sm.onSyncFailure(1000);
    TEST_ASSERT_EQUAL_INT((int)FirmwareState::WIFI_OFF, (int)sm.state());
}

void test_single_sync_failure_after_ok_goes_stale(void) {
    StateMachine sm;
    sm.onSyncSuccess(1000);
    sm.onSyncFailure(2000);
    TEST_ASSERT_EQUAL_INT((int)FirmwareState::STALE, (int)sm.state());
}

void test_two_consecutive_failures_transitions_to_fail_badge(void) {
    StateMachine sm;
    sm.onSyncSuccess(1000);
    sm.onSyncFailure(2000);
    sm.onSyncFailure(3000);
    TEST_ASSERT_EQUAL_INT((int)FirmwareState::FAIL_BADGE, (int)sm.state());
}

void test_wifi_drop_transitions_to_wifi_off_regardless_of_prior_state(void) {
    StateMachine sm;
    sm.onSyncSuccess(1000);
    sm.setWifiConnected(false);
    TEST_ASSERT_EQUAL_INT((int)FirmwareState::WIFI_OFF, (int)sm.state());
}

void test_recovery_from_any_fail_on_success(void) {
    StateMachine sm;
    sm.setWifiConnected(false);
    sm.onSyncFailure(1000);
    TEST_ASSERT_EQUAL_INT((int)FirmwareState::WIFI_OFF, (int)sm.state());

    sm.setWifiConnected(true);
    sm.onSyncSuccess(2000);
    TEST_ASSERT_EQUAL_INT((int)FirmwareState::OK, (int)sm.state());
}

void test_age_seconds_from_last_success(void) {
    StateMachine sm;
    sm.onSyncSuccess(1000);
    TEST_ASSERT_EQUAL_INT64(60, sm.ageSeconds(1060));
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_initial_state_is_first_sync_pending);
    RUN_TEST(test_first_successful_sync_transitions_to_ok);
    RUN_TEST(test_first_sync_failure_without_wifi_is_wifi_off);
    RUN_TEST(test_single_sync_failure_after_ok_goes_stale);
    RUN_TEST(test_two_consecutive_failures_transitions_to_fail_badge);
    RUN_TEST(test_wifi_drop_transitions_to_wifi_off_regardless_of_prior_state);
    RUN_TEST(test_recovery_from_any_fail_on_success);
    RUN_TEST(test_age_seconds_from_last_success);
    return UNITY_END();
}
```

- [ ] **Step 2: Run test, expect failure**

```bash
pio test -e native 2>&1 | tail -20
```

Expected: FAIL with missing header.

- [ ] **Step 3: Implement state machine**

`firmware/src/state_machine.h`:

```cpp
#pragma once
#include <stdint.h>
#include <time.h>

namespace tokei {

enum class FirmwareState : uint8_t {
    OK,
    STALE,
    FAIL_BADGE,
    WIFI_OFF,
    FIRST_SYNC_PENDING,
};

class StateMachine {
public:
    StateMachine();

    void setWifiConnected(bool connected);
    void onSyncSuccess(time_t now);
    void onSyncFailure(time_t now);

    FirmwareState state() const { return state_; }
    time_t lastSuccessTs() const { return last_success_ts_; }
    int consecutiveFailures() const { return consecutive_failures_; }
    int64_t ageSeconds(time_t now) const;

private:
    FirmwareState state_;
    bool wifi_connected_;
    time_t last_success_ts_;
    int consecutive_failures_;
};

}  // namespace tokei
```

`firmware/src/state_machine.cpp`:

```cpp
#include "state_machine.h"

namespace tokei {

StateMachine::StateMachine()
    : state_(FirmwareState::FIRST_SYNC_PENDING),
      wifi_connected_(true),
      last_success_ts_(0),
      consecutive_failures_(0) {}

void StateMachine::setWifiConnected(bool connected) {
    wifi_connected_ = connected;
    if (!connected) {
        state_ = FirmwareState::WIFI_OFF;
    }
}

void StateMachine::onSyncSuccess(time_t now) {
    last_success_ts_ = now;
    consecutive_failures_ = 0;
    state_ = FirmwareState::OK;
}

void StateMachine::onSyncFailure(time_t now) {
    (void)now;
    consecutive_failures_++;
    if (!wifi_connected_) {
        state_ = FirmwareState::WIFI_OFF;
        return;
    }
    if (last_success_ts_ == 0) {
        // Never had a good sync
        state_ = FirmwareState::FIRST_SYNC_PENDING;
        return;
    }
    if (consecutive_failures_ >= 2) {
        state_ = FirmwareState::FAIL_BADGE;
    } else {
        state_ = FirmwareState::STALE;
    }
}

int64_t StateMachine::ageSeconds(time_t now) const {
    if (last_success_ts_ == 0) return 0;
    return static_cast<int64_t>(now - last_success_ts_);
}

}  // namespace tokei
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pio test -e native 2>&1 | tail -20
```

Expected: all 16 tests (8 summary + 8 state machine) PASS.

- [ ] **Step 5: Commit**

```bash
git add firmware/src/state_machine.cpp firmware/src/state_machine.h firmware/test/native/test_state_machine.cpp
git commit -m "feat(firmware): firmware state machine with native tests"
```

---

## Task 7: Network (WiFi + NTP + HTTP wrapper)

**Files:**
- Create: `firmware/src/network.cpp` + `.h`

This task has no unit tests; wrapper over WiFi/NTP/HTTP libraries is verified at flash time.

- [ ] **Step 1: Write network header**

`firmware/src/network.h`:

```cpp
#pragma once
#include <stdint.h>
#include <time.h>

namespace tokei {

/** Attempts to bring up WiFi via WiFiManager. Returns true if connected. */
bool networkBegin(const char* ntp_server, const char* tz);

/** Periodic polling: maintain WiFi state, returns true if connected. */
bool networkTick();

/** Current time from RTC (after NTP sync). */
time_t networkNow();

/** Perform an HTTPS GET request with Bearer auth.
 *  Writes response body to `out_buffer` up to `buf_size - 1` chars (null-terminated).
 *  Returns HTTP status code, or -1 on transport failure.
 */
int httpGetWithBearer(const char* url, const char* bearer_token,
                      char* out_buffer, size_t buf_size);

}  // namespace tokei
```

- [ ] **Step 2: Implement network**

`firmware/src/network.cpp`:

```cpp
#include "network.h"
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

namespace tokei {

static WiFiManager wifi_manager;
static bool wifi_ok = false;

bool networkBegin(const char* ntp_server, const char* tz) {
    WiFi.mode(WIFI_STA);
    wifi_manager.setConfigPortalTimeout(180);
    wifi_ok = wifi_manager.autoConnect("Tokei-Setup");

    if (wifi_ok) {
        configTzTime(tz, ntp_server);
        Serial.printf("WiFi connected: %s\n", WiFi.SSID().c_str());
    } else {
        Serial.println("WiFi connect failed; will retry in loop");
    }
    return wifi_ok;
}

bool networkTick() {
    wifi_ok = (WiFi.status() == WL_CONNECTED);
    if (!wifi_ok) {
        WiFi.reconnect();
    }
    return wifi_ok;
}

time_t networkNow() {
    time_t now = 0;
    time(&now);
    return now;
}

int httpGetWithBearer(const char* url, const char* bearer_token,
                      char* out_buffer, size_t buf_size) {
    if (out_buffer == nullptr || buf_size == 0) return -1;
    out_buffer[0] = '\0';

    WiFiClientSecure client;
    client.setInsecure();  // TODO(tokei): pin the worker cert once stable

    HTTPClient http;
    if (!http.begin(client, url)) {
        return -1;
    }
    http.addHeader("Authorization", String("Bearer ") + bearer_token);
    http.setTimeout(30000);

    int status = http.GET();
    if (status > 0) {
        String payload = http.getString();
        strncpy(out_buffer, payload.c_str(), buf_size - 1);
        out_buffer[buf_size - 1] = '\0';
    }
    http.end();
    return status;
}

}  // namespace tokei
```

- [ ] **Step 3: Build to verify it compiles**

```bash
pio run -e esp32s3 2>&1 | tail -15
```

Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add firmware/src/network.cpp firmware/src/network.h
git commit -m "feat(firmware): network wrapper wifi+ntp+https+bearer"
```

---

## Task 8: API client

**Files:**
- Create: `firmware/src/api.cpp` + `.h`

- [ ] **Step 1: Write api.h**

`firmware/src/api.h`:

```cpp
#pragma once
#include "tokei_summary.h"

namespace tokei {

enum class ApiResult : uint8_t {
    OK,
    TRANSPORT_FAILURE,
    HTTP_ERROR,
    PARSE_ERROR,
};

/** Fetch /v1/summary and parse into `out`. On anything other than OK,
 *  out.valid is set to false.
 */
ApiResult fetchSummary(const char* worker_url, const char* bearer_token,
                       TokeiSummary& out, int* out_http_status = nullptr);

}  // namespace tokei
```

- [ ] **Step 2: Implement api.cpp**

`firmware/src/api.cpp`:

```cpp
#include "api.h"
#include "network.h"
#include "summary_parser.h"
#include <Arduino.h>
#include <string.h>

namespace tokei {

static const size_t RESPONSE_BUFFER_SIZE = 16 * 1024;

ApiResult fetchSummary(const char* worker_url, const char* bearer_token,
                       TokeiSummary& out, int* out_http_status) {
    out.valid = false;

    static char response_buffer[RESPONSE_BUFFER_SIZE];

    char url[256];
    snprintf(url, sizeof(url), "%s/v1/summary", worker_url);

    int status = httpGetWithBearer(url, bearer_token, response_buffer, RESPONSE_BUFFER_SIZE);
    if (out_http_status != nullptr) {
        *out_http_status = status;
    }

    if (status < 0) {
        Serial.println("fetchSummary: transport failure");
        return ApiResult::TRANSPORT_FAILURE;
    }
    if (status < 200 || status >= 300) {
        Serial.printf("fetchSummary: HTTP %d\n", status);
        return ApiResult::HTTP_ERROR;
    }

    if (!parseSummary(response_buffer, out)) {
        Serial.println("fetchSummary: parse error");
        return ApiResult::PARSE_ERROR;
    }
    return ApiResult::OK;
}

}  // namespace tokei
```

- [ ] **Step 3: Build**

```bash
pio run -e esp32s3 2>&1 | tail -10
```

Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add firmware/src/api.cpp firmware/src/api.h
git commit -m "feat(firmware): api client wrapping network + parser"
```

---

## Task 9: Sensors (SHTC3 + PCF85063 RTC + battery ADC)

**Files:**
- Create: `firmware/src/sensors.cpp` + `.h`

The vendor BSP already provides SHTC3 and PCF85063 helpers (example code `05_I2C_SHTC3` and `04_I2C_PCF85063` in the upstream repo) so we wrap those here. If the vendor BSP is missing, provide a graceful fallback that reports zero/default values.

- [ ] **Step 1: Write sensors.h**

`firmware/src/sensors.h`:

```cpp
#pragma once
#include <stdint.h>

namespace tokei {

struct SensorReading {
    float temperature_c;  // -99 on read failure
    float humidity_pct;   // -1 on read failure
    float battery_pct;    // -1 on read failure
    bool shtc3_ok;
    bool battery_ok;
};

void sensorsBegin();
SensorReading sensorsRead();

}  // namespace tokei
```

- [ ] **Step 2: Implement sensors.cpp**

`firmware/src/sensors.cpp`:

```cpp
#include "sensors.h"
#include <Arduino.h>
#include <Wire.h>

namespace tokei {

// SHTC3 I2C address and commands
static constexpr uint8_t SHTC3_ADDR = 0x70;
static constexpr uint16_t SHTC3_CMD_MEASURE_NORMAL = 0x7866;

// Battery ADC pin from vendor BSP (Waveshare ESP32-S3-RLCD-4.2)
// GPIO 1 is wired to the battery voltage divider on the board.
static constexpr int BATTERY_ADC_PIN = 1;
static constexpr float BATTERY_FULL_V = 4.2f;
static constexpr float BATTERY_EMPTY_V = 3.2f;
static constexpr float ADC_REF_V = 3.3f;
static constexpr float ADC_DIVIDER_RATIO = 2.0f;

void sensorsBegin() {
    Wire.begin();
    analogReadResolution(12);
}

static bool readShtc3(float& t_c, float& rh_pct) {
    // Wake up
    Wire.beginTransmission(SHTC3_ADDR);
    Wire.write(0x35);
    Wire.write(0x17);
    if (Wire.endTransmission() != 0) return false;
    delayMicroseconds(240);

    // Measure
    Wire.beginTransmission(SHTC3_ADDR);
    Wire.write(static_cast<uint8_t>(SHTC3_CMD_MEASURE_NORMAL >> 8));
    Wire.write(static_cast<uint8_t>(SHTC3_CMD_MEASURE_NORMAL & 0xFF));
    if (Wire.endTransmission() != 0) return false;
    delay(13);

    Wire.requestFrom(SHTC3_ADDR, (uint8_t)6);
    if (Wire.available() < 6) return false;

    uint16_t raw_t = (Wire.read() << 8) | Wire.read();
    Wire.read();  // CRC
    uint16_t raw_rh = (Wire.read() << 8) | Wire.read();
    Wire.read();  // CRC

    t_c = -45.0f + 175.0f * (static_cast<float>(raw_t) / 65535.0f);
    rh_pct = 100.0f * (static_cast<float>(raw_rh) / 65535.0f);

    // Sleep
    Wire.beginTransmission(SHTC3_ADDR);
    Wire.write(0xB0);
    Wire.write(0x98);
    Wire.endTransmission();
    return true;
}

static float readBatteryPct() {
    uint32_t raw = analogRead(BATTERY_ADC_PIN);
    float v_measured = (static_cast<float>(raw) / 4095.0f) * ADC_REF_V;
    float v_battery = v_measured * ADC_DIVIDER_RATIO;
    float pct = (v_battery - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V) * 100.0f;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return pct;
}

SensorReading sensorsRead() {
    SensorReading r{-99.0f, -1.0f, -1.0f, false, false};

    float t = -99, rh = -1;
    if (readShtc3(t, rh)) {
        r.temperature_c = t;
        r.humidity_pct = rh;
        r.shtc3_ok = true;
    }

    r.battery_pct = readBatteryPct();
    r.battery_ok = true;  // ADC always succeeds in practice; dial in thresholds later

    return r;
}

}  // namespace tokei
```

Note: PCF85063 RTC reading is omitted because we use NTP via the ESP32's SNTP client to set the system clock directly (simpler than dual-source). The PCF85063 on the board would only matter if we wanted time-across-reboots-without-WiFi; NTP covers our 1 h cadence.

- [ ] **Step 3: Build**

```bash
pio run -e esp32s3 2>&1 | tail -10
```

Expected: SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add firmware/src/sensors.cpp firmware/src/sensors.h
git commit -m "feat(firmware): shtc3 and battery adc sensors"
```

---

## Task 10: UI layout builder

**Files:**
- Create: `firmware/src/ui.cpp` + `.h`

The UI module builds the full LVGL object tree on the active screen. It has one entry point `uiRender(summary, sensors, state)` that is called after every successful or failed fetch. For simplicity we rebuild the screen each tick when data changes; LVGL's object diffing is not used.

- [ ] **Step 1: Write ui.h**

`firmware/src/ui.h`:

```cpp
#pragma once
#include "tokei_summary.h"
#include "sensors.h"
#include "state_machine.h"

namespace tokei {

void uiInit();
void uiRender(const TokeiSummary& summary,
              const SensorReading& sensors,
              FirmwareState state,
              int64_t age_seconds);

}  // namespace tokei
```

- [ ] **Step 2: Implement ui.cpp**

`firmware/src/ui.cpp`:

```cpp
#include "ui.h"
#include <lvgl.h>
#include <stdio.h>
#include <time.h>

namespace tokei {

static lv_obj_t* root = nullptr;

static void formatCompact(int64_t tokens, char* out, size_t len) {
    if (tokens >= 1'000'000) {
        snprintf(out, len, "%.2fM", tokens / 1'000'000.0f);
    } else if (tokens >= 1000) {
        snprintf(out, len, "%lldk", static_cast<long long>(tokens / 1000));
    } else {
        snprintf(out, len, "%lld", static_cast<long long>(tokens));
    }
}

static void formatAge(int64_t seconds, char* out, size_t len) {
    if (seconds < 0) seconds = 0;
    if (seconds < 60) snprintf(out, len, "%llds", static_cast<long long>(seconds));
    else if (seconds < 3600) snprintf(out, len, "%lldm", static_cast<long long>(seconds / 60));
    else snprintf(out, len, "%lldh", static_cast<long long>(seconds / 3600));
}

void uiInit() {
    root = lv_scr_act();
    lv_obj_set_style_bg_color(root, lv_color_white(), 0);
    lv_obj_clean(root);
}

void uiRender(const TokeiSummary& s,
              const SensorReading& sensors,
              FirmwareState state,
              int64_t age_seconds) {
    if (root == nullptr) uiInit();
    lv_obj_clean(root);
    lv_obj_set_style_bg_color(root, lv_color_white(), 0);
    lv_obj_set_style_text_color(root, lv_color_black(), 0);

    // ========== STATUS BAR (top 24 px) ==========
    lv_obj_t* bar = lv_obj_create(root);
    lv_obj_set_size(bar, 400, 24);
    lv_obj_set_pos(bar, 0, 0);
    lv_obj_set_style_bg_color(bar, lv_color_white(), 0);
    lv_obj_set_style_border_width(bar, 0, 0);
    lv_obj_set_style_pad_all(bar, 0, 0);

    // TOKEI brand (inverse)
    lv_obj_t* brand = lv_obj_create(bar);
    lv_obj_set_size(brand, 60, 24);
    lv_obj_set_pos(brand, 0, 0);
    lv_obj_set_style_bg_color(brand, lv_color_black(), 0);
    lv_obj_set_style_border_width(brand, 0, 0);
    lv_obj_set_style_pad_all(brand, 0, 0);
    lv_obj_t* brand_lbl = lv_label_create(brand);
    lv_label_set_text(brand_lbl, "TOKEI");
    lv_obj_set_style_text_color(brand_lbl, lv_color_white(), 0);
    lv_obj_center(brand_lbl);

    // Date + time middle
    time_t now = time(nullptr);
    struct tm tm_now;
    localtime_r(&now, &tm_now);
    char datetime[32];
    strftime(datetime, sizeof(datetime), "%a %m-%d %H:%M", &tm_now);
    lv_obj_t* dt = lv_label_create(bar);
    lv_label_set_text(dt, datetime);
    lv_obj_align(dt, LV_ALIGN_LEFT_MID, 70, 0);

    // Right environment info
    char env[48];
    snprintf(env, sizeof(env), "%.1fC %.0f%%  BAT %.0f%%",
             sensors.shtc3_ok ? sensors.temperature_c : 0.0f,
             sensors.shtc3_ok ? sensors.humidity_pct : 0.0f,
             sensors.battery_pct);
    lv_obj_t* env_lbl = lv_label_create(bar);
    lv_label_set_text(env_lbl, env);
    lv_obj_align(env_lbl, LV_ALIGN_RIGHT_MID, -6, 0);

    // Bottom border under status bar
    lv_obj_t* bar_sep = lv_obj_create(root);
    lv_obj_set_size(bar_sep, 400, 1);
    lv_obj_set_pos(bar_sep, 0, 24);
    lv_obj_set_style_bg_color(bar_sep, lv_color_black(), 0);
    lv_obj_set_style_border_width(bar_sep, 0, 0);

    // ========== FIRST_SYNC_PENDING full screen ==========
    if (state == FirmwareState::FIRST_SYNC_PENDING || !s.valid) {
        lv_obj_t* wait = lv_label_create(root);
        lv_label_set_text(wait, "WAITING FOR FIRST SYNC");
        lv_obj_align(wait, LV_ALIGN_CENTER, 0, -20);

        lv_obj_t* sub = lv_label_create(root);
        lv_label_set_text(sub, "Check WiFi and worker URL.\nRetrying...");
        lv_obj_align(sub, LV_ALIGN_CENTER, 0, 20);
        return;
    }

    // ========== LEFT HERO (x 0..158, y 25..199) ==========
    lv_obj_t* left = lv_obj_create(root);
    lv_obj_set_size(left, 158, 175);
    lv_obj_set_pos(left, 0, 25);
    lv_obj_set_style_bg_color(left, lv_color_white(), 0);
    lv_obj_set_style_border_width(left, 0, 0);
    lv_obj_set_style_pad_all(left, 8, 0);

    lv_obj_t* today_lbl = lv_label_create(left);
    lv_label_set_text(today_lbl, "TODAY");
    lv_obj_set_pos(today_lbl, 0, 0);

    char big[32];
    if (s.today_total_tokens >= 1'000'000) {
        snprintf(big, sizeof(big), "%.2f", s.today_total_tokens / 1'000'000.0f);
    } else {
        snprintf(big, sizeof(big), "%lldk", static_cast<long long>(s.today_total_tokens / 1000));
    }
    lv_obj_t* big_lbl = lv_label_create(left);
    lv_label_set_text(big_lbl, big);
    lv_obj_set_pos(big_lbl, 0, 16);
    lv_obj_set_style_text_font(big_lbl, &lv_font_montserrat_48, 0);

    const char* unit_text = (s.today_total_tokens >= 1'000'000) ? "M tokens" : "k tokens";
    lv_obj_t* unit_lbl = lv_label_create(left);
    lv_label_set_text(unit_lbl, unit_text);
    lv_obj_set_pos(unit_lbl, 0, 64);

    char usd[32];
    snprintf(usd, sizeof(usd), "$%.2f", s.today_total_usd);
    lv_obj_t* usd_lbl = lv_label_create(left);
    lv_label_set_text(usd_lbl, usd);
    lv_obj_set_pos(usd_lbl, 0, 80);

    char month_str[48];
    char month_tokens_s[16];
    formatCompact(s.month_total_tokens, month_tokens_s, sizeof(month_tokens_s));
    snprintf(month_str, sizeof(month_str), "Month %s $%.0f", month_tokens_s, s.month_total_usd);
    lv_obj_t* month_lbl = lv_label_create(left);
    lv_label_set_text(month_lbl, month_str);
    lv_obj_set_pos(month_lbl, 0, 98);

    // Sparkline as 7 rectangles at bottom of left column
    int spark_max = 1;
    for (int i = 0; i < 7; i++) if (s.sparkline_7d[i] > spark_max) spark_max = s.sparkline_7d[i];
    for (int i = 0; i < 7; i++) {
        lv_obj_t* bar_i = lv_obj_create(left);
        int h = 2 + (s.sparkline_7d[i] * 18) / spark_max;
        lv_obj_set_size(bar_i, 12, h);
        lv_obj_set_pos(bar_i, i * 16, 140 - h);
        lv_obj_set_style_bg_color(bar_i, lv_color_black(), 0);
        lv_obj_set_style_border_width(bar_i, 0, 0);
    }

    // Vertical separator between left and right
    lv_obj_t* vsep = lv_obj_create(root);
    lv_obj_set_size(vsep, 1, 175);
    lv_obj_set_pos(vsep, 158, 25);
    lv_obj_set_style_bg_color(vsep, lv_color_black(), 0);
    lv_obj_set_style_border_width(vsep, 0, 0);

    // ========== RIGHT TOOL LIST ==========
    lv_obj_t* right = lv_obj_create(root);
    lv_obj_set_size(right, 241, 175);
    lv_obj_set_pos(right, 159, 25);
    lv_obj_set_style_bg_color(right, lv_color_white(), 0);
    lv_obj_set_style_border_width(right, 0, 0);
    lv_obj_set_style_pad_all(right, 6, 0);

    uint8_t n = s.tool_count;
    if (n == 0) n = 1;
    int row_h = 175 / n;

    for (uint8_t i = 0; i < s.tool_count; i++) {
        lv_obj_t* name = lv_label_create(right);
        lv_label_set_text(name, s.tools[i].name);
        lv_obj_set_pos(name, 0, i * row_h + 4);

        char val[16];
        formatCompact(s.tools[i].today_tokens, val, sizeof(val));
        lv_obj_t* val_lbl = lv_label_create(right);
        lv_label_set_text(val_lbl, val);
        lv_obj_set_style_text_font(val_lbl, &lv_font_montserrat_28, 0);
        lv_obj_align(val_lbl, LV_ALIGN_TOP_RIGHT, -4, i * row_h);

        if (i < s.tool_count - 1) {
            lv_obj_t* row_sep = lv_obj_create(right);
            lv_obj_set_size(row_sep, 229, 1);
            lv_obj_set_pos(row_sep, 0, (i + 1) * row_h);
            lv_obj_set_style_bg_color(row_sep, lv_color_black(), 0);
            lv_obj_set_style_border_width(row_sep, 0, 0);
        }
    }

    // Horizontal separator above quote footer
    lv_obj_t* hsep = lv_obj_create(root);
    lv_obj_set_size(hsep, 400, 1);
    lv_obj_set_pos(hsep, 0, 200);
    lv_obj_set_style_bg_color(hsep, lv_color_black(), 0);
    lv_obj_set_style_border_width(hsep, 0, 0);

    // ========== QUOTE FOOTER (200..300) ==========
    lv_obj_t* foot = lv_obj_create(root);
    lv_obj_set_size(foot, 400, 100);
    lv_obj_set_pos(foot, 0, 201);
    lv_obj_set_style_bg_color(foot, lv_color_white(), 0);
    lv_obj_set_style_border_width(foot, 0, 0);
    lv_obj_set_style_pad_all(foot, 8, 0);

    lv_obj_t* daily = lv_label_create(foot);
    lv_label_set_text(daily, "DAILY");
    lv_obj_align(daily, LV_ALIGN_TOP_LEFT, 0, 0);

    lv_obj_t* cat = lv_label_create(foot);
    lv_label_set_text(cat, s.quote_category);
    lv_obj_align(cat, LV_ALIGN_TOP_RIGHT, 0, 0);

    lv_obj_t* text = lv_label_create(foot);
    lv_label_set_long_mode(text, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(text, 384);
    lv_label_set_text(text, s.quote_text);
    lv_obj_align(text, LV_ALIGN_TOP_LEFT, 0, 18);

    lv_obj_t* attr = lv_label_create(foot);
    char attr_str[96];
    snprintf(attr_str, sizeof(attr_str), "- %s", s.quote_attr);
    lv_label_set_text(attr, attr_str);
    lv_obj_align(attr, LV_ALIGN_BOTTOM_RIGHT, -4, -4);

    // ========== ERROR BADGE OVERLAY ==========
    const char* badge_text = nullptr;
    char badge_buf[64];
    char age_buf[16];
    formatAge(age_seconds, age_buf, sizeof(age_buf));

    if (state == FirmwareState::FAIL_BADGE) {
        snprintf(badge_buf, sizeof(badge_buf), "! SYNC FAIL %s OLD", age_buf);
        badge_text = badge_buf;
    } else if (state == FirmwareState::WIFI_OFF) {
        snprintf(badge_buf, sizeof(badge_buf), "! NO WIFI %s OLD", age_buf);
        badge_text = badge_buf;
    } else if (state == FirmwareState::OK || state == FirmwareState::STALE) {
        snprintf(badge_buf, sizeof(badge_buf), "SYNC %s AGO", age_buf);
        badge_text = badge_buf;
    }

    if (badge_text != nullptr) {
        lv_obj_t* badge = lv_obj_create(root);
        bool inverse = (state == FirmwareState::FAIL_BADGE || state == FirmwareState::WIFI_OFF);
        int w = 160;
        lv_obj_set_size(badge, w, 18);
        lv_obj_set_pos(badge, 400 - w - 4, 28);
        lv_obj_set_style_bg_color(badge, inverse ? lv_color_black() : lv_color_white(), 0);
        lv_obj_set_style_border_width(badge, 0, 0);
        lv_obj_set_style_pad_all(badge, 0, 0);

        lv_obj_t* badge_lbl = lv_label_create(badge);
        lv_label_set_text(badge_lbl, badge_text);
        lv_obj_set_style_text_color(badge_lbl, inverse ? lv_color_white() : lv_color_black(), 0);
        lv_obj_center(badge_lbl);
    }
}

}  // namespace tokei
```

- [ ] **Step 3: Build**

```bash
pio run -e esp32s3 2>&1 | tail -15
```

Expected: SUCCESS. If `lv_font_montserrat_48` isn't enabled, add `-DLV_FONT_MONTSERRAT_48=1 -DLV_FONT_MONTSERRAT_28=1` to `build_flags` in `platformio.ini` and retry.

- [ ] **Step 4: Commit**

```bash
git add firmware/src/ui.cpp firmware/src/ui.h
git commit -m "feat(firmware): lvgl ui layout with split zones and error badge"
```

---

## Task 11: Main loop wiring

**Files:**
- Modify: `firmware/src/main.cpp`

- [ ] **Step 1: Replace main.cpp with full loop**

`firmware/src/main.cpp`:

```cpp
#include <Arduino.h>
#include <lvgl.h>
#include "config.h"
#include "lvgl_setup.h"
#include "network.h"
#include "api.h"
#include "sensors.h"
#include "ui.h"
#include "state_machine.h"

using namespace tokei;

static TokeiSummary g_summary{};
static StateMachine g_sm;
static SensorReading g_sensors{};
static uint32_t g_last_fetch_ms = 0;
static uint32_t g_last_render_ms = 0;
static bool g_first_fetch_done = false;

static void fetchAndUpdate() {
    int http_status = 0;
    ApiResult r = fetchSummary(TOKEI_WORKER_URL, TOKEI_BEARER_TOKEN, g_summary, &http_status);
    time_t now = networkNow();
    if (r == ApiResult::OK) {
        g_sm.onSyncSuccess(now);
        g_first_fetch_done = true;
    } else {
        g_sm.onSyncFailure(now);
    }
}

void setup() {
    Serial.begin(115200);
    delay(100);
    Serial.println("Tokei firmware booting");

    lvgl_setup_init();
    sensorsBegin();
    uiInit();

    // Show waiting screen before attempting WiFi
    uiRender(g_summary, g_sensors, FirmwareState::FIRST_SYNC_PENDING, 0);
    lvgl_setup_tick();

    bool wifi_up = networkBegin(TOKEI_NTP_SERVER, TOKEI_NTP_TZ);
    g_sm.setWifiConnected(wifi_up);

    if (wifi_up) {
        fetchAndUpdate();
    }
    g_last_fetch_ms = millis();
}

void loop() {
    lvgl_setup_tick();

    uint32_t now_ms = millis();

    bool wifi_up = networkTick();
    g_sm.setWifiConnected(wifi_up);

    if (wifi_up && (now_ms - g_last_fetch_ms) >= TOKEI_POLL_INTERVAL_MS) {
        fetchAndUpdate();
        g_last_fetch_ms = now_ms;
    }

    if ((now_ms - g_last_render_ms) >= 5000) {
        g_sensors = sensorsRead();
        int64_t age = g_sm.ageSeconds(networkNow());
        uiRender(g_summary, g_sensors, g_sm.state(), age);
        g_last_render_ms = now_ms;
    }

    delay(5);
}
```

- [ ] **Step 2: Build**

```bash
pio run -e esp32s3 2>&1 | tail -15
```

Expected: SUCCESS. This is the first build that wires all modules together.

- [ ] **Step 3: Commit**

```bash
git add firmware/src/main.cpp
git commit -m "feat(firmware): main loop wiring fetch+render+state machine"
```

---

## Task 12: Final compile + lint + format + test sweep

**Files:**
- None (run-only verification)

- [ ] **Step 1: Run native tests**

```bash
cd /Users/chichi/workspace/xx/tokei/firmware
pio test -e native 2>&1 | tail -20
```

Expected: all Unity tests pass.

- [ ] **Step 2: Build for target**

```bash
pio run -e esp32s3 2>&1 | tail -20
```

Expected: SUCCESS with RAM + flash usage reported. Firmware must fit in the 16 MB flash (huge_app.csv partition gives ~3 MB for app, plenty).

- [ ] **Step 3: Record sizes in EXECUTION-REPORT**

Skip this step (the subsequent task creates the report).

---

## Task 13: Execution report + manual flash guide

**Files:**
- Create: `firmware/FIRMWARE-EXECUTION-REPORT.md`
- Modify: `firmware/README.md` (add manual flash section if missing)

- [ ] **Step 1: Write execution report**

`firmware/FIRMWARE-EXECUTION-REPORT.md`:

```markdown
# Tokei Firmware Implementation · Execution Report

**Plan:** `docs/superpowers/plans/2026-04-12-tokei-firmware.md`
**Date:** 2026-04-12

## Task Status

| # | Task | Status | Commit SHA |
|---|------|--------|------------|
| 1  | Scaffold platformio project                      | DONE | <sha> |
| 2  | Vendor Waveshare BSP                              | DONE | <sha> |
| 3  | LVGL hello world on vendor BSP                    | DONE | <sha> |
| 4  | TokeiSummary struct                               | DONE | <sha> |
| 5  | Summary parser + native unit tests                | DONE | <sha> |
| 6  | State machine + native unit tests                 | DONE | <sha> |
| 7  | Network wrapper (WiFi + NTP + HTTPS)              | DONE | <sha> |
| 8  | API client                                        | DONE | <sha> |
| 9  | Sensors (SHTC3 + battery)                         | DONE | <sha> |
| 10 | LVGL UI layout                                    | DONE | <sha> |
| 11 | Main loop wiring                                  | DONE | <sha> |
| 12 | Final compile + test sweep                        | DONE | <commit or n/a> |
| 13 | Execution report + manual flash guide             | DONE | <sha> |

Fill in actual SHAs from `git log --oneline`.

## Test Summary

- Unity native tests: <pass>/<total>
- Target build: SUCCESS, RAM usage <>, flash usage <>

## Deviations from Plan

- (list any, with reason)

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
- Vendor BSP header names may differ from the plan's assumed `bsp_board.h` / `lv_port_disp.h`; check task 3 notes
- No TLS pinning on the HTTPS client (setInsecure); add once worker cert is stable
```

- [ ] **Step 2: Commit**

```bash
git add firmware/FIRMWARE-EXECUTION-REPORT.md
git commit -m "docs(firmware): execution report and manual flash guide"
```

---

## Final checklist

```bash
cd /Users/chichi/workspace/xx/tokei/firmware
pio test -e native                                # unity tests pass
pio run -e esp32s3                                # target build succeeds
```

Both must exit 0.

---

## Follow-up work (not in this plan)

1. **CJK font conversion.** Use `lv_font_conv` (npm package) to convert Noto Sans CJK TTF at 14 px into a `.c` file, add to `lib_deps` or vendor under `lib/fonts/`, and swap the quote_text label's font.
2. **TLS cert pinning.** Replace `client.setInsecure()` with a pinned Cloudflare cert once the worker is stable.
3. **OTA updates.** Add ArduinoOTA init in `setup()` so future firmware flashes can run over WiFi instead of USB.
4. **Low-power sleep.** Replace the busy wait with light sleep between pulls to save battery when untethered.
5. **Per-tool drill-down.** When `tool_count > 4`, collapse the 4+ into an "OTHERS" row; currently we show all in one shrunk column.
6. **Multi-line pretty OTLP in collector's Gemini parser** is a collector issue, not firmware.
