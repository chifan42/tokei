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
