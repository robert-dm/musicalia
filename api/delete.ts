import { del } from '@vercel/blob'
import type { NextRequest } from 'next/server'

function verifyAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-musicalia-key')
  const expectedKey = process.env.MUSICALIA_KEY
  
  if (!expectedKey) {
    throw new Error('MUSICALIA_KEY no configurada')
  }
  
  return key === expectedKey
}

export async function DELETE(request: NextRequest) {
  try {
    if (!verifyAuth(request)) {
      return Response.json({ error: 'Clave incorrecta' }, { status: 401 })
    }
    
    const { pathname } = await request.json()
    
    if (!pathname) {
      return Response.json({ error: 'Pathname requerido' }, { status: 400 })
    }
    
    // Use explicit token if available, otherwise SDK uses OIDC with MUSICALIA_STORE_ID
    const token = process.env.MUSICALIA_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN
    
    await del(pathname, token ? { token } : undefined)
    
    return Response.json({ success: true })
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
