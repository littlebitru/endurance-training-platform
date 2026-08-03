import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


class CredentialDecryptionError(Exception):
    pass


def _fernet_key() -> bytes:
    configured = settings.DEVICE_TOKEN_ENCRYPTION_KEY.strip()
    if configured:
        try:
            key = configured.encode("ascii")
            Fernet(key)
            return key
        except (ValueError, UnicodeEncodeError) as exc:
            raise ImproperlyConfigured("DEVICE_TOKEN_ENCRYPTION_KEY must be a valid Fernet key.") from exc

    if settings.GARMIN_TRAINING_API_ENABLED or settings.STRAVA_INTEGRATION_ENABLED:
        raise ImproperlyConfigured("DEVICE_TOKEN_ENCRYPTION_KEY is required when a device integration is enabled.")

    digest = hashlib.sha256(f"{settings.SECRET_KEY}:device-credentials".encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(value: str) -> str:
    if not value:
        return ""
    return Fernet(_fernet_key()).encrypt(value.encode()).decode("ascii")


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return Fernet(_fernet_key()).decrypt(value.encode("ascii")).decode()
    except (InvalidToken, UnicodeEncodeError, UnicodeDecodeError) as exc:
        raise CredentialDecryptionError("The stored device credential cannot be decrypted.") from exc
