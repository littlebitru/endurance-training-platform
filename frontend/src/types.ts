export type Role = "coach" | "athlete";
export interface CoachSummary { id: number; username: string; first_name: string; last_name: string }
export interface User { id: number; username: string; email: string; first_name: string; last_name: string; role: Role; profile: { sport: string; bio: string; date_of_birth: string | null }; coach?: CoachSummary | null }
export interface Page<T> { count: number; next: string | null; previous: string | null; results: T[] }
export interface Exercise { id: number; workout: number; name: string; step_type: string; order: number; description: string; repetitions: number | null; duration_seconds: number | null; distance_meters: number | null; recovery_seconds: number | null; target_type: string; target_min: string | null; target_max: string | null; target_unit: string; resolved_target_min: string | null; resolved_target_max: string | null; resolved_target_unit: string; resolved_target_label: string }
export interface CoachComment { id: number; workout: number; coach: number; coach_name: string; body: string; created_at: string }
export interface Workout { id: number; weekly_plan: number; title: string; sport: string; workout_type: string; status: string; scheduled_at: string; planned_duration_minutes: number | null; planned_distance_km: string | null; intensity: string; notes: string; exercises: Exercise[]; coach_comments: CoachComment[]; log?: WorkoutLog | null }
export interface WorkoutLog { id: number; workout: number; completed_at: string; actual_duration_minutes: number | null; actual_distance_km: string | null; perceived_exertion: number | null; notes: string }
export interface WeeklyPlan { id: number; training_plan: number; week_number: number; start_date: string; phase: string; planned_duration_minutes: number | null; is_recovery: boolean; notes: string; workouts: Workout[] }
export type PlanPublicationStatus = "draft" | "published" | "archived";
export interface TrainingPlan { id: number; coach: number; title: string; description: string; primary_sport: string; target_event_name: string; target_event_type: string; target_distance_km: string | null; generation_method?: "manual" | "periodized"; experience_level?: "beginner" | "intermediate" | "advanced" | ""; athlete: number; start_date: string; end_date: string; is_active: boolean; publication_status: PlanPublicationStatus; published_at: string | null; created_at?: string; updated_at?: string; weeks: WeeklyPlan[] }
export interface Relationship { id: number; coach: User; athlete: User; is_active: boolean }
export interface TrainingGoalProfile { code: string; sport: string; label: string; distance_km: string | null; minimum_weeks: number; recommended_taper_weeks: number; recommended_weekly_minutes: Record<"beginner" | "intermediate" | "advanced", number> }
export interface WeeklyAnalytics { week_start: string; total_workouts: number; completed_workouts: number; completion_rate: number; planned_duration_minutes: string; actual_duration_minutes: string; planned_distance_km: string; actual_distance_km: string; session_load: string }
export interface Analytics { total_workouts: number; completed_workouts: number; skipped_workouts: number; completion_rate: number; planned_duration_minutes: string; actual_duration_minutes: string; planned_distance_km: string; actual_distance_km: string; average_perceived_exertion: number | null; weekly: WeeklyAnalytics[] }
export interface TrainingZone { id: number; athlete: number; sport: string; metric: string; zone_number: number; name: string; lower_bound: string; upper_bound: string; unit: string; display_range: string }
export interface AthleteThreshold { id: number; athlete: number; sport: string; effective_from: string; source: string; notes: string; is_current: boolean; threshold_heart_rate: number | null; maximum_heart_rate: number | null; functional_threshold_power: number | null; threshold_pace_seconds_per_km: number | null; critical_swim_speed_seconds_per_100m: number | null; heart_rate_basis: string; zones: TrainingZone[]; updated_at: string }
export interface WorkoutTemplate { id: number; coach: number; title: string; sport: string; workout_type: string; description: string; planned_duration_minutes: number | null; planned_distance_km: string | null; intensity: string; structured_steps: Array<Record<string, string | number | null>> }
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
