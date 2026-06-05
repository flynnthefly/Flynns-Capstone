# Disclaimer
This is an academic project and use of this program is entirely at the user's own risk.

## About
This project is a web application for annotating/visualising whole slide images (WSI) in SVS format.

Uses Python, JavaScript, and HTML Canvas. Third-party libraries include OpenSlide, Pillow, and ClipperLib/Clipper1.

## Scope
This application is designed to be entirely local and user controlled. It is not an online database nor does it offer any automated tools (e.g. AI segmentation).

## Features
- Currently supports uploading and exporting of SVS, JPG, and PNG files.
- WSI patching based on desired square dimensions (pixels).
- Annotation tools include pen, brush, circle, square, pan, select, and zoom. When a shape is selected, backspace to delete.
- Masks window to add cell categories and filter masks to show. Select the current mask to annotate on next to the tools.

## Running
Ensure that you are under the Python environment, available here: https://www.python.org/downloads/release/python-3124/

For Windows: double click the `open` file (with the .bat extension) in root directory.

For Mac/Linux: type `./run.sh`. If permissions are denied run `chmod +x ./run.sh` and then run the first command again.

Or go to the /src/, and run the command: python app.py


