import { get } from '@vercel/blob'
import { getVercelOidcToken } from '@vercel/oidc'
import { getSessionFromRequest } from './_lib/auth-utils.js'

export async function GET(request: Request) {
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
    
    // Use authenticated get() instead of head() + fetch(blob.url)
    // Try public access first (how files are saved), then private as fallback
    let result
    try {
      result = await get(pathname, {
        access: 'public',
        storeId,
        oidcToken
      })
    } catch (publicError: any) {
      console.log(`Public access failed for ${pathname}, trying private:`, publicError.message)
      try {
        result = await get(pathname, {
          access: 'private',
          storeId,
          oidcToken
        })
      } catch (privateError: any) {
        console.error(`Both public and private access failed for ${pathname}`)
        return Response.json({ error: 'Archivo no encontrado' }, { status: 404 })
      }
    }
    
    if (!result || !result.stream) {
      return Response.json({ error: 'Archivo no encontrado' }, { status: 404 })
    }
    
    // For JSON files (project.json), buffer the entire stream to ensure completeness
    // and validate it's not empty/corrupt before sending to client
    const isJsonFile = pathname.endsWith('.json') || result.blob.contentType?.includes('json')
    
    if (isJsonFile || result.blob.size < 1024 * 1024) { // Buffer files under 1MB
      // Read the entire stream into a buffer
      const reader = result.stream.getReader()
      const chunks: Uint8Array[] = []
      let totalLength = 0
      
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            totalLength += value.length
          }
        }
      } catch (streamError: any) {
        console.error(`Stream read error for ${pathname}:`, streamError)
        return Response.json({ error: 'Error al leer el archivo' }, { status: 500 })
      }
      
      // Check if file is empty
      if (totalLength === 0) {
        console.error(`Empty file: ${pathname}`)
        return Response.json({ error: 'El archivo está vacío o corrupto' }, { status: 500 })
      }
      
      // Concatenate chunks into single buffer
      const fullContent = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        fullContent.set(chunk, offset)
        offset += chunk.length
      }
      
      // For JSON files, validate it's valid JSON
      if (isJsonFile) {
        try {
          const text = new TextDecoder().decode(fullContent)
          JSON.parse(text) // Validate JSON
        } catch (jsonError: any) {
          console.error(`Invalid JSON in ${pathname}:`, jsonError)
          return Response.json({ error: 'El archivo JSON está corrupto' }, { status: 500 })
        }
      }
      
      // Return buffered content with accurate Content-Length
      return new Response(fullContent, {
        headers: {
          'Content-Type': result.blob.contentType || 'application/octet-stream',
          'Content-Length': totalLength.toString()
        }
      })
    }
    
    // For large files (audio), stream directly but ensure Content-Length matches
    return new Response(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || 'application/octet-stream',
        'Content-Length': result.blob.size.toString()
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
