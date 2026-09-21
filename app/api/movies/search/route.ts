import { NextRequest, NextResponse } from 'next/server';
import { searchMovies, getMovieDetails } from '@/lib/tmdb';

// GET /api/movies/search?q=<nome>  → lista de sugestões do TMDB
// GET /api/movies/search?id=<id>   → detalhes (diretor, gêneros, duração, capa)
export async function GET(request: NextRequest) {
  const q  = request.nextUrl.searchParams.get('q')?.trim();
  const id = Number(request.nextUrl.searchParams.get('id'));

  try {
    if (id) return NextResponse.json(await getMovieDetails(id));
    if (q && q.length >= 2) return NextResponse.json({ results: await searchMovies(q) });
    return NextResponse.json({ error: 'Envie q (mín. 2 letras) ou id' }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Falha ao consultar o TMDB' }, { status: 502 });
  }
}
