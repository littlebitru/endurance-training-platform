export type Role = "coach" | "athlete";
export interface CoachSummary { id: number; username: string; first_name: string; last_name: string }
export interface User { id: number; username: string; email: string; first_name: string; last_name: string; role: Role; profile: { sport: string; bio: string; date_of_birth: string | null }; coach?: CoachSummary | null }
export interface Page<T> { count: number; next: string | null; previous: string | null; results: T[] }
export interface Exercise { id: number; workout: number; name: string; order: number; description: string; repetitions: number | null; duration_seconds: number | null; distance_meters: number | null; recovery_seconds: number | null; target_type: string; target_min: string | null; target_max: string | null; target_unit: string }
export interface CoachComment { id: number; workout: number; coach: number; coach_name: string; body: string; created_at: string }
export interface Workout { id: number; weekly_plan: number; title: string; sport: string; status: string; scheduled_at: string; planned_duration_minutes: number | null; planned_distance_km: string | null; intensity: string; notes: string; exercises: Exercise[]; coach_comments: CoachComment[]; log?: WorkoutLog | null }
export interface WorkoutLog { id: number; workout: number; completed_at: string; actual_duration_minutes: number | null; actual_distance_km: string | null; perceived_exertion: number | null; notes: string }
export interface WeeklyPlan { id: number; training_plan: number; week_number: number; start_date: string; notes: string; workouts: Workout[] }
export interface TrainingPlan { id: number; coach: number; title: string; description: string; athlete: number; start_date: string; end_date: string; is_active: boolean; weeks: WeeklyPlan[] }
export interface Relationship { id: number; coach: User; athlete: User; is_active: boolean }
export interface Analytics { total_workouts: number; completed_workouts: number; skipped_workouts: number; completion_rate: number; planned_duration_minutes: string; actual_duration_minutes: string; planned_distance_km: string; actual_distance_km: string; average_perceived_exertion: number | null }
