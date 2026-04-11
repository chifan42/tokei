#include "lvgl_setup.h"
#include <Arduino.h>
#include "display_bsp.h"
#include "lvgl_bsp.h"

static DisplayPort RlcdPort(12, 11, 5, 40, 41, 400, 300);

static void lvgl_flush_cb(lv_display_t* drv, const lv_area_t* area, uint8_t* color_map) {
    uint16_t* buffer = (uint16_t*)color_map;
    for (int y = area->y1; y <= area->y2; y++) {
        for (int x = area->x1; x <= area->x2; x++) {
            uint8_t color = (*buffer < 0x7fff) ? ColorBlack : ColorWhite;
            RlcdPort.RLCD_SetPixel(x, y, color);
            buffer++;
        }
    }
    RlcdPort.RLCD_Display();
    lv_disp_flush_ready(drv);
}

void lvgl_setup_init() {
    RlcdPort.RLCD_Init();
    Lvgl_PortInit(400, 300, lvgl_flush_cb);
}

void lvgl_setup_tick() {
    // The vendor BSP runs LVGL timer handler in a FreeRTOS task,
    // so we just need to acquire the lock when modifying LVGL objects.
    // No-op here; callers use Lvgl_lock()/Lvgl_unlock() around UI updates.
}
