#ifndef UNIT_TEST
#include <Arduino.h>
#include <lvgl.h>
#include "lvgl_setup.h"

void setup() {
    Serial.begin(115200);
    delay(100);
    Serial.println("Tokei firmware booting");

    lvgl_setup_init();

    lv_obj_t* screen = lv_scr_act();
    lv_obj_set_style_bg_color(screen, lv_color_white(), 0);

    lv_obj_t* label = lv_label_create(screen);
    lv_label_set_text(label, "TOKEI\n"
                             "Booting...");
    lv_obj_set_style_text_color(label, lv_color_black(), 0);
    lv_obj_center(label);
}

void loop() {
    lvgl_setup_tick();
    delay(5);
}
#endif  // UNIT_TEST
