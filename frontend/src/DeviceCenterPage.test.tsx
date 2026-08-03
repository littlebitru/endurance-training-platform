import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AthleteGarminConnection, CoachDeviceRoster } from "./DeviceCenterPage";
import { LanguageProvider } from "./i18n";
import type { DeviceProviderCapability, Relationship } from "./types";

afterEach(cleanup);

const pendingCapability: DeviceProviderCapability = {
  provider: "garmin",
  partner_status: "application_required",
  authorization_available: false,
  direct_delivery_available: false,
  manual_fit_available: true,
};

test("keeps Garmin connection honest while personalized FIT remains available", () => {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <AthleteGarminConnection
          capability={pendingCapability}
          dateLocale="en-US"
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
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
          connectionByAthlete={new Map()}
          dateLocale="en-US"
          relationships={relationships}
        />
      </LanguageProvider>
    </MemoryRouter>,
  );

  expect(screen.getByText("Alex Runner")).toBeInTheDocument();
  expect(screen.getByText("The athlete has not granted Garmin consent")).toBeInTheDocument();
  expect(screen.getByText("Athlete-owned consent")).toBeInTheDocument();
});
