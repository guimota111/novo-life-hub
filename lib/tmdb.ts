// Cliente mínimo do TMDB (themoviedb.org), usado só no servidor.
// O token fica no secret TMDB_TOKEN (API Read Access Token, v4).

const BASE = 'https://api.themoviedb.org/3';
const IMG  = 'https://image.tmdb.org/t/p';

// IDs de gênero do TMDB → nomes da lista GENRES da página de filmes.
// Família e Cinema TV não têm equivalente e são ignorados.
const GENRE_MAP: Record<number, string> = {
  28: 'Ação', 12: 'Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime',
  99: 'Documentário', 18: 'Drama', 14: 'Fantasia', 36: 'Histórico', 27: 'Terror',
  10402: 'Musical', 9648: 'Mistério', 10749: 'Romance', 878: 'Ficção Científica',
  53: 'Thriller', 10752: 'Guerra', 37: 'Western',
};

export interface TmdbSearchResult {
  id: number;
  title: string;
  originalTitle: string;
  year: string;
  posterUrl: string | null;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  director: string;
  genres: string[];
  durationMinutes: number | null;
  coverUrl: string | null;
}

async function tmdb<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = process.env.TMDB_TOKEN;
  if (!token) throw new Error('TMDB_TOKEN não configurado');
  const qs = new URLSearchParams({ language: 'pt-BR', ...params });
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json() as Promise<T>;
}

export async function searchMovies(query: string): Promise<TmdbSearchResult[]> {
  const data = await tmdb<{ results: {
    id: number; title: string; original_title: string; release_date?: string; poster_path: string | null;
  }[] }>('/search/movie', { query, include_adult: 'false' });

  return data.results.slice(0, 8).map(r => ({
    id: r.id,
    title: r.title,
    originalTitle: r.original_title,
    year: r.release_date?.slice(0, 4) ?? '',
    posterUrl: r.poster_path ? `${IMG}/w92${r.poster_path}` : null,
  }));
}

export async function getMovieDetails(id: number): Promise<TmdbMovieDetails> {
  const m = await tmdb<{
    id: number; title: string; runtime: number | null; poster_path: string | null;
    genres: { id: number }[]; credits: { crew: { job: string; name: string }[] };
  }>(`/movie/${id}`, { append_to_response: 'credits' });

  return {
    id: m.id,
    title: m.title,
    director: m.credits.crew.filter(c => c.job === 'Director').map(c => c.name).join(', '),
    genres: [...new Set(m.genres.map(g => GENRE_MAP[g.id]).filter(Boolean))],
    durationMinutes: m.runtime || null,
    coverUrl: m.poster_path ? `${IMG}/w500${m.poster_path}` : null,
  };
}
