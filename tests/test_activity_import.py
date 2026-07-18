from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone

from apps.training.models import Activity, AthleteThreshold, TrainingPlan, WeeklyPlan, Workout, WorkoutLog
from apps.training.zones import recalculate_training_zones
from apps.users.models import Profile, User


def gpx_file(started_at=None):
    start = started_at or timezone.now().replace(microsecond=0)
    points = []
    for index in range(4):
        timestamp = start + timedelta(minutes=index * 10)
        points.append(
            f"""
            <trkpt lat="{51.5 + index * 0.01}" lon="{-0.1 + index * 0.01}">
              <ele>{20 + index * 3}</ele><time>{timestamp.isoformat().replace('+00:00', 'Z')}</time>
              <extensions><hr>{145 + index * 5}</hr><cad>{82 + index}</cad></extensions>
            </trkpt>
            """
        )
    content = f"""<?xml version="1.0" encoding="UTF-8"?>
    <gpx version="1.1" creator="Endurance Test"><trk><name>Morning run</name><type>running</type>
    <trkseg>{''.join(points)}</trkseg></trk></gpx>"""
    return SimpleUploadedFile("morning-run.gpx", content.encode(), content_type="application/gpx+xml")


def tcx_file(started_at=None):
    start = started_at or timezone.now().replace(microsecond=0)
    points = []
    for index in range(3):
        timestamp = start + timedelta(minutes=index * 15)
        points.append(
            f"""
            <Trackpoint><Time>{timestamp.isoformat().replace('+00:00', 'Z')}</Time>
            <DistanceMeters>{index * 5000}</DistanceMeters><Cadence>{85 + index}</Cadence>
            <HeartRateBpm><Value>{150 + index * 4}</Value></HeartRateBpm>
            <Extensions><TPX><Speed>5.5</Speed><Watts>{210 + index * 10}</Watts></TPX></Extensions>
            </Trackpoint>
            """
        )
    content = f"""<?xml version="1.0" encoding="UTF-8"?>
    <TrainingCenterDatabase><Activities><Activity Sport="Biking">
      <Id>{start.isoformat().replace('+00:00', 'Z')}</Id>
      <Lap StartTime="{start.isoformat().replace('+00:00', 'Z')}"><TotalTimeSeconds>1800</TotalTimeSeconds>
      <DistanceMeters>10000</DistanceMeters><Calories>320</Calories><Track>{''.join(points)}</Track></Lap>
    </Activity></Activities></TrainingCenterDatabase>"""
    return SimpleUploadedFile("ride.tcx", content.encode(), content_type="application/vnd.garmin.tcx+xml")


def planned_workout(coach, athlete, scheduled_at, sport=Workout.Sport.RUNNING):
    plan = TrainingPlan.objects.create(
        coach=coach,
        athlete=athlete,
        title="Imported activity plan",
        primary_sport=sport,
        start_date=scheduled_at.date(),
        end_date=scheduled_at.date() + timedelta(days=7),
    )
    week = WeeklyPlan.objects.create(training_plan=plan, week_number=1, start_date=scheduled_at.date())
    return Workout.objects.create(
        weekly_plan=week,
        title="Planned endurance session",
        sport=sport,
        scheduled_at=scheduled_at,
        planned_duration_minutes=30,
        planned_distance_km="3.90",
    )


@pytest.mark.django_db
def test_athlete_imports_gpx_and_matches_planned_workout(api_client, coach, athlete, relationship):
    started_at = timezone.now().replace(microsecond=0)
    workout = planned_workout(coach, athlete, started_at)
    threshold = AthleteThreshold.objects.create(
        athlete=athlete,
        sport=Workout.Sport.RUNNING,
        threshold_heart_rate=175,
        threshold_pace_seconds_per_km=270,
    )
    recalculate_training_zones(threshold)
    api_client.force_authenticate(athlete)

    response = api_client.post(reverse("activity-import"), {"file": gpx_file(started_at)}, format="multipart")

    assert response.status_code == 201
    assert response.data["workout"] == workout.id
    assert response.data["match_confidence"] == Activity.MatchConfidence.HIGH
    assert response.data["compliance_status"] == Activity.ComplianceStatus.ON_TARGET
    assert response.data["average_heart_rate"] == 152
    assert float(response.data["distance_meters"]) > 3000
    assert response.data["training_load_method"] in {"pace", "heart_rate"}
    assert response.data["zone_distribution"]["metric"] == "pace"
    assert response.data["stream"]["point_count"] == 4
    assert all("lat" not in point and "lon" not in point for point in response.data["stream"]["points"])
    assert WorkoutLog.objects.filter(workout=workout, athlete=athlete).exists()
    workout.refresh_from_db()
    assert workout.status == Workout.Status.COMPLETED


@pytest.mark.django_db
def test_duplicate_activity_file_is_rejected(api_client, athlete):
    upload = gpx_file()
    content = upload.read()
    api_client.force_authenticate(athlete)

    first = api_client.post(
        reverse("activity-import"),
        {"file": SimpleUploadedFile("run.gpx", content)},
        format="multipart",
    )
    second = api_client.post(
        reverse("activity-import"),
        {"file": SimpleUploadedFile("run.gpx", content)},
        format="multipart",
    )

    assert first.status_code == 201
    assert second.status_code == 400
    assert "already been imported" in str(second.data["file"])
    assert Activity.objects.filter(athlete=athlete).count() == 1


@pytest.mark.django_db
def test_coach_imports_tcx_for_assigned_athlete(api_client, coach, athlete, relationship):
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("activity-import"),
        {"athlete": athlete.id, "file": tcx_file()},
        format="multipart",
    )

    assert response.status_code == 201
    assert response.data["athlete"] == athlete.id
    assert response.data["sport"] == Workout.Sport.CYCLING
    assert response.data["average_power"] == 220
    assert response.data["distance_meters"] == "10000.00"


@pytest.mark.django_db
def test_coach_cannot_import_for_unassigned_athlete(api_client, coach):
    outsider = User.objects.create_user("activity-outsider", role=User.Role.ATHLETE)
    Profile.objects.create(user=outsider)
    api_client.force_authenticate(coach)

    response = api_client.post(
        reverse("activity-import"),
        {"athlete": outsider.id, "file": gpx_file()},
        format="multipart",
    )

    assert response.status_code == 400
    assert not Activity.objects.filter(athlete=outsider).exists()


@pytest.mark.django_db
def test_athlete_only_sees_and_deletes_own_activity(api_client, coach, athlete, relationship):
    api_client.force_authenticate(athlete)
    imported = api_client.post(reverse("activity-import"), {"file": gpx_file()}, format="multipart")
    other = User.objects.create_user("other-activity-athlete", role=User.Role.ATHLETE)
    Profile.objects.create(user=other)
    Activity.objects.create(
        athlete=other,
        source_file_name="other.gpx",
        file_type=Activity.FileType.GPX,
        file_sha256="1" * 64,
        sport=Workout.Sport.RUNNING,
        started_at=timezone.now(),
    )

    listing = api_client.get(reverse("activity-list"))
    deletion = api_client.delete(reverse("activity-detail", args=(imported.data["id"],)))

    assert [item["id"] for item in listing.data["results"]] == [imported.data["id"]]
    assert deletion.status_code == 204
    assert not Activity.objects.filter(pk=imported.data["id"]).exists()


@pytest.mark.django_db
def test_invalid_activity_document_is_rejected(api_client, athlete):
    api_client.force_authenticate(athlete)
    upload = SimpleUploadedFile("fake.gpx", b"<TrainingCenterDatabase />")

    response = api_client.post(reverse("activity-import"), {"file": upload}, format="multipart")

    assert response.status_code == 400
    assert "not a valid gpx" in str(response.data).lower()


@pytest.mark.django_db
def test_deleting_import_preserves_existing_athlete_feedback(api_client, coach, athlete, relationship):
    started_at = timezone.now().replace(microsecond=0)
    workout = planned_workout(coach, athlete, started_at)
    WorkoutLog.objects.create(
        workout=workout,
        athlete=athlete,
        completed_at=started_at,
        actual_duration_minutes=32,
        actual_distance_km="4.10",
        perceived_exertion=6,
        notes="Felt controlled throughout.",
    )
    api_client.force_authenticate(athlete)
    imported = api_client.post(reverse("activity-import"), {"file": gpx_file(started_at)}, format="multipart")

    response = api_client.delete(reverse("activity-detail", args=(imported.data["id"],)))

    assert response.status_code == 204
    log = WorkoutLog.objects.get(workout=workout)
    assert log.perceived_exertion == 6
    assert log.notes == "Felt controlled throughout."
    assert log.actual_duration_minutes is None
    assert log.actual_distance_km is None
