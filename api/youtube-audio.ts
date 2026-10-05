import ytdl from '@distube/ytdl-core'
import { getSessionFromRequest } from './_lib/auth-utils.js'

const MAX_DURATION_SECONDS = 600 // 10 minutes

export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return Response.json({ error: 'Debe iniciar sesión' }, { status: 401 })
    }

    const body = await request.json() as { url: string }
    const { url } = body

    if (!url) {
      return Response.json({ error: 'URL de YouTube requerida' }, { status: 400 })
    }

    // Validate YouTube URL
    if (!ytdl.validateURL(url)) {
      return Response.json({ error: 'URL de YouTube inválida' }, { status: 400 })
    }

    // Get video info
    const info = await ytdl.getInfo(url)
    
    // Check duration
    const duration = parseInt(info.videoDetails.lengthSeconds)
    if (duration > MAX_DURATION_SECONDS) {
      return Response.json({ 
        error: `Video demasiado largo (${Math.floor(duration / 60)} min). Límite: ${MAX_DURATION_SECONDS / 60} minutos. Intenta subir el archivo directamente.` 
      }, { status: 400 })
    }

    // Get audio-only format
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly')
    if (audioFormats.length === 0) {
      return Response.json({ error: 'No se encontró audio en este video' }, { status: 404 })
    }

    // Sort by bitrate (highest first)
    audioFormats.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))
    const format = audioFormats[0]

    // Return metadata and stream URL
    return Response.json({
      title: info.videoDetails.title,
      duration,
      streamUrl: format.url,
      mimeType: format.mimeType,
      audioBitrate: format.audioBitrate
    })

  } catch (error: any) {
    console.error('YouTube audio error:', error)
    
    // Provide helpful error messages in Spanish
    let message = 'Error al obtener audio de YouTube'
    
    if (error.message?.includes('Sign in to confirm')) {
      message = 'Video con restricción de edad. Intenta subir el archivo directamente.'
    } else if (error.message?.includes('not available')) {
      message = 'Video no disponible en esta región. Intenta subir el archivo directamente.'
    } else if (error.message?.includes('private')) {
      message = 'Video privado. Intenta subir el archivo directamente.'
    } else if (error.message?.includes('blocked')) {
      message = 'YouTube bloqueó la solicitud. Intenta subir el archivo directamente.'
    } else if (error.statusCode === 429) {
      message = 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.'
    }
    
    return Response.json({ error: message }, { status: 500 })
  }
}
