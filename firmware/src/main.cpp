#ifndef UNIT_TEST
#include <Arduino.h>
#include <lvgl.h>
#include "config.h"
#include "lvgl_setup.h"
#include "lvgl_bsp.h"
#include "network.h"
#include "api.h"
#include "sensors.h"
#include "ui.h"
#include "state_machine.h"

using namespace tokei;

static constexpr int KEY_PIN = 0;  // BOOT button = GPIO 0

static TokeiSummary g_summary{};
static StateMachine g_sm;
static SensorReading g_sensors{};
static uint32_t g_last_fetch_ms = 0;
static uint32_t g_last_render_ms = 0;
static uint32_t g_last_key_ms = 0;

static void fetchAndRender() {
    int http_status = 0;
    ApiResult r = fetchSummary(TOKEI_WORKER_URL, TOKEI_BEARER_TOKEN, g_summary, &http_status);
    time_t now = networkNow();
    if (r == ApiResult::OK) {
        g_sm.onSyncSuccess(now);
        Serial.printf("sync OK: %lld tokens today\n", (long long)g_summary.today_total_tokens);
    } else {
        g_sm.onSyncFailure(now);
        Serial.printf("sync FAIL: http=%d\n", http_status);
    }
    if (Lvgl_lock(1000)) {
        g_sensors = sensorsRead();
        int64_t age = g_sm.ageSeconds(networkNow());
        uiRender(g_summary, g_sensors, g_sm.state(), age);
        Lvgl_unlock();
    }
}

void setup() {
    Serial.begin(115200);
    delay(2000);
    Serial.println("Tokei firmware booting");

    pinMode(KEY_PIN, INPUT_PULLUP);

    lvgl_setup_init();
    sensorsBegin();

    if (Lvgl_lock(-1)) {
        uiInit();
        uiRender(g_summary, g_sensors, FirmwareState::FIRST_SYNC_PENDING, 0);
        Lvgl_unlock();
    }

    bool wifi_up = networkBegin(TOKEI_NTP_SERVER, TOKEI_NTP_TZ);
    g_sm.setWifiConnected(wifi_up);

    if (wifi_up) {
        fetchAndRender();
    }
    g_last_fetch_ms = millis();
    g_last_render_ms = millis();
    Serial.println("setup done");
}

void loop() {
    uint32_t now_ms = millis();

    bool wifi_up = networkTick();
    g_sm.setWifiConnected(wifi_up);

    // KEY button: single press triggers immediate refresh (debounce 500ms)
    if (digitalRead(KEY_PIN) == LOW && (now_ms - g_last_key_ms) > 500) {
        g_last_key_ms = now_ms;
        Serial.println("KEY pressed: manual refresh");
        if (wifi_up) {
            fetchAndRender();
            g_last_fetch_ms = now_ms;
        }
    }

    if (wifi_up && (now_ms - g_last_fetch_ms) >= TOKEI_POLL_INTERVAL_MS) {
        fetchAndRender();
        g_last_fetch_ms = now_ms;
    }

    if ((now_ms - g_last_render_ms) >= 30000) {
        if (Lvgl_lock(100)) {
            g_sensors = sensorsRead();
            int64_t age = g_sm.ageSeconds(networkNow());
            uiRender(g_summary, g_sensors, g_sm.state(), age);
            Lvgl_unlock();
        }
        g_last_render_ms = now_ms;
    }

    vTaskDelay(pdMS_TO_TICKS(50));
}
#endif
