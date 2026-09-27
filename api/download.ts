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
    const path = searchParams.get('path')
    
    if (!path) {
      return Response.json({ error: 'Path requerido' }, { status: 400 })
    }
    
    const blobUrl = `${process.env.BLOB_READ_WRITE_TOKEN!.split('_')[0]}_${path.split('/').pop()}`
    const response = await fetch(`https://blob.vercel-storage.com/${path}`)
    
    if (!response.ok) {
      return Response.json({ error: 'Archivo no encontrado' }, { status: 404 })
    }
    
    return new Response(response.body, {
      headers: {
        'Content-Type': 'application/octet-stream'
      }
    })
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 })
  }
}
