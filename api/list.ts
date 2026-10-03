import { list } from '@vercel/blob'
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
    
    const storeId = process.env.MUSICALIA_STORE_ID
    if (!storeId) {
      return Response.json({ error: 'MUSICALIA_STORE_ID no configurado' }, { status: 500 })
    }
    
    const { blobs } = await list({ 
      prefix: 'musicalia/',
      storeId
    })
    
    const projectMap = new Map<string, { name: string, totalSize: number, uploadedAt: Date }>()
    
    for (const blob of blobs) {
      const pathParts = blob.pathname.split('/')
      if (pathParts.length >= 2 && pathParts[0] === 'musicalia') {
        const projectName = pathParts[1]
        
        if (pathParts.length === 3 && pathParts[2] === 'project.json') {
          const existing = projectMap.get(projectName)
          if (!existing || blob.uploadedAt > existing.uploadedAt) {
            projectMap.set(projectName, {
              name: projectName,
              totalSize: existing?.totalSize || 0,
              uploadedAt: blob.uploadedAt
            })
          }
        }
        
        const existing = projectMap.get(projectName)
        if (existing) {
          existing.totalSize += blob.size
        } else {
          projectMap.set(projectName, {
            name: projectName,
            totalSize: blob.size,
            uploadedAt: blob.uploadedAt
          })
        }
      } else if (blob.pathname.endsWith('.musicalia')) {
        const projectName = blob.pathname.replace('musicalia/', '').replace('.musicalia', '')
        projectMap.set(projectName, {
          name: projectName,
          totalSize: blob.size,
          uploadedAt: blob.uploadedAt
        })
      }
    }
    
    const projects = Array.from(projectMap.values()).map(project => ({
      name: project.name,
      pathname: `musicalia/${project.name}`,
      size: project.totalSize,
      uploadedAt: project.uploadedAt
    }))
    
    return Response.json(projects)
  } catch (error: any) {
    console.error('List error:', error)
    let message = error.message || 'Error al listar proyectos'
    
    if (message.includes('OIDC') || message.includes('credentials') || message.includes('authentication') || message.includes('No blob credentials')) {
      message = 'Activa "Store Scoped Access Tokens" en la configuración del proyecto en Vercel'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
