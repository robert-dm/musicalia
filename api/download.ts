import { head } from '@vercel/blob'
import { getVercelOidcToken } from '@vercel/oidc'
import type { NextRequest } from 'next/server'
import { getSessionFromRequest } from './auth-utils'

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return Response.json({ error: 'No autenticado' }, { status: 401 })
    }
    
    const { searchParams } = new URL(request.url)
    const pathname = searchParams.get('path')
    
    if (!pathname) {
      return Response.json({ error: 'Path requerido' }, { status: 400 })
    }

    if (!pathname.startsWith(`musicalia-projects/${session.userId}/`)) {
      return Response.json({ error: 'Acceso denegado' }, { status: 403 })
    }
    
    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      return Response.json({ error: 'MUSICALIA_STORE_ID no configurado' }, { status: 500 })
    }
    
    const oidcToken = await getVercelOidcToken()
    if (!oidcToken) {
      return Response.json({ 
        error: 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC' 
      }, { status: 500 })
    }
    
    const blob = await head(pathname, { storeId, oidcToken })
    
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
      message = 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC'
    } else if (message.includes('does not exist') || message.includes('not found') || message.includes('NotFound')) {
      message = 'Archivo no encontrado'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
