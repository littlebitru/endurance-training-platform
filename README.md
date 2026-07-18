# Endurance Training API

A production-oriented REST API for coaches and endurance athletes in running, triathlon, swimming, and cycling. The service supports structured training plans, coach–athlete collaboration, completed-workout tracking, and role-based data access.

The repository also includes a responsive React and TypeScript web application with role-aware coach and athlete workspaces.

## Features

- User registration and JWT authentication with rotating refresh tokens
- Email verification, password reset, logout, and refresh-token revocation
- Coach and athlete roles with isolated data access
- User profiles and coach–athlete assignments
- Consent-based athlete invitations with expiration and revocation
- Training plans, weekly plans, workouts, and exercises
- Sport-specific athlete thresholds with automatically calculated heart-rate, pace, and power zones
- Structured workout targets that dynamically follow the athlete's latest thresholds
- Coach comments and athlete workout logs
- Coach analytics with athlete and date-range filtering
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
| Athlete thresholds | `/api/v1/athlete-thresholds/` |
| Training zones | `/api/v1/training-zones/` |
| Weekly plans | `/api/v1/weekly-plans/` |
| Workouts | `/api/v1/workouts/` |
| Exercises | `/api/v1/exercises/` |
| Coach comments | `/api/v1/coach-comments/` |
| Workout logs | `/api/v1/workout-logs/` |
| Coach analytics | `GET /api/v1/coach/analytics/summary/` |

Collection endpoints accept `page`, `page_size`, `ordering`, and resource-specific filters. Search-enabled endpoints accept `search`. Discover the complete contract in Swagger or download `/api/schema/`.

The analytics endpoint accepts optional `athlete_id`, `date_from`, and `date_to` query parameters. It returns planned and actual volume, completed and skipped workout counts, completion rate, and average perceived exertion. Access is restricted to coaches, and athlete filtering is limited to active coaching relationships.

### Automatic training zones

Coaches maintain one threshold profile per athlete and sport. Running profiles accept LTHR or maximum heart rate and threshold pace, cycling profiles accept heart-rate data and FTP, swimming profiles accept heart-rate data and CSS, and triathlon profiles provide general heart-rate targets. Saving a threshold profile atomically regenerates the matching training zones.

Structured workouts store relative zone targets such as Z2 or Z4. API responses resolve those targets to the athlete's current real-world range, such as `145–158 bpm`, `4:08–4:18 /km`, or `228–263 W`. Updating a threshold therefore updates the resolved targets of existing workouts without rewriting the plan.

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

`render.yaml` defines a Render staging Blueprint with managed PostgreSQL, a Docker API service, and a static frontend. Push the repository to GitHub, create a Render Blueprint from the repository, and provide the prompted host, origin, frontend, and SMTP values. Render runs migrations through the API service's pre-deploy command. The current staging plans are free and suitable only for acceptance testing, not production availability or durable data guarantees.

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
