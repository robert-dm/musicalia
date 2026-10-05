import { getSessionFromRequest } from './_lib/auth-utils'
import { list, copy } from '@vercel/blob'
import { getVercelOidcToken } from '@vercel/oidc'

export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return Response.json({ error: 'No autenticado' }, { status: 401 })
    }

    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      return Response.json({ error: 'MUSICALIA_STORE_ID no configurado' }, { status: 500 })
    }

    const oidcToken = await getVercelOidcToken()
    if (!oidcToken) {
      return Response.json({ 
        error: 'OIDC token no disponible' 
      }, { status: 500 })
    }

    // List all blobs in the old musicalia/ prefix
    const { blobs } = await list({
      prefix: 'musicalia/',
      storeId,
      oidcToken
    })

    // Filter for project blobs (not musicalia-users/ or musicalia-projects/)
    const legacyBlobs = blobs.filter(blob => 
      !blob.pathname.startsWith('musicalia-users/') && 
      !blob.pathname.startsWith('musicalia-projects/')
    )

    if (legacyBlobs.length === 0) {
      return Response.json({ 
        message: 'No hay proyectos antiguos para migrar',
        migratedCount: 0
      })
    }

    // Copy each legacy blob to the new user namespace
    const migrations: Promise<void>[] = []
    for (const blob of legacyBlobs) {
      // Extract project name and file from old path: musicalia/{projectName}/{file}
      const pathParts = blob.pathname.split('/')
      if (pathParts.length >= 3 && pathParts[0] === 'musicalia') {
        const projectName = pathParts[1]
        const fileName = pathParts.slice(2).join('/')
        const newPathname = `musicalia-projects/${session.userId}/${projectName}/${fileName}`

        migrations.push(
          copy(blob.url, newPathname, {
            storeId,
            token: oidcToken
          }).then(() => {
            console.log(`Migrated ${blob.pathname} to ${newPathname}`)
          })
        )
      }
    }

    await Promise.all(migrations)

    return Response.json({
      message: `${legacyBlobs.length} archivos copiados a tu cuenta (los originales permanecen)`,
      migratedCount: legacyBlobs.length
    })
  } catch (error: any) {
    console.error('Migration error:', error)
    return Response.json({ 
      error: error.message || 'Error al migrar proyectos' 
    }, { status: 500 })
  }
}
