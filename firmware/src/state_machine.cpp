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
