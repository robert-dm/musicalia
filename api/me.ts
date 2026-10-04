import type { NextRequest } from 'next/server'
import { getSessionFromRequest } from '../lib/auth-utils'

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    
    if (!session) {
      return Response.json({ error: 'No autenticado' }, { status: 401 })
    }

    return Response.json({
      user: {
        id: session.userId,
        username: session.username,
        email: session.email
      }
    })
  } catch (error: any) {
    console.error('Me error:', error)
    return Response.json({ error: error.message || 'Error al obtener usuario' }, { status: 500 })
  }
}
