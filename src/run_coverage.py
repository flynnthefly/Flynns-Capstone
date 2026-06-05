"""
Usage:
  python run_coverage.py

This will:
  - run pytest
  - produce terminal coverage summary
  - write an HTML coverage report to ./htmlcov/index.html
"""
import sys
import pytest

def main():
    args = [
        "--cov=app",               # measure coverage of app.py module
        "--cov=views",
        "--cov-report=term-missing",
        "--cov-report=html",
    ]
    # allow extra args passthrough (e.g., -k upload)
    args.extend(sys.argv[1:])
    ec = pytest.main(args)
    if ec != 0:
        sys.exit(ec)
    print("\nCoverage HTML report at: htmlcov/index.html\n")

if __name__ == "__main__":
    main()
