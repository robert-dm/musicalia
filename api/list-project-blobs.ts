import { list } from '@vercel/blob'
import { getVercelOidcToken } from '@vercel/oidc'
import { getSessionFromRequest } from './_lib/auth-utils.js'

export async function GET(request: Request) {
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

    // Validate that prefix is for this user's projects
    // Allow both musicalia-projects/{userId}/ and legacy musicalia-projects/ paths
    const isUserPath = prefix.startsWith(`musicalia-projects/${session.userId}/`)
    const isLegacyPath = prefix.startsWith('musicalia-projects/') && !prefix.includes(session.userId)
    
    if (!isUserPath && !isLegacyPath) {
      console.error(`Access denied: prefix="${prefix}", userId="${session.userId}"`)
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
    const { blobs } = await list({ 
      prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
      storeId,
      oidcToken
    })
    
    console.log(`list-project-blobs: prefix="${prefix}", found ${blobs.length} blobs`)
    
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
