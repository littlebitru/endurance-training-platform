import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_health_check_reports_healthy_database(api_client):
    response = api_client.get(reverse("health"))
    assert response.status_code == 200
    assert response.data == {"status": "healthy"}


@pytest.mark.django_db
def test_health_check_is_not_rate_limited(api_client):
    responses = [api_client.get(reverse("health")) for _ in range(105)]

    assert all(response.status_code == 200 for response in responses)
