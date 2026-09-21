import { NextRequest, NextResponse } from 'next/server';
import { searchBooks, getBookDetails } from '@/lib/googleBooks';

// GET /api/books/search?q=<nome>  → edições sugeridas pelo Google Books
// GET /api/books/search?id=<id>   → detalhes (autor, gêneros, páginas, capa)
export async function GET(request: NextRequest) {
  const q  = request.nextUrl.searchParams.get('q')?.trim();
  const id = request.nextUrl.searchParams.get('id')?.trim();

  try {
    if (id) return NextResponse.json(await getBookDetails(id));
    if (q && q.length >= 2) return NextResponse.json({ results: await searchBooks(q) });
    return NextResponse.json({ error: 'Envie q (mín. 2 letras) ou id' }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Falha ao consultar o Google Books' }, { status: 502 });
  }
}
