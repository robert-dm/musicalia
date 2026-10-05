import { createUser, findUserByEmail, findUserByUsername, createJWT } from './_lib/auth-utils'

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  try {
    const body = await request.json()
    const { username, email, password } = body

    if (!username || !email || !password) {
      return Response.json({ error: 'Usuario, email y contraseña son requeridos' }, { status: 400 })
    }

    if (username.length < 3) {
      return Response.json({ error: 'El usuario debe tener al menos 3 caracteres' }, { status: 400 })
    }

    if (password.length < 6) {
      return Response.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return Response.json({ error: 'Email inválido' }, { status: 400 })
    }

    const existingEmail = await findUserByEmail(email)
    if (existingEmail) {
      return Response.json({ error: 'Email ya registrado' }, { status: 409 })
    }

    const existingUsername = await findUserByUsername(username)
    if (existingUsername) {
      return Response.json({ error: 'Usuario ya existe' }, { status: 409 })
    }

    const user = await createUser(username, email, password)
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
    console.error('Register error:', error)
    return Response.json({ error: error.message || 'Error al crear usuario' }, { status: 500 })
  }
}
