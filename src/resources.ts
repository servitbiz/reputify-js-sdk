import type { Query, Reputify } from './client.js';
import type { Page } from './page.js';
import type {
  Embed, Invitation, InviteResult, Project, ProjectProfile, Recording, Review, ReviewQuery, Survey, SurveyAttributes,
} from './types.js';

type Id = number | string;
type Json = Record<string, unknown>;

const id = (v: Id) => encodeURIComponent(String(v));
const project = (p: Id) => `v1/projects/${id(p)}`;

abstract class Resource {
  constructor(protected readonly client: Reputify) {}
}

/** Recht: `projects:read`. */
export class Projects extends Resource {
  list(query: { q?: string; page?: number; per_page?: number } = {}): Promise<Page<Project>> {
    return this.client.page<Project>('v1/projects', query);
  }

  get(projectId: Id): Promise<Project> {
    return this.client.request<Project>('GET', project(projectId));
  }

  /** Score, Schnitt, Anzahl — dieselben Zahlen wie Siegel und Profil. `group` rechnet je Bewertungsgruppe. */
  profile(projectId: Id, group?: number): Promise<ProjectProfile> {
    return this.client.request<ProjectProfile>('GET', `${project(projectId)}/reputify-profile`, { group });
  }

  /** Score-Verlauf (ab Pro). */
  scoreHistory(projectId: Id, range: { from?: string | Date; to?: string | Date } = {}): Promise<Json> {
    return this.client.request('GET', `${project(projectId)}/score`, range);
  }
}

/**
 * Rechte: `reviews:read`, zum Antworten `reviews:reply`. Anlegen oder
 * loeschen gibt es nicht — und kein Recht kann eine Bewertung verbergen.
 */
export class Reviews extends Resource {
  list(projectId: Id, query: ReviewQuery = {}): Promise<Page<Review>> {
    return this.client.page<Review>(`${project(projectId)}/reviews`, query as Query);
  }

  get(projectId: Id, reviewId: Id): Promise<Review> {
    return this.client.request<Review>('GET', `${project(projectId)}/reviews/${id(reviewId)}`);
  }

  /** Bei Plattform-Bewertungen nur fuer ein verbundenes Google-Profil — sonst `ConflictError` (`reply_on_platform`). */
  reply(projectId: Id, reviewId: Id, text: string): Promise<Review> {
    return this.client.request<Review>('PUT', `${project(projectId)}/reviews/${id(reviewId)}/reply`, {}, { text });
  }

  deleteReply(projectId: Id, reviewId: Id): Promise<Review> {
    return this.client.request<Review>('DELETE', `${project(projectId)}/reviews/${id(reviewId)}/reply`);
  }
}

/**
 * Rechte: `surveys:read`, `surveys:write`. Ueber die API angelegte
 * Umfragen beginnen als Entwurf und nehmen Einladungen aus fremden
 * Systemen an.
 */
export class Surveys extends Resource {
  list(projectId: Id, query: { active?: boolean; page?: number; per_page?: number } = {}): Promise<Page<Survey>> {
    return this.client.page<Survey>(`${project(projectId)}/surveys`, query);
  }

  get(projectId: Id, surveyId: Id): Promise<Survey> {
    return this.client.request<Survey>('GET', `${project(projectId)}/surveys/${id(surveyId)}`);
  }

  create(projectId: Id, attributes: SurveyAttributes & { name: string }): Promise<Survey> {
    return this.client.request<Survey>('POST', `${project(projectId)}/surveys`, {}, attributes);
  }

  update(projectId: Id, surveyId: Id, attributes: SurveyAttributes): Promise<Survey> {
    return this.client.request<Survey>('PATCH', `${project(projectId)}/surveys/${id(surveyId)}`, {}, attributes);
  }

  /** Trichter: eingeladen, geoeffnet, bewertet … */
  insights(projectId: Id, surveyId: Id, range: { from?: string | Date; to?: string | Date } = {}): Promise<Json> {
    return this.client.request('GET', `${project(projectId)}/surveys/${id(surveyId)}/insights`, range);
  }

  recipients(projectId: Id, surveyId: Id, query: { status?: string; order_ref?: string; page?: number } = {}): Promise<Page<Json>> {
    return this.client.page(`${project(projectId)}/surveys/${id(surveyId)}/recipients`, query);
  }
}

/** Einladen — mit einer Umfrage-Marke (`rpf_inv_…`) oder `invites:write`. Tarifunabhaengig. */
export class Invites extends Resource {
  /** Dieselbe `order_ref` zweimal ergibt `status: 'already_invited'`, keine zweite Einladung. */
  create(invitation: Invitation): Promise<InviteResult> {
    return this.client.request<InviteResult>('POST', 'v1/invite', {}, invitation);
  }
}

/** Recht: `analysis:read`. */
export class Analysis extends Resource {
  sentiment(projectId: Id): Promise<Json> {
    return this.client.request('GET', `${project(projectId)}/analysis/sentiment`);
  }

  findings(projectId: Id, locale?: string): Promise<Json> {
    return this.client.request('GET', `${project(projectId)}/analysis/findings`, { locale });
  }

  summary(projectId: Id): Promise<{ text: string | null; generated_at: string | null }> {
    return this.client.request('GET', `${project(projectId)}/analysis/summary`);
  }

  figures(projectId: Id): Promise<Json> {
    return this.client.request('GET', `${project(projectId)}/analysis/figures`);
  }
}

export const RENDER_BASE = 'https://cdn.reputify.io/w/v1';

/**
 * Einbettungen. Rechte: `widgets:read`, `embeds:write`. Eine Einbettung hat
 * einen eigenen, oeffentlichen Schluessel (`pk_…`) — der gehoert in die
 * Website, nie die Zugangsmarke.
 */
export class Embeds extends Resource {
  catalog(query: { area?: string; locale?: string } = {}): Promise<{ data: Json[]; meta?: Json }> {
    return this.client.request('GET', 'v1/widgets', query);
  }

  list(projectId: Id): Promise<{ data: Embed[]; meta?: Json }> {
    return this.client.request('GET', `${project(projectId)}/embeds`);
  }

  create(projectId: Id, attributes: { variant: string; name?: string; locale?: string; allowed_domains?: string[]; review_group_id?: number; config?: Json }): Promise<Embed> {
    return this.client.request<Embed>('POST', `${project(projectId)}/embeds`, {}, attributes);
  }

  update(projectId: Id, embedId: Id, attributes: { name?: string; locale?: string; active?: boolean; allowed_domains?: string[]; review_group_id?: number | null; config?: Json }): Promise<Embed> {
    return this.client.request<Embed>('PATCH', `${project(projectId)}/embeds/${id(embedId)}`, {}, attributes);
  }

  /** Adresse eines gerenderten Bausteins — ohne Aufruf, ohne Marke. Darf in den Browser. */
  static renderUrl(
    publicKey: string,
    variant: string,
    ext: 'svg' | 'png' | 'html' | 'json' = 'svg',
    query: { locale?: string; theme?: string; loc?: string | number; product?: string; reviews?: number; platforms?: string } = {},
  ): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
    const qs = params.toString();
    return `${RENDER_BASE}/${encodeURIComponent(publicKey)}/${encodeURIComponent(variant)}.${ext}${qs ? `?${qs}` : ''}`;
  }
}

/** Video- und Tonbewertungen. Rechte: `recordings:read`, `recordings:write`. */
export class Recordings extends Resource {
  list(projectId: Id, query: { status?: string; featured?: boolean; kind?: 'video' | 'audio'; per_page?: number; page?: number } = {}): Promise<Page<Recording>> {
    return this.client.page<Recording>(`${project(projectId)}/recordings`, query);
  }

  get(projectId: Id, recordingId: Id): Promise<Recording> {
    return this.client.request<Recording>('GET', `${project(projectId)}/recordings/${id(recordingId)}`);
  }

  feature(projectId: Id, recordingId: Id, featured = true): Promise<Recording> {
    return this.client.request<Recording>('PATCH', `${project(projectId)}/recordings/${id(recordingId)}`, {}, { is_featured: featured });
  }

  exports(projectId: Id, recordingId: Id): Promise<Json> {
    return this.client.request('GET', `${project(projectId)}/recordings/${id(recordingId)}/exports`);
  }

  /** Social-Export (ab Agency Light). */
  createExport(projectId: Id, recordingId: Id, options: { format: string; has_subtitles?: boolean; has_logo_watermark?: boolean; clip_start_seconds?: number; clip_end_seconds?: number }): Promise<{ export_id: number; status: string; estimated_processing_seconds: number }> {
    return this.client.request('POST', `${project(projectId)}/recordings/${id(recordingId)}/exports`, {}, options);
  }

  prompts(projectId: Id, query: { language?: string; survey?: Id } = {}): Promise<Json> {
    return this.client.request('GET', `${project(projectId)}/recording-prompts`, query as Query);
  }
}

/** Recht: `awards:read`. */
export class Awards extends Resource {
  list(projectId: Id, validOnly = false): Promise<{ data: Json[]; meta?: Json }> {
    return this.client.request('GET', `${project(projectId)}/awards`, { valid: validOnly || undefined });
  }
}

/** Interne Rueckmeldungen (keine Bewertungen). Recht: `feedback:read`. */
export class Feedback extends Resource {
  list(projectId: Id, query: { survey?: number; with_message?: boolean; handled?: boolean; page?: number } = {}): Promise<Page<Json>> {
    return this.client.page(`${project(projectId)}/feedback`, query);
  }
}

export class Catalog extends Resource {
  platformTypes(): Promise<{ data: Json[] }> {
    return this.client.request('GET', 'v1/platform-types');
  }

  industries(locale?: string): Promise<{ data: Json[] }> {
    return this.client.request('GET', 'v1/industries', { locale });
  }
}

/**
 * Fuer Website-Anbindungen (Marke aus dem Verbinden-Dialog, an **ein**
 * Projekt gebunden). Kein Projekt in der Adresse — die Marke kennt es.
 */
export class Site extends Resource {
  get(): Promise<Json> {
    return this.client.request('GET', 'v1/site');
  }

  surveys(): Promise<{ data: Json[] }> {
    return this.client.request('GET', 'v1/site/surveys');
  }

  /** Was aus den Einladungen dieser Bestellungen wurde (hoechstens 100). */
  invites(orderRefs: string[]): Promise<{ data: Json[]; stats: Json }> {
    return this.client.request('GET', 'v1/site/invites', { order_refs: orderRefs });
  }

  setIndustry(industry: string): Promise<Json> {
    return this.client.request('PUT', 'v1/site/industry', {}, { industry });
  }

  /** Einmal-Link ins Dashboard, angemeldet. */
  loginLink(options: { target?: string; platform?: string; return?: string } = {}): Promise<{ url: string; expires_in: number }> {
    return this.client.request('POST', 'v1/site/login-link', {}, options);
  }
}
