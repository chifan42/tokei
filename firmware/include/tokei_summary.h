#pragma once
#include <stdint.h>
#include <time.h>

#define TOKEI_MAX_TOOLS 6
#define TOKEI_TOOL_NAME_LEN 32
#define TOKEI_QUOTE_TEXT_LEN 256
#define TOKEI_QUOTE_ATTR_LEN 64
#define TOKEI_QUOTE_CATEGORY_LEN 32

struct ToolEntry {
    char name[TOKEI_TOOL_NAME_LEN];
    int64_t today_tokens;
    int64_t month_tokens;
    float today_usd;
    float month_usd;
    int sparkline_7d[7];
};

struct TokeiSummary {
    int64_t today_total_tokens;
    float today_total_usd;
    int64_t month_total_tokens;
    float month_total_usd;
    int sparkline_7d[7];  // k tokens/day oldest to newest
    ToolEntry tools[TOKEI_MAX_TOOLS];
    uint8_t tool_count;
    char quote_text[TOKEI_QUOTE_TEXT_LEN];
    char quote_attr[TOKEI_QUOTE_ATTR_LEN];
    char quote_category[TOKEI_QUOTE_CATEGORY_LEN];
    time_t sync_ts;
    int64_t fallback_priced_tokens;
    bool valid;  // false = no data rendered yet (first boot)
};
