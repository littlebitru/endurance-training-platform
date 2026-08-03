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
- Athlete-owned daily wellness check-ins with sleep, fatigue, stress, soreness, overall feeling, HRV, and resting heart rate
- Personal recovery baselines, explicit sharing controls, coach recovery queues, and load-aware readiness context
- Professional workout studio with curated multisport templates, repeat blocks, live dose previews, and athlete-zone resolution
- Immutable system templates, private coach copies, structure versioning, compatibility reporting, and atomic calendar assignment
- Personalized Garmin FIT workout preview and download using the official SDK, athlete zones, and post-encoding integrity validation
- Responsive bilingual React application for coach and athlete workflows
- PostgreSQL, Docker Compose, OpenAPI, automated tests, quality checks, CI, and Render staging

## Current milestone: connected Garmin delivery

- Completed: official FIT workout encoding, semantic decoding, and CRC integrity validation
- Completed: secure personalized preview and download endpoints with deterministic file naming
- Completed: responsive bilingual Garmin export workflow in the workout library
- Garmin Connect Developer Program application package, privacy policy, and account-disconnection flow
- Provider-neutral integration connections, encrypted credentials, idempotent delivery jobs, and sync history
- Garmin OAuth 2.0 PKCE and Training API publishing after partner credentials are approved
- Activity API webhook ingestion and automatic matching of completed Garmin activities

Exit criteria: a coach can validate and export any compatible structured workout as FIT; after Garmin approval, an athlete can explicitly connect Garmin, receive scheduled workouts on a compatible device, and sync completed activities back without duplicate records.

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

1. Privacy, consent, account deletion, and Garmin application package
2. Background delivery jobs, notifications, and sync observability
3. Garmin OAuth and Training API adapter after partner approval
4. Caching, error tracking, security, accessibility, and performance review
5. Production acceptance and release
