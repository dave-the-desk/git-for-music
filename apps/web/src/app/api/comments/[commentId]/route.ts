import { NextResponse } from 'next/server';

export async function PATCH() {
  return NextResponse.json({ error: 'Comment updates now flow through DAW operations' }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json({ error: 'Comment deletes now flow through DAW operations' }, { status: 405 });
}
