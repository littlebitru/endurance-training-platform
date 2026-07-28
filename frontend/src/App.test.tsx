import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthProvider } from "./auth";
import { LanguageProvider } from "./i18n";
import App, { AthletePlanPortfolio, WeeklyCommandCenter } from "./App";
import type { TrainingCalendar, TrainingPlan, Workout } from "./types";

beforeEach(() => {
  localStorage.setItem("endurance_locale", "en");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderApp() {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }} initialEntries={["/auth"]}>
      <LanguageProvider><AuthProvider><App /></AuthProvider></LanguageProvider>
    </MemoryRouter>,
  );
}

test("renders the sign-in experience for guests", async () => {
  renderApp();
  expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
});

test("shows registration errors returned by the API", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ username: ["This username is already registered."] }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  renderApp();

  fireEvent.click(await screen.findByRole("button", { name: "New here? Create an account" }));
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "coach@example.com" } });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "antoncoach" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "StrongPass123!" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("This username is already registered.");
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
});

test("switches the interface to Russian", async () => {
  renderApp();

  fireEvent.click(await screen.findByRole("button", { name: "RU" }));

  expect(screen.getByRole("heading", { name: "С возвращением" })).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("ru");
});

test("shows every active athlete plan as a direct workspace link", () => {
  const plans = [
    {
      id: 20,
      coach: 1,
      title: "Marathon build",
      description: "",
      primary_sport: "running",
      target_event_name: "Autumn Marathon",
      target_event_type: "run_marathon",
      target_distance_km: "42.20",
      athlete: 2,
      start_date: "2026-08-03",
      end_date: "2026-11-22",
      is_active: true,
      publication_status: "published",
      published_at: "2026-07-20T08:00:00Z",
      weeks: [],
    },
    {
      id: 21,
      coach: 1,
      title: "5 km speed",
      description: "",
      primary_sport: "running",
      target_event_name: "Summer 5K",
      target_event_type: "run_5k",
      target_distance_km: "5.00",
      athlete: 2,
      start_date: "2026-07-28",
      end_date: "2026-09-12",
      is_active: true,
      publication_status: "published",
      published_at: "2026-07-25T08:00:00Z",
      weeks: [],
    },
  ] satisfies TrainingPlan[];

  render(
    <MemoryRouter>
      <LanguageProvider><AthletePlanPortfolio plans={plans} /></LanguageProvider>
    </MemoryRouter>,
  );

  expect(screen.getByRole("link", { name: /Marathon build/ })).toHaveAttribute("href", "/plans?plan_id=20");
  expect(screen.getByRole("link", { name: /5 km speed/ })).toHaveAttribute("href", "/plans?plan_id=21");
});

const weekCalendar = {
  date_from: "2026-07-27",
  date_to: "2026-08-02",
  summary: {
    athletes_count: 1,
    planned_count: 5,
    completed_count: 3,
    unplanned_count: 0,
    attention_count: 2,
    completion_rate: 60,
    average_compliance: 87,
    planned_duration_minutes: 300,
    actual_duration_minutes: "175.00",
    training_load_score: "241.40",
  },
  events: [],
} satisfies TrainingCalendar;

const nextWorkout = {
  id: 30,
  weekly_plan: 3,
  title: "Easy aerobic run",
  sport: "running",
  workout_type: "endurance",
  status: "planned",
  scheduled_at: "2026-07-29T06:30:00Z",
  planned_duration_minutes: 45,
  planned_distance_km: "8.00",
  intensity: "Z2",
  notes: "",
  exercises: [],
  coach_comments: [],
} satisfies Workout;

test("shows a compact localized weekly command center for an athlete", () => {
  localStorage.setItem("endurance_locale", "ru");

  render(
    <MemoryRouter>
      <LanguageProvider>
        <WeeklyCommandCenter
          activePlanCount={2}
          athleteCount={0}
          calendar={weekCalendar}
          nextWorkout={nextWorkout}
          role="athlete"
        />
      </LanguageProvider>
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "Ваша тренировочная неделя" })).toBeInTheDocument();
  expect(screen.getByText("бег")).toBeInTheDocument();
  expect(screen.getByText("60%")).toBeInTheDocument();
  expect(screen.getByText("241")).toBeInTheDocument();
  expect(screen.getByText("Процент выполнения")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Активные планы/ })).toHaveAttribute("href", "/plans");
  expect(screen.getByRole("link", { name: /Следующая тренировка/ })).toHaveAttribute(
    "href",
    "/calendar?date=2026-07-29&workout_id=30",
  );
  expect(screen.getByRole("link", { name: /Открыть календарь тренировок/ })).toHaveAttribute("href", "/calendar");
});

test("prioritizes the coach review queue when sessions need attention", () => {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <WeeklyCommandCenter
          activePlanCount={0}
          athleteCount={4}
          calendar={weekCalendar}
          role="coach"
        />
      </LanguageProvider>
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "Some sessions need your review" })).toBeInTheDocument();
  expect(screen.getByText("The review queue contains 2 missed or materially deviating sessions.")).toBeInTheDocument();
  expect(screen.getByText("4")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open review queue/ })).toHaveAttribute("href", "/calendar");
});
