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
