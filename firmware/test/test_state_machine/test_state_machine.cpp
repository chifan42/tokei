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
