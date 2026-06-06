import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    hasKey: typeof process.env.OPENROUTER_API_KEY === 'string' && process.env.OPENROUTER_API_KEY.trim().length > 0,
  })
}
