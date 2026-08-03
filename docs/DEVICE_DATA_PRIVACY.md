# Device Integration Privacy and Retention

## Principles

Device connections are athlete-owned, optional, revocable, and limited to the data required for the selected product feature. A coaching relationship does not grant a coach access to the athlete's Garmin credentials.

## Stored connection data

The platform may store:

- provider name and provider account identifier;
- granted scope names;
- consent, token-expiration, synchronization, and disconnection timestamps;
- encrypted OAuth access and refresh tokens;
- delivery status, provider workout reference, attempt count, and sanitized error information; and
- audit events required to investigate a delivery failure.

The frontend and public API never receive encrypted token fields.

## Access

- Athletes can view and revoke their own device connections.
- Coaches can view connection readiness and delivery history only for athletes in an active coaching relationship.
- Administrators must not copy or reveal encrypted credential values.

## Retention

- A disconnect operation immediately clears locally stored access and refresh credentials.
- Expired one-time OAuth authorization states should be deleted by scheduled maintenance.
- Delivery audit records should be retained only for the documented support and compliance period.
- Deleting an athlete account cascades device connections, authorization states, and delivery records, subject to any separately documented legal retention obligation.

## Manual FIT files

Personalized FIT workout files are generated on demand. The response is marked private and non-cacheable. Generated FIT payloads are not persisted by the application.

## Incident response

Suspected credential exposure requires immediate provider revocation, encryption-key impact analysis, log review, notification assessment, and documented remediation. Secrets must never be included in issue trackers, logs, analytics, or support screenshots.
