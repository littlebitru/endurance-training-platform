from django.db import connection
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthCheckView(APIView):
    permission_classes = (permissions.AllowAny,)
    authentication_classes = ()
    throttle_classes = ()

    @extend_schema(
        responses=inline_serializer("HealthResponse", fields={"status": serializers.CharField()}),
        summary="Check API and database health",
    )
    def get(self, request):
        try:
            connection.ensure_connection()
        except Exception:
            return Response({"status": "unhealthy"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({"status": "healthy"})
