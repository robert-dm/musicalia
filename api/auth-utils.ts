import { getVercelOidcToken } from '@vercel/oidc'
import { list, put, head } from '@vercel/blob'

export interface User {
  id: string
  username: string
  email: string
  passwordHash: string
  createdAt: string
}

export interface Session {
  userId: string
  username: string
  email: string
  exp: number
}

const JWT_SECRET = process.env.JWT_SECRET || 'musicalia-jwt-secret-change-in-production'

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password)
  return passwordHash === hash
}

export async function createUser(username: string, email: string, password: string): Promise<User> {
  const storeId = process.env.MUSICALIA_STORE_ID
  if (!storeId) {
    throw new Error('MUSICALIA_STORE_ID no configurado')
  }

  const oidcToken = await getVercelOidcToken()
  if (!oidcToken) {
    throw new Error('OIDC token no disponible')
  }

  const userId = crypto.randomUUID()
  const user: User = {
    id: userId,
    username,
    email,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString()
  }

  const userBlob = new Blob([JSON.stringify(user)], { type: 'application/json' })
  const pathname = `musicalia-users/${userId}.json`
  
  await put(pathname, userBlob, {
    access: 'public',
    storeId,
    token: oidcToken
  })

  return user
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const storeId = process.env.MUSICALIA_STORE_ID
  if (!storeId) {
    throw new Error('MUSICALIA_STORE_ID no configurado')
  }

  const oidcToken = await getVercelOidcToken()
  if (!oidcToken) {
    throw new Error('OIDC token no disponible')
  }

  const { blobs } = await list({
    prefix: 'musicalia-users/',
    storeId,
    token: oidcToken
  })

  for (const blob of blobs) {
    try {
      const response = await fetch(blob.url)
      const user: User = await response.json()
      if (user.email === email) {
        return user
      }
    } catch (e) {
      console.error('Error reading user blob:', e)
    }
  }

  return null
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const storeId = process.env.MUSICALIA_STORE_ID
  if (!storeId) {
    throw new Error('MUSICALIA_STORE_ID no configurado')
  }

  const oidcToken = await getVercelOidcToken()
  if (!oidcToken) {
    throw new Error('OIDC token no disponible')
  }

  const { blobs } = await list({
    prefix: 'musicalia-users/',
    storeId,
    token: oidcToken
  })

  for (const blob of blobs) {
    try {
      const response = await fetch(blob.url)
      const user: User = await response.json()
      if (user.username === username) {
        return user
      }
    } catch (e) {
      console.error('Error reading user blob:', e)
    }
  }

  return null
}

export function createJWT(user: User): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload: Session = {
    userId: user.id,
    username: user.username,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
  }

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url')
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = Buffer.from(JWT_SECRET + base64Header + '.' + base64Payload).toString('base64url')

  return `${base64Header}.${base64Payload}.${signature}`
}

export function verifyJWT(token: string): Session | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts
    const expectedSignature = Buffer.from(JWT_SECRET + headerB64 + '.' + payloadB64).toString('base64url')
    
    if (signatureB64 !== expectedSignature) return null

    const payload: Session = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    
    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    return payload
  } catch (e) {
    return null
  }
}

export function getSessionFromRequest(request: Request): Session | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  return verifyJWT(token)
}
