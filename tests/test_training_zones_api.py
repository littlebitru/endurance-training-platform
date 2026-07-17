import pytest
from django.urls import reverse

from apps.training.models import TrainingZone


@pytest.mark.django_db
def test_coach_can_create_zone_for_assigned_athlete(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)
    response = api_client.post(
        reverse("training-zone-list"),
        {
            "athlete": athlete.id,
            "sport": "running",
            "metric": "heart_rate",
            "zone_number": 2,
            "name": "Aerobic",
            "lower_bound": "135.00",
            "upper_bound": "150.00",
            "unit": "bpm",
        },
    )
    assert response.status_code == 201
    assert TrainingZone.objects.filter(athlete=athlete, zone_number=2).exists()


@pytest.mark.django_db
def test_athlete_can_read_but_not_change_zones(api_client, coach, athlete, relationship):
    zone = TrainingZone.objects.create(
        athlete=athlete,
        sport="cycling",
        metric="power",
        zone_number=1,
        name="Recovery",
        lower_bound=0,
        upper_bound=150,
        unit="W",
    )
    api_client.force_authenticate(athlete)
    assert api_client.get(reverse("training-zone-list")).data["results"][0]["id"] == zone.id
    assert (
        api_client.patch(reverse("training-zone-detail", kwargs={"pk": zone.pk}), {"upper_bound": 160}).status_code
        == 403
    )


@pytest.mark.django_db
def test_zone_rejects_invalid_bounds(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)
    response = api_client.post(
        reverse("training-zone-list"),
        {
            "athlete": athlete.id,
            "sport": "running",
            "metric": "heart_rate",
            "zone_number": 1,
            "name": "Invalid",
            "lower_bound": "150.00",
            "upper_bound": "140.00",
            "unit": "bpm",
        },
    )
    assert response.status_code == 400
