import { put, list, del } from '@vercel/blob'
import type { NextRequest } from 'next/server'

function verifyAuth(request: NextRequest): boolean {
  const key = request.headers.get('x-musicalia-key')
  const expectedKey = process.env.MUSICALIA_KEY
  
  if (!expectedKey) {
    throw new Error('MUSICALIA_KEY no configurada')
  }
  
  return key === expectedKey
}

export async function POST(request: NextRequest) {
  try {
    if (!verifyAuth(request)) {
      return Response.json({ error: 'Clave incorrecta' }, { status: 401 })
    }
    
    const projectName = request.headers.get('x-project-name')
    if (!projectName) {
      return Response.json({ error: 'Nombre de proyecto requerido' }, { status: 400 })
    }
    
    const blob = await request.blob()
    const pathname = `musicalia/${decodeURIComponent(projectName)}.musicalia`
    
    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      return Response.json({ error: 'MUSICALIA_STORE_ID no configurado en variables de entorno' }, { status: 500 })
    }
    
    const oidcToken = process.env.VERCEL_OIDC_TOKEN
    if (!oidcToken) {
      return Response.json({ error: 'VERCEL_OIDC_TOKEN no disponible' }, { status: 500 })
    }
    
    const result = await put(pathname, blob, {
      access: 'public',
      addRandomSuffix: false,
      storeId,
      oidcToken
    })
    
    return Response.json({ url: result.url })
  } catch (error: any) {
    console.error('Upload error:', error)
    const message = error.message || 'Error desconocido'
    return Response.json({ error: message }, { status: 500 })
  }
}
