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
    
    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      return Response.json({ error: 'Almacenamiento no configurado' }, { status: 500 })
    }
    
    await del(pathname, { storeId })
    
    return Response.json({ success: true })
  } catch (error: any) {
    console.error('Delete error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
