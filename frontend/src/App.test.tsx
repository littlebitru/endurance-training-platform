import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthProvider } from "./auth";
import { LanguageProvider } from "./i18n";
import App from "./App";

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
    <MemoryRouter initialEntries={["/auth"]}>
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
