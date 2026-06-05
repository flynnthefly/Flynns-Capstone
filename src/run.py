#!/usr/bin/env python3
import os
import platform
import subprocess
import sys
import time
import webbrowser

def main():
    current_dir = os.path.dirname(os.path.abspath(__file__))

    # Move to project root
    project_root = os.path.dirname(current_dir)
    os.chdir(project_root)

    if platform.system() == "Windows":
        pip_cmd = ["pip"]
        py_cmd = ["python"]
    else:
        pip_cmd = ["pip3"]
        py_cmd = ["python3"]

    # Step 1: Install requirements
    print("Installing dependencies...")
    try:
        subprocess.run(
            pip_cmd + ["install", "-r", os.path.join("src", "requirements.txt"), "--ignore-installed"],
            check=True
        )
    except subprocess.CalledProcessError:
        print("⚠️  Failed to install requirements.")
        sys.exit(1)

    # Step 2: Define path to Flask app
    app_path = os.path.join("src", "app.py")
    if not os.path.exists(app_path):
        print(f"❌ Error: Flask app not found at {app_path}")
        sys.exit(1)

    # Step 3: Run Flask app
    print("Starting Flask app...")
    process = subprocess.Popen(py_cmd + [app_path])

    # Step 4: Wait a moment for server to start
    time.sleep(2)

    # Step 5: Open browser
    url = "http://127.0.0.1:5000"
    print(f"Opening {url} ...")
    webbrowser.open(url)

    # Step 6: Wait for app to close or interrupt
    try:
        process.wait()
    except KeyboardInterrupt:
        print("\nStopping Flask app...")
        process.terminate()

if __name__ == "__main__":
    main()
