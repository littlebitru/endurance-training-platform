import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AthleteThresholdPanel } from "./AthleteThresholdPanel";
import { LanguageProvider } from "./i18n";
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
    profile: { sport: "cycling", bio: "", date_of_birth: null },
  },
  coach: {
    id: 1,
    username: "coach",
    email: "coach@example.com",
    first_name: "Coach",
    last_name: "One",
    role: "coach",
    profile: { sport: "cycling", bio: "", date_of_birth: null },
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
      sport: "cycling",
      threshold_heart_rate: 175,
      maximum_heart_rate: 190,
      functional_threshold_power: 250,
      threshold_pace_seconds_per_km: null,
      critical_swim_speed_seconds_per_100m: null,
      heart_rate_basis: "lthr",
      updated_at: "2026-07-18T00:00:00Z",
      zones: [{
        id: 20,
        athlete: 2,
        sport: "cycling",
        metric: "power",
        zone_number: 4,
        name: "Threshold",
        lower_bound: "228.00",
        upper_bound: "263.00",
        unit: "W",
        display_range: "228–263 W",
      }],
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("shows automatically calculated athlete zones", async () => {
  render(<LanguageProvider><AthleteThresholdPanel onClose={() => undefined} relationship={relationship} /></LanguageProvider>);

  expect(await screen.findByRole("heading", { name: "Calculated training zones" })).toBeInTheDocument();
  expect(screen.getByText("228–263 W")).toBeInTheDocument();
  expect(await screen.findByDisplayValue("250")).toBeInTheDocument();
});
