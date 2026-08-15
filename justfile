set shell := ["bash", "-cu"]

default: check test

fmt:
  moon fmt

info:
  moon info

check:
  moon check --deny-warn

test:
  moon test --deny-warn

build:
  moon build --deny-warn

release-check: fmt info check test build

wpt-svg-gen *args:
  node scripts/generate-wpt-svg.mjs {{args}}

wpt-svg *args:
  just wpt-svg-gen {{args}}
  moon run src/cmd/wpt-svg
