import { list } from '@vercel/blob'
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
    const prefix = searchParams.get('prefix')
    
    if (!prefix) {
      return Response.json({ error: 'Prefix requerido' }, { status: 400 })
    }

    if (!prefix.startsWith(`musicalia-projects/${session.userId}/`)) {
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
    
    // Call list() with the prefix and return the blobs array
    // Example blob shape from list() result:
    // {
    //   pathname: "musicalia/MyProject/project.json",
    //   url: "https://...",
    //   size: 1234,
    //   uploadedAt: Date
    // }
    const { blobs } = await list({ 
      prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
      storeId,
      oidcToken
    })
    
    return Response.json(blobs)
  } catch (error: any) {
    console.error('List project blobs error:', error)
    let message = error.message || 'Error al listar archivos'
    
    if (message.includes('OIDC') || message.includes('credentials') || message.includes('authentication') || message.includes('No blob credentials')) {
      message = 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
