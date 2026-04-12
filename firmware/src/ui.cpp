#ifndef UNIT_TEST
#include "ui.h"
#include <lvgl.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

LV_FONT_DECLARE(noto_sans_cjk_14);

namespace tokei {

static lv_obj_t* root = nullptr;

static void formatCompact(int64_t tokens, char* out, size_t len) {
    if (tokens >= 100'000'000) {
        snprintf(out, len, "%.0fM", tokens / 1'000'000.0f);
    } else if (tokens >= 10'000'000) {
        snprintf(out, len, "%.1fM", tokens / 1'000'000.0f);
    } else if (tokens >= 1'000'000) {
        snprintf(out, len, "%.2fM", tokens / 1'000'000.0f);
    } else if (tokens >= 1000) {
        snprintf(out, len, "%lldk", static_cast<long long>(tokens / 1000));
    } else {
        snprintf(out, len, "%lld", static_cast<long long>(tokens));
    }
}

static void formatAge(int64_t seconds, char* out, size_t len) {
    if (seconds < 0) seconds = 0;
    if (seconds < 60) snprintf(out, len, "%llds", static_cast<long long>(seconds));
    else if (seconds < 3600) snprintf(out, len, "%lldm", static_cast<long long>(seconds / 60));
    else snprintf(out, len, "%lldh", static_cast<long long>(seconds / 3600));
}

static const char* displayName(const char* tool) {
    if (strcmp(tool, "claude_code") == 0) return "Claude Code";
    if (strcmp(tool, "cursor") == 0) return "Cursor";
    if (strcmp(tool, "codex") == 0) return "Codex";
    if (strcmp(tool, "gemini") == 0) return "Gemini";
    return tool;
}

void uiInit() {
    root = lv_scr_act();
    lv_obj_set_style_bg_color(root, lv_color_white(), 0);
    lv_obj_clean(root);
}

void uiRender(const TokeiSummary& s,
              const SensorReading& sensors,
              FirmwareState state,
              int64_t age_seconds) {
    if (root == nullptr) uiInit();
    lv_obj_clean(root);
    lv_obj_set_style_bg_color(root, lv_color_white(), 0);
    lv_obj_set_style_text_color(root, lv_color_black(), 0);

    // ========== STATUS BAR (top 24 px) ==========
    lv_obj_t* bar = lv_obj_create(root);
    lv_obj_set_size(bar, 400, 24);
    lv_obj_set_pos(bar, 0, 0);
    lv_obj_set_style_bg_color(bar, lv_color_white(), 0);
    lv_obj_set_style_border_width(bar, 0, 0);
    lv_obj_set_style_pad_all(bar, 0, 0);

    // TOKEI brand (inverse)
    lv_obj_t* brand = lv_obj_create(bar);
    lv_obj_set_size(brand, 60, 24);
    lv_obj_set_pos(brand, 0, 0);
    lv_obj_set_style_bg_color(brand, lv_color_black(), 0);
    lv_obj_set_style_border_width(brand, 0, 0);
    lv_obj_set_style_pad_all(brand, 0, 0);
    lv_obj_t* brand_lbl = lv_label_create(brand);
    lv_label_set_text(brand_lbl, "TOKEI");
    lv_obj_set_style_text_color(brand_lbl, lv_color_white(), 0);
    lv_obj_center(brand_lbl);

    // Date + time middle
    time_t now = time(nullptr);
    struct tm tm_now;
    localtime_r(&now, &tm_now);
    char datetime[32];
    strftime(datetime, sizeof(datetime), "%a %m-%d %H:%M", &tm_now);
    lv_obj_t* dt = lv_label_create(bar);
    lv_label_set_text(dt, datetime);
    lv_obj_align(dt, LV_ALIGN_LEFT_MID, 70, 0);

    // Right environment info
    char env[48];
    snprintf(env, sizeof(env), "%.1fC %.0f%%  BAT %.0f%%",
             sensors.shtc3_ok ? sensors.temperature_c : 0.0f,
             sensors.shtc3_ok ? sensors.humidity_pct : 0.0f,
             sensors.battery_pct);
    lv_obj_t* env_lbl = lv_label_create(bar);
    lv_label_set_text(env_lbl, env);
    lv_obj_align(env_lbl, LV_ALIGN_RIGHT_MID, -6, 0);

    // Bottom border under status bar
    lv_obj_t* bar_sep = lv_obj_create(root);
    lv_obj_set_size(bar_sep, 400, 1);
    lv_obj_set_pos(bar_sep, 0, 24);
    lv_obj_set_style_bg_color(bar_sep, lv_color_black(), 0);
    lv_obj_set_style_border_width(bar_sep, 0, 0);

    // ========== FIRST_SYNC_PENDING full screen ==========
    if (state == FirmwareState::FIRST_SYNC_PENDING || !s.valid) {
        lv_obj_t* wait = lv_label_create(root);
        lv_label_set_text(wait, "WAITING FOR FIRST SYNC");
        lv_obj_align(wait, LV_ALIGN_CENTER, 0, -20);

        lv_obj_t* sub = lv_label_create(root);
        lv_label_set_text(sub, "Check WiFi and worker URL.\nRetrying...");
        lv_obj_align(sub, LV_ALIGN_CENTER, 0, 20);
        return;
    }

    // ========== LEFT HERO (x 0..158, y 25..199) ==========
    lv_obj_t* left = lv_obj_create(root);
    lv_obj_set_size(left, 158, 175);
    lv_obj_set_pos(left, 0, 25);
    lv_obj_set_style_bg_color(left, lv_color_white(), 0);
    lv_obj_set_style_border_width(left, 0, 0);
    lv_obj_set_style_pad_all(left, 8, 0);

    lv_obj_t* today_lbl = lv_label_create(left);
    lv_label_set_text(today_lbl, "TODAY");
    lv_obj_align(today_lbl, LV_ALIGN_TOP_LEFT, 0, 0);

    // SYNC badge in the left hero area, top-right corner
    char sync_buf[32];
    char age_str[16];
    formatAge(age_seconds, age_str, sizeof(age_str));
    bool badge_error = (state == FirmwareState::FAIL_BADGE || state == FirmwareState::WIFI_OFF);
    if (state == FirmwareState::FAIL_BADGE) {
        snprintf(sync_buf, sizeof(sync_buf), "! FAIL %s", age_str);
    } else if (state == FirmwareState::WIFI_OFF) {
        snprintf(sync_buf, sizeof(sync_buf), "! NO WIFI");
    } else {
        snprintf(sync_buf, sizeof(sync_buf), "SYNC %s", age_str);
    }
    lv_obj_t* sync_lbl = lv_label_create(left);
    lv_label_set_text(sync_lbl, sync_buf);
    if (badge_error) {
        lv_obj_t* sync_bg = lv_obj_create(left);
        lv_obj_set_size(sync_bg, 80, 14);
        lv_obj_align(sync_bg, LV_ALIGN_TOP_RIGHT, 0, 0);
        lv_obj_set_style_bg_color(sync_bg, lv_color_black(), 0);
        lv_obj_set_style_border_width(sync_bg, 0, 0);
        lv_obj_set_style_pad_all(sync_bg, 0, 0);
        lv_obj_t* err_lbl = lv_label_create(sync_bg);
        lv_label_set_text(err_lbl, sync_buf);
        lv_obj_set_style_text_color(err_lbl, lv_color_white(), 0);
        lv_obj_center(err_lbl);
        lv_obj_add_flag(sync_lbl, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_align(sync_lbl, LV_ALIGN_TOP_RIGHT, 0, 0);
    }

    char big[32];
    if (s.today_total_tokens >= 100'000'000) {
        snprintf(big, sizeof(big), "%.1f", s.today_total_tokens / 1'000'000.0f);
    } else if (s.today_total_tokens >= 1'000'000) {
        snprintf(big, sizeof(big), "%.2f", s.today_total_tokens / 1'000'000.0f);
    } else {
        snprintf(big, sizeof(big), "%lldk", static_cast<long long>(s.today_total_tokens / 1000));
    }
    lv_obj_t* big_lbl = lv_label_create(left);
    lv_label_set_text(big_lbl, big);
    lv_obj_set_pos(big_lbl, 0, 16);
    lv_obj_set_style_text_font(big_lbl, &lv_font_montserrat_48, 0);

    const char* unit_text = (s.today_total_tokens >= 1'000'000) ? "M tokens" : "k tokens";
    lv_obj_t* unit_lbl = lv_label_create(left);
    lv_label_set_text(unit_lbl, unit_text);
    lv_obj_set_pos(unit_lbl, 0, 64);

    char usd[32];
    snprintf(usd, sizeof(usd), "$%.2f", s.today_total_usd);
    lv_obj_t* usd_lbl = lv_label_create(left);
    lv_label_set_text(usd_lbl, usd);
    lv_obj_set_pos(usd_lbl, 0, 80);

    char month_str[48];
    char month_tokens_s[16];
    formatCompact(s.month_total_tokens, month_tokens_s, sizeof(month_tokens_s));
    snprintf(month_str, sizeof(month_str), "Month %s $%.0f", month_tokens_s, s.month_total_usd);
    lv_obj_t* month_lbl = lv_label_create(left);
    lv_label_set_text(month_lbl, month_str);
    lv_obj_set_pos(month_lbl, 0, 98);

    // Sparkline: 7 sharp rectangles spanning the left column width
    {
        int spark_max = 1;
        int left_w = 142;  // 158 - 2*8 padding
        int gap = 2;
        int bar_w = (left_w - 6 * gap) / 7;
        for (int i = 0; i < 7; i++) if (s.sparkline_7d[i] > spark_max) spark_max = s.sparkline_7d[i];
        for (int i = 0; i < 7; i++) {
            int h = (s.sparkline_7d[i] > 0) ? 2 + (s.sparkline_7d[i] * 18) / spark_max : 0;
            if (h > 0) {
                lv_obj_t* bar_i = lv_obj_create(left);
                lv_obj_set_size(bar_i, bar_w, h);
                lv_obj_set_pos(bar_i, i * (bar_w + gap), 140 - h);
                lv_obj_set_style_bg_color(bar_i, lv_color_black(), 0);
                lv_obj_set_style_border_width(bar_i, 0, 0);
                lv_obj_set_style_radius(bar_i, 0, 0);
                lv_obj_set_style_pad_all(bar_i, 0, 0);
            }
        }
    }

    // Vertical separator between left and right
    lv_obj_t* vsep = lv_obj_create(root);
    lv_obj_set_size(vsep, 1, 175);
    lv_obj_set_pos(vsep, 158, 25);
    lv_obj_set_style_bg_color(vsep, lv_color_black(), 0);
    lv_obj_set_style_border_width(vsep, 0, 0);

    // ========== RIGHT TOOL LIST ==========
    // Each tool row: top line = name (left) + number (right), then sparkline below.
    // Layout per mockup: 8px padding, row_h = 175/tool_count, sparkline 22px tall.
    lv_obj_t* right = lv_obj_create(root);
    lv_obj_set_size(right, 241, 175);
    lv_obj_set_pos(right, 159, 25);
    lv_obj_set_style_bg_color(right, lv_color_white(), 0);
    lv_obj_set_style_border_width(right, 0, 0);
    lv_obj_set_style_pad_all(right, 0, 0);

    uint8_t tc = s.tool_count;
    if (tc == 0) tc = 1;
    int row_h = 175 / tc;
    int pad_x = 10;
    int pad_y = 8;
    int spark_bar_h = 22;

    // Same-line layout: name (16px left) + number (20px right), sparkline below
    for (uint8_t i = 0; i < s.tool_count; i++) {
        int ry = i * row_h;

        // Tool name (left) and number (right) on the same line
        lv_obj_t* name = lv_label_create(right);
        lv_label_set_text(name, displayName(s.tools[i].name));
        lv_obj_set_style_text_font(name, &lv_font_montserrat_16, 0);
        lv_obj_set_pos(name, pad_x, ry + 10);

        char val[16];
        formatCompact(s.tools[i].today_tokens, val, sizeof(val));
        lv_obj_t* val_lbl = lv_label_create(right);
        lv_label_set_text(val_lbl, val);
        lv_obj_set_style_text_font(val_lbl, &lv_font_montserrat_20, 0);
        lv_obj_set_width(val_lbl, 100);
        lv_obj_set_style_text_align(val_lbl, LV_TEXT_ALIGN_RIGHT, 0);
        lv_obj_set_pos(val_lbl, 241 - pad_x - 100, ry + 8);

        // Mini sparkline: sharp rectangles spanning the tool row width
        int spark_y = ry + 34;
        int right_content_w = 241 - 2 * pad_x;  // 221px
        int tgap = 2;
        int tbar_w = (right_content_w - 6 * tgap) / 7;  // ~29px per bar
        int ts_max = 1;
        for (int j = 0; j < 7; j++) {
            if (s.tools[i].sparkline_7d[j] > ts_max)
                ts_max = s.tools[i].sparkline_7d[j];
        }
        for (int j = 0; j < 7; j++) {
            int bh = (s.tools[i].sparkline_7d[j] > 0)
                ? 2 + (s.tools[i].sparkline_7d[j] * spark_bar_h) / ts_max
                : 0;
            if (bh > 0) {
                lv_obj_t* sb = lv_obj_create(right);
                lv_obj_set_size(sb, tbar_w, bh);
                lv_obj_set_pos(sb, pad_x + j * (tbar_w + tgap), spark_y + spark_bar_h - bh);
                lv_obj_set_style_bg_color(sb, lv_color_black(), 0);
                lv_obj_set_style_border_width(sb, 0, 0);
                lv_obj_set_style_radius(sb, 0, 0);
                lv_obj_set_style_pad_all(sb, 0, 0);
            }
        }

        // Row separator
        if (i < s.tool_count - 1) {
            lv_obj_t* row_sep = lv_obj_create(right);
            lv_obj_set_size(row_sep, 221, 1);
            lv_obj_set_pos(row_sep, pad_x, (i + 1) * row_h);
            lv_obj_set_style_bg_color(row_sep, lv_color_black(), 0);
            lv_obj_set_style_border_width(row_sep, 0, 0);
        }
    }

    // Horizontal separator above quote footer
    lv_obj_t* hsep = lv_obj_create(root);
    lv_obj_set_size(hsep, 400, 1);
    lv_obj_set_pos(hsep, 0, 200);
    lv_obj_set_style_bg_color(hsep, lv_color_black(), 0);
    lv_obj_set_style_border_width(hsep, 0, 0);

    // ========== QUOTE FOOTER (200..300) ==========
    lv_obj_t* foot = lv_obj_create(root);
    lv_obj_set_size(foot, 400, 100);
    lv_obj_set_pos(foot, 0, 201);
    lv_obj_set_style_bg_color(foot, lv_color_white(), 0);
    lv_obj_set_style_border_width(foot, 0, 0);
    lv_obj_set_style_pad_all(foot, 8, 0);

    lv_obj_t* daily = lv_label_create(foot);
    lv_label_set_text(daily, "DAILY");
    lv_obj_set_style_text_font(daily, &lv_font_montserrat_16, 0);
    lv_obj_align(daily, LV_ALIGN_TOP_LEFT, 0, 0);

    lv_obj_t* cat = lv_label_create(foot);
    lv_label_set_text(cat, s.quote_category);
    lv_obj_set_style_text_font(cat, &lv_font_montserrat_16, 0);
    lv_obj_align(cat, LV_ALIGN_TOP_RIGHT, 0, 0);

    lv_obj_t* text = lv_label_create(foot);
    lv_label_set_long_mode(text, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(text, 384);
    lv_obj_set_style_text_font(text, &noto_sans_cjk_14, 0);
    lv_label_set_text(text, s.quote_text);
    lv_obj_align(text, LV_ALIGN_TOP_LEFT, 0, 20);

    lv_obj_t* attr = lv_label_create(foot);
    char attr_str[96];
    snprintf(attr_str, sizeof(attr_str), "- %s", s.quote_attr);
    lv_obj_set_style_text_font(attr, &noto_sans_cjk_14, 0);
    lv_label_set_text(attr, attr_str);
    lv_obj_align(attr, LV_ALIGN_BOTTOM_RIGHT, -4, -4);

    // SYNC badge is now rendered inside the left hero area (see above)
}

}  // namespace tokei
#endif  // UNIT_TEST
