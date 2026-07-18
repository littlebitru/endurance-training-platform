import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ActivitiesPage } from "./ActivitiesPage";
import { api } from "./api";
import { LanguageProvider } from "./i18n";
import type { Activity } from "./types";

vi.mock("./auth", () => ({
  useAuth: () => ({
    user: {
      id: 2,
      username: "runner",
      role: "athlete",
      first_name: "Alex",
      last_name: "Miles",
    },
  }),
}));

vi.mock("./api", () => ({
  api: {
    activities: vi.fn(),
    activity: vi.fn(),
    importActivity: vi.fn(),
    deleteActivity: vi.fn(),
  },
}));

const activity: Activity = {
  id: 42,
  athlete: 2,
  athlete_name: "Alex Miles",
  workout: 8,
  workout_title: "Aerobic endurance run",
  planned_duration_minutes: 45,
  planned_distance_km: "8.00",
  source_file_name: "morning-run.gpx",
  file_type: "gpx",
  sport: "running",
  started_at: "2026-07-18T06:00:00Z",
  duration_seconds: 2700,
  moving_time_seconds: 2650,
  distance_meters: "8100.00",
  elevation_gain_meters: "62.00",
  calories: 520,
  average_heart_rate: 151,
  maximum_heart_rate: 174,
  average_power: null,
  maximum_power: null,
  normalized_power: null,
  average_cadence: 84,
  maximum_cadence: 91,
  average_speed_mps: "3.000",
  average_pace_seconds_per_km: 333,
  intensity_factor: "0.810",
  training_load_score: "49.20",
  training_load_method: "pace",
  compliance_score: 98,
  compliance_status: "on_target",
  match_confidence: "high",
  zone_distribution: { metric: "heart_rate", unit: "bpm", zones: [{ zone: 2, name: "Aerobic", seconds: 1800, percentage: 66.7 }] },
  created_at: "2026-07-18T07:00:00Z",
  stream: { points: [{ elapsed: 0, heart_rate: 130 }, { elapsed: 2700, heart_rate: 174 }], point_count: 2, sample_interval_seconds: 2700 },
};

beforeEach(() => {
  localStorage.setItem("endurance_locale", "en");
  vi.mocked(api.activities).mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  vi.mocked(api.importActivity).mockResolvedValue(activity);
  vi.mocked(api.activity).mockResolvedValue(activity);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("imports an activity file and opens its professional analysis", async () => {
  render(<LanguageProvider><ActivitiesPage /></LanguageProvider>);
  expect(await screen.findByRole("heading", { name: "Activity analysis" })).toBeInTheDocument();
  const upload = new File(["<gpx />"], "morning-run.gpx", { type: "application/gpx+xml" });
  fireEvent.change(screen.getByLabelText(/Choose an activity file/), { target: { files: [upload] } });
  fireEvent.submit(screen.getByRole("button", { name: "Import and analyze" }).closest("form")!);

  await waitFor(() => expect(api.importActivity).toHaveBeenCalledOnce());
  const formData = vi.mocked(api.importActivity).mock.calls[0][0];
  expect((formData.get("file") as File).name).toBe("morning-run.gpx");
  expect(await screen.findByRole("heading", { name: "Aerobic endurance run" })).toBeInTheDocument();
  expect(screen.getByText("On target · 98%")).toBeInTheDocument();
  expect(screen.getByText("Original files and GPS coordinates are not retained. Only calculated training data is stored.")).toBeInTheDocument();
});
