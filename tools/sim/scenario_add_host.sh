#!/bin/sh
# Simulator smoke test: add the mock server with the remote, connect, trust the key, sign in.
# usage: tools/sim/scenario_add_host.sh <mock-password> <screenshot-dir>
set -e
D="python3 $(dirname "$0")/drive.py"; PASS=$1; OUT=${2:-.}
w() { python3 -c "import time; time.sleep($1)"; }
$D eval 'localStorage.removeItem("hosts"); location.reload()' >/dev/null; w 2
$D key RIGHT OK                                   # This TV -> + Add host
$D type "Sim server"; $D key RIGHT; $D type "127.0.0.1"
$D key DOWN; $D type "sim"
$D key LEFT LEFT LEFT LEFT; $D eval 'document.activeElement.select()' >/dev/null; $D type "2222"
$D key DOWN RIGHT RIGHT RIGHT; $D type "$PASS"
$D key DOWN LEFT
[ "$($D eval 'document.activeElement.id')" = '"e-save"' ] || { echo "focus not on Save"; exit 1; }
$D key OK; w 1
$D shot "$OUT/01-home.png" >/dev/null
$D key OK; w 2                                    # connect -> host key prompt
$D shot "$OUT/02-hostkey.png" >/dev/null
$D key OK; w 3                                    # trust
$D shot "$OUT/03-shell.png" >/dev/null
echo "hosts: $($D eval 'localStorage.getItem("hosts")' | cut -c1-120)"
