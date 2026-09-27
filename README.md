# Musicalia

A web-based music production application with AI stem separation and Vercel Blob cloud storage.

## Vercel Blob Setup

To enable cloud project storage:

### 1. Create Blob Store

1. Go to your Vercel project dashboard
2. Navigate to **Storage** tab
3. Click **Create Database** > **Blob**
4. Name it (e.g., "musicalia-projects")
5. Click **Create**
6. Copy the `BLOB_READ_WRITE_TOKEN` (automatically added to env vars)

### 2. Set Shared Secret

1. Go to **Settings** > **Environment Variables**
2. Add a new variable:
   - **Name**: `MUSICALIA_KEY`
   - **Value**: (create a strong random string, e.g., `openssl rand -hex 32`)
   - **Environment**: Production, Preview, Development
3. Click **Save**

### 3. Deploy

1. Push your changes or click **Redeploy** in Vercel
2. Share the `MUSICALIA_KEY` value with users who need access

Users will enter the key once in the app (stored in localStorage) to save/load cloud projects.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
