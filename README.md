# Musicalia

A web-based music production application built with React, Tone.js, and ONNX Runtime for AI-powered stem separation with Google Drive cloud storage.

## Google Drive Setup

To enable Google Drive cloud project storage:

### 1. Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Drive API**:
   - Go to **APIs & Services** > **Library**
   - Search for "Google Drive API"
   - Click **Enable**
4. Create OAuth 2.0 credentials:
   - Go to **APIs & Services** > **Credentials**
   - Click **Create Credentials** > **OAuth client ID**
   - Choose **Web application**
   - Under **Authorized JavaScript origins**, add:
     - `https://musicalia-pi.vercel.app`
   - Click **Create**
   - Copy the **Client ID**

### 2. Vercel Environment Variable

1. Go to your Vercel project dashboard
2. Navigate to **Settings** > **Environment Variables**
3. Add a new variable:
   - **Name**: `VITE_GOOGLE_CLIENT_ID`
   - **Value**: (paste the Client ID from step 1)
   - **Environment**: Production, Preview, Development
4. Click **Save**
5. Redeploy the application

Once configured, users can:
- Connect their Google Drive account
- Save projects to a "Musicalia" folder in Drive
- List, open, and permanently delete cloud projects
- View storage usage

## Development

```bash
npm install
npm run dev
```

## Build for Production

```bash
npm run build
```
