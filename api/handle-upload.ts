import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client'
import { issueSignedToken } from '@vercel/blob'
import { getVercelOidcToken } from '@vercel/oidc'
import type { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HandleUploadPresignedBody
    
    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      return Response.json({ error: 'MUSICALIA_STORE_ID no configurado' }, { status: 500 })
    }
    
    const expectedKey = process.env.MUSICALIA_KEY
    if (!expectedKey) {
      return Response.json({ error: 'MUSICALIA_KEY no configurada en servidor' }, { status: 500 })
    }
    
    const oidcToken = await getVercelOidcToken()
    if (!oidcToken) {
      return Response.json({ 
        error: 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC' 
      }, { status: 500 })
    }
    
    const webhookPublicKey = process.env.MUSICALIA_WEBHOOK_PUBLIC_KEY || process.env.BLOB_WEBHOOK_PUBLIC_KEY
    if (!webhookPublicKey) {
      return Response.json({ error: 'MUSICALIA_WEBHOOK_PUBLIC_KEY no configurado' }, { status: 500 })
    }
    
    const jsonResponse = await handleUploadPresigned({
      body,
      request,
      webhookPublicKey,
      getSignedToken: async (pathname, clientPayload, multipart) => {
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
        
        const signedToken = await issueSignedToken({
          oidcToken,
          storeId,
          pathname: finalPathname,
          operations: ['put'],
          allowedContentTypes: ['audio/wav', 'audio/mpeg', 'audio/mp3', 'application/json', 'application/octet-stream']
        })
        
        return { token: signedToken }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('Upload completed:', blob.pathname)
      }
    })

    return Response.json(jsonResponse)
  } catch (error: any) {
    console.error('Handle upload error:', error)
    let message = error.message || 'Error al procesar upload'
    
    if (message.includes('OIDC') || message.includes('credentials') || message.includes('authentication') || message.includes('No blob credentials')) {
      message = 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
