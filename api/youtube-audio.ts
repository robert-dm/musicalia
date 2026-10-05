import ytdl from '@distube/ytdl-core'
import { getSessionFromRequest } from './_lib/auth-utils.js'

const MAX_DURATION_SECONDS = 600 // 10 minutes
const CHUNK_SIZE = 4 * 1024 * 1024 // 4MB chunks (under 4.5MB limit with overhead)

export const config = {
  maxDuration: 60 // 60 seconds for Hobby tier
}

export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return Response.json({ error: 'Debe iniciar sesión' }, { status: 401 })
    }

    const body = await request.json() as { url: string; chunkIndex?: number }
    const { url, chunkIndex } = body

    if (!url) {
      return Response.json({ error: 'URL de YouTube requerida' }, { status: 400 })
    }

    // Validate YouTube URL
    if (!ytdl.validateURL(url)) {
      return Response.json({ error: 'URL de YouTube inválida' }, { status: 400 })
    }

    // Get video info (cached by ytdl-core for subsequent chunk requests)
    const info = await ytdl.getInfo(url)
    
    // Check duration
    const duration = parseInt(info.videoDetails.lengthSeconds)
    if (duration > MAX_DURATION_SECONDS) {
      return Response.json({ 
        error: `Video demasiado largo (${Math.floor(duration / 60)} min). Límite: ${MAX_DURATION_SECONDS / 60} minutos. Intenta subir el archivo directamente.` 
      }, { status: 400 })
    }

    // Get audio-only format, prefer low bitrate to avoid size limits
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly')
    if (audioFormats.length === 0) {
      return Response.json({ error: 'No se encontró audio en este video' }, { status: 404 })
    }

    // Find lowest bitrate m4a (itag 140) or webm/opus that Chrome can decode
    // Sort by bitrate (lowest first) to minimize bandwidth and size
    audioFormats.sort((a, b) => (a.audioBitrate || 999) - (b.audioBitrate || 999))
    
    // Prefer m4a (better compatibility with decodeAudioData) or webm/opus
    const format = audioFormats.find(f => 
      f.mimeType?.includes('audio/mp4') || 
      f.mimeType?.includes('audio/webm')
    ) || audioFormats[0]

    // Estimate total size to determine if chunking is needed
    const estimatedSize = (format.contentLength && parseInt(format.contentLength)) || 
                         (duration * ((format.audioBitrate || 64) / 8) * 1000) // fallback: bitrate * duration
    
    const needsChunking = estimatedSize > CHUNK_SIZE

    console.log(`[YouTube] ${needsChunking ? 'Chunked' : 'Direct'} streaming: ${info.videoDetails.title} (${duration}s, ${format.mimeType}, ${format.audioBitrate}kbps, ~${(estimatedSize / 1024 / 1024).toFixed(1)}MB)`)

    // Handle chunked request
    if (needsChunking && chunkIndex !== undefined) {
      const startByte = chunkIndex * CHUNK_SIZE
      const endByte = Math.min(startByte + CHUNK_SIZE - 1, estimatedSize - 1)
      
      console.log(`[YouTube] Chunk ${chunkIndex}: bytes ${startByte}-${endByte}`)
      
      const audioStream = ytdl(url, {
        format: format,
        quality: format.itag,
        range: { start: startByte, end: endByte }
      })

      const chunks: Uint8Array[] = []
      
      // Collect all chunks into memory (within 4MB limit)
      await new Promise<void>((resolve, reject) => {
        audioStream.on('data', (chunk: Buffer) => {
          chunks.push(new Uint8Array(chunk))
        })
        
        audioStream.on('end', () => resolve())
        audioStream.on('error', (error) => reject(error))
      })
      
      // Concatenate chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }
      
      const isLastChunk = endByte >= estimatedSize - 1
      
      return new Response(combined, {
        status: 206, // Partial Content
        headers: {
          'Content-Type': format.mimeType || 'audio/mp4',
          'Content-Range': `bytes ${startByte}-${endByte}/${estimatedSize}`,
          'X-Is-Last-Chunk': isLastChunk ? 'true' : 'false',
          'Cache-Control': 'no-cache'
        }
      })
    }

    // If first request for a large file, return metadata for chunked fetching
    if (needsChunking && chunkIndex === undefined) {
      const totalChunks = Math.ceil(estimatedSize / CHUNK_SIZE)
      return Response.json({
        needsChunking: true,
        totalChunks,
        chunkSize: CHUNK_SIZE,
        estimatedSize,
        videoTitle: info.videoDetails.title,
        duration,
        mimeType: format.mimeType || 'audio/mp4'
      })
    }

    // Direct streaming for small files (under 4MB)
    const audioStream = ytdl(url, {
      format: format,
      quality: format.itag
    })

    // Convert Node stream to Web ReadableStream
    const webStream = new ReadableStream({
      start(controller) {
        audioStream.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk))
        })
        
        audioStream.on('end', () => {
          controller.close()
        })
        
        audioStream.on('error', (error) => {
          console.error('[YouTube] Stream error:', error)
          controller.error(error)
        })
      },
      
      cancel() {
        audioStream.destroy()
      }
    })

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': format.mimeType || 'audio/mp4',
        'X-Video-Title': encodeURIComponent(info.videoDetails.title),
        'X-Video-Duration': duration.toString(),
        'Cache-Control': 'no-cache'
      }
    })

  } catch (error: any) {
    console.error('YouTube audio error:', error)
    
    // Provide helpful error messages in Spanish
    let message = 'Error al obtener audio de YouTube'
    
    if (error.message?.includes('not a bot')) {
      message = 'YouTube bloqueó la solicitud. Intenta subir el archivo directamente.'
    } else if (error.message?.includes('Sign in to confirm')) {
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
