#include <unity.h>
#include <string.h>
#include "summary_parser.h"
#include "tokei_summary.h"

static const char* SAMPLE = R"({
  "today": {
    "total_tokens": 1160000,
    "total_usd": 4.72,
    "tools": [
      {"name": "claude_code", "tokens": 847000, "usd": 3.40},
      {"name": "cursor",      "tokens": 312000, "usd": 1.32}
    ]
  },
  "month": {"total_tokens": 17200000, "total_usd": 77.80},
  "sparkline_7d": [850, 1100, 620, 1400, 980, 1500, 1160],
  "quote": {
    "text": "Premature optimization is the root of all evil.",
    "attr": "Donald Knuth",
    "category": "computing",
    "lang": "en"
  },
  "sync_ts": 1744370400,
  "fallback_priced_tokens": 0
})";

void setUp(void) {}
void tearDown(void) {}

void test_parses_today_total_tokens(void) {
    TokeiSummary s{};
    bool ok = tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_TRUE(ok);
    TEST_ASSERT_EQUAL_INT64(1160000, s.today_total_tokens);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 4.72f, s.today_total_usd);
}

void test_parses_tools_with_correct_order(void) {
    TokeiSummary s{};
    tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_EQUAL_UINT8(2, s.tool_count);
    TEST_ASSERT_EQUAL_STRING("claude_code", s.tools[0].name);
    TEST_ASSERT_EQUAL_INT64(847000, s.tools[0].today_tokens);
    TEST_ASSERT_EQUAL_STRING("cursor", s.tools[1].name);
    TEST_ASSERT_EQUAL_INT64(312000, s.tools[1].today_tokens);
}

void test_parses_month_total(void) {
    TokeiSummary s{};
    tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_EQUAL_INT64(17200000, s.month_total_tokens);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 77.80f, s.month_total_usd);
}

void test_parses_sparkline_7d(void) {
    TokeiSummary s{};
    tokei::parseSummary(SAMPLE, s);
    int expected[7] = {850, 1100, 620, 1400, 980, 1500, 1160};
    for (int i = 0; i < 7; i++) {
        TEST_ASSERT_EQUAL_INT(expected[i], s.sparkline_7d[i]);
    }
}

void test_parses_quote(void) {
    TokeiSummary s{};
    tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_EQUAL_STRING("Premature optimization is the root of all evil.", s.quote_text);
    TEST_ASSERT_EQUAL_STRING("Donald Knuth", s.quote_attr);
    TEST_ASSERT_EQUAL_STRING("computing", s.quote_category);
}

void test_parses_sync_ts_and_valid_flag(void) {
    TokeiSummary s{};
    bool ok = tokei::parseSummary(SAMPLE, s);
    TEST_ASSERT_TRUE(ok);
    TEST_ASSERT_EQUAL_INT64(1744370400, s.sync_ts);
    TEST_ASSERT_TRUE(s.valid);
}

void test_rejects_malformed_json(void) {
    TokeiSummary s{};
    bool ok = tokei::parseSummary("not json", s);
    TEST_ASSERT_FALSE(ok);
    TEST_ASSERT_FALSE(s.valid);
}

void test_tool_count_capped_at_max(void) {
    const char* many = R"({
      "today": {"total_tokens": 0, "total_usd": 0, "tools": [
        {"name":"t1","tokens":1,"usd":0},
        {"name":"t2","tokens":1,"usd":0},
        {"name":"t3","tokens":1,"usd":0},
        {"name":"t4","tokens":1,"usd":0},
        {"name":"t5","tokens":1,"usd":0},
        {"name":"t6","tokens":1,"usd":0},
        {"name":"t7","tokens":1,"usd":0},
        {"name":"t8","tokens":1,"usd":0}
      ]},
      "month": {"total_tokens": 0, "total_usd": 0},
      "sparkline_7d": [0,0,0,0,0,0,0],
      "quote": {"text":"x","attr":"y","category":"computing","lang":"en"},
      "sync_ts": 0,
      "fallback_priced_tokens": 0
    })";
    TokeiSummary s{};
    tokei::parseSummary(many, s);
    TEST_ASSERT_EQUAL_UINT8(TOKEI_MAX_TOOLS, s.tool_count);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_parses_today_total_tokens);
    RUN_TEST(test_parses_tools_with_correct_order);
    RUN_TEST(test_parses_month_total);
    RUN_TEST(test_parses_sparkline_7d);
    RUN_TEST(test_parses_quote);
    RUN_TEST(test_parses_sync_ts_and_valid_flag);
    RUN_TEST(test_rejects_malformed_json);
    RUN_TEST(test_tool_count_capped_at_max);
    return UNITY_END();
}
