import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Mock response for development - replace with Firebase logic when configured
    console.log(`Incrementing water count for user: ${userId}`);

    return NextResponse.json({
      success: true,
      message: 'Contagem de água incrementada (modo desenvolvimento)',
      userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Water increment error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
