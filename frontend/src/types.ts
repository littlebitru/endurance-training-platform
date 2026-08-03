export type Role = "coach" | "athlete";
export interface CoachSummary { id: number; username: string; first_name: string; last_name: string }
export interface User { id: number; username: string; email: string; first_name: string; last_name: string; role: Role; profile: { sport: string; bio: string; date_of_birth: string | null }; coach?: CoachSummary | null }
export interface Page<T> { count: number; next: string | null; previous: string | null; results: T[] }
export interface Exercise { id: number; workout: number; name: string; step_type: string; order: number; description: string; repetitions: number | null; duration_seconds: number | null; distance_meters: number | null; recovery_seconds: number | null; target_type: string; target_min: string | null; target_max: string | null; target_unit: string; resolved_target_min: string | null; resolved_target_max: string | null; resolved_target_unit: string; resolved_target_label: string }
export interface CoachComment { id: number; workout: number; coach: number; coach_name: string; body: string; created_at: string }
export interface Workout { id: number; weekly_plan: number; title: string; sport: string; workout_type: string; status: string; scheduled_at: string; planned_duration_minutes: number | null; planned_distance_km: string | null; intensity: string; notes: string; source_template?: number | null; structure_version?: number; exercises: Exercise[]; coach_comments: CoachComment[]; log?: WorkoutLog | null }
export interface WorkoutLog { id: number; workout: number; completed_at: string; actual_duration_minutes: number | null; actual_distance_km: string | null; perceived_exertion: number | null; notes: string }
export interface WeeklyPlan { id: number; training_plan: number; week_number: number; start_date: string; phase: string; planned_duration_minutes: number | null; is_recovery: boolean; notes: string; workouts: Workout[] }
export type PlanPublicationStatus = "draft" | "published" | "archived";
export interface TrainingPlan { id: number; coach: number; title: string; description: string; primary_sport: string; target_event_name: string; target_event_type: string; target_distance_km: string | null; generation_method?: "manual" | "periodized"; experience_level?: "beginner" | "intermediate" | "advanced" | ""; athlete: number; start_date: string; end_date: string; is_active: boolean; publication_status: PlanPublicationStatus; published_at: string | null; created_at?: string; updated_at?: string; weeks: WeeklyPlan[] }
export interface Relationship { id: number; coach: User; athlete: User; is_active: boolean }
export interface TrainingGoalProfile { code: string; sport: string; label: string; distance_km: string | null; minimum_weeks: number; recommended_taper_weeks: number; recommended_weekly_minutes: Record<"beginner" | "intermediate" | "advanced", number> }
export interface WeeklyAnalytics { week_start: string; total_workouts: number; completed_workouts: number; completion_rate: number; planned_duration_minutes: string; actual_duration_minutes: string; planned_distance_km: string; actual_distance_km: string; session_load: string }
export interface Analytics { total_workouts: number; completed_workouts: number; skipped_workouts: number; completion_rate: number; planned_duration_minutes: string; actual_duration_minutes: string; planned_distance_km: string; actual_distance_km: string; average_perceived_exertion: number | null; weekly: WeeklyAnalytics[] }
export type TrainingBalanceStatus = "very_fresh" | "fresh" | "balanced" | "building" | "high_load";
export interface PerformancePoint {
  date: string;
  actual_load: string;
  planned_load: string;
  effective_load: string;
  fitness: string;
  fatigue: string;
  form: string;
  projected: boolean;
}
export interface PerformanceInsights {
  athlete: { id: number; name: string };
  date_from: string;
  date_to: string;
  sport: string;
  summary: {
    as_of: string;
    fitness: string;
    fatigue: string;
    form: string;
    balance_status: TrainingBalanceStatus;
    seven_day_load: string;
    twenty_eight_day_load: string;
    fitness_change_7d: string;
    forecast_fitness: string;
    forecast_form: string;
    forecast_fitness_change: string;
  };
  data_quality: {
    activities_count: number;
    actual_load_days: number;
    planned_workouts_count: number;
    has_history: boolean;
    has_forecast: boolean;
  };
  points: PerformancePoint[];
}

export type RecoveryStatus = "ready" | "monitor" | "recovery_focus" | "missing";

export interface WellnessCheckIn {
  id: number;
  athlete: number;
  check_in_date: string;
  sleep_duration_minutes: number | null;
  sleep_quality: number;
  fatigue: number;
  stress: number;
  muscle_soreness: number;
  overall_feeling: number;
  resting_heart_rate: number | null;
  hrv_rmssd: string | null;
  illness_severity: number;
  injury_severity: number;
  notes: string;
  share_with_coach: boolean;
  source: "manual" | "device";
  created_at: string;
  updated_at: string;
}

export interface RecoveryPoint {
  id: number;
  date: string;
  sleep_duration_minutes: number | null;
  sleep_quality: number;
  fatigue: number;
  stress: number;
  muscle_soreness: number;
  overall_feeling: number;
  resting_heart_rate: number | null;
  hrv_rmssd: string | null;
  illness_severity: number;
  injury_severity: number;
  notes: string;
  share_with_coach: boolean;
  readiness_score: number;
  subjective_score: number;
  status: Exclude<RecoveryStatus, "missing">;
  signals: string[];
  resting_heart_rate_baseline: number | null;
  resting_heart_rate_deviation_pct: number | null;
  resting_heart_rate_baseline_samples: number;
  hrv_baseline: number | null;
  hrv_deviation_pct: number | null;
  hrv_baseline_samples: number;
}

export interface RecoveryInsights {
  athlete: { id: number; name: string };
  date_from: string;
  date_to: string;
  summary: {
    latest: RecoveryPoint | null;
    average_readiness: number | null;
    readiness_change: number;
    check_in_days: number;
    completion_rate: number;
    attention_days: number;
  };
  load_context: {
    completed_load_7d: string;
    planned_load_next_7d: string;
    fitness: string;
    fatigue: string;
    form: string;
  };
  points: RecoveryPoint[];
}

export interface RecoveryRosterEntry {
  athlete: { id: number; name: string };
  latest_date: string | null;
  days_since_check_in: number | null;
  readiness_score: number | null;
  status: RecoveryStatus;
  signals: string[];
  attention_required: boolean;
  completed_load_7d: string;
  planned_load_next_7d: string;
}

export interface RecoveryRoster {
  as_of: string;
  summary: {
    athletes_count: number;
    checked_in_today: number;
    attention_count: number;
  };
  athletes: RecoveryRosterEntry[];
}

export interface TrainingZone { id: number; athlete: number; sport: string; metric: string; zone_number: number; name: string; lower_bound: string; upper_bound: string; unit: string; display_range: string }
export interface AthleteThreshold { id: number; athlete: number; sport: string; effective_from: string; source: string; notes: string; is_current: boolean; threshold_heart_rate: number | null; maximum_heart_rate: number | null; functional_threshold_power: number | null; threshold_pace_seconds_per_km: number | null; critical_swim_speed_seconds_per_100m: number | null; heart_rate_basis: string; zones: TrainingZone[]; updated_at: string }
export interface WorkoutTemplateStep {
  name: string;
  name_ru?: string;
  step_type: string;
  order?: number;
  description?: string;
  description_ru?: string;
  repetitions?: number | null;
  duration_seconds?: number | null;
  distance_meters?: number | null;
  recovery_seconds?: number | null;
  target_type: string;
  target_min?: string | number | null;
  target_max?: string | number | null;
  target_unit?: string;
}
export interface WorkoutTemplate {
  id: number;
  coach: number | null;
  slug: string | null;
  source: "system" | "coach";
  is_system: boolean;
  is_archived: boolean;
  title: string;
  title_ru: string;
  sport: string;
  workout_type: string;
  description: string;
  description_ru: string;
  objective: string;
  objective_ru: string;
  difficulty: "all" | "beginner" | "intermediate" | "advanced";
  tags: string[];
  equipment: string[];
  planned_duration_minutes: number | null;
  planned_distance_km: string | null;
  intensity: string;
  structured_steps: WorkoutTemplateStep[];
  schema_version: number;
  usage_count: number;
  structure_summary: {
    step_count: number;
    work_intervals: number;
    total_duration_seconds: number;
    total_duration_minutes: number;
    total_distance_meters: number;
    total_distance_km: string;
  };
  compatibility: {
    status: "ready" | "adaptation_required" | "blocked";
    garmin_ready: boolean;
    issues: string[];
    warnings: string[];
  };
}
export interface GarminFitIssue {
  code: string;
  step_index?: number;
  target_type?: string;
  zone_from?: number;
  zone_to?: number;
  unit?: string;
}
export interface GarminFitPreviewStep {
  index: number;
  source_step: number;
  name: string;
  step_type: string;
  duration: { type: "time" | "distance" | "open"; value: number | null; unit: string };
  target: {
    type: string;
    source: "athlete_zones" | "explicit" | "open";
    zone_from?: number;
    zone_to?: number;
    minimum: string | null;
    maximum: string | null;
    unit: string;
  };
}
export interface GarminFitPreview {
  source_type: "template" | "workout";
  source_id: number;
  template_id?: number;
  workout_id?: number;
  title: string;
  sport: string;
  athlete: { id: number; name: string };
  filename: string;
  sdk_version: string;
  fit_protocol_version: string;
  status: "ready" | "adaptation_required" | "blocked";
  can_export: boolean;
  issues: GarminFitIssue[];
  warnings: GarminFitIssue[];
  step_count: number;
  steps: GarminFitPreviewStep[];
}
export interface ActivityStreamPoint { elapsed: number; heart_rate?: number; power?: number; cadence?: number; speed?: number; distance?: number; elevation?: number }
export interface ActivityZone { zone: number; name: string; seconds: number; percentage: number }
export interface Activity {
  id: number;
  athlete: number;
  athlete_name: string;
  workout: number | null;
  workout_title: string | null;
  planned_duration_minutes: number | null;
  planned_distance_km: string | null;
  source_file_name: string;
  file_type: "fit" | "tcx" | "gpx";
  sport: string;
  started_at: string;
  duration_seconds: number;
  moving_time_seconds: number | null;
  distance_meters: string | null;
  elevation_gain_meters: string | null;
  calories: number | null;
  average_heart_rate: number | null;
  maximum_heart_rate: number | null;
  average_power: number | null;
  maximum_power: number | null;
  normalized_power: number | null;
  average_cadence: number | null;
  maximum_cadence: number | null;
  average_speed_mps: string | null;
  average_pace_seconds_per_km: number | null;
  intensity_factor: string | null;
  training_load_score: string | null;
  training_load_method: string;
  compliance_score: number | null;
  compliance_status: string;
  match_confidence: string;
  zone_distribution: { metric?: string; unit?: string; zones?: ActivityZone[] };
  created_at: string;
  stream?: { points: ActivityStreamPoint[]; point_count: number; sample_interval_seconds: number | null };
}

export interface CalendarActivity {
  id: number;
  started_at: string;
  duration_seconds: number;
  distance_meters: string | null;
  training_load_score: string | null;
  compliance_score: number | null;
  compliance_status: string;
  match_confidence: string;
  average_heart_rate: number | null;
  average_power: number | null;
  average_pace_seconds_per_km: number | null;
}

export interface CalendarEvent {
  event_id: string;
  kind: "workout" | "activity";
  athlete: { id: number; name: string };
  workout_id: number | null;
  activity_ids: number[];
  plan_id: number | null;
  plan_title: string;
  plan_publication_status: PlanPublicationStatus | "";
  title: string;
  sport: string;
  workout_type: string;
  starts_at: string;
  status: string;
  planned_duration_minutes: number | null;
  planned_distance_km: string | null;
  actual_duration_minutes: string | null;
  actual_distance_km: string | null;
  training_load_score: string | null;
  compliance_score: number | null;
  compliance_status: string;
  match_confidence: string;
  attention_required: boolean;
  attention_reason: string;
  activities: CalendarActivity[];
}

export interface TrainingCalendar {
  date_from: string;
  date_to: string;
  summary: {
    athletes_count: number;
    planned_count: number;
    completed_count: number;
    unplanned_count: number;
    attention_count: number;
    completion_rate: number;
    average_compliance: number | null;
    planned_duration_minutes: number;
    actual_duration_minutes: string;
    training_load_score: string;
  };
  events: CalendarEvent[];
}
