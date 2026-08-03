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
- Professional bilingual workout studio with curated running, cycling, swimming, and triathlon templates
- Step-by-step workout authoring with repeat blocks, time, distance, open duration, and zone-aware targets
- Personalized Garmin FIT workout generation with official SDK encoding and integrity validation
- Provider-neutral Device Center with athlete-owned Garmin consent, encrypted OAuth credentials, idempotent delivery records, and coach-visible readiness
- Atomic template assignment that preserves the reusable prescription while resolving each athlete's current zones
- Training plans, weekly plans, structured workouts, and exercises
- Historical sport-specific thresholds with automatically calculated heart-rate, pace, and power zones
- Structured workout targets that dynamically follow the athlete's latest thresholds
- Coach comments and athlete workout logs
- Coach and athlete analytics with weekly planned-versus-completed volume and session load
- Secure FIT, TCX, and GPX activity imports with duplicate detection and automatic workout matching
- Actual heart-rate, pace, power, elevation, training-load, compliance, and time-in-zone analysis
- Unified plan-versus-execution calendar with coach attention queues, sport filters, and athlete scoping
- Interactive fitness, fatigue, and form analysis with published-plan load forecasting
- Daily athlete wellness check-ins with subjective readiness, personal HRV/RHR baselines, privacy controls, and coach recovery queues
- Filtering, full-text-style search, ordering, and pagination
- OpenAPI schema and interactive Swagger UI
- PostgreSQL, Docker, automated tests, code quality checks, and GitHub Actions

## Architecture

The codebase uses domain-oriented Django applications:

- `apps.users`: authentication, profiles, roles, and coaching relationships
- `apps.training`: plans, weeks, workouts, exercises, comments, and logs
- `apps.integrations`: provider capabilities, athlete-owned device connections, encrypted OAuth credentials, and delivery audit records
- `apps.core`: shared, domain-neutral building blocks
- `config`: environment-specific Django configuration and URL routing

Every training queryset is scoped to the authenticated principal. Coaches can manage only plans for athletes actively assigned to them; athletes receive read-only access to their plans and can manage only their own workout logs. Wellness entries are athlete-owned: coaches have read-only access to entries explicitly shared by an actively assigned athlete.

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
| Preview assigned workout FIT export | `GET /api/v1/workouts/{id}/garmin-preview/` |
| Download assigned workout FIT file | `GET /api/v1/workouts/{id}/garmin-fit/` |
| Workout library | `/api/v1/workout-templates/` |
| Copy workout template | `POST /api/v1/workout-templates/{id}/duplicate/` |
| Schedule workout template | `POST /api/v1/workout-templates/{id}/assign/` |
| Preview Garmin FIT export | `GET /api/v1/workout-templates/{id}/garmin-preview/` |
| Download Garmin FIT workout | `GET /api/v1/workout-templates/{id}/garmin-fit/` |
| Device provider capabilities | `GET /api/v1/device-providers/` |
| Device connections | `GET /api/v1/device-connections/` |
| Start athlete Garmin consent | `POST /api/v1/device-connections/garmin/authorize/` |
| Disconnect athlete device | `POST /api/v1/device-connections/{id}/disconnect/` |
| Workout delivery history | `GET /api/v1/workout-deliveries/` |
| Queue scheduled workout delivery | `POST /api/v1/workout-deliveries/queue/` |
| Exercises | `/api/v1/exercises/` |
| Coach comments | `/api/v1/coach-comments/` |
| Workout logs | `/api/v1/workout-logs/` |
| Completed activities | `GET /api/v1/activities/` |
| Import activity file | `POST /api/v1/activities/import/` |
| Unified training calendar | `GET /api/v1/calendar/` |
| Performance insights | `GET /api/v1/performance/insights/` |
| Wellness check-ins | `/api/v1/wellness-check-ins/` |
| Recovery insights | `GET /api/v1/wellness/insights/` |
| Coach recovery roster | `GET /api/v1/wellness/roster/` |
| Coach analytics | `GET /api/v1/coach/analytics/summary/` |
| Athlete analytics | `GET /api/v1/athlete/analytics/summary/` |

Collection endpoints accept `page`, `page_size`, `ordering`, and resource-specific filters. Search-enabled endpoints accept `search`. Discover the complete contract in Swagger or download `/api/schema/`.

### Structured workout studio

The workout library combines immutable, professionally curated templates with private coach-authored templates. The initial catalog covers recovery, endurance, long, tempo, threshold, VO2 max, technique, swim CSS, and triathlon brick sessions. System templates contain English and Russian content, difficulty, search tags, equipment, objective, structured steps, and a device-compatibility summary.

Coaches can create, reorder, copy, and version reusable prescriptions without binding them to one athlete. Each step supports time, distance, or open duration; repetitions and between-repeat recovery; heart-rate, pace, power, cadence, RPE, or free targets. Relative heart-rate, pace, and power zones keep the template portable across athletes.

`POST /api/v1/workout-templates/{id}/assign/` atomically snapshots a template into a selected training week. The assigned workout records its source template and schema version, while its API representation resolves zone targets from the athlete's current threshold profile. The original template remains unchanged. Coaches can therefore improve future templates without silently rewriting workouts already prescribed to athletes.

The bilingual web studio offers catalog search and filters, a step-by-step visual builder, repeat-block editing, live dose and intensity previews, athlete-specific target previews, Garmin-compatibility guidance, direct scheduling into an athlete plan, and personalized FIT downloads. The canonical template remains device-neutral; Garmin encoding is isolated in an adapter so additional providers can reuse the same prescription.

### Garmin FIT workout export

Coaches can select an actively assigned athlete on a workout template and request `GET /api/v1/workout-templates/{id}/garmin-preview/?athlete_id={id}&locale=en`. The preview expands repeated work and recovery blocks, resolves relative zones from the athlete's current threshold profile, reports compatibility issues, and shows the exact number of device steps without creating a file.

`GET /api/v1/workout-templates/{id}/garmin-fit/?athlete_id={id}&locale=en` returns a personalized `.fit` workout only when the preview is exportable. Encoding uses the official Garmin FIT Python SDK. The adapter writes File ID, Workout, and ordered Workout Step messages, applies FIT scaling and target conventions, calculates the header and CRC, then decodes the completed payload and verifies its integrity before returning it. Responses are private, non-cacheable downloads. Athlete access is restricted to active coaching relationships.

Once a template has been scheduled, both the plan owner and the assigned athlete can preview or download the personalized prescription from `/api/v1/workouts/{id}/garmin-preview/` and `/api/v1/workouts/{id}/garmin-fit/`. The athlete is derived from the immutable plan assignment, so the caller cannot accidentally export the workout with another athlete's zones. The calendar exposes the same download for upcoming sessions.

Heart-rate zones are encoded as personalized BPM ranges, running and swimming pace zones as speed ranges, cycling power zones as watt ranges, and cadence as an explicit RPM range. Open-duration steps remain Lap-button steps. RPE-only targets are reported as incompatible instead of being silently weakened. Triathlon templates are blocked until their bike, transition, and run steps are modeled as explicit multisport sessions. This milestone provides standards-compliant manual FIT delivery; direct Garmin Connect and watch synchronization still requires Garmin partner approval, athlete consent, OAuth, and the Training API delivery adapter.

### Device connections and Garmin delivery foundation

The bilingual **Devices** workspace is available to both roles. Athletes own connection consent and disconnection. Coaches see readiness and delivery status only for actively assigned athletes; OAuth credentials never appear in API serializers or frontend state.

The Garmin authorization foundation uses OAuth 2.0 Authorization Code with PKCE, a hashed one-time state that expires after ten minutes, and encrypted access tokens, refresh tokens, and PKCE verifiers. Production refuses to enable Garmin without a dedicated valid Fernet key. Disconnecting clears stored credentials immediately.

Workout deliveries are idempotent by device connection, scheduled workout, and a fingerprint of the final athlete-specific prescription. The fingerprint includes the structured version and resolved athlete targets, so a threshold change produces a new delivery while repeated clicks do not create duplicates. An append-only event history supports queued, processing, delivered, failed, and canceled states. Capability discovery keeps direct delivery disabled until partner credentials, the approved publishing contract, and the delivery worker are configured. Calendar users continue to receive a personalized FIT download instead of a simulated success.

See [Garmin Connect application package](docs/GARMIN_CONNECT_APPLICATION.md) and [device data privacy and retention](docs/DEVICE_DATA_PRIVACY.md) before enabling a provider integration.

### Completed activity imports

Athletes can import their own device files from the **Activities** workspace. Coaches can import and review files only for athletes in an active coaching relationship. The multipart import endpoint accepts a required `file`, an optional sport override, an optional planned `workout`, and a required `athlete` when a coach performs the import.

Imported activities are matched to a compatible planned workout within a 24-hour window. The API calculates actual duration and distance, heart-rate, pace, power, cadence, elevation gain, threshold-based training load, compliance, and time in configured training zones. Multiple activity files may belong to one multisport workout, and the workout log is synchronized from their combined duration and distance.

For privacy and compatibility with ephemeral deployments, original files and GPS coordinates are not retained. The database stores the SHA-256 checksum, source metadata, calculated summaries, and a downsampled stream capped at 1,000 points. Files are limited to 20 MB, parsed with hardened XML handling, rate-limited, and deduplicated per athlete.

### Unified training calendar

`GET /api/v1/calendar/` combines scheduled workouts, matched completed activities, manual workout logs, and unplanned activities in one bounded date range. The response includes planned-versus-actual duration and distance, training load, compliance, completion metrics, and an attention reason for missed, skipped, or materially deviating sessions.

The endpoint accepts `date_from`, `date_to`, optional `sport`, and optional `athlete_id`. Ranges are capped at 63 days. Athletes can retrieve only their own calendar; coaches can retrieve all active assigned athletes or select one assigned athlete. The web workspace offers week and month views, athlete and sport filters, a mobile agenda layout, deep links to activity analysis, and a coach review queue.

The coach analytics endpoint accepts optional `athlete_id`, `date_from`, and `date_to` query parameters. Both analytics endpoints return planned and actual volume, completed and skipped workout counts, completion rate, average perceived exertion, and weekly session load. Coach athlete filtering is limited to active coaching relationships; athletes can retrieve only their own summary.

### Performance insights

`GET /api/v1/performance/insights/` returns one daily series containing completed training load, estimated published-plan load, long-term fitness, short-term fatigue, and form. Historical calculations use completed imported activities. Dates after today use the estimated load of published workouts, keeping recorded history and the forecast logically separate.

Fitness is calculated as a 42-day exponentially weighted load, fatigue as a 7-day exponentially weighted load, and each day's form as the previous day's fitness minus fatigue. Planned load is a transparent estimate based on workout duration and a workout-type intensity factor. The response also includes 7-day and 28-day load, recent fitness change, forecast-end values, data-coverage metadata, and a descriptive training-balance status. These values are coaching decision support, not a medical assessment or an automatic instruction to train.

The endpoint accepts optional `date_from`, `date_to`, and `sport` parameters. Ranges are capped at 183 days. Athletes can retrieve only their own insights. Coaches must provide `athlete_id`, which is accepted only for an active assigned athlete. The bilingual web workspace offers 12-week and 6-month views, sport filtering, an accessible day scrubber, animated load curves, and responsive layouts.

### Wellness and recovery context

Athletes create or update one `/api/v1/wellness-check-ins/` entry per day. A check-in records sleep duration and quality, fatigue, stress, muscle soreness, overall feeling, optional resting heart rate and HRV (rMSSD), optional illness or injury severity, and a free-text note. Future dates and duplicate athlete/date pairs are rejected. Athletes can keep an individual entry private by disabling `share_with_coach`; coaches have read-only access to shared entries from actively assigned athletes.

`GET /api/v1/wellness/insights/` returns a 14, 28, or 90-day recovery series. The subjective readiness score combines sleep quality, fatigue, stress, soreness, overall feeling, and optional sleep duration. Resting heart rate and HRV do not silently change that score. Instead, they are compared with the athlete's own 30-day median only after at least seven prior observations, preserving an explicit distinction between subjective feedback and physiological context.

The response includes active context signals, check-in consistency, recent and upcoming training load, current fitness/fatigue/form values, and transparent baseline metadata. Internal signal thresholds prioritize review; they are not diagnoses or automatic training prescriptions.

`GET /api/v1/wellness/roster/` gives coaches an attention-first view of all active assigned athletes. It combines each athlete's latest shared recovery context with completed seven-day load and estimated published-plan load for the next seven days. The responsive bilingual web workspace adds a fast athlete check-in form, an interactive readiness and sleep chart, personal-baseline readouts, direct links to load analysis, and a dashboard recovery indicator.

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

The current version is a tested staging product, not yet a complete public SaaS release. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the prioritized path to production, including recovery context, notifications, observability, security review, and release criteria.

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
