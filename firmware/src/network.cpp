#ifndef UNIT_TEST
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
        // Wait for NTP to actually sync (async operation).
        // Without this, time() returns 0 and SYNC age shows as millions of hours.
        Serial.print("NTP syncing");
        for (int i = 0; i < 20; i++) {
            time_t now = 0;
            time(&now);
            if (now > 1700000000) {
                Serial.printf(" OK (%ld)\n", (long)now);
                break;
            }
            Serial.print(".");
            delay(500);
        }
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
#endif  // UNIT_TEST
