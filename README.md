# Endurance Training API

A production-oriented REST API for coaches and endurance athletes in running, triathlon, swimming, and cycling. The service supports structured training plans, coach–athlete collaboration, completed-workout tracking, and role-based data access.

The repository also includes a responsive React and TypeScript web application with role-aware coach and athlete workspaces.

## Features

- User registration and JWT authentication with in-memory access tokens and secure HttpOnly refresh cookies
- Email verification, password reset, logout, and refresh-token revocation
- Coach and athlete roles with isolated data access
- User profiles and coach–athlete assignments
- Consent-based athlete invitations with expiration and revocation
- Automatic event-based periodization across Base, Build, Peak, Taper, Recovery, and Race phases
- Coach-controlled draft, review, publication, retraction, and archival lifecycle for athlete plans
- Interactive weekly calendar with workout editing, drag-and-drop rescheduling, duplication, and reusable libraries
- Training plans, weekly plans, structured workouts, and exercises
- Historical sport-specific thresholds with automatically calculated heart-rate, pace, and power zones
- Structured workout targets that dynamically follow the athlete's latest thresholds
- Coach comments and athlete workout logs
- Coach and athlete analytics with weekly planned-versus-completed volume and session load
- Secure FIT, TCX, and GPX activity imports with duplicate detection and automatic workout matching
- Actual heart-rate, pace, power, elevation, training-load, compliance, and time-in-zone analysis
- Unified plan-versus-execution calendar with coach attention queues, sport filters, and athlete scoping
- Filtering, full-text-style search, ordering, and pagination
- OpenAPI schema and interactive Swagger UI
- PostgreSQL, Docker, automated tests, code quality checks, and GitHub Actions

## Architecture

The codebase uses domain-oriented Django applications:

- `apps.users`: authentication, profiles, roles, and coaching relationships
- `apps.training`: plans, weeks, workouts, exercises, comments, and logs
- `apps.core`: shared, domain-neutral building blocks
- `config`: environment-specific Django configuration and URL routing

Every training queryset is scoped to the authenticated principal. Coaches can manage only plans for athletes actively assigned to them; athletes receive read-only access to their plans and can manage only their own workout logs.

## Quick start with Docker

Requirements: Docker Engine and Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

The web application is available at `http://localhost:3000/`, the API at `http://localhost:8000/api/v1/`, and Swagger UI at `http://localhost:8000/api/docs/`.

Create an administrator in a second terminal:

```bash
docker compose exec api python manage.py createsuperuser
```

## Local development

Python 3.12+ and PostgreSQL 16+ are recommended.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver
```

On Windows, activate the environment with `.venv\\Scripts\\activate`.

## API overview

| Resource | Path |
|---|---|
| Registration | `POST /api/v1/auth/register/` |
| Obtain JWT | `POST /api/v1/auth/token/` |
| Refresh JWT | `POST /api/v1/auth/token/refresh/` |
| Logout | `POST /api/v1/auth/logout/` |
| Request email verification | `POST /api/v1/auth/verify-email/request/` |
| Verify email | `POST /api/v1/auth/verify-email/` |
| Request password reset | `POST /api/v1/auth/password-reset/` |
| Confirm password reset | `POST /api/v1/auth/password-reset/confirm/` |
| Current user | `/api/v1/users/me/` |
| Profile | `/api/v1/profile/` |
| Coach assignments | `/api/v1/coaching-relationships/` |
| Athlete invitations | `/api/v1/athlete-invitations/` |
| Accept invitation | `POST /api/v1/athlete-invitations/{token}/accept/` |
| Assigned athletes | `/api/v1/athletes/` |
| Training plans | `/api/v1/training-plans/` |
| Generate periodized plan | `POST /api/v1/training-plans/generate/` |
| Publish reviewed plan | `POST /api/v1/training-plans/{id}/publish/` |
| Return plan to draft | `POST /api/v1/training-plans/{id}/return-to-draft/` |
| Archive plan | `POST /api/v1/training-plans/{id}/archive/` |
| Training goal catalog | `GET /api/v1/training-goals/` |
| Athlete thresholds | `/api/v1/athlete-thresholds/` |
| Training zones | `/api/v1/training-zones/` |
| Weekly plans | `/api/v1/weekly-plans/` |
| Workouts | `/api/v1/workouts/` |
| Duplicate workout | `POST /api/v1/workouts/{id}/duplicate/` |
| Workout library | `/api/v1/workout-templates/` |
| Exercises | `/api/v1/exercises/` |
| Coach comments | `/api/v1/coach-comments/` |
| Workout logs | `/api/v1/workout-logs/` |
| Completed activities | `GET /api/v1/activities/` |
| Import activity file | `POST /api/v1/activities/import/` |
| Unified training calendar | `GET /api/v1/calendar/` |
| Coach analytics | `GET /api/v1/coach/analytics/summary/` |
| Athlete analytics | `GET /api/v1/athlete/analytics/summary/` |

Collection endpoints accept `page`, `page_size`, `ordering`, and resource-specific filters. Search-enabled endpoints accept `search`. Discover the complete contract in Swagger or download `/api/schema/`.

### Completed activity imports

Athletes can import their own device files from the **Activities** workspace. Coaches can import and review files only for athletes in an active coaching relationship. The multipart import endpoint accepts a required `file`, an optional sport override, an optional planned `workout`, and a required `athlete` when a coach performs the import.

Imported activities are matched to a compatible planned workout within a 24-hour window. The API calculates actual duration and distance, heart-rate, pace, power, cadence, elevation gain, threshold-based training load, compliance, and time in configured training zones. Multiple activity files may belong to one multisport workout, and the workout log is synchronized from their combined duration and distance.

For privacy and compatibility with ephemeral deployments, original files and GPS coordinates are not retained. The database stores the SHA-256 checksum, source metadata, calculated summaries, and a downsampled stream capped at 1,000 points. Files are limited to 20 MB, parsed with hardened XML handling, rate-limited, and deduplicated per athlete.

### Unified training calendar

`GET /api/v1/calendar/` combines scheduled workouts, matched completed activities, manual workout logs, and unplanned activities in one bounded date range. The response includes planned-versus-actual duration and distance, training load, compliance, completion metrics, and an attention reason for missed, skipped, or materially deviating sessions.

The endpoint accepts `date_from`, `date_to`, optional `sport`, and optional `athlete_id`. Ranges are capped at 63 days. Athletes can retrieve only their own calendar; coaches can retrieve all active assigned athletes or select one assigned athlete. The web workspace offers week and month views, athlete and sport filters, a mobile agenda layout, deep links to activity analysis, and a coach review queue.

The coach analytics endpoint accepts optional `athlete_id`, `date_from`, and `date_to` query parameters. Both analytics endpoints return planned and actual volume, completed and skipped workout counts, completion rate, average perceived exertion, and weekly session load. Coach athlete filtering is limited to active coaching relationships; athletes can retrieve only their own summary.

### Periodized plan generation

`GET /api/v1/training-goals/` exposes the supported race formats and their minimum preparation window, recommended taper, target distance, and experience-specific peak weekly volume. The catalog includes running races from 5 km through 50 km, cycling time trials and gran fondos, pool and open-water swimming events, and sprint through long-distance triathlon.

`POST /api/v1/training-plans/generate/` creates a complete, editable calendar for one exact target. The coach supplies the athlete, discipline, target event type, start and event dates, peak weekly volume, available weekdays, experience level, recovery rhythm, and optional custom distance. The service builds the plan backward from the event, validates a goal-specific preparation window, selects goal-specific quality sessions, progresses long-session distance from the athlete's pace or CSS threshold, inserts recovery weeks, and creates the exact race-distance workout.

The generator schedules no more than six training days per week, preserving at least one complete rest day even when all seven weekdays are marked as available. Beginner plans use at most five days, recovery weeks remove another session, and race weeks reduce frequency and avoid scheduling on the day immediately before the event.

Generated plans are decision support, not a substitute for coaching judgment. The coach remains responsible for reviewing athlete readiness, recent training response, injury context, and schedule constraints before publishing or adapting the calendar.

Every new manual or generated plan starts as a private coach draft. Coaches can review and edit draft workouts in their calendar, while athletes cannot retrieve, complete, or match activities to those workouts. Publishing exposes the approved schedule to the assigned athlete. A published plan can return to draft only before athlete work has been recorded; archiving makes the schedule read-only while preserving athlete history.

### Automatic training zones

Coaches maintain dated threshold measurements per athlete and sport. Running profiles accept LTHR or maximum heart rate and threshold pace, cycling profiles accept heart-rate data and FTP, swimming profiles accept heart-rate data and CSS, and triathlon profiles provide general heart-rate targets. Each measurement records its effective date, source, and notes. Saving the newest measurement atomically regenerates the matching training zones while older results remain available for longitudinal comparison.

Structured workouts store relative zone targets such as Z2 or Z4. API responses resolve those targets to the athlete's current real-world range, such as `145–158 bpm`, `4:08–4:18 /km`, or `228–263 W`. Updating a threshold therefore updates the resolved targets of existing workouts without rewriting the plan.

Training-plan creation and automatic generation may include a `threshold_profile` object. The API creates or updates the athlete's current matching sport profile, recalculates the zones, and creates the plan in one database transaction. The web plan wizard loads existing values automatically and requires the discipline-specific threshold when a profile is not configured yet.

### Browser authentication

The browser never persists JWTs in `localStorage`. Access tokens live only in memory; rotating refresh tokens use `HttpOnly`, `Secure`, path-scoped cookies in production. Refresh and logout requests validate cross-origin cookie use, logout blacklists the refresh token, and the frontend restores an authenticated session through the refresh endpoint. Native API clients may still submit a refresh token in the request body.

### Athlete invitation flow

1. A coach creates an invitation with `POST /api/v1/athlete-invitations/` and the athlete's email.
2. The configured email backend sends an acceptance link. Development uses the console backend, so the message appears in the API container logs.
3. The athlete registers with the invited email and obtains an access token.
4. The authenticated athlete accepts with `POST /api/v1/athlete-invitations/{token}/accept/`.
5. The API creates the coaching relationship atomically. Expired, revoked, previously accepted, mismatched-email, and duplicate relationships are rejected.

Direct relationship creation is intentionally disabled: athletes must consent by accepting an invitation.

New accounts must verify their email before JWT tokens are issued. In development, verification and password-reset messages are printed in the API container logs. Use `docker compose logs -f api` to inspect them.

## Delivery roadmap

The current version is a tested API foundation, not yet a complete public SaaS release. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the prioritized path to production, including account verification, richer training metrics, observability, deployment, security review, and release criteria.

## Frontend development

The frontend lives in `frontend/` and uses React, TypeScript, Vite, and native CSS.

```bash
cd frontend
corepack enable
pnpm install
pnpm dev
```

Set `VITE_API_URL` from `frontend/.env.example` when the API is not running at the default local URL.

## Staging deployment

`render.yaml` defines a Render staging Blueprint with managed PostgreSQL, a Docker API service, and a static frontend. Push the repository to GitHub and create a Render Blueprint from the repository. The API entrypoint applies migrations when `RUN_MIGRATIONS=true`. The current staging plans are suitable only for acceptance testing, not production availability or durable data guarantees.

## Quality checks

```bash
black --check .
isort --check-only .
flake8 .
pytest
```

Install Git hooks with `pre-commit install`. The GitHub Actions workflow runs the same checks on pushes and pull requests.

## Configuration

Configuration is loaded exclusively from environment variables. Use `.env.example` as the reference; never commit real credentials. In production, provide a strong secret key, disable debug mode, restrict allowed hosts, terminate TLS at the ingress, and store secrets in the deployment platform's secret manager.

Production deployments must set `DJANGO_SETTINGS_MODULE=config.settings_production`. This enables HTTPS redirects, HSTS, secure cookies, SMTP email, and structured logs, and rejects weak secret keys. The unauthenticated `/health/` endpoint verifies database connectivity for container orchestration.

See [operations documentation](docs/OPERATIONS.md) for deployment, migration, backup, rollback, and incident procedures.

## License

This project is provided as a commercial-grade foundation. Add the license appropriate to your organization before distribution.
