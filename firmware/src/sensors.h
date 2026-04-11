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
