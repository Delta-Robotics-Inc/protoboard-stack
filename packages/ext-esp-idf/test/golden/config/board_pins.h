/* Bottle core board (test fixture): pins and peripherals for ESP-IDF 5.3.5, generated from the UHD model by @protoboardai/ext-esp-idf. Do not edit. */

#pragma once

#include "driver/gpio.h" /* GPIO_NUM_x */

/* Controller */
#define BOARD_TARGET "esp32c3" /* espressif-esp32-c3-mini-1-h4x: ESP32-C3FH4X, chip revision v1.1 (4 MB flash in package) */

/* I2C0: u2, u3, u4 */
#define BOARD_I2C0_PORT 0 /* I2C controller 0 (the esp32c3 has 1) */
#define BOARD_I2C0_SDA GPIO_NUM_6 /* net i2c_sda: u1:pin_20 IO6 */
#define BOARD_I2C0_SCL GPIO_NUM_7 /* net i2c_scl: u1:pin_21 IO7 */
#define BOARD_I2C0_FREQ_HZ 400000 /* the slowest device's limit (400 kHz at most) */
#define BOARD_I2C0_INTERNAL_PULLUPS 0 /* pull-up resistors on the board */
#define BOARD_U2_I2C_ADDR 0x28 /* LED driver (ti-lp5024rsm) */
#define BOARD_U3_I2C_ADDR 0x29 /* Level sensor (st-vl53l4cdv0dh-1) */
#define BOARD_U3_GPIO1_GPIO GPIO_NUM_4 /* Level sensor GPIO1: u1:pin_18 IO4 */
#define BOARD_U3_GPIO1_ACTIVE_LEVEL 0 /* active low */
#define BOARD_U3_GPIO1_PULL GPIO_PULLUP_ONLY /* internal pull-up */
#define BOARD_U4_I2C_ADDR 0x36 /* Fuel gauge (adi-max17048g-t10) */
#define BOARD_U4_ALRT_GPIO GPIO_NUM_3 /* Fuel gauge ALRT: u1:pin_6 IO3 */
#define BOARD_U4_ALRT_ACTIVE_LEVEL 0 /* active low */
#define BOARD_U4_ALRT_PULL GPIO_PULLUP_ONLY /* internal pull-up */

/* UART1: m1 */
#define BOARD_UART1_PORT 1 /* UART 1 */
#define BOARD_UART1_TX GPIO_NUM_21 /* net gnss_rx: u1:pin_31 TXD0 */
#define BOARD_UART1_RX GPIO_NUM_20 /* net gnss_tx: u1:pin_30 RXD0 */
#define BOARD_UART1_BAUD 9600 /* m1 (GNSS) */

/* 1-Wire 0: p1 */
#define BOARD_ONEWIRE0_GPIO GPIO_NUM_10 /* DQ on net temp_dq: u1:pin_16 IO10 */
#define BOARD_ONEWIRE0_INTERNAL_PULLUP 0 /* pull-up resistor on the board */
#define BOARD_P1_RESOLUTION_BITS 12 /* Temperature probe: power-on resolution */

/* Buttons */
#define BOARD_SW1_GPIO GPIO_NUM_9 /* BOOT button: u1:pin_23 IO9 */
#define BOARD_SW1_ACTIVE_LEVEL 0 /* active low */
#define BOARD_SW1_PULL GPIO_PULLUP_ONLY /* internal pull-up */
#define BOARD_SW2_GPIO GPIO_NUM_5 /* Wake button: u1:pin_19 IO5 */
#define BOARD_SW2_ACTIVE_LEVEL 0 /* active low */
#define BOARD_SW2_PULL GPIO_PULLUP_ONLY /* internal pull-up */

/* Deep-sleep wake (esp_deep_sleep_enable_gpio_wakeup: RTC GPIOs only) */
#define BOARD_DEEP_SLEEP_WAKE_LOW_MASK ((1ULL << GPIO_NUM_5) | (1ULL << GPIO_NUM_3)) /* sw2, u4: wake when low (ESP_GPIO_WAKEUP_GPIO_LOW) */
