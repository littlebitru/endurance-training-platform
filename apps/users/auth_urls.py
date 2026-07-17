from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    EmailVerificationRequestView,
    EmailVerificationView,
    LogoutView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
    VerifiedTokenObtainPairView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("token/", VerifiedTokenObtainPairView.as_view(), name="token-obtain-pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("verify-email/", EmailVerificationView.as_view(), name="verify-email"),
    path("verify-email/request/", EmailVerificationRequestView.as_view(), name="verify-email-request"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
]
