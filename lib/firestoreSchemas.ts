import type { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  displayName: string;
  avatar?: string;
  hydrationGoal: number;
  waterCount: number;
  creatineGoal: number;
  creatineCount: number;
  dailyStudyGoal: number;
  dailyReadGoal: number;
  dailyMovieGoal: number;
  dailyStepGoal: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface UserGoals {
  water_ml: number;        // ml por dia (default: 4000)
  steps: number;           // passos por dia (default: 10000)
  reading_pages: number;   // páginas por dia (default: 10)
  gym_days_per_week: number; // dias de academia por semana (default: 5)
  study_minutes: number;   // minutos de estudo por dia (default: 120)
  updatedAt: Timestamp | null;
}

export interface DailyLog {
  water_ml: number;
  steps: number;
  reading_pages: number;
  gym_done: boolean;
  creatine_done: boolean;
  study_minutes: number;
  updatedAt: Timestamp | null;
}

export interface HealthLog {
  userId: string;
  type: string;
  value: number | string | null;
  unit: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: Timestamp | null;
}

export interface ManualLog {
  userId: string;
  category: 'reading' | 'study' | 'movie' | 'water';
  title: string;
  amount: number;
  unit: string;
  createdAt: Timestamp | null;
}
