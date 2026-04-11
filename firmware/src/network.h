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
