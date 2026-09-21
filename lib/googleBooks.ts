// Cliente mínimo do Google Books, usado só no servidor.
// A chave fica no secret GOOGLE_BOOKS_KEY.

const BASE = 'https://www.googleapis.com/books/v1/volumes';

// Categorias do Google (BISAC, em inglês, ex.: "Fiction / Fantasy / Epic") →
// nomes da lista BOOK_GENRES da página de leitura. A ordem importa:
// "science fiction" precisa ser testado antes de "science".
const GENRE_RULES: [RegExp, string][] = [
  [/science fiction/, 'Ficção Científica'],
  [/fantasy/, 'Fantasia'],
  [/horror/, 'Terror'],
  [/mystery|detective/, 'Mistério'],
  [/thriller|suspense/, 'Thriller'],
  [/romance/, 'Romance'],
  [/action & adventure/, 'Aventura'],
  [/historical|^history/, 'Histórico'],
  [/biography|autobiography/, 'Biografia'],
  [/self-help/, 'Autoajuda'],
  [/business|economics/, 'Negócios'],
  [/^(science|nature|mathematics|medical|technology)/, 'Ciência'],
  [/philosophy/, 'Filosofia'],
  [/poetry/, 'Poesia'],
  [/short stories/, 'Conto'],
  [/classics/, 'Clássico'],
  [/^juvenile/, 'Infantil'],
  [/manga/, 'Mangá'],
  [/comics|graphic novels/, 'HQ'],
  [/^fiction/, 'Ficção'],
];

export function mapCategories(categories: string[] = []): string[] {
  const out = new Set<string>();
  for (const raw of categories) {
    const c = raw.toLowerCase();
    for (const [re, genre] of GENRE_RULES) if (re.test(c)) out.add(genre);
  }
  return [...out];
}

interface VolumeInfo {
  title: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  pageCount?: number;
  categories?: string[];
  imageLinks?: Record<string, string>;
}

function coverOf(links: Record<string, string> | undefined, sizes: string[]): string | null {
  const url = sizes.map(s => links?.[s]).find(Boolean);
  return url ? url.replace(/^http:/, 'https:').replace('&edge=curl', '') : null;
}

export interface BookSearchResult {
  id: string;
  title: string;
  authors: string;
  publisher: string;
  year: string;
  pageCount: number | null;
  thumbUrl: string | null;
}

export interface BookDetails {
  title: string;
  author: string;
  genres: string[];
  totalPages: number | null;
  coverUrl: string | null;
}

async function gbooks<T>(url: string): Promise<T> {
  const key = process.env.GOOGLE_BOOKS_KEY;
  if (!key) throw new Error('GOOGLE_BOOKS_KEY não configurada');
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${key}`, { next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`Google Books ${res.status}`);
  return res.json() as Promise<T>;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// A busca livre acha títulos digitados sem acento mas erra em nomes curtos
// ("duna" traz dicionários); a busca "intitle:" é o contrário. Faz as duas e
// põe primeiro os títulos que começam (ou contêm) o texto digitado.
export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  type Item = { id: string; volumeInfo: VolumeInfo };
  const run = (q: string) => {
    const qs = new URLSearchParams({ q, maxResults: '10', printType: 'books', langRestrict: 'pt' });
    return gbooks<{ items?: Item[] }>(`${BASE}?${qs}`).then(d => d.items ?? []);
  };
  const [free, byTitle] = await Promise.all([run(query), run(`intitle:${query}`)]);

  const seen = new Set<string>();
  const merged = [...free, ...byTitle].filter(i => !seen.has(i.id) && seen.add(i.id));
  const q = norm(query);
  const rank = (i: Item) => {
    const t = norm(i.volumeInfo.title);
    return t.startsWith(q) ? 0 : t.includes(q) ? 1 : 2;
  };
  merged.sort((a, b) => rank(a) - rank(b));

  return merged.slice(0, 10).map(({ id, volumeInfo: v }) => ({
    id,
    title: v.subtitle ? `${v.title}: ${v.subtitle}` : v.title,
    authors: (v.authors ?? []).join(', '),
    publisher: v.publisher ?? '',
    year: v.publishedDate?.slice(0, 4) ?? '',
    pageCount: v.pageCount || null,
    thumbUrl: coverOf(v.imageLinks, ['smallThumbnail', 'thumbnail']),
  }));
}

// O endpoint de detalhe traz categorias mais específicas e capas maiores que a busca.
export async function getBookDetails(id: string): Promise<BookDetails> {
  const { volumeInfo: v } = await gbooks<{ volumeInfo: VolumeInfo }>(`${BASE}/${encodeURIComponent(id)}`);
  return {
    title: v.title,
    author: (v.authors ?? []).join(', '),
    genres: mapCategories(v.categories),
    totalPages: v.pageCount || null,
    coverUrl: coverOf(v.imageLinks, ['medium', 'small', 'thumbnail', 'smallThumbnail']),
  };
}
