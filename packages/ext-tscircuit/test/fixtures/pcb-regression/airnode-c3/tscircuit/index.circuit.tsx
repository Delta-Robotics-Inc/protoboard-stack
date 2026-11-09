// Airnode C3: the small sample board of the PCB editor regression set (Phase 0). Not for fab.
// ESP32-C3-MINI-1 module, USB-C (power and native USB), AP2112K-3.3 LDO, SHT40 on I2C,
// a power LED, a status LED and a BOOT button. 40 x 30 mm, 2 layers.
// Parts stock-checked 2026-11-09 (JLCPCB live): C2838502 ESP32-C3-MINI-1-N4 (Extended, 11.9k),
// C165948 TYPE-C-31-M-12 (Extended, 306k), C51118 AP2112K-3.3TRG1 (Extended, 12.5k),
// C2909890 SHT40-AD1B-R2 (Extended, 15.8k), C318884 TS-1187A-B-A-B (Basic, 870k),
// C2286 KT-0603R red LED (Basic, 6.6M), C2297 KT-0805G green LED (Basic, 1.9M).
// Passives: common JLC Basic numbers, not stock-checked here.
// Assumptions (verify against datasheets before any fab use): the button's A and C pins are on
// opposite sides of the switch; I2C is on IO4/IO5 to keep the IO8/IO9 strapping pins free;
// IO9 is the BOOT strap (low at reset enters download mode), IO8 is pulled high.
// Placed, not routed (routingDisabled): tscircuit's autorouter left overlapping copper of
// different nets, and KiCad's DRC then counts clearance and shorting items differently on
// every run, which a regression baseline cannot use. imports/ESP32_C3_MINI_1_N4.tsx is the
// tsci import of C2838502 with one change: the chamfered corner pad of the pin 49 ground grid
// is a plain rect like its eight neighbors. Built with tsci 0.0.3019:
//   tsci build index.circuit.tsx; tsci export index.circuit.tsx -f kicad_pcb (and -f kicad_sch)
// then airnode-c3.kicad_pcb got one fix by hand: circuit-json-to-kicad gives the net of a
// multi-pad pin to one pad only, so the eight other "49" pads of U1 were given (net 2 "GND").
import { ESP32_C3_MINI_1_N4 } from "./imports/ESP32_C3_MINI_1_N4"
import { TYPE_C_31_M_12 } from "./imports/TYPE_C_31_M_12"
import { AP2112K_3_3TRG1 } from "./imports/AP2112K_3_3TRG1"
import { SHT40_AD1B_R2 } from "./imports/SHT40_AD1B_R2"
import { TS_1187A_B_A_B } from "./imports/TS_1187A_B_A_B"

const espGnd = [
  "GND1", "GND2", "GND3", "GND4", "GND5", "GND6", "GND7", "GND8", "GND9", "GND10", "GND11",
  "GND12", "GND13", "GND14", "GND15", "GND16", "GND17", "GND18", "GND19", "GND20", "GND21", "GND22",
]

export default () => (
  <board width="40mm" height="30mm" routingDisabled>
    <ESP32_C3_MINI_1_N4 name="U1" pcbX={-11.5} pcbY={3.5} />
    <TYPE_C_31_M_12 name="J1" pcbX={14.2} pcbY={0} pcbRotation={90} />
    <AP2112K_3_3TRG1 name="U2" pcbX={6} pcbY={-9} />
    <SHT40_AD1B_R2 name="U3" pcbX={11} pcbY={10} />
    <TS_1187A_B_A_B name="SW1" pcbX={-12} pcbY={-10} />

    <capacitor name="C1" capacitance="10uF" footprint="0805" supplierPartNumbers={{ lcsc: ["C15850"] }} pcbX={10.5} pcbY={-9} />
    <capacitor name="C2" capacitance="10uF" footprint="0805" supplierPartNumbers={{ lcsc: ["C15850"] }} pcbX={1.5} pcbY={-9} />
    <capacitor name="C3" capacitance="100nF" footprint="0603" supplierPartNumbers={{ lcsc: ["C14663"] }} pcbX={-2.5} pcbY={8} />
    <capacitor name="C4" capacitance="100nF" footprint="0603" supplierPartNumbers={{ lcsc: ["C14663"] }} pcbX={11} pcbY={13} />
    <capacitor name="C5" capacitance="1uF" footprint="0603" supplierPartNumbers={{ lcsc: ["C15849"] }} pcbX={-2.5} pcbY={2} />
    <resistor name="R1" resistance="10k" footprint="0603" supplierPartNumbers={{ lcsc: ["C25804"] }} pcbX={-2.5} pcbY={5} />
    <resistor name="R2" resistance="5.1k" footprint="0603" supplierPartNumbers={{ lcsc: ["C23186"] }} pcbX={8} pcbY={-3} />
    <resistor name="R3" resistance="5.1k" footprint="0603" supplierPartNumbers={{ lcsc: ["C23186"] }} pcbX={8} pcbY={3} />
    <resistor name="R4" resistance="4.7k" footprint="0603" supplierPartNumbers={{ lcsc: ["C23162"] }} pcbX={6} pcbY={11} />
    <resistor name="R5" resistance="4.7k" footprint="0603" supplierPartNumbers={{ lcsc: ["C23162"] }} pcbX={6} pcbY={8} />
    <resistor name="R6" resistance="10k" footprint="0603" supplierPartNumbers={{ lcsc: ["C25804"] }} pcbX={-2.5} pcbY={-1} />
    <resistor name="R7" resistance="1k" footprint="0603" supplierPartNumbers={{ lcsc: ["C21190"] }} pcbX={1} pcbY={-4} />
    <resistor name="R8" resistance="1k" footprint="0603" supplierPartNumbers={{ lcsc: ["C21190"] }} pcbX={-4} pcbY={-5} />
    <led name="LED1" color="red" footprint="0603" supplierPartNumbers={{ lcsc: ["C2286"] }} pcbX={4} pcbY={-4} />
    <led name="LED2" color="green" footprint="0805" supplierPartNumbers={{ lcsc: ["C2297"] }} pcbX={-4} pcbY={-8.5} />

    {/* USB-C power and data */}
    <trace name="vbus1" from=".J1 > .VBUS1" to="net.VBUS" />
    <trace name="vbus2" from=".J1 > .VBUS2" to="net.VBUS" />
    <trace name="usbgnd1" from=".J1 > .GND1" to="net.GND" />
    <trace name="usbgnd2" from=".J1 > .GND2" to="net.GND" />
    <trace name="cc1" from=".J1 > .CC1" to=".R2 > .pin1" />
    <trace name="cc1r" from=".R2 > .pin2" to="net.GND" />
    <trace name="cc2" from=".J1 > .CC2" to=".R3 > .pin1" />
    <trace name="cc2r" from=".R3 > .pin2" to="net.GND" />
    <trace name="dp1" from=".J1 > .DP1" to="net.USB_DP" />
    <trace name="dp2" from=".J1 > .DP2" to="net.USB_DP" />
    <trace name="dn1" from=".J1 > .DN1" to="net.USB_DN" />
    <trace name="dn2" from=".J1 > .DN2" to="net.USB_DN" />
    <trace name="esp_dp" from=".U1 > .IO19" to="net.USB_DP" />
    <trace name="esp_dn" from=".U1 > .IO18" to="net.USB_DN" />

    {/* LDO, enabled from VBUS */}
    <trace name="ldo_in" from=".U2 > .VIN" to="net.VBUS" />
    <trace name="ldo_en" from=".U2 > .EN" to="net.VBUS" />
    <trace name="ldo_out" from=".U2 > .VOUT" to="net.V3V3" />
    <trace name="ldo_gnd" from=".U2 > .GND" to="net.GND" />
    <trace name="c1a" from=".C1 > .pin1" to="net.VBUS" />
    <trace name="c1b" from=".C1 > .pin2" to="net.GND" />
    <trace name="c2a" from=".C2 > .pin1" to="net.V3V3" />
    <trace name="c2b" from=".C2 > .pin2" to="net.GND" />

    {/* ESP32-C3 power, enable, strapping */}
    <trace name="esp_3v3" from=".U1 > .3V3" to="net.V3V3" />
    {espGnd.map((g) => (
      <trace name={`esp_${g}`} from={`.U1 > .${g}`} to="net.GND" />
    ))}
    <trace name="c3a" from=".C3 > .pin1" to="net.V3V3" />
    <trace name="c3b" from=".C3 > .pin2" to="net.GND" />
    <trace name="en_pu" from=".R1 > .pin1" to="net.V3V3" />
    <trace name="en" from=".R1 > .pin2" to=".U1 > .EN" />
    <trace name="en_c" from=".C5 > .pin1" to=".U1 > .EN" />
    <trace name="en_c_gnd" from=".C5 > .pin2" to="net.GND" />
    <trace name="io8_pu" from=".R6 > .pin1" to="net.V3V3" />
    <trace name="io8" from=".R6 > .pin2" to=".U1 > .IO8" />
    <trace name="boot" from=".SW1 > .A" to=".U1 > .IO9" />
    <trace name="boot_gnd" from=".SW1 > .C" to="net.GND" />

    {/* LEDs: power (red) and status on IO7 (green) */}
    <trace name="led1_r" from=".R7 > .pin1" to="net.V3V3" />
    <trace name="led1_a" from=".R7 > .pin2" to=".LED1 > .anode" />
    <trace name="led1_k" from=".LED1 > .cathode" to="net.GND" />
    <trace name="led2_r" from=".R8 > .pin1" to=".U1 > .IO7" />
    <trace name="led2_a" from=".R8 > .pin2" to=".LED2 > .anode" />
    <trace name="led2_k" from=".LED2 > .cathode" to="net.GND" />

    {/* SHT40 on I2C (address 0x44) */}
    <trace name="sht_vdd" from=".U3 > .VDD" to="net.V3V3" />
    <trace name="sht_vss" from=".U3 > .VSS" to="net.GND" />
    <trace name="sht_ep" from=".U3 > .EP" to="net.GND" />
    <trace name="c4a" from=".C4 > .pin1" to="net.V3V3" />
    <trace name="c4b" from=".C4 > .pin2" to="net.GND" />
    <trace name="sda" from=".U3 > .SDA" to="net.SDA" />
    <trace name="scl" from=".U3 > .SCL" to="net.SCL" />
    <trace name="esp_sda" from=".U1 > .IO4" to="net.SDA" />
    <trace name="esp_scl" from=".U1 > .IO5" to="net.SCL" />
    <trace name="sda_pu" from=".R4 > .pin1" to="net.SDA" />
    <trace name="sda_pu2" from=".R4 > .pin2" to="net.V3V3" />
    <trace name="scl_pu" from=".R5 > .pin1" to="net.SCL" />
    <trace name="scl_pu2" from=".R5 > .pin2" to="net.V3V3" />

    <copperpour connectsTo="net.GND" layer="bottom" />
  </board>
)
