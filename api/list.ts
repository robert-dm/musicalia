import { list } from '@vercel/blob'
import type { NextRequest } from 'next/server'

function verifyAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-musicalia-key')
  const expectedKey = process.env.MUSICALIA_KEY
  
  if (!expectedKey) {
    throw new Error('MUSICALIA_KEY no configurada')
  }
  
  return key === expectedKey
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyAuth(request)) {
      return Response.json({ error: 'Clave incorrecta' }, { status: 401 })
    }
    
    // Use explicit token if available, otherwise SDK uses OIDC with MUSICALIA_STORE_ID
    const token = process.env.MUSICALIA_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN
    
    const { blobs } = await list({ 
      prefix: 'musicalia/',
      ...(token && { token })
    })
    
    const projects = blobs.map(blob => ({
      name: blob.pathname.replace('musicalia/', '').replace('.musicalia', ''),
      pathname: blob.pathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt
    }))
    
    return Response.json(projects)
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
