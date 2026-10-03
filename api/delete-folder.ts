import { list, del } from '@vercel/blob'
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
    
    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      return Response.json({ error: 'MUSICALIA_STORE_ID no configurado' }, { status: 500 })
    }
    
    const { blobs } = await list({ 
      prefix: `${pathname}/`,
      storeId
    })
    
    const pathsToDelete = blobs.map(b => b.pathname)
    
    if (pathsToDelete.length === 0) {
      try {
        await del(`${pathname}.musicalia`, { storeId })
      } catch (err) {
        console.log('Old format file not found, already deleted')
      }
    } else {
      await del(pathsToDelete, { storeId })
    }
    
    return Response.json({ success: true })
  } catch (error: any) {
    console.error('Delete folder error:', error)
    let message = error.message || 'Error al eliminar'
    
    if (message.includes('OIDC') || message.includes('credentials') || message.includes('authentication') || message.includes('No blob credentials')) {
      message = 'Activa "Store Scoped Access Tokens" en la configuración del proyecto en Vercel'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
