import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["SDA"],
  pin2: ["SCL"],
  pin3: ["VDD"],
  pin4: ["VSS"],
  pin5: ["EP"]
} as const

const pinAttributes = {
  pin3: {requiresPower: true, mustBeConnected: true, shouldHaveDecouplingCapacitor: true},
  pin4: {requiresGround: true, mustBeConnected: true},
  pin1: {isInput: true, isOutput: true, isBidirectional: true, capabilities: ["i2c_sda"], needsExternalPullup: true, canUseOpenDrain: true},
  pin2: {isInput: true, capabilities: ["i2c_scl"], needsExternalPullup: true}
} satisfies NonNullable<ChipProps["pinAttributes"]>

export const SHT40_AD1B_R2 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C2909890"
  ]
}}
      manufacturerPartNumber="SHT40-AD1B-R2"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-0.677418mm" pcbY="0.40005mm" width="0.5050028mm" height="0.419989mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-0.677418mm" pcbY="-0.40005mm" width="0.5050028mm" height="0.419989mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="0.677418mm" pcbY="-0.40005mm" width="0.5050028mm" height="0.419989mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="0.677418mm" pcbY="0.40005mm" width="0.5050028mm" height="0.419989mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="0mm" pcbY="-0mm" width="0.3999992mm" height="1.0999978mm" shape="rect" />
<silkscreenpath route={[{"x":-0.8261857999999904,"y":0.8261857999999904},{"x":0.8262111999999888,"y":0.8261857999999904}]} />
<silkscreenpath route={[{"x":-0.8261857999999904,"y":-0.826211200000003},{"x":0.8262111999999888,"y":-0.826211200000003}]} />
<silkscreencircle pcbX="-1.01346mm" pcbY="0.76454mm" radius="0.037592mm" />
<silkscreentext text="{NAME}" pcbX="-0.0508mm" pcbY="1.8382mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-1.1799193999999886,"y":1.0100187999999974},{"x":1.1799193999999886,"y":1.0100187999999974},{"x":1.1799193999999886,"y":-1.009993399999999},{"x":-1.1799193999999886,"y":-1.009993399999999},{"x":-1.1799193999999886,"y":1.0100187999999974}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2909890.obj?uuid=09d63d3bb21a495aa100cde68133c9fa",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C2909890.step?uuid=09d63d3bb21a495aa100cde68133c9fa",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0.000012700000013410317, y: -0.000012699999999199463, z: -0.01 },
      }}
      {...props}
    />
  )
}