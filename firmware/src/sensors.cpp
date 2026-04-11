#ifndef UNIT_TEST
#include "sensors.h"
#include <Arduino.h>
#include <Wire.h>

namespace tokei {

// SHTC3 I2C address and commands
static constexpr uint8_t SHTC3_ADDR = 0x70;
static constexpr uint16_t SHTC3_CMD_MEASURE_NORMAL = 0x7866;

// I2C pins from vendor BSP (Waveshare ESP32-S3-RLCD-4.2)
static constexpr int I2C_SDA_PIN = 13;
static constexpr int I2C_SCL_PIN = 14;

// Battery ADC: vendor uses ADC_CHANNEL_3 (GPIO 4) with 3x voltage divider
static constexpr int BATTERY_ADC_PIN = 4;
static constexpr float BATTERY_FULL_V = 4.2f;
static constexpr float BATTERY_EMPTY_V = 3.0f;
static constexpr float ADC_REF_V = 3.3f;
static constexpr float ADC_DIVIDER_RATIO = 3.0f;

void sensorsBegin() {
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
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
    r.battery_ok = true;

    return r;
}

}  // namespace tokei
#endif  // UNIT_TEST
