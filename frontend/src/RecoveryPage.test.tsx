import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { LanguageProvider } from "./i18n";
import { RecoveryPage } from "./RecoveryPage";
import type { RecoveryInsights, RecoveryRoster } from "./types";

const authState = vi.hoisted(() => ({
  user: {
    id: 2,
    username: "runner",
    role: "athlete",
    first_name: "Alex",
    last_name: "Miles",
  },
}));

vi.mock("./auth", () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock("./api", () => ({
  api: {
    athletes: vi.fn(),
    wellnessCheckIns: vi.fn(),
    createWellnessCheckIn: vi.fn(),
    updateWellnessCheckIn: vi.fn(),
    recoveryInsights: vi.fn(),
    recoveryRoster: vi.fn(),
  },
}));

const latestPoint = {
  id: 11,
  date: "2026-07-28",
  sleep_duration_minutes: 480,
  sleep_quality: 4,
  fatigue: 2,
  stress: 2,
  muscle_soreness: 2,
  overall_feeling: 4,
  resting_heart_rate: 52,
  hrv_rmssd: "61.50",
  illness_severity: 0,
  injury_severity: 0,
  notes: "",
  share_with_coach: true,
  readiness_score: 90,
  subjective_score: 80,
  status: "ready" as const,
  signals: [],
  resting_heart_rate_baseline: 51,
  resting_heart_rate_deviation_pct: 2,
  resting_heart_rate_baseline_samples: 10,
  hrv_baseline: 60,
  hrv_deviation_pct: 2.5,
  hrv_baseline_samples: 10,
};

const insights: RecoveryInsights = {
  athlete: { id: 2, name: "Alex Miles" },
  date_from: "2026-07-01",
  date_to: "2026-07-28",
  summary: {
    latest: latestPoint,
    average_readiness: 82,
    readiness_change: 8,
    check_in_days: 24,
    completion_rate: 86,
    attention_days: 3,
  },
  load_context: {
    completed_load_7d: "245.00",
    planned_load_next_7d: "280.00",
    fitness: "31.20",
    fatigue: "34.10",
    form: "-2.90",
  },
  points: [
    { ...latestPoint, id: 10, date: "2026-07-27", readiness_score: 78, sleep_duration_minutes: 420 },
    latestPoint,
  ],
};

const roster: RecoveryRoster = {
  as_of: "2026-07-28",
  summary: { athletes_count: 1, checked_in_today: 1, attention_count: 1 },
  athletes: [{
    athlete: { id: 2, name: "Alex Miles" },
    latest_date: "2026-07-28",
    days_since_check_in: 0,
    readiness_score: 58,
    status: "monitor",
    signals: ["high_fatigue"],
    attention_required: true,
    completed_load_7d: "245.00",
    planned_load_next_7d: "280.00",
  }],
};

beforeEach(() => {
  localStorage.setItem("endurance_locale", "en");
  authState.user = {
    id: 2,
    username: "runner",
    role: "athlete",
    first_name: "Alex",
    last_name: "Miles",
  };
  vi.mocked(api.wellnessCheckIns).mockResolvedValue({
    count: 0,
    next: null,
    previous: null,
    results: [],
  });
  vi.mocked(api.recoveryInsights).mockResolvedValue(insights);
  vi.mocked(api.createWellnessCheckIn).mockResolvedValue({
    id: 11,
    athlete: 2,
    check_in_date: "2026-07-28",
    sleep_duration_minutes: 480,
    sleep_quality: 4,
    fatigue: 2,
    stress: 2,
    muscle_soreness: 2,
    overall_feeling: 4,
    resting_heart_rate: null,
    hrv_rmssd: null,
    illness_severity: 0,
    injury_severity: 0,
    notes: "",
    share_with_coach: true,
    source: "manual",
    created_at: "2026-07-28T06:00:00Z",
    updated_at: "2026-07-28T06:00:00Z",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("athlete records a daily check-in and sees transparent recovery context", async () => {
  const { container } = render(
    <MemoryRouter>
      <LanguageProvider><RecoveryPage /></LanguageProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Daily wellness and recovery" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "How are you responding to training?" })).toBeInTheDocument();
  expect(screen.getAllByText("Ready to follow the plan")).not.toHaveLength(0);
  expect(screen.getByText("This workspace supports coaching conversations. It does not diagnose illness, injury, overtraining, or readiness to compete.")).toBeInTheDocument();
  expect(container.querySelector(".readiness-line")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Sleep quality"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Save check-in" }));

  await waitFor(() => expect(api.createWellnessCheckIn).toHaveBeenCalledTimes(1));
  expect(api.createWellnessCheckIn).toHaveBeenCalledWith(expect.objectContaining({
    sleep_quality: 4,
    share_with_coach: true,
  }));
});

test("coach sees the recovery attention roster beside athlete load", async () => {
  authState.user = {
    id: 1,
    username: "coach",
    role: "coach",
    first_name: "Casey",
    last_name: "Coach",
  };
  vi.mocked(api.athletes).mockResolvedValue({
    count: 1,
    next: null,
    previous: null,
    results: [{
      id: 5,
      coach: {
        id: 1,
        username: "coach",
        email: "coach@example.com",
        first_name: "Casey",
        last_name: "Coach",
        role: "coach",
        profile: { sport: "triathlon", bio: "", date_of_birth: null },
      },
      athlete: {
        id: 2,
        username: "runner",
        email: "runner@example.com",
        first_name: "Alex",
        last_name: "Miles",
        role: "athlete",
        profile: { sport: "running", bio: "", date_of_birth: null },
      },
      is_active: true,
    }],
  });
  vi.mocked(api.recoveryRoster).mockResolvedValue(roster);
  vi.mocked(api.recoveryInsights).mockResolvedValue(insights);

  render(
    <MemoryRouter initialEntries={["/recovery?athlete_id=2"]}>
      <LanguageProvider><RecoveryPage /></LanguageProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Morning athlete overview" })).toBeInTheDocument();
  expect(screen.getByText("need review")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Alex Miles/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open load analysis/ })).toHaveAttribute("href", "/performance?athlete_id=2");
  expect(await screen.findByText("Completed load · 7 days")).toBeInTheDocument();
  expect(api.recoveryInsights).toHaveBeenCalledWith(2, 28);
});
