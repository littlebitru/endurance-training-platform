FROM python:3.14-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN addgroup --system django && adduser --system --ingroup django django
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=django:django . .
RUN chmod +x /app/docker-entrypoint.sh
USER django

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:{}/health/'.format(os.getenv('PORT', '8000')), timeout=2)"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 3"]
