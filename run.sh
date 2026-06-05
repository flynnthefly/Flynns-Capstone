#!/bin/bash

# need buffer/system checks
unamestr=$(uname)

# macOS
if [[ "$unamestr" == "Darwin" ]]; then
    # pip3 install -r src/requirements.txt --no-warn-already-satisfied
    # pip3 install -r --no-warn-already-satisfied src/requirements.txt
    set -o pipefail; pip3 install --ignore-installed -r src/requirements.txt | { grep -v "already satisfied" || :; }
    python3 src/app.py &
    sleep 2
    open "http://127.0.0.1:5000"

# Linux
elif [[ "$unamestr" == "Linux" ]]; then
    pip3 install -r src/requirements.txt #--no-warn-already-satisfied
    python3 src/app.py &
    sleep 2
    xdg-open "http://127.0.0.1:5000"

# Windows (Git bash or similar)
elif [[ "$unamestr" == "MINGW"* || "$unamestr" == "CYGWIN"* || "$unamestr" == "MSYS"* ]]; then
    pip install -r src/requirements.txt #--no-warn-already-satisfied
    python src/app.py &
    sleep 2
    explorer "http://127.0.0.1:5000"

else
    echo "Unsupported OS: $unamestr"
    exit 1
fi
