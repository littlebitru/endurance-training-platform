import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "unsafe-development-key")
DEBUG = os.getenv("DJANGO_DEBUG", "False").lower() == "true"
ALLOWED_HOSTS = [host.strip() for host in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")]
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "drf_spectacular",
    "apps.users",
    "apps.training",
    "apps.integrations",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": os.getenv("DB_ENGINE", "django.db.backends.postgresql"),
        "NAME": os.getenv("POSTGRES_DB", "endurance"),
        "USER": os.getenv("POSTGRES_USER", "endurance"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD", "endurance"),
        "HOST": os.getenv("POSTGRES_HOST", "db"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
AUTH_USER_MODEL = "users.User"
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "noreply@endurance.local")
EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
ACTIVITY_UPLOAD_MAX_BYTES = 20 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = ACTIVITY_UPLOAD_MAX_BYTES + 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = ACTIVITY_UPLOAD_MAX_BYTES

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardResultsSetPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": "100/hour",
        "user": "2000/hour",
        "registration": "5/hour",
        "login": "10/minute",
        "token_refresh": "120/hour",
        "account_email": "5/hour",
        "logout": "30/hour",
        "activity_import": "20/hour",
        "device_authorization": "20/hour",
    },
}
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}
JWT_REFRESH_COOKIE_NAME = os.getenv("JWT_REFRESH_COOKIE_NAME", "endurance_refresh")
JWT_REFRESH_COOKIE_SAMESITE = os.getenv("JWT_REFRESH_COOKIE_SAMESITE", "Lax")
EMAIL_VERIFICATION_MAX_AGE = int(os.getenv("EMAIL_VERIFICATION_MAX_AGE", "86400"))
SPECTACULAR_SETTINGS = {
    "TITLE": "Endurance Training API",
    "DESCRIPTION": "API for coaches and endurance athletes.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "ENUM_NAME_OVERRIDES": {
        "SportEnum": "apps.training.models.SportType.choices",
        "WorkoutStatusEnum": "apps.training.models.WORKOUT_STATUS_CHOICES",
        "DeviceConnectionStatusEnum": "apps.integrations.models.DEVICE_CONNECTION_STATUS_CHOICES",
        "WorkoutDeliveryStatusEnum": "apps.integrations.models.WORKOUT_DELIVERY_STATUS_CHOICES",
        "WellnessSeverityEnum": "apps.training.models.WELLNESS_SEVERITY_CHOICES",
    },
}

DEVICE_TOKEN_ENCRYPTION_KEY = os.getenv("DEVICE_TOKEN_ENCRYPTION_KEY", "")
GARMIN_TRAINING_API_ENABLED = os.getenv("GARMIN_TRAINING_API_ENABLED", "False").lower() == "true"
GARMIN_PARTNER_STATUS = os.getenv("GARMIN_PARTNER_STATUS", "application_required")
GARMIN_CLIENT_ID = os.getenv("GARMIN_CLIENT_ID", "")
GARMIN_CLIENT_SECRET = os.getenv("GARMIN_CLIENT_SECRET", "")
GARMIN_OAUTH_AUTHORIZATION_URL = os.getenv("GARMIN_OAUTH_AUTHORIZATION_URL", "")
GARMIN_OAUTH_TOKEN_URL = os.getenv("GARMIN_OAUTH_TOKEN_URL", "")
GARMIN_OAUTH_REVOCATION_URL = os.getenv("GARMIN_OAUTH_REVOCATION_URL", "")
GARMIN_OAUTH_REDIRECT_URI = os.getenv("GARMIN_OAUTH_REDIRECT_URI", "")
GARMIN_OAUTH_SCOPES = tuple(scope for scope in os.getenv("GARMIN_OAUTH_SCOPES", "").split() if scope)
GARMIN_TRAINING_PUBLISH_URL = os.getenv("GARMIN_TRAINING_PUBLISH_URL", "")
GARMIN_DELIVERY_WORKER_ENABLED = os.getenv("GARMIN_DELIVERY_WORKER_ENABLED", "False").lower() == "true"
