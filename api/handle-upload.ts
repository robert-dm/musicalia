import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client'
import { issueSignedToken } from '@vercel/blob'
import { getVercelOidcToken } from '@vercel/oidc'
import type { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HandleUploadPresignedBody
    
    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      console.error('[handle-upload] Missing MUSICALIA_STORE_ID')
      return Response.json({ error: 'MUSICALIA_STORE_ID no configurado' }, { status: 500 })
    }
    
    const expectedKey = process.env.MUSICALIA_KEY
    if (!expectedKey) {
      console.error('[handle-upload] Missing MUSICALIA_KEY')
      return Response.json({ error: 'MUSICALIA_KEY no configurada en servidor' }, { status: 500 })
    }
    
    let oidcToken: string | null = null
    try {
      oidcToken = await getVercelOidcToken()
      console.log('[handle-upload] OIDC token retrieved:', oidcToken ? 'YES' : 'NO')
    } catch (err: any) {
      console.error('[handle-upload] getVercelOidcToken failed:', err.message)
      return Response.json({ 
        error: 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC' 
      }, { status: 500 })
    }
    
    if (!oidcToken) {
      console.error('[handle-upload] OIDC token is null')
      return Response.json({ 
        error: 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC' 
      }, { status: 500 })
    }
    
    const webhookPublicKey = process.env.MUSICALIA_WEBHOOK_PUBLIC_KEY || process.env.BLOB_WEBHOOK_PUBLIC_KEY
    if (!webhookPublicKey) {
      console.error('[handle-upload] Missing MUSICALIA_WEBHOOK_PUBLIC_KEY')
      return Response.json({ error: 'MUSICALIA_WEBHOOK_PUBLIC_KEY no configurado' }, { status: 500 })
    }
    
    console.log('[handle-upload] All env vars validated, calling handleUploadPresigned')
    
    const jsonResponse = await handleUploadPresigned({
      body,
      request,
      webhookPublicKey,
      getSignedToken: async (pathname, clientPayload, multipart) => {
        try {
          console.log('[getSignedToken] Called with pathname:', pathname)
          
          let payload: any = {}
          if (clientPayload) {
            try {
              payload = JSON.parse(clientPayload)
            } catch (parseErr: any) {
              console.error('[getSignedToken] Failed to parse clientPayload:', parseErr.message)
              throw new Error('Invalid client payload')
            }
          }
          
          if (payload.musicaliaKey !== expectedKey) {
            console.error('[getSignedToken] Invalid musicalia key')
            throw new Error('Clave incorrecta')
          }
          
          const projectName = payload.projectName
          if (!projectName) {
            console.error('[getSignedToken] Missing projectName')
            throw new Error('Nombre de proyecto requerido')
          }
          
          const fileName = pathname.split('/').pop() || 'file'
          const finalPathname = `musicalia/${projectName}/${fileName}`
          
          console.log('[getSignedToken] Issuing signed token for pathname:', finalPathname)
          
          const signedToken = await issueSignedToken({
            oidcToken,
            storeId,
            pathname: finalPathname,
            operations: ['put'],
            allowedContentTypes: ['audio/wav', 'audio/mpeg', 'audio/mp3', 'application/json', 'application/octet-stream']
          })
          
          console.log('[getSignedToken] Signed token issued successfully')
          
          return { token: signedToken }
        } catch (err: any) {
          console.error('[getSignedToken] Error:', err.message, err.stack)
          throw err
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('[handle-upload] Upload completed:', blob.pathname)
      }
    })

    console.log('[handle-upload] handleUploadPresigned returned successfully')
    return Response.json(jsonResponse)
  } catch (error: any) {
    console.error('[handle-upload] Top-level error:', error.message, error.stack)
    
    let message = error.message || 'Error al procesar upload'
    
    if (message.includes('OIDC') || message.includes('credentials') || message.includes('authentication') || message.includes('No blob credentials')) {
      message = 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC'
    } else if (message.includes('Failed to retrieve') || message.includes('presigned')) {
      message = 'Error al generar URL de subida. Verifica la configuración del Blob store.'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
