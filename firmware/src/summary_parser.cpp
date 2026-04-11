#include "summary_parser.h"
#include <ArduinoJson.h>
#include <string.h>

namespace tokei {

static void copyString(char* dest, size_t destLen, const char* src) {
    if (src == nullptr) {
        dest[0] = '\0';
        return;
    }
    strncpy(dest, src, destLen - 1);
    dest[destLen - 1] = '\0';
}

bool parseSummary(const char* json, TokeiSummary& out) {
    out.valid = false;
    out.tool_count = 0;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
        return false;
    }

    JsonObjectConst today = doc["today"].as<JsonObjectConst>();
    if (today.isNull()) return false;
    out.today_total_tokens = today["total_tokens"].as<int64_t>();
    out.today_total_usd = today["total_usd"].as<float>();

    JsonArrayConst tools = today["tools"].as<JsonArrayConst>();
    uint8_t tool_count = 0;
    for (JsonObjectConst t : tools) {
        if (tool_count >= TOKEI_MAX_TOOLS) break;
        copyString(out.tools[tool_count].name,
                   TOKEI_TOOL_NAME_LEN,
                   t["name"].as<const char*>());
        out.tools[tool_count].today_tokens = t["tokens"].as<int64_t>();
        out.tools[tool_count].today_usd = t["usd"].as<float>();
        out.tools[tool_count].month_tokens = 0;
        out.tools[tool_count].month_usd = 0;
        tool_count++;
    }
    out.tool_count = tool_count;

    JsonObjectConst month = doc["month"].as<JsonObjectConst>();
    if (!month.isNull()) {
        out.month_total_tokens = month["total_tokens"].as<int64_t>();
        out.month_total_usd = month["total_usd"].as<float>();
    } else {
        out.month_total_tokens = 0;
        out.month_total_usd = 0;
    }

    JsonArrayConst spark = doc["sparkline_7d"].as<JsonArrayConst>();
    for (int i = 0; i < 7; i++) {
        out.sparkline_7d[i] = (i < (int)spark.size()) ? spark[i].as<int>() : 0;
    }

    JsonObjectConst quote = doc["quote"].as<JsonObjectConst>();
    if (!quote.isNull()) {
        copyString(out.quote_text, TOKEI_QUOTE_TEXT_LEN, quote["text"].as<const char*>());
        copyString(out.quote_attr, TOKEI_QUOTE_ATTR_LEN, quote["attr"].as<const char*>());
        copyString(out.quote_category, TOKEI_QUOTE_CATEGORY_LEN, quote["category"].as<const char*>());
    } else {
        out.quote_text[0] = '\0';
        out.quote_attr[0] = '\0';
        out.quote_category[0] = '\0';
    }

    out.sync_ts = static_cast<time_t>(doc["sync_ts"].as<int64_t>());
    out.fallback_priced_tokens = doc["fallback_priced_tokens"].as<int64_t>();
    out.valid = true;
    return true;
}

}  // namespace tokei
