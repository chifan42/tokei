#ifndef UNIT_TEST
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
#endif  // UNIT_TEST
