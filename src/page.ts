export interface PageMeta {
  page?: number;
  current_page?: number;
  per_page?: number;
  total?: number;
  pages?: number;
  [key: string]: unknown;
}

export interface PageLinks {
  next?: string | null;
  prev?: string | null;
}

export interface ListBody<T> {
  data: T[];
  meta?: PageMeta;
  links?: PageLinks;
}

/**
 * Eine Seite einer Liste. `for await (const x of page)` laeuft ueber
 * **alle** Seiten und holt die folgenden nach, solange es `links.next`
 * gibt (Aufnahmen tragen keine `links`: dort bis `total`).
 */
export class Page<T> implements AsyncIterable<T> {
  readonly data: T[];
  readonly meta: PageMeta;
  readonly links: PageLinks;

  constructor(body: ListBody<T>, private readonly fetchPage?: (page: number) => Promise<Page<T>>) {
    this.data = Array.isArray(body.data) ? body.data : [];
    this.meta = body.meta ?? {};
    this.links = body.links ?? {};
  }

  get currentPage(): number {
    return Number(this.meta.page ?? this.meta.current_page ?? 1);
  }

  get total(): number | undefined {
    return this.meta.total;
  }

  hasMore(): boolean {
    if (!this.fetchPage || this.data.length === 0) return false;
    if ('next' in this.links) return Boolean(this.links.next);
    const perPage = Number(this.meta.per_page ?? 0);
    return perPage > 0 && this.meta.total !== undefined && this.currentPage * perPage < this.meta.total;
  }

  async next(): Promise<Page<T> | null> {
    return this.hasMore() && this.fetchPage ? this.fetchPage(this.currentPage + 1) : null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page: Page<T> | null = this;
    while (page) {
      yield* page.data;
      page = await page.next();
    }
  }

  /** Alle Eintraege ueber alle Seiten — Vorsicht bei grossen Listen. */
  async all(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) out.push(item);
    return out;
  }
}
