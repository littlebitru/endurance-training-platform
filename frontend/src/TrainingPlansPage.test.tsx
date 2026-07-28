import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LanguageProvider } from "./i18n";
import { EditorPanel } from "./TrainingPlansPage";
import type { Relationship } from "./types";

const relationship = {
  id: 1,
  is_active: true,
  athlete: {
    id: 2,
    username: "runner",
    email: "runner@example.com",
    first_name: "Alex",
    last_name: "Miles",
    role: "athlete",
    profile: { sport: "running", bio: "", date_of_birth: null },
  },
  coach: {
    id: 1,
    username: "coach",
    email: "coach@example.com",
    first_name: "Coach",
    last_name: "One",
    role: "coach",
    profile: { sport: "running", bio: "", date_of_birth: null },
  },
} satisfies Relationship;

beforeEach(() => {
  localStorage.setItem("endurance_locale", "en");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    count: 1,
    next: null,
    previous: null,
    results: [{
      id: 10,
      athlete: 2,
      sport: "running",
      effective_from: "2026-07-18",
      source: "field_test",
      notes: "Track field test",
      is_current: true,
      threshold_heart_rate: 178,
      maximum_heart_rate: 193,
      functional_threshold_power: null,
      threshold_pace_seconds_per_km: 255,
      critical_swim_speed_seconds_per_100m: null,
      heart_rate_basis: "lthr",
      updated_at: "2026-07-18T00:00:00Z",
      zones: [{
        id: 20,
        athlete: 2,
        sport: "running",
        metric: "pace",
        zone_number: 4,
        name: "Threshold",
        lower_bound: "247.00",
        upper_bound: "258.00",
        unit: "sec/km",
        display_range: "4:07–4:18 /km",
      }],
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })));
  const thresholdFetch = vi.mocked(fetch);
  vi.stubGlobal("fetch", vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("/training-goals/")) return thresholdFetch(input, init);
    return Promise.resolve(new Response(JSON.stringify([{
      code: "run_5k",
      sport: "running",
      label: "5 km",
      distance_km: "5.00",
      minimum_weeks: 6,
      recommended_taper_weeks: 1,
      recommended_weekly_minutes: { beginner: 240, intermediate: 330, advanced: 420 },
    }, {
      code: "run_marathon",
      sport: "running",
      label: "Marathon",
      distance_km: "42.20",
      minimum_weeks: 16,
      recommended_taper_weeks: 3,
      recommended_weekly_minutes: { beginner: 420, intermediate: 600, advanced: 780 },
    }]), { status: 200, headers: { "Content-Type": "application/json" } }));
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("loads the athlete intensity profile inside plan creation", async () => {
  render(
    <LanguageProvider>
      <EditorPanel
        editor={{ kind: "plan" }}
        onClose={() => undefined}
        onSaved={async () => undefined}
        relationships={[relationship]}
      />
    </LanguageProvider>,
  );

  expect(screen.getAllByText("Personal intensity profile")).toHaveLength(2);
  expect(await screen.findByDisplayValue("4:15")).toBeInTheDocument();
  expect(screen.getByText("Z4 · 4:07–4:18 /km")).toBeInTheDocument();
});

test("submits event settings to the periodized plan generator", async () => {
  render(
    <LanguageProvider>
      <EditorPanel
        editor={{ kind: "plan" }}
        onClose={() => undefined}
        onSaved={async () => undefined}
        relationships={[relationship]}
      />
    </LanguageProvider>,
  );

  await screen.findByDisplayValue("4:15");
  await screen.findByRole("option", { name: "Marathon" });
  fireEvent.change(screen.getByLabelText("Plan title"), { target: { value: "Autumn marathon" } });
  fireEvent.change(screen.getByLabelText("Target race distance or format"), { target: { value: "run_marathon" } });
  fireEvent.change(screen.getByLabelText("Target event"), { target: { value: "City Marathon" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    const generatorCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/training-plans/generate/"));
    expect(generatorCall).toBeDefined();
    const body = JSON.parse(String(generatorCall?.[1]?.body));
    expect(body).toMatchObject({
      athlete: 2,
      title: "Autumn marathon",
      primary_sport: "running",
      event_name: "City Marathon",
      target_event_type: "run_marathon",
      weekly_minutes: 600,
      available_days: [0, 2, 4, 6],
      recovery_every: 4,
      taper_weeks: 3,
    });
  });
});
