import { head } from '@vercel/blob'
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
    
    const { searchParams } = new URL(request.url)
    const pathname = searchParams.get('path')
    
    if (!pathname) {
      return Response.json({ error: 'Path requerido' }, { status: 400 })
    }
    
    // Use explicit token if available, otherwise SDK uses OIDC with MUSICALIA_STORE_ID
    const token = process.env.MUSICALIA_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN
    
    const blob = await head(pathname, token ? { token } : undefined)
    
    if (!blob) {
      return Response.json({ error: 'Archivo no encontrado' }, { status: 404 })
    }
    
    // Fetch the actual blob content
    const response = await fetch(blob.url)
    
    if (!response.ok) {
      return Response.json({ error: 'Error al descargar archivo' }, { status: 500 })
    }
    
    return new Response(response.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': blob.size.toString()
      }
    })
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
