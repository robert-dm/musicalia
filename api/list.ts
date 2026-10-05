import { list } from '@vercel/blob'
import { getVercelOidcToken } from '@vercel/oidc'
import { getSessionFromRequest } from './_lib/auth-utils'

export default async function handler(request: Request) {
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
        error: 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC' 
      }, { status: 500 })
    }
    
    const { blobs } = await list({ 
      prefix: `musicalia-projects/${session.userId}/`,
      storeId,
      oidcToken
    })
    
    const projectMap = new Map<string, { name: string, totalSize: number, uploadedAt: Date, hasProjectJson: boolean, folderPath: string | null }>()
    
    for (const blob of blobs) {
      const pathParts = blob.pathname.split('/')
      if (pathParts.length >= 3 && pathParts[0] === 'musicalia-projects' && pathParts[1] === session.userId) {
        const projectName = pathParts[2]
        
        // Match project.json or project-*.json or similar patterns
        if (pathParts.length === 4 && (pathParts[3] === 'project.json' || pathParts[3].match(/^project[^/]*\.json$/))) {
          const folderPath = `${pathParts[0]}/${pathParts[1]}/${pathParts[2]}`
          const existing = projectMap.get(projectName)
          if (!existing || blob.uploadedAt > existing.uploadedAt) {
            projectMap.set(projectName, {
              name: projectName,
              totalSize: existing?.totalSize || 0,
              uploadedAt: blob.uploadedAt,
              hasProjectJson: true,
              folderPath
            })
          } else {
            existing.hasProjectJson = true
            if (!existing.folderPath) {
              existing.folderPath = folderPath
            }
          }
        }
        
        const existing = projectMap.get(projectName)
        if (existing) {
          existing.totalSize += blob.size
        } else {
          const folderPath = pathParts.length >= 3 ? `${pathParts[0]}/${pathParts[1]}/${pathParts[2]}` : null
          projectMap.set(projectName, {
            name: projectName,
            totalSize: blob.size,
            uploadedAt: blob.uploadedAt,
            hasProjectJson: false,
            folderPath
          })
        }
      } else if (blob.pathname.endsWith('.musicalia')) {
        const projectName = blob.pathname.replace('musicalia/', '').replace('.musicalia', '')
        projectMap.set(projectName, {
          name: projectName,
          totalSize: blob.size,
          uploadedAt: blob.uploadedAt,
          hasProjectJson: true,
          folderPath: blob.pathname.replace('.musicalia', '')
        })
      }
    }
    
    const projects = Array.from(projectMap.values())
      .filter(project => project.hasProjectJson && project.folderPath)
      .map(project => ({
        name: project.name,
        pathname: project.folderPath!,
        size: project.totalSize,
        uploadedAt: project.uploadedAt
      }))
    
    return Response.json(projects)
  } catch (error: any) {
    console.error('List error:', error)
    let message = error.message || 'Error al listar proyectos'
    
    if (message.includes('OIDC') || message.includes('credentials') || message.includes('authentication') || message.includes('No blob credentials')) {
      message = 'En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
