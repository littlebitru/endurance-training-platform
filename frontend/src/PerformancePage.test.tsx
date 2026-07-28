import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { LanguageProvider } from "./i18n";
import { PerformancePage } from "./PerformancePage";
import type { PerformanceInsights } from "./types";

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
    athletes: vi.fn(),
    performanceInsights: vi.fn(),
  },
}));

const insights: PerformanceInsights = {
  athlete: { id: 2, name: "Alex Miles" },
  date_from: "2026-07-27",
  date_to: "2026-07-29",
  sport: "",
  summary: {
    as_of: "2026-07-28",
    fitness: "24.30",
    fatigue: "30.10",
    form: "-5.80",
    balance_status: "balanced",
    seven_day_load: "245.00",
    twenty_eight_day_load: "710.00",
    fitness_change_7d: "2.40",
    forecast_fitness: "25.10",
    forecast_form: "-3.20",
    forecast_fitness_change: "0.80",
  },
  data_quality: {
    activities_count: 18,
    actual_load_days: 15,
    planned_workouts_count: 7,
    has_history: true,
    has_forecast: true,
  },
  points: [
    {
      date: "2026-07-27",
      actual_load: "72.00",
      planned_load: "65.00",
      effective_load: "72.00",
      fitness: "23.80",
      fatigue: "29.00",
      form: "-4.70",
      projected: false,
    },
    {
      date: "2026-07-28",
      actual_load: "35.00",
      planned_load: "40.00",
      effective_load: "35.00",
      fitness: "24.30",
      fatigue: "30.10",
      form: "-5.80",
      projected: false,
    },
    {
      date: "2026-07-29",
      actual_load: "0.00",
      planned_load: "49.00",
      effective_load: "49.00",
      fitness: "25.10",
      fatigue: "32.80",
      form: "-5.80",
      projected: true,
    },
  ],
};

beforeEach(() => {
  localStorage.setItem("endurance_locale", "en");
  vi.mocked(api.performanceInsights).mockResolvedValue(insights);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("renders actionable performance insights and an interactive forecast", async () => {
  const { container } = render(
    <MemoryRouter>
      <LanguageProvider><PerformancePage /></LanguageProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Fitness, fatigue, and training balance" })).toBeInTheDocument();
  expect(screen.getByText("Alex Miles")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Balanced" })).toBeInTheDocument();
  expect(screen.getByText("These values describe training-load patterns. They are not a medical assessment or a standalone instruction to train.")).toBeInTheDocument();
  expect(screen.getByText("18")).toBeInTheDocument();
  expect(container.querySelectorAll(".performance-line")).toHaveLength(3);

  expect(screen.getByRole("slider", { name: "Selected day" })).toHaveAttribute("max", "2");
  expect(screen.getByText("July 28, 2026")).toBeInTheDocument();
  expect(screen.getAllByText("40")).not.toHaveLength(0);
});

test("reloads the analysis when the period changes", async () => {
  render(
    <MemoryRouter>
      <LanguageProvider><PerformancePage /></LanguageProvider>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Fitness, fatigue, and training balance" });

  fireEvent.click(screen.getByRole("button", { name: "6 months" }));

  await waitFor(() => expect(api.performanceInsights).toHaveBeenCalledTimes(2));
});
