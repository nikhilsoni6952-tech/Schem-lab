release: python manage.py migrate --no-input
web: gunicorn schemlab.wsgi:application --workers 2 --timeout 60
