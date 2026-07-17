import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AuthProvider } from "./auth";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

test("renders the sign-in experience for guests", async () => {
  render(<MemoryRouter initialEntries={["/auth"]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
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
  render(<MemoryRouter initialEntries={["/auth"]}><AuthProvider><App /></AuthProvider></MemoryRouter>);

  fireEvent.click(await screen.findByRole("button", { name: "New here? Create an account" }));
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "coach@example.com" } });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "antoncoach" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "StrongPass123!" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("This username is already registered.");
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
});
