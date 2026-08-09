# Staging Acceptance Checklist

Use this checklist before approving a staging release. Test only with dedicated staging accounts and non-sensitive activity files. Never enter production credentials or private athlete data into staging.

## Test preparation

- [ ] GitHub Actions is green for the commit deployed to Render.
- [ ] The API and web services show the same commit and a successful deployment.
- [ ] `GET /health/` returns HTTP 200.
- [ ] Create one coach account and one athlete account with email addresses that can be verified.
- [ ] Keep a second coach account for authorization-boundary tests.
- [ ] Test in a current Chromium browser at 100% zoom and in a mobile viewport near 390 px wide.
- [ ] Repeat the primary flows in Russian and English.

## Authentication and coaching relationship

- [ ] Register, verify the email address, sign in, refresh the page, and sign out for both roles.
- [ ] Confirm that incorrect credentials and duplicate registration show useful errors.
- [ ] As the coach, invite the athlete by email.
- [ ] As the athlete, accept the invitation and confirm that the assigned coach is visible.
- [ ] Confirm that an invitation cannot be accepted by a different email address or accepted twice.

## Coach workflow

- [ ] Open the athlete profile and enter realistic threshold data.
- [ ] Confirm that heart-rate, pace, and power zones are calculated and displayed clearly.
- [ ] Generate a goal-based plan for a specific event, such as a 5 km race.
- [ ] Confirm that the event type, target date, phases, weekly load, and rest days match the selected goal.
- [ ] Publish the plan and confirm that every scheduled workout appears in the coach calendar.
- [ ] Create a structured workout from the library and verify warm-up, work, recovery, and cool-down steps.
- [ ] Confirm that distance targets use clear kilometre or metre labels and preserve the entered value.
- [ ] Assign the workout to the athlete, move it to another day, duplicate it, and remove the duplicate.
- [ ] Download the personalized Garmin FIT file and confirm that the filename and workout summary identify the correct athlete and date.

## Athlete workflow

- [ ] Confirm that the dashboard identifies the coach and summarizes all active plans logically.
- [ ] Open dashboard metrics and upcoming workouts through their interactive links.
- [ ] Confirm that published workouts appear in the athlete calendar but draft plans do not.
- [ ] Open a workout and verify sport, duration, distance, intensity target, zone, and structured steps.
- [ ] Record a wellness check-in and confirm that recovery guidance updates.
- [ ] Import a synthetic FIT, GPX, or TCX activity and review its analysis.
- [ ] Confirm that the completed activity is matched to the correct scheduled workout when applicable.

## Device integrations

- [ ] Device Center clearly distinguishes available, manual, and partner-approval integrations.
- [ ] Garmin offers a truthful manual FIT workflow while direct delivery remains disabled.
- [ ] After Strava credentials are configured, connect Strava only from the athlete account.
- [ ] Complete OAuth, return to Device Center, and run a manual synchronization.
- [ ] Confirm that imported Strava activities appear once in Activities and Calendar, even after a second synchronization.
- [ ] Confirm that Strava activities show their source and cannot be edited as manually uploaded files.
- [ ] Disconnect Strava and confirm the expected authorization and imported-data removal behavior.
- [ ] Confirm that coaches can see connection readiness but never athlete tokens or provider credentials.

## Permissions and resilience

- [ ] The athlete cannot create, edit, publish, or delete a coach-owned plan.
- [ ] The second coach cannot see the first coach's athlete, plans, workouts, or activity details.
- [ ] Signed-out API requests return an authorization error and do not expose private data.
- [ ] Refreshing any application route does not produce a 404 page.
- [ ] Empty states, loading states, API errors, and retry actions remain readable and actionable.
- [ ] No secret, access token, stack trace, or internal server path appears in the browser UI or console.

## Responsive and visual checks

- [ ] At 100%, 90%, and 125% browser zoom, navigation and primary actions remain visible.
- [ ] At approximately 390 px width, there is no horizontal page overflow.
- [ ] Forms, dialogs, plan weeks, calendar cards, and device cards remain usable on mobile.
- [ ] Russian text does not overflow buttons or cards, and generated plan descriptions use the selected language.
- [ ] Keyboard focus is visible and every form can be completed without a mouse.

## Issue report format

For every failure, record:

1. Role and account used.
2. Exact page URL.
3. Steps to reproduce.
4. Expected and actual result.
5. Screenshot and browser console error, if present.
6. Approximate time and deployed commit, so the matching Render logs can be found.

Do not send passwords, API secrets, OAuth codes, cookies, or access tokens in screenshots or issue reports.

## Release acceptance

Accept the release only when all critical coach-to-athlete flows pass, authorization boundaries hold, GitHub Actions is green, Render health remains stable, and no unresolved high-severity issue remains.
