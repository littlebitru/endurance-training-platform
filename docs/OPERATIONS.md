# Operations Runbook

## Deployment prerequisites

- Managed PostgreSQL with automated backups and point-in-time recovery
- HTTPS reverse proxy or managed ingress
- SMTP provider with verified sender domain
- Secret manager for application and database credentials
- Central log collection and error monitoring

Set `DJANGO_SETTINGS_MODULE=config.settings_production`. Provide all values documented in `.env.example`, including a random secret key of at least 50 characters and explicit allowed hosts and trusted origins.

Keep `GARMIN_TRAINING_API_ENABLED=False` and `GARMIN_DELIVERY_WORKER_ENABLED=False` until Garmin approves the application and staging passes the partner contract. When enabling the integration, generate a dedicated Fernet key for `DEVICE_TOKEN_ENCRYPTION_KEY`; do not reuse `DJANGO_SECRET_KEY`. Store Garmin client credentials and the encryption key in a managed secret store. Never expose them as Render Blueprint literal values.

Keep `STRAVA_INTEGRATION_ENABLED=False` until a Strava API application has been registered and its callback domain has been verified. Configure the client ID, client secret, redirect URI, and the same dedicated `DEVICE_TOKEN_ENCRYPTION_KEY` in the secret store. Manual synchronization is available after OAuth is enabled. Automatic event synchronization additionally requires a webhook verify token, the confirmed Strava subscription ID, and a supervised `process_strava_webhooks --loop` worker. Keep `STRAVA_WEBHOOK_PROCESSING_ENABLED=False` when no worker is running. See `docs/STRAVA_INTEGRATION.md`.

Run `python manage.py cleanup_device_authorizations` on a recurring schedule to remove expired one-time OAuth state records.

## Release procedure

1. Run the CI workflow and require all checks to pass.
2. Build an immutable image tagged with the commit SHA.
3. Back up the database and verify backup completion.
4. Run `python manage.py migrate --check` against staging.
5. Deploy the image to staging and run acceptance tests.
6. Apply migrations with a single release job.
7. Roll out API instances and monitor health, error rate, latency, and database load.
8. Record the deployed image and migration versions.

## Health checks

`GET /health/` returns HTTP 200 only when the process can connect to the database. The container image includes a health check against this endpoint.

## Backup and restore

Use encrypted daily backups plus point-in-time recovery. Run a restore drill at least quarterly in an isolated environment. A backup is not considered valid until a restore has been tested.

## Rollback

Application rollback uses the previously deployed immutable image. Database migrations must be designed for backward compatibility; use expand-and-contract migrations for destructive schema changes. Do not reverse a migration in production without verifying its data-loss behavior.

## Incident response

1. Confirm impact through health, error, latency, and database metrics.
2. Preserve logs and identify the first affected release.
3. Roll back the application when the current release is implicated.
4. Rotate affected credentials when exposure is possible.
5. Restore data only from a verified backup and only after identifying the corruption boundary.
6. Document timeline, root cause, impact, remediation, and preventive actions.
