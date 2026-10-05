import { getSessionFromRequest } from './_lib/auth-utils.js'

export async function GET(request: Request) {
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
