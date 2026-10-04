import { getVercelOidcToken } from '@vercel/oidc'
import { list, put, head } from '@vercel/blob'

export interface User {
  id: string
  username: string
  email: string
  passwordHash: string
  salt: string
  createdAt: string
}

export interface Session {
  userId: string
  username: string
  email: string
  exp: number
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(salt + password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const passwordHash = await hashPassword(password, salt)
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
  const salt = crypto.randomUUID()
  const user: User = {
    id: userId,
    username,
    email,
    passwordHash: await hashPassword(password, salt),
    salt,
    createdAt: new Date().toISOString()
  }

  const userBlob = new Blob([JSON.stringify(user)], { type: 'application/json' })
  const pathname = `musicalia-users/${userId}.json`
  
  await put(pathname, userBlob, {
    access: 'private',
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
      const blobMeta = await head(blob.pathname, { storeId, token: oidcToken })
      const response = await fetch(blobMeta.downloadUrl)
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
      const blobMeta = await head(blob.pathname, { storeId, token: oidcToken })
      const response = await fetch(blobMeta.downloadUrl)
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

async function hmacSHA256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(message)
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData)
  const signatureArray = Array.from(new Uint8Array(signature))
  return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function createJWT(user: User): Promise<string> {
  const signingKey = process.env.MUSICALIA_KEY
  if (!signingKey) {
    throw new Error('MUSICALIA_KEY no configurada')
  }

  const header = { alg: 'HS256', typ: 'JWT' }
  const payload: Session = {
    userId: user.id,
    username: user.username,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
  }

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url')
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const message = `${base64Header}.${base64Payload}`
  const signature = await hmacSHA256(signingKey, message)

  return `${message}.${signature}`
}

export async function verifyJWT(token: string): Promise<Session | null> {
  try {
    const signingKey = process.env.MUSICALIA_KEY
    if (!signingKey) {
      return null
    }

    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureHex] = parts
    const message = `${headerB64}.${payloadB64}`
    const expectedSignature = await hmacSHA256(signingKey, message)
    
    if (signatureHex !== expectedSignature) return null

    const payload: Session = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    
    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    return payload
  } catch (e) {
    return null
  }
}

export async function getSessionFromRequest(request: Request): Promise<Session | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  return await verifyJWT(token)
}
