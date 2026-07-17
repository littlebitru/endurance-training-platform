export type Role = "coach" | "athlete";
export interface User { id: number; username: string; email: string; first_name: string; last_name: string; role: Role; profile: { sport: string; bio: string; date_of_birth: string | null } }
export interface Page<T> { count: number; next: string | null; previous: string | null; results: T[] }
export interface Workout { id: number; title: string; sport: string; status: string; scheduled_at: string; planned_duration_minutes: number | null; planned_distance_km: string | null; intensity: string; exercises: unknown[]; log?: WorkoutLog }
export interface WorkoutLog { id: number; workout: number; completed_at: string; actual_duration_minutes: number | null; actual_distance_km: string | null; perceived_exertion: number | null; notes: string }
export interface WeeklyPlan { id: number; week_number: number; start_date: string; workouts: Workout[] }
export interface TrainingPlan { id: number; title: string; description: string; athlete: number; start_date: string; end_date: string; is_active: boolean; weeks: WeeklyPlan[] }
export interface Relationship { id: number; athlete: User; is_active: boolean }
export interface Analytics { total_workouts: number; completed_workouts: number; skipped_workouts: number; completion_rate: number; planned_duration_minutes: string; actual_duration_minutes: string; planned_distance_km: string; actual_distance_km: string; average_perceived_exertion: number | null }
