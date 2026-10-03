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
    
    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      return Response.json({ error: 'MUSICALIA_STORE_ID no configurado' }, { status: 500 })
    }
    
    const blob = await head(pathname, { storeId })
    
    if (!blob) {
      return Response.json({ error: 'Archivo no encontrado' }, { status: 404 })
    }
    
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
    console.error('Download error:', error)
    let message = error.message || 'Error al descargar'
    
    if (message.includes('OIDC') || message.includes('credentials') || message.includes('authentication') || message.includes('No blob credentials')) {
      message = 'Activa "Store Scoped Access Tokens" en la configuración del proyecto en Vercel'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
