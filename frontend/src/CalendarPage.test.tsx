import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { CalendarPage } from "./CalendarPage";
import { LanguageProvider } from "./i18n";
import type { TrainingCalendar, TrainingPlan } from "./types";

const authState = vi.hoisted(() => ({
  user: {
    id: 2,
    username: "runner",
    role: "athlete" as "athlete" | "coach",
    first_name: "Alex",
    last_name: "Miles",
  },
}));
vi.mock("./auth", () => ({
  useAuth: () => ({
    user: authState.user,
  }),
}));

vi.mock("./api", () => ({
  api: {
    calendar: vi.fn(),
    athletes: vi.fn(),
    publishPlan: vi.fn(),
  },
}));

const today = new Date();
const startsAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7).toISOString();
const calendar: TrainingCalendar = {
  date_from: "2026-07-01",
  date_to: "2026-08-02",
  summary: {
    athletes_count: 1,
    planned_count: 1,
    completed_count: 1,
    unplanned_count: 0,
    attention_count: 1,
    completion_rate: 100,
    average_compliance: 68,
    planned_duration_minutes: 60,
    actual_duration_minutes: "42.0",
    training_load_score: "58.00",
  },
  events: [{
    event_id: "workout-12",
    kind: "workout",
    athlete: { id: 2, name: "Alex Miles" },
    workout_id: 12,
    activity_ids: [44],
    plan_id: 44,
    plan_title: "Marathon preparation",
    plan_publication_status: "published",
    title: "Aerobic endurance run",
    sport: "running",
    workout_type: "endurance",
    starts_at: startsAt,
    status: "completed",
    planned_duration_minutes: 60,
    planned_distance_km: "10.00",
    actual_duration_minutes: "42.0",
    actual_distance_km: "7.20",
    training_load_score: "58.00",
    compliance_score: 68,
    compliance_status: "under",
    match_confidence: "high",
    attention_required: true,
    attention_reason: "low_compliance",
    activities: [{
      id: 44,
      started_at: startsAt,
      duration_seconds: 2520,
      distance_meters: "7200.00",
      training_load_score: "58.00",
      compliance_score: 68,
      compliance_status: "under",
      match_confidence: "high",
      average_heart_rate: 149,
      average_power: null,
      average_pace_seconds_per_km: 350,
    }],
  }],
};

beforeEach(() => {
  localStorage.setItem("endurance_locale", "en");
  authState.user.id = 2;
  authState.user.username = "runner";
  authState.user.role = "athlete";
  authState.user.first_name = "Alex";
  authState.user.last_name = "Miles";
  vi.mocked(api.calendar).mockResolvedValue(calendar);
  vi.mocked(api.athletes).mockResolvedValue({
    count: 0,
    next: null,
    previous: null,
    results: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("shows a unified plan and execution calendar with attention workflow", async () => {
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <LanguageProvider><CalendarPage /></LanguageProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Plan and execution calendar" })).toBeInTheDocument();
  await waitFor(() => expect(api.calendar).toHaveBeenCalledOnce());
  expect(screen.getAllByText("Aerobic endurance run").length).toBeGreaterThan(0);
  expect(screen.getByText("Low plan compliance")).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole("button", { name: /Aerobic endurance run/ })[0]);

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open full analysis" })).toBeInTheDocument();
  expect(screen.getByText("149 bpm")).toBeInTheDocument();
});

test("opens the generated plan month and athlete from the calendar deep link", async () => {
  render(
    <MemoryRouter
      initialEntries={["/calendar?date=2026-08-03&athlete_id=2"]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <LanguageProvider><CalendarPage /></LanguageProvider>
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(api.calendar).toHaveBeenCalledWith(
      "2026-07-27",
      "2026-09-06",
      2,
      undefined,
    );
  });
});

test("opens a linked upcoming workout directly in the calendar", async () => {
  render(
    <MemoryRouter
      initialEntries={[`/calendar?date=${startsAt.slice(0, 10)}&workout_id=12`]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <LanguageProvider><CalendarPage /></LanguageProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Aerobic endurance run" })).toBeInTheDocument();
});

test("lets the coach publish a reviewed generated plan from the calendar", async () => {
  authState.user.id = 1;
  authState.user.username = "coach";
  authState.user.role = "coach";
  authState.user.first_name = "Coach";
  authState.user.last_name = "One";
  const draftCalendar: TrainingCalendar = {
    ...calendar,
    events: calendar.events.map((event) => ({
      ...event,
      status: "planned",
      plan_publication_status: "draft",
      activity_ids: [],
      activities: [],
    })),
  };
  vi.mocked(api.calendar)
    .mockResolvedValueOnce(draftCalendar)
    .mockResolvedValueOnce(calendar);
  vi.mocked(api.publishPlan).mockResolvedValue({
    id: 44,
    publication_status: "published",
  } as TrainingPlan);

  render(
    <MemoryRouter
      initialEntries={["/calendar?date=2026-08-03&athlete_id=2&plan_id=44"]}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <LanguageProvider><CalendarPage /></LanguageProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByText("Review the generated plan before publication")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Publish to athlete" }));

  await waitFor(() => expect(api.publishPlan).toHaveBeenCalledWith(44));
  expect(await screen.findByText("The reviewed plan is now visible to the athlete.")).toBeInTheDocument();
});
