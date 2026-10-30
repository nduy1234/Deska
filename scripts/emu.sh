#!/usr/bin/env bash
# Emulator helpers for driving Deska in IWER via the IWSDK CLI.
# Usage: source scripts/emu.sh; emu_enter; emu_pull cylinder 0 1.3 -0.33
# Positions are XR-origin meters. With the default standing headset at
# y=1.6 the desk anchors at y=1.2, center z=-0.36; tray slots sit at
# z=-0.53, x = -0.13 (cube), 0 (cylinder), 0.13 (sphere).

IW="timeout 90 npx @iwsdk/cli"

emu_ok() { grep -E '"ok"|"message"' | head -2; }

emu_enter() {
  $IW xr enter | emu_ok
  $IW xr set-input-mode --input-json '{"mode":"hand"}' | emu_ok
}

# emu_pull <primitive> <x> <y> <z>: pinch a tray slot and place it on the desk
emu_pull() {
  local sx
  case "$1" in cube) sx=-0.13 ;; cylinder) sx=0 ;; sphere) sx=0.13 ;; esac
  local j="{\"device\":\"hand-right\",\"steps\":[{\"position\":{\"x\":$sx,\"y\":1.245,\"z\":-0.53},\"approach\":{\"distance\":0.06},\"pinch\":{\"value\":1,\"at\":\"arrival\"}},{\"position\":{\"x\":$2,\"y\":$3,\"z\":$4}},{\"pinch\":0,\"duration\":0.15},{\"position\":{\"x\":0.25,\"y\":1.3,\"z\":-0.1}}]}"
  $IW xr run-sequence --timeout 60000 --input-json "$j" | emu_ok
}

# emu_find <Component>: list entity indices carrying a component
emu_find() {
  $IW ecs find --input-json "{\"withComponents\":[\"$1\"]}" | grep -E 'entityIndex|"name"'
}

# emu_clay <entityIndex>: print deform fields
emu_clay() {
  $IW ecs query --input-json "{\"entityIndex\":$1}" |
    grep -E '"(sx|sy|sz|waist|twist|taper|archetype|primitive)"'
}

emu_shot() {
  $IW browser screenshot --output-file "$1" | emu_ok
}

# emu_eval '<js expression>': evaluate in the app page (needs dev up --allow-browser-automation)
emu_eval() {
  printf '%s' "$1" > scripts/.eval.txt
  $IW browser run scripts/eval.mjs 2>&1 | grep -v '^\s*$' | head -60
}
