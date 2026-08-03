# Strava Integration Runbook

## Supported workflow

The Strava adapter provides athlete-owned OAuth 2.0 authorization, encrypted token storage, refresh-token rotation, manual activity synchronization, and webhook ingestion. Imported running, cycling, swimming, and triathlon activities are matched to published calendar workouts and processed by the existing compliance and training-load pipeline.

Strava is an activity source, not a structured-workout delivery channel. Training prescriptions continue to use personalized FIT downloads until an approved device provider supports direct delivery.

## Application registration

1. Create a Strava API application in the authenticated Strava developer settings.
2. Set the production callback domain to the API hostname.
3. Set the OAuth callback to `https://<api-host>/api/v1/device-oauth/strava/callback/`.
4. Request only `read` and `activity:read_all` scopes.
5. Store the client ID and client secret in the deployment secret manager.
6. Generate a dedicated Fernet key for `DEVICE_TOKEN_ENCRYPTION_KEY`.
7. Enable `STRAVA_INTEGRATION_ENABLED` only after staging authorization succeeds.

## Webhook registration

The subscription callback is `https://<api-host>/api/v1/device-webhooks/strava/`.

1. Generate a high-entropy value for `STRAVA_WEBHOOK_VERIFY_TOKEN`.
2. Create the Strava webhook subscription using the registered application credentials.
3. Save the returned subscription ID as `STRAVA_WEBHOOK_SUBSCRIPTION_ID`.
4. Verify create, update, delete, and athlete-deauthorization events in staging.

Webhook processing is idempotent. Activity create and update events upsert the provider activity identifier. Delete events remove the imported activity and recalculate any affected workout log. Athlete deauthorization removes tokens and locally imported Strava activities.

## Synchronization boundaries

- Initial manual synchronization imports up to `STRAVA_INITIAL_SYNC_DAYS` of history.
- `STRAVA_MAX_SYNC_PAGES` limits each request to protect provider rate limits.
- Unsupported sport types are counted and ignored.
- Detailed streams are not requested during summary synchronization, reducing data collection and API usage.
- A five-minute overlap protects against activities arriving near the previous synchronization boundary.

## Production verification

1. Complete OAuth with a non-administrator athlete account.
2. Confirm tokens are never returned by the public API or written to logs.
3. Run manual synchronization twice and verify that no duplicate activities are created.
4. Confirm a matching planned workout becomes completed and displays compliance metrics.
5. Trigger a webhook activity update and deletion.
6. Disconnect Strava and verify token removal and activity-data deletion.
