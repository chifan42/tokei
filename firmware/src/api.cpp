#ifndef UNIT_TEST
#include "api.h"
#include "network.h"
#include "summary_parser.h"
#include <Arduino.h>
#include <string.h>

namespace tokei {

static const size_t RESPONSE_BUFFER_SIZE = 16 * 1024;

ApiResult fetchSummary(const char* worker_url, const char* bearer_token,
                       TokeiSummary& out, int* out_http_status) {
    out.valid = false;

    static char response_buffer[RESPONSE_BUFFER_SIZE];

    char url[256];
    snprintf(url, sizeof(url), "%s/v1/summary", worker_url);

    int status = httpGetWithBearer(url, bearer_token, response_buffer, RESPONSE_BUFFER_SIZE);
    if (out_http_status != nullptr) {
        *out_http_status = status;
    }

    if (status < 0) {
        Serial.println("fetchSummary: transport failure");
        return ApiResult::TRANSPORT_FAILURE;
    }
    if (status < 200 || status >= 300) {
        Serial.printf("fetchSummary: HTTP %d\n", status);
        return ApiResult::HTTP_ERROR;
    }

    if (!parseSummary(response_buffer, out)) {
        Serial.println("fetchSummary: parse error");
        return ApiResult::PARSE_ERROR;
    }
    return ApiResult::OK;
}

}  // namespace tokei
#endif  // UNIT_TEST
