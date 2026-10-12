/**
 * Die Formen der wichtigsten Antworten. Bewusst offen (`[key: string]:
 * unknown`): die API fuegt Felder hinzu, ohne die Version zu wechseln.
 */

export interface Score {
  value: number | null;
  band: 'excellent' | 'good' | 'fair' | 'weak' | 'poor' | string | null;
  calculated_at: string | null;
  scope: 'project' | 'group' | string;
}

export interface Rating {
  average: number | null;
  count: number;
  distribution: Array<{ stars: number; count: number; percent: number }>;
}

export interface Project {
  id: number;
  name: string;
  slug: string;
  website: string | null;
  logo: string | null;
  timezone: string | null;
  created_at: string;
  description?: string | null;
  profile?: { visibility: string; url: string | null };
  score?: Score;
  rating?: Rating;
  platforms?: Array<{ id: number; name: string; type: string; key: string; identifier_count: number; status: string }>;
  locations?: Array<{ id: number; name: string }>;
  [key: string]: unknown;
}

export interface ProjectProfile {
  project: Project;
  profile_url: string | null;
  group_id: number | null;
  score: Score;
  rating: Rating;
  [key: string]: unknown;
}

export interface Review {
  id: number;
  /** Behaelt die Nachkommastelle: `4.0`, nicht `4`. */
  rating: number;
  text: string | null;
  reviewer_name: string | null;
  date: string;
  source: 'survey' | 'platform' | string;
  verification: string | null;
  type: 'text' | 'video' | 'audio' | string;
  platform: { id: number; name: string; key?: string } | null;
  group: { id: number; name: string } | null;
  product_items?: Array<string | { ref: string; name?: string; url?: string }>;
  reply: { text: string; [key: string]: unknown } | null;
  likes?: number;
  analysis?: {
    sentiment: 'positive' | 'neutral' | 'negative' | string | null;
    /** Sicherheit der Einordnung (0…1), nicht die Richtung. */
    sentiment_score: number | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface ReviewQuery {
  platform?: number;
  platform_key?: string;
  group?: number;
  product?: string;
  min_rating?: number;
  max_rating?: number;
  date_from?: string | Date;
  date_to?: string | Date;
  has_text?: boolean;
  has_reply?: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative';
  sort?: string;
  page?: number;
  per_page?: number;
}

export interface Survey {
  id: number;
  name: string;
  status: 'draft' | 'active' | 'paused' | string;
  active: boolean;
  public_key: string;
  access: string[];
  modes: string[];
  location: { id: number; name: string } | null;
  hands_over: boolean;
  created_at: string;
  [key: string]: unknown;
}

export interface SurveyAttributes {
  name?: string;
  description?: string;
  delay_hours?: number;
  allow_text?: boolean;
  allow_audio?: boolean;
  allow_video?: boolean;
  star_threshold_action?: string;
  review_group_id?: number | null;
}

export interface Invitation {
  name: string;
  email: string;
  phone?: string;
  /** Dieselbe Nummer zweimal ergibt keine zweite Einladung. */
  order_ref?: string;
  /** Artikelnummer oder `{ ref, name, url }` — fuer den Produktfilter der Widgets. */
  product_items?: Array<string | { ref: string; name?: string; url?: string }>;
  delay_hours?: number;
  /** Nur bei Website-Anbindungen; eine Umfrage-Marke kennt ihre Umfrage. */
  survey?: string;
}

export interface InviteResult {
  status: 'invited' | 'already_invited' | string;
  recipient_id?: number;
  scheduled_at?: string;
  link?: string;
}

export interface Embed {
  id: number;
  name: string;
  variant: string;
  type: string;
  locale: string;
  active: boolean;
  public_key: string;
  url: string;
  allowed_domains: string[];
  [key: string]: unknown;
}

export interface Recording {
  id: number;
  kind?: 'video' | 'audio';
  [key: string]: unknown;
}
