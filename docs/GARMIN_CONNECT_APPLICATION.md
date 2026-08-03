# Garmin Connect Developer Program Application Package

## Product summary

Endurance Training is a coach-to-athlete platform for running, cycling, swimming, and triathlon. Coaches create periodized plans and structured workouts. Athletes review their schedule, record wellness data, import completed activities, and control connections to external device providers.

The requested Garmin integration has two purposes:

1. publish an athlete-approved structured workout to the athlete's Garmin Connect training calendar; and
2. receive completed activity data for plan-versus-execution analysis after separate athlete consent.

The platform already generates and validates personalized FIT workout files with the official Garmin FIT SDK. Direct Garmin delivery remains disabled until the application is approved and the partner contract is implemented against the private Garmin specification.

## User roles and consent

- The athlete is the Garmin account owner and is the only role allowed to initiate or revoke OAuth authorization.
- A coach can see whether an assigned athlete's connection is ready and can view delivery outcomes.
- A coach cannot access OAuth tokens, Garmin credentials, or another athlete's device connection.
- Disconnecting Garmin immediately removes locally stored access and refresh credentials and prevents new delivery jobs.
- Manual FIT download remains available without OAuth and is clearly presented as a separate workflow.

## Proposed authorization flow

1. The authenticated athlete opens Device Center and selects **Connect Garmin**.
2. The backend creates a cryptographically random, ten-minute, one-time authorization state.
3. OAuth 2.0 Authorization Code with PKCE redirects the athlete to Garmin.
4. Garmin returns the athlete to the backend callback.
5. The backend validates and consumes the state before exchanging the code.
6. Access and refresh tokens are encrypted before database storage and are never returned to the web client.
7. The athlete can disconnect at any time from Device Center.

## Requested data and minimum use

Final scope names must be copied from the approved partner documentation. The application should request only scopes required for:

- structured workout and training-calendar delivery;
- delivery status or provider identifiers needed for idempotency; and
- completed activity retrieval or notifications, if Activity API access is separately approved.

Health, wellness, location, and activity data outside these product workflows must not be requested.

## Delivery and idempotency

Each delivery is uniquely identified by device connection, scheduled workout, and a fingerprint of the final athlete-specific prescription. Repeated clicks return the existing delivery instead of creating duplicate Garmin workouts, while changed athlete targets produce a new fingerprint. Delivery transitions are recorded as append-only events: queued, processing, delivered, failed, or canceled.

Direct delivery capability is reported as unavailable unless all of the following are true:

- Garmin partner access is enabled;
- OAuth settings are complete;
- the approved Training API publishing endpoint is configured; and
- an approved delivery worker is enabled.

The platform never reports a simulated Garmin connection or successful delivery.

## Security controls

- OAuth 2.0 Authorization Code with PKCE
- single-use, hashed authorization state with a ten-minute expiration
- encrypted access tokens, refresh tokens, and PKCE verifier
- production startup failure when Garmin is enabled without a dedicated encryption key
- role- and relationship-scoped API querysets
- no OAuth secrets in serializers, responses, logs, or browser storage
- idempotent delivery records and immutable audit events
- secure cookies, short-lived JWT access tokens, TLS enforcement, HSTS, CORS, and CSRF origin checks

## Configuration required after approval

The following values must come from the Garmin partner portal and a managed secret store:

- `DEVICE_TOKEN_ENCRYPTION_KEY`
- `GARMIN_CLIENT_ID`
- `GARMIN_CLIENT_SECRET`
- `GARMIN_OAUTH_AUTHORIZATION_URL`
- `GARMIN_OAUTH_TOKEN_URL`
- `GARMIN_OAUTH_REVOCATION_URL`
- `GARMIN_OAUTH_REDIRECT_URI`
- `GARMIN_OAUTH_SCOPES`
- `GARMIN_TRAINING_PUBLISH_URL`

`GARMIN_TRAINING_API_ENABLED` and `GARMIN_DELIVERY_WORKER_ENABLED` must remain false until staging acceptance against the approved Garmin sandbox or partner environment is complete.

## Validation checklist

- Connect, callback, refresh, reconnect, and disconnect flows
- denied-consent and expired-state behavior
- revoked and expired credential behavior
- coach and athlete access boundaries
- duplicate delivery prevention
- rate-limit and transient-provider retry policy
- training-step compatibility across running, cycling, swimming, and triathlon
- compatible-device synchronization confirmation
- account deletion and data-retention verification
- staging rollback with Garmin integration disabled
