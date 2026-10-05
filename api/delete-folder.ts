import { list, del } from '@vercel/blob'
import { getVercelOidcToken } from '@vercel/oidc'
import { getSessionFromRequest } from './_lib/auth-utils'

export async function DELETE(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return Response.json({ error: 'No autenticado' }, { status: 401 })
    }
    
    const { pathname } = await request.json()
    
    if (!pathname) {
      return Response.json({ error: 'Pathname requerido' }, { status: 400 })
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
    
    const { blobs } = await list({ 
      prefix: `${pathname}/`,
      storeId,
      oidcToken
    })
    
    const pathsToDelete = blobs.map(b => b.pathname)
    
    if (pathsToDelete.length === 0) {
      try {
        await del(`${pathname}.musicalia`, { storeId, oidcToken })
      } catch (err) {
        console.log('Old format file not found, already deleted')
      }
    } else {
      await del(pathsToDelete, { storeId, oidcToken })
    }
    
    return Response.json({ success: true })
  } catch (error: any) {
    console.error('Delete folder error:', error)
    let message = error.message || 'Error al eliminar'
    
    if (message.includes('OIDC') || message.includes('credentials') || message.includes('authentication') || message.includes('No blob credentials')) {
      message = 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
