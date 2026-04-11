#pragma once
#include "tokei_summary.h"

namespace tokei {

/** Parses /v1/summary JSON into a TokeiSummary struct.
 *  Returns false if JSON is malformed or required fields are missing.
 *  On failure, out.valid is set to false.
 */
bool parseSummary(const char* json, TokeiSummary& out);

}  // namespace tokei
