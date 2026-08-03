import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AthleteProviderConnection, CoachDeviceRoster } from "./DeviceCenterPage";
import { LanguageProvider } from "./i18n";
import type { DeviceProviderCapability, Relationship } from "./types";

afterEach(cleanup);

const pendingCapability: DeviceProviderCapability = {
  provider: "garmin",
  partner_status: "application_required",
  authorization_available: false,
  direct_delivery_available: false,
  manual_fit_available: true,
  activity_import_available: false,
  automatic_activity_sync_available: false,
};

test("keeps Garmin connection honest while personalized FIT remains available", () => {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <AthleteProviderConnection
          capability={pendingCapability}
          dateLocale="en-US"
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
          onSync={vi.fn()}
          working={false}
        />
      </LanguageProvider>
    </MemoryRouter>,
  );

  expect(screen.getByRole("button", { name: "Connect Garmin" })).toBeDisabled();
  expect(screen.getByText("Partner activation in progress")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open calendar / FIT" })).toHaveAttribute("href", "/calendar");
});

test("shows athlete readiness without exposing device credentials to a coach", () => {
  const relationships = [{
    id: 1,
    coach: { id: 1 },
    athlete: {
      id: 2,
      username: "runner",
      email: "runner@example.com",
      first_name: "Alex",
      last_name: "Runner",
      role: "athlete",
      profile: { sport: "running", bio: "", date_of_birth: null },
    },
    is_active: true,
  }] as Relationship[];

  render(
    <MemoryRouter>
      <LanguageProvider>
        <CoachDeviceRoster
          connectionByAthleteProvider={new Map()}
          dateLocale="en-US"
          relationships={relationships}
        />
      </LanguageProvider>
    </MemoryRouter>,
  );

  expect(screen.getByText("Alex Runner")).toBeInTheDocument();
  expect(screen.getByText("The athlete has not connected a training provider")).toBeInTheDocument();
  expect(screen.getByText("Athlete-owned consent")).toBeInTheDocument();
});

test("shows honest Strava activity-sync capabilities", () => {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <AthleteProviderConnection
          capability={{
            ...pendingCapability,
            provider: "strava",
            partner_status: "available",
            authorization_available: true,
            activity_import_available: true,
            automatic_activity_sync_available: true,
            manual_fit_available: false,
          }}
          dateLocale="en-US"
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
          onSync={vi.fn()}
          working={false}
        />
      </LanguageProvider>
    </MemoryRouter>,
  );

  expect(screen.getByRole("button", { name: "Connect Strava" })).toBeEnabled();
  expect(screen.getByText(/Completed activity import/)).toBeInTheDocument();
  expect(screen.getByText(/Automatic calendar matching/)).toBeInTheDocument();
});
