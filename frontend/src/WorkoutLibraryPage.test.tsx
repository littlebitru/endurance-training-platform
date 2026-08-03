import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { LanguageProvider } from "./i18n";
import type { Relationship, TrainingPlan, WorkoutTemplate } from "./types";
import { WorkoutLibraryPage } from "./WorkoutLibraryPage";

const authState = vi.hoisted(() => ({
  user: {
    id: 1,
    username: "coach",
    role: "coach",
    first_name: "Casey",
    last_name: "Coach",
  },
}));

vi.mock("./auth", () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock("./api", () => ({
  api: {
    workoutTemplates: vi.fn(),
    plans: vi.fn(),
    athletes: vi.fn(),
    trainingZones: vi.fn(),
    createWorkoutTemplate: vi.fn(),
    updateWorkoutTemplate: vi.fn(),
    duplicateWorkoutTemplate: vi.fn(),
    assignWorkoutTemplate: vi.fn(),
    previewGarminFit: vi.fn(),
    downloadGarminFit: vi.fn(),
  },
}));

const systemTemplate: WorkoutTemplate = {
  id: 41,
  coach: null,
  slug: "run-threshold-4x8",
  source: "system",
  is_system: true,
  is_archived: false,
  title: "Threshold development · 4 × 8 min",
  title_ru: "Развитие порога · 4 × 8 мин",
  sport: "running",
  workout_type: "threshold",
  description: "Controlled threshold intervals.",
  description_ru: "Контролируемые пороговые интервалы.",
  objective: "Accumulate sustainable work near threshold.",
  objective_ru: "Накопить устойчивую работу вблизи порога.",
  difficulty: "intermediate",
  tags: ["threshold", "intervals"],
  equipment: ["running_shoes"],
  planned_duration_minutes: 66,
  planned_distance_km: null,
  intensity: "Z4",
  structured_steps: [
    { name: "Warm-up", name_ru: "Разминка", step_type: "warmup", duration_seconds: 900, repetitions: 1, recovery_seconds: null, target_type: "pace", target_min: 2, target_max: 2, target_unit: "zone" },
    { name: "Threshold intervals", name_ru: "Пороговые интервалы", step_type: "work", duration_seconds: 480, repetitions: 4, recovery_seconds: 120, target_type: "pace", target_min: 4, target_max: 4, target_unit: "zone" },
    { name: "Cool-down", name_ru: "Заминка", step_type: "cooldown", duration_seconds: 900, repetitions: 1, recovery_seconds: null, target_type: "pace", target_min: 1, target_max: 1, target_unit: "zone" },
  ],
  schema_version: 1,
  usage_count: 0,
  structure_summary: { step_count: 3, work_intervals: 4, total_duration_seconds: 3960, total_duration_minutes: 66, total_distance_meters: 0, total_distance_km: "0.00" },
  compatibility: { status: "ready", garmin_ready: true, issues: [], warnings: [] },
};

const coachTemplate: WorkoutTemplate = {
  ...systemTemplate,
  id: 42,
  coach: 1,
  slug: null,
  source: "coach",
  is_system: false,
  title: "Coach threshold copy",
  title_ru: "",
};

const plan: TrainingPlan = {
  id: 8,
  coach: 1,
  athlete: 2,
  title: "5 km preparation",
  description: "",
  primary_sport: "running",
  target_event_name: "City 5K",
  target_event_type: "run_5k",
  target_distance_km: "5.00",
  start_date: "2026-08-03",
  end_date: "2026-09-14",
  is_active: true,
  publication_status: "draft",
  published_at: null,
  weeks: [{ id: 20, training_plan: 8, week_number: 1, start_date: "2026-08-03", phase: "base", planned_duration_minutes: 240, is_recovery: false, notes: "", workouts: [] }],
};

const relationship: Relationship = {
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
};

beforeEach(() => {
  localStorage.setItem("endurance_locale", "en");
  vi.mocked(api.workoutTemplates).mockResolvedValue({ count: 1, next: null, previous: null, results: [systemTemplate] });
  vi.mocked(api.plans).mockResolvedValue({ count: 1, next: null, previous: null, results: [plan] });
  vi.mocked(api.athletes).mockResolvedValue({ count: 1, next: null, previous: null, results: [relationship] });
  vi.mocked(api.trainingZones).mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  vi.mocked(api.createWorkoutTemplate).mockResolvedValue(coachTemplate);
  vi.mocked(api.duplicateWorkoutTemplate).mockResolvedValue(coachTemplate);
  vi.mocked(api.assignWorkoutTemplate).mockResolvedValue({
    id: 71,
    weekly_plan: 20,
    title: systemTemplate.title,
    sport: "running",
    workout_type: "threshold",
    status: "planned",
    scheduled_at: "2026-08-03T07:00:00Z",
    planned_duration_minutes: 66,
    planned_distance_km: null,
    intensity: "Z4",
    notes: "",
    source_template: 41,
    structure_version: 1,
    exercises: [],
    coach_comments: [],
  });
  vi.mocked(api.previewGarminFit).mockResolvedValue({
    template_id: 41,
    title: systemTemplate.title,
    sport: "running",
    athlete: { id: 2, name: "Alex Miles" },
    filename: "threshold-development.fit",
    sdk_version: "21.208.0",
    fit_protocol_version: "2.0",
    status: "ready",
    can_export: true,
    issues: [],
    warnings: [],
    step_count: 9,
    steps: [],
  });
  vi.mocked(api.downloadGarminFit).mockResolvedValue({
    blob: new Blob(["fit"]),
    filename: "threshold-development.fit",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("coach reviews a curated workout and schedules it atomically", async () => {
  render(
    <MemoryRouter initialEntries={["/workout-library"]}>
      <LanguageProvider>
        <Routes>
          <Route path="/workout-library" element={<WorkoutLibraryPage />} />
          <Route path="/plans" element={<div>Plan workspace</div>} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Design once. Personalize for every athlete." })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: systemTemplate.title })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("Training plan")).toHaveValue("8");
  fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));

  await waitFor(() => expect(api.assignWorkoutTemplate).toHaveBeenCalledWith(41, expect.objectContaining({
    weekly_plan: 20,
    locale: "en",
  })));
  expect(await screen.findByText("Plan workspace")).toBeInTheDocument();
});

test("coach builds and saves a reusable structured workout", async () => {
  render(
    <MemoryRouter>
      <LanguageProvider><WorkoutLibraryPage /></LanguageProvider>
    </MemoryRouter>,
  );

  await screen.findByRole("heading", { name: systemTemplate.title });
  fireEvent.click(screen.getByRole("button", { name: /Create workout/ }));
  fireEvent.change(screen.getByLabelText("Workout title"), { target: { value: "Aerobic progression" } });
  fireEvent.change(screen.getAllByLabelText("Duration type")[1], { target: { value: "distance" } });
  expect(screen.getByLabelText(/Distance, kilometers/)).toHaveValue(1);
  fireEvent.change(screen.getByLabelText(/Distance, kilometers/), { target: { value: "1.2" } });
  fireEvent.change(screen.getByLabelText("Sport"), { target: { value: "swimming" } });
  expect(screen.getByLabelText(/Distance, meters/)).toHaveValue(1200);
  fireEvent.change(screen.getByLabelText("Sport"), { target: { value: "running" } });
  expect(screen.getByLabelText(/Distance, kilometers/)).toHaveValue(1.2);
  fireEvent.click(screen.getByRole("button", { name: "Save to library" }));

  await waitFor(() => expect(api.createWorkoutTemplate).toHaveBeenCalledTimes(1));
  expect(api.createWorkoutTemplate).toHaveBeenCalledWith(expect.objectContaining({
    title: "Aerobic progression",
    sport: "running",
    workout_type: "endurance",
    planned_duration_minutes: 20,
    planned_distance_km: "1.20",
    structured_steps: expect.arrayContaining([
      expect.objectContaining({ step_type: "warmup", duration_seconds: 600 }),
      expect.objectContaining({ step_type: "work", duration_seconds: null, distance_meters: 1200, target_unit: "zone" }),
    ]),
  }));
});

test("coach downloads a personalized Garmin FIT workout", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:garmin-fit") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const createObjectUrl = vi.mocked(URL.createObjectURL);
  const revokeObjectUrl = vi.mocked(URL.revokeObjectURL);
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  render(
    <MemoryRouter>
      <LanguageProvider><WorkoutLibraryPage /></LanguageProvider>
    </MemoryRouter>,
  );

  await screen.findByRole("heading", { name: systemTemplate.title });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(api.previewGarminFit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Choose the athlete/), { target: { value: "2" } });

  await waitFor(() => expect(api.previewGarminFit).toHaveBeenCalledWith(41, 2, "en"));
  expect(await screen.findByText("Personalized FIT file is ready")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Download .FIT file" }));

  await waitFor(() => expect(api.downloadGarminFit).toHaveBeenCalledWith(41, 2, "en"));
  expect(createObjectUrl).toHaveBeenCalled();
  expect(anchorClick).toHaveBeenCalled();
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:garmin-fit");
});

test("coach sees how to enable Garmin export when no athletes are assigned", async () => {
  vi.mocked(api.athletes).mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  render(
    <MemoryRouter>
      <LanguageProvider><WorkoutLibraryPage /></LanguageProvider>
    </MemoryRouter>,
  );

  await screen.findByRole("heading", { name: systemTemplate.title });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));

  expect(await screen.findByText("Add an athlete before exporting")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open athletes" })).toBeInTheDocument();
  expect(api.previewGarminFit).not.toHaveBeenCalled();
});
