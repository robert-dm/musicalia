import { findUserByEmail, verifyPassword, createJWT } from './_lib/auth-utils.js'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email: string, password: string }
    const { email, password } = body

    if (!email || !password) {
      return Response.json({ error: 'Email y contraseña son requeridos' }, { status: 400 })
    }

    const user = await findUserByEmail(email)
    if (!user) {
      return Response.json({ error: 'Email o contraseña incorrectos' }, { status: 401 })
    }

    const isValid = await verifyPassword(password, user.passwordHash, user.salt)
    if (!isValid) {
      return Response.json({ error: 'Email o contraseña incorrectos' }, { status: 401 })
    }

    const token = await createJWT(user)

    return Response.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    })
  } catch (error: any) {
    console.error('Login error:', error)
    return Response.json({ error: error.message || 'Error al iniciar sesión' }, { status: 500 })
  }
}
