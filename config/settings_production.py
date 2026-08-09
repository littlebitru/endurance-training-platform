import os

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

from . import settings as base_settings
from .settings import *  # noqa: F401,F403

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
if not SECRET_KEY or len(SECRET_KEY) < 50:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must contain at least 50 characters in production.")

DEBUG = False
ALLOWED_HOSTS = base_settings.ALLOWED_HOSTS.copy()
RENDER_EXTERNAL_HOSTNAME = os.getenv("RENDER_EXTERNAL_HOSTNAME")
if RENDER_EXTERNAL_HOSTNAME and RENDER_EXTERNAL_HOSTNAME not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)

if os.getenv("DATABASE_URL"):
    DATABASES = {"default": dj_database_url.config(conn_max_age=600, conn_health_checks=True, ssl_require=True)}
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",") if origin]
JWT_REFRESH_COOKIE_SAMESITE = os.getenv("JWT_REFRESH_COOKIE_SAMESITE", "None")

if base_settings.GARMIN_TRAINING_API_ENABLED:
    garmin_required_settings = {
        "DEVICE_TOKEN_ENCRYPTION_KEY": base_settings.DEVICE_TOKEN_ENCRYPTION_KEY,
        "GARMIN_CLIENT_ID": base_settings.GARMIN_CLIENT_ID,
        "GARMIN_CLIENT_SECRET": base_settings.GARMIN_CLIENT_SECRET,
        "GARMIN_OAUTH_AUTHORIZATION_URL": base_settings.GARMIN_OAUTH_AUTHORIZATION_URL,
        "GARMIN_OAUTH_TOKEN_URL": base_settings.GARMIN_OAUTH_TOKEN_URL,
        "GARMIN_OAUTH_REDIRECT_URI": base_settings.GARMIN_OAUTH_REDIRECT_URI,
    }
    missing_garmin_settings = [name for name, value in garmin_required_settings.items() if not value]
    if missing_garmin_settings:
        raise ImproperlyConfigured(
            "Garmin integration is enabled but required settings are missing: " + ", ".join(missing_garmin_settings)
        )

if base_settings.STRAVA_WEBHOOK_PROCESSING_ENABLED and not base_settings.STRAVA_INTEGRATION_ENABLED:
    raise ImproperlyConfigured("Strava webhook processing requires STRAVA_INTEGRATION_ENABLED=True.")

if base_settings.STRAVA_INTEGRATION_ENABLED:
    strava_required_settings = {
        "DEVICE_TOKEN_ENCRYPTION_KEY": base_settings.DEVICE_TOKEN_ENCRYPTION_KEY,
        "STRAVA_CLIENT_ID": base_settings.STRAVA_CLIENT_ID,
        "STRAVA_CLIENT_SECRET": base_settings.STRAVA_CLIENT_SECRET,
        "STRAVA_OAUTH_REDIRECT_URI": base_settings.STRAVA_OAUTH_REDIRECT_URI,
    }
    missing_strava_settings = [name for name, value in strava_required_settings.items() if not value]
    if missing_strava_settings:
        raise ImproperlyConfigured(
            "Strava integration is enabled but required settings are missing: " + ", ".join(missing_strava_settings)
        )
    if base_settings.STRAVA_WEBHOOK_PROCESSING_ENABLED:
        strava_webhook_required_settings = {
            "STRAVA_WEBHOOK_VERIFY_TOKEN": base_settings.STRAVA_WEBHOOK_VERIFY_TOKEN,
            "STRAVA_WEBHOOK_SUBSCRIPTION_ID": base_settings.STRAVA_WEBHOOK_SUBSCRIPTION_ID,
        }
        missing_strava_webhook_settings = [
            name for name, value in strava_webhook_required_settings.items() if not value
        ]
        if missing_strava_webhook_settings:
            raise ImproperlyConfigured(
                "Strava webhook processing is enabled but required settings are missing: "
                + ", ".join(missing_strava_webhook_settings)
            )

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True").lower() == "true"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "format": '{{"time":"{asctime}","level":"{levelname}","logger":"{name}","message":"{message}"}}',
            "style": "{",
        }
    },
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
}
