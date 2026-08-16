import type { EntityType, MealType } from '@/lib/types';

/** كيف حدّد المستخدم الأسبوع/الأسابيع في سؤاله. */
export type WeekSpec =
  | { mode: 'explicit'; weeks: number[] } // "الأسبوع الثالث" / "أسبوع ٢ و ٣"
  | { mode: 'current' } //                  "هذا الأسبوع"
  | { mode: 'next' } //                     "الأسبوع الجاي"
  | { mode: 'prev' } //                     "الأسبوع الماضي"
  | { mode: 'all' }; //                     كل الدورة (٤ أسابيع) — الافتراضي

export type Intent =
  /** متى يُقدَّم صنف معيّن؟ */
  | { kind: 'meal_schedule'; subject: string; entityType?: EntityType; mealType?: MealType }
  /** كم حصة من صنف خلال فترة؟ */
  | {
      kind: 'meal_consumption';
      subject: string;
      weeks: WeekSpec;
      days?: number[];
      entityType?: EntityType;
      mealType?: MealType;
    }
  /** مين ممنوع عليه صنف معيّن وما البديل؟ */
  | { kind: 'meal_exclusions'; subject: string }
  /** وش القائمة يوم كذا؟ */
  | {
      kind: 'menu_day';
      weeks: WeekSpec;
      days?: number[];
      date?: string;
      entityType?: EntityType;
      mealType?: MealType;
    }
  /** كم عدد المستفيدين/المرافقين؟ */
  | { kind: 'entity_count'; entityType?: EntityType; villa?: string; activeOnly: boolean | null }
  /** توزيع المستفيدين حسب بُعد معيّن. */
  | { kind: 'entity_breakdown'; by: 'villa' | 'diet' | 'category'; entityType?: EntityType }
  /** بطاقة مستفيد/مرافق. */
  | { kind: 'entity_profile'; subject: string }
  /** أكثر الأصناف استهلاكاً. */
  | {
      kind: 'top_meals';
      weeks: WeekSpec;
      limit: number;
      entityType?: EntityType;
      mealType?: MealType;
    }
  /** المستخدم كتب اسماً فقط — نحاول نعرف صنف ولا شخص. */
  | { kind: 'lookup'; subject: string; weeks: WeekSpec }
  /** ما فهمنا السؤال. */
  | { kind: 'help'; reason: 'empty' | 'unknown' };

export type IntentKind = Intent['kind'];

// ── كتل العرض ──────────────────────────────────────────────────────────────
// شكل موحّد تعرضه الواجهة بشكل عام بدون معرفة نوع السؤال.

export interface StatItem {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'primary' | 'success' | 'warn';
}

export type AnswerBlock =
  | { type: 'stats'; items: StatItem[] }
  | {
      type: 'table';
      caption?: string;
      columns: string[];
      rows: Array<Array<string | number>>;
      numericColumns?: number[];
    }
  | { type: 'list'; caption?: string; items: string[] }
  | { type: 'note'; tone: 'info' | 'warn'; text: string };

export interface Answer {
  ok: boolean;
  intent: IntentKind;
  title: string;
  /** جملة الجواب المختصرة — أول ما تقرأه العين. */
  summary: string;
  blocks: AnswerBlock[];
  /** من وين جاء الرقم — يظهر أسفل البطاقة لبناء الثقة. */
  source?: string;
  /** أسئلة مقترحة للمتابعة. */
  suggestions?: string[];
}
