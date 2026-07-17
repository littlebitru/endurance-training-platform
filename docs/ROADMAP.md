# Product Delivery Roadmap

## Current milestone: API foundation

- Role-based registration and JWT authentication
- Coach and athlete profiles
- Active coach–athlete relationships
- Training plans, weeks, workouts, exercises, comments, and logs
- Coach analytics summary with date and athlete filters
- Consent-based athlete invitations with expiration and revocation
- Email verification, password reset, and refresh-token revocation
- Heart-rate, pace, and power zones
- Structured interval targets and recovery durations
- Production settings, health checks, throttling, structured logs, and operations runbook
- PostgreSQL and Docker Compose development environment
- OpenAPI documentation, automated tests, formatting, linting, and CI

## Milestone 2: Complete core product

- Athlete physiological profile and automatic zone calculation
- Workout status synchronization when a log is created or removed
- Weekly workload and adherence trends
- Coach dashboard endpoints with athlete alerts and missed-workout indicators
- Notification preferences and an asynchronous email worker
- Expanded permission, validation, and concurrency tests

Exit criteria: every primary coach and athlete workflow is covered by integration tests and documented in OpenAPI.

## Milestone 3: Production readiness

- Redis-backed caching and background jobs
- Request correlation IDs, error tracking, and metrics
- Database backups and a tested restore procedure
- Rate limiting, login protection, and a formal security review
- Optimized database indexes and query-performance tests
- Production container health checks and zero-downtime migrations
- Managed PostgreSQL deployment and secret-manager integration

Exit criteria: staging passes load, security, backup-restore, and deployment rollback tests.

## Milestone 4: First release

- Seeded demonstration workspace and acceptance-test script
- API versioning and backward-compatibility policy
- Privacy policy, terms, data-retention rules, and account deletion flow
- Release notes and operational runbook
- Production deployment through an approval-gated GitHub Actions workflow
- Post-release dashboards and alert thresholds

Exit criteria: product owner accepts the staging build and the operations owner approves the runbook.

## Recommended implementation order

1. Workload analytics and coach alerts
2. Notifications and background jobs
3. Caching, error tracking, and metrics
4. Staging deployment and acceptance tests
5. Security and performance review
6. Production release
