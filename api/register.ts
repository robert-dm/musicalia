import type { NextRequest } from 'next/server'
import { createUser, findUserByEmail, findUserByUsername, createJWT } from './auth-utils'

export async function POST(request: NextRequest) {
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
    const token = createJWT(user)

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
