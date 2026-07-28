import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthProvider } from "./auth";
import { LanguageProvider } from "./i18n";
import App, { AthletePlanPortfolio } from "./App";
import type { TrainingPlan } from "./types";

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
