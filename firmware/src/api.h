#pragma once
#include "tokei_summary.h"

namespace tokei {

enum class ApiResult : uint8_t {
    OK,
    TRANSPORT_FAILURE,
    HTTP_ERROR,
    PARSE_ERROR,
};

/** Fetch /v1/summary and parse into `out`. On anything other than OK,
 *  out.valid is set to false.
 */
ApiResult fetchSummary(const char* worker_url, const char* bearer_token,
                       TokeiSummary& out, int* out_http_status = nullptr);

}  // namespace tokei
