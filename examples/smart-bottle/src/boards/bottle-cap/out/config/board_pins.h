/* Bottle cap board: pins and peripherals for ESP-IDF 5.3.5, generated from the UHD model by @protoboardai/ext-esp-idf. Do not edit. */

#pragma once

#include "driver/gpio.h" /* GPIO_NUM_x */

/* Controller */
#define BOARD_TARGET "esp32c3" /* espressif-esp32-c3-mini-1-h4x: ESP32-C3FH4X, chip revision v1.1 (4 MB flash in package) */

/* I2C0: u2, u3, u6 */
#define BOARD_I2C0_PORT 0 /* I2C controller 0 (the esp32c3 has 1) */
#define BOARD_I2C0_SDA GPIO_NUM_8 /* net i2c_sda: u1:pin_22 IO8 */
#define BOARD_I2C0_SCL GPIO_NUM_2 /* net i2c_scl: u1:pin_5 IO2 */
#define BOARD_I2C0_FREQ_HZ 400000 /* the slowest device's limit (400 kHz at most) */
#define BOARD_I2C0_INTERNAL_PULLUPS 0 /* pull-up resistors on the board */
#define BOARD_U2_I2C_ADDR 0x29 /* Level sensor (ToF) (st-vl53l4cdv0dh-1) */
#define BOARD_U2_XSHUT_GPIO GPIO_NUM_0 /* Level sensor (ToF) XSHUT: u1:pin_12 IO0, pulled down by r5 */
#define BOARD_U2_XSHUT_ACTIVE_LEVEL 0 /* active low */
#define BOARD_U2_GPIO1_GPIO GPIO_NUM_1 /* Level sensor (ToF) GPIO1: u1:pin_13 IO1, pulled up by r6 */
#define BOARD_U2_GPIO1_ACTIVE_LEVEL 0 /* active low */
#define BOARD_U2_GPIO1_PULL GPIO_FLOATING /* the board has its own pull resistor */
#define BOARD_U3_I2C_ADDR 0x28 /* LED driver (ti-lp5024rsm) */
#define BOARD_U3_EN_GPIO GPIO_NUM_5 /* LED driver EN: u1:pin_19 IO5, pulled down by r9 */
#define BOARD_U3_EN_ACTIVE_LEVEL 1 /* active high */
#define BOARD_U6_I2C_ADDR 0x36 /* Fuel gauge (adi-max17048g-t10) */
#define BOARD_U6_ALRT_GPIO GPIO_NUM_6 /* Fuel gauge ALRT: u1:pin_20 IO6, pulled up by r16 */
#define BOARD_U6_ALRT_ACTIVE_LEVEL 0 /* active low */
#define BOARD_U6_ALRT_PULL GPIO_FLOATING /* the board has its own pull resistor */

/* 1-Wire 0: jprb */
#define BOARD_ONEWIRE0_GPIO GPIO_NUM_4 /* DQ on net temp_dq: u1:pin_18 IO4 */
#define BOARD_ONEWIRE0_INTERNAL_PULLUP 0 /* pull-up resistor on the board */

/* Buttons */
#define BOARD_SW1_GPIO GPIO_NUM_3 /* Button: u1:pin_6 IO3, pulled up by r8 */
#define BOARD_SW1_ACTIVE_LEVEL 0 /* active low */
#define BOARD_SW1_PULL GPIO_FLOATING /* the board has its own pull resistor */

/* Status and control lines */
#define BOARD_U5_STAT_GPIO GPIO_NUM_7 /* LiPo charger STAT (through r14): u1:pin_21 IO7, pulled down by r15 */
#define BOARD_U5_STAT_ACTIVE_LEVEL 1 /* active high */
#define BOARD_U5_STAT_PULL GPIO_FLOATING /* the board has its own pull resistor */
#define BOARD_VBUS_SENSE_GPIO GPIO_NUM_10 /* VBUS sense (through r17): u1:pin_16 IO10, pulled down by r18 */
#define BOARD_VBUS_SENSE_ACTIVE_LEVEL 1 /* active high */
#define BOARD_VBUS_SENSE_PULL GPIO_FLOATING /* the board has its own pull resistor */

/* Deep-sleep wake (esp_deep_sleep_enable_gpio_wakeup: RTC GPIOs only) */
#define BOARD_DEEP_SLEEP_WAKE_LOW_MASK ((1ULL << GPIO_NUM_3)) /* sw1: wake when low (ESP_GPIO_WAKEUP_GPIO_LOW) */
