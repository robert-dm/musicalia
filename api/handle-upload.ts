import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import type { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HandleUploadBody
    
    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      return Response.json({ error: 'MUSICALIA_STORE_ID no configurado' }, { status: 500 })
    }
    
    const oidcToken = process.env.VERCEL_OIDC_TOKEN
    if (!oidcToken) {
      return Response.json({ error: 'VERCEL_OIDC_TOKEN no disponible' }, { status: 500 })
    }
    
    const expectedKey = process.env.MUSICALIA_KEY
    if (!expectedKey) {
      return Response.json({ error: 'MUSICALIA_KEY no configurada en servidor' }, { status: 500 })
    }
    
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload: any = {}
        if (clientPayload) {
          try {
            payload = JSON.parse(clientPayload)
          } catch {
            throw new Error('Invalid client payload')
          }
        }
        
        if (payload.musicaliaKey !== expectedKey) {
          throw new Error('Clave incorrecta')
        }
        
        const projectName = payload.projectName
        if (!projectName) {
          throw new Error('Nombre de proyecto requerido')
        }
        
        const fileName = pathname.split('/').pop() || 'file'
        const finalPathname = `musicalia/${projectName}/${fileName}`
        
        return {
          allowedContentTypes: ['audio/wav', 'audio/mpeg', 'audio/mp3', 'application/json', 'application/octet-stream'],
          tokenPayload: JSON.stringify({
            projectName,
          }),
          pathname: finalPathname
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('Upload completed:', blob.pathname)
      },
      options: {
        storeId,
        oidcToken
      }
    })

    return Response.json(jsonResponse)
  } catch (error: any) {
    console.error('Handle upload error:', error)
    const message = error.message || 'Error al procesar upload'
    return Response.json({ error: message }, { status: 500 })
  }
}
