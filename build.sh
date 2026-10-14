#!/usr/bin/env bash
# Build step for hosting platforms: install, collect static files, update the database.
set -o errexit
pip install --upgrade pip
pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate --no-input
