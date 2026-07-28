# Product Delivery Roadmap

## Delivered foundation

- Role-based registration, JWT authentication, email verification, password reset, and logout
- Coach and athlete profiles with consent-based coaching relationships
- Training plans, weeks, workouts, structured exercises, comments, and workout logs
- Event-specific automatic periodization with protected rest days and coach-controlled publication
- Historical sport thresholds with automatic heart-rate, pace, power, and swim-pace zones
- FIT, TCX, and GPX imports with matching, compliance, training load, and time-in-zone analysis
- Unified plan-versus-execution calendar with coach attention queues
- Weekly adherence analytics and interactive fitness, fatigue, form, and load forecasting
- Responsive bilingual React application for coach and athlete workflows
- PostgreSQL, Docker Compose, OpenAPI, automated tests, quality checks, CI, and Render staging

## Current milestone: Complete coaching context

- Athlete daily wellness and recovery check-ins
- Coach recovery-context view alongside load and adherence
- Explicit separation between subjective athlete feedback and calculated load indicators
- Notification preferences and asynchronous email delivery
- Expanded permission, validation, accessibility, and concurrency tests

Exit criteria: a coach can review plan, execution, load, recovery context, and communication needs without leaving the product.

## Production readiness

- Redis-backed caching and background jobs
- Request correlation IDs, error tracking, and service metrics
- Database backups and a tested restore procedure
- Rate limiting, login protection, and a formal security review
- Query-performance budgets and representative load tests
- Zero-downtime migration and rollback drills
- Production-grade managed PostgreSQL and secret-manager integration

Exit criteria: staging passes load, security, backup-restore, and deployment rollback tests.

## First release

- Seeded demonstration workspace and acceptance-test script
- API versioning and backward-compatibility policy
- Privacy policy, terms, data-retention rules, export, and account deletion flow
- Release notes and finalized operational runbook
- Production deployment through an approval-gated GitHub Actions workflow
- Post-release dashboards, alert thresholds, and incident ownership

Exit criteria: the product owner accepts the release candidate and the operations owner approves the runbook.

## Recommended implementation order

1. Daily wellness and recovery context
2. Notifications and background jobs
3. Caching, error tracking, and metrics
4. Security, accessibility, and performance review
5. Production acceptance and release
