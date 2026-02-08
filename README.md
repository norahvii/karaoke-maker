# Karaoke Maker 🎤

A hackable, locally-hosted karaoke creation tool powered by state-of-the-art AI models. Process audio on your home computer and control it remotely from your mobile devices.

## Features

- **AI-Powered Vocal Removal**: Uses cutting-edge models (BS-RoFormer, MDX-Net, Demucs, Vocal Remover)
- **Mobile Control**: Queue jobs from your phone via local network or Tailscale VPN
- **Community Models**: Support for custom models by aufr33, FoxJoy, @playdasegunda, and more
- **Audio Enhancement**: Optional enhancement using Resemble Enhance or Apollo
- **Lyrics Generation**: Automatic lyrics extraction and karaoke video generation
- **Plugin System**: Extensible input sources (YouTube, SoundCloud, local files, etc.)
- **YouTube Integration**: Direct upload to your YouTube channel
- **Privacy-First**: All processing happens locally on your hardware

## Architecture

```
┌──────────────┐    WiFi/Tailscale       ┌──────────────────┐
│  Mobile App  │  ◄──────────────────►   │  Desktop App     │
│  (React      │    HTTP/WebSocket       │  (Electron +     │
│   Native)    │                         │   Python)        │
└──────────────┘                         └────────┬─────────┘
                                                  │
                    ┌─────────────────────────────┼───────────────────────────┐
                    │                             │                           │
           ┌────────▼────────┐         ┌──────────▼──────────┐       ┌────────▼────────┐
           │  Vocal Removal  │         │  Audio Enhancement  │       │  Lyrics Engine  │
           │ • BS-RoFormer   │         │ • Resemble Enhance  │       │ • Whisper       │
           │ • MDX-Net       │         │ • Apollo            │       │ • FFmpeg        │
           │ • Demucs        │         └─────────────────────┘       └─────────────────┘
           │ • Vocal Remover │                    │   
           └─────────────────┘                    │  
                                                  │
                                                  ▼
                                       ┌─────────────────────┐
                                       │   YOUTUBE UPLOAD    │
                                       │   (Your Channel)    │
                                       │  • OAuth2 Auth      │
                                       │  • Direct Upload    │
                                       └─────────────────────┘        
```

## Quick Start

### Prerequisites

- **Desktop**: Windows 10/11, macOS 12+, or Linux
- **Mobile**: iOS 14+ or Android 10+
- **Python**: 3.9 or higher
- **Node.js**: 18 or higher
- **GPU**: NVIDIA GPU with CUDA recommended (CPU supported but slower)

### Installation

1. **Clone the repository**:
```bash
git clone https://github.com/yourusername/karaoke-maker.git
cd karaoke-maker
```

2. **Install Python dependencies**:
```bash
cd desktop-app/python-pipeline
pip install -r requirements.txt
```

3. **Install desktop app dependencies**:
```bash
cd ../
npm install
```

4. **Build and run**:
```bash
npm run dev
```

### Mobile App Setup

1. Install the mobile app:
```bash
cd mobile-app
npm install
npx expo start
```

2. Scan the QR code with Expo Go app, or run on simulator

3. Enter the desktop app IP address (shown in desktop app settings)

## Supported Models

### Official Models

| Model | Author | Type | Description |
|-------|--------|------|-------------|
| BS-RoFormer | lucidrains | Separation | SOTA attention network for music separation |
| MDX-Net | kuielab | Separation | Sony Demixing Challenge 2nd place |
| Vocal Remover | tsurumeso | Separation | DNN-based vocal isolation |
| Demucs | Meta | Separation | General music source separation |
| Resemble Enhance | resemble-ai | Enhancement | Speech/audio enhancement |
| Apollo | JusperLee | Enhancement | Post-processing enhancement |

### Community Models (UVR Compatible)

| Model | Author | Purpose |
|-------|--------|---------|
| BVE | aufr33 | Best Vocal Eliminator |
| Karaoke | aufr33 | Optimized for karaoke |
| De-Crowd | aufr33 | Remove crowd noise |
| De-Noise | aufr33 | Audio denoising |
| MDX De-Reverb | FoxJoy | Reverb removal |
| MDX De-Echo | FoxJoy | Echo removal |
| BS-RoFormer Vocals | @playdasegunda | Vocal extraction |
| BS-RoFormer Bass | @playdasegunda | Bass separation |
| Mel-RoFormer Guitar | @playdasegunda | Guitar separation |

### Downloading Models

Models can be downloaded through the desktop app UI or via CLI:

```bash
python desktop-app/python-pipeline/model_manager.py --download bs_roformer_vocals
```

List available models:
```bash
python desktop-app/python-pipeline/model_manager.py --list
```

## Usage

### Desktop App

1. Launch the application
2. The app will start a local server (default: http://localhost:3000)
3. Add jobs via the UI or mobile app
4. Monitor processing progress
5. Find outputs in `~/Karaoke-Output` (or your configured directory)

### Mobile App

1. Open the mobile app
2. Enter the desktop IP address shown in desktop settings
3. Paste a YouTube URL or search
4. Select processing options:
   - **Model**: BS-RoFormer (recommended), MDX-Net, BVE, etc.
   - **Enhancement**: Optional audio enhancement
   - **Lyrics**: Enable/disable lyrics generation
5. Submit and monitor progress

### Remote Access with Tailscale

1. Install Tailscale on both desktop and mobile
2. Enable Tailscale in desktop app settings
3. Use the Tailscale IP in mobile app
4. Access from anywhere in the world securely

## Plugin Development

Create custom input plugins by dropping JS files into `~/.karaoke-app/plugins/`:

```javascript
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  
  canHandle: (input) => {
    // Return true if this plugin can handle the input
    return input.includes('my-source.com');
  },
  
  fetch: async (input) => {
    // Download/process the input
    // Return: { path: '/path/to/audio.wav', metadata: {...} }
    return {
      path: await downloadAudio(input),
      metadata: { title: 'Song Title', artist: 'Artist Name' }
    };
  }
};
```

See `desktop-app/plugins/` for examples.

## Configuration

Configuration is stored in `~/.karaoke-app/config.json`:

```json
{
  "apiPort": 3000,
  "outputDir": "/Users/username/Karaoke-Output",
  "modelsDir": "/Users/username/.karaoke-app/models",
  "pythonPath": "python3",
  "tailscaleEnabled": true,
  "tailscaleIp": "100.x.x.x",
  "youtubeClientId": null,
  "youtubeClientSecret": null
}
```

## API Endpoints

The desktop app exposes a REST API:

- `GET /api/status` - Server status
- `GET /api/queue` - Current queue
- `POST /api/process` - Add job to queue
- `GET /api/job/:id` - Get job status
- `POST /api/job/:id/cancel` - Cancel job
- `GET /api/models` - List available models
- `POST /api/models/download` - Download model

## Troubleshooting

### CUDA Out of Memory
- Reduce batch size in settings
- Use CPU mode (slower)
- Close other GPU applications

### Model Download Fails
- Check internet connection
- Try manual download from HuggingFace
- Place files in `~/.karaoke-app/models/`

### Mobile Can't Connect
- Ensure same WiFi network
- Check firewall settings
- Try using Tailscale
- Verify IP address and port

### YouTube Download Fails
- Update yt-dlp: `pip install -U yt-dlp`
- Check URL is valid and accessible
- Some videos may be restricted

## Performance Tips

- **GPU**: NVIDIA RTX 3060 or better recommended
- **RAM**: 16GB minimum, 32GB recommended for large files
- **Storage**: SSD recommended for temp files
- **Processing Time**: ~1-3 minutes per song on GPU, 5-15 on CPU

## Credits

### Core Models
- [tsurumeso/vocal-remover](https://github.com/tsurumeso/vocal-remover)
- [kuielab/mdx-net](https://github.com/kuielab/mdx-net)
- [lucidrains/BS-RoFormer](https://github.com/lucidrains/BS-RoFormer)
- [facebookresearch/demucs](https://github.com/facebookresearch/demucs)
- [resemble-ai/resemble-enhance](https://github.com/resemble-ai/resemble-enhance)

### Community Contributors
- **aufr33** - UVR Online, BVE, De-crowd, De-noise models
- **Anjok07** - Ultimate Vocal Remover GUI
- **FoxJoy** - MDX De-reverb, UVR De-echo
- **@playdasegunda** - BS-RoFormer variants
- **jarredou** - MDX23C DeReverb
- **anvuew** - BS-RoFormer Dereverb

## License

MIT License - See LICENSE file for details.

Note: This project uses third-party models with their own licenses. Please respect the licenses of individual models when distributing.

## Contributing

Contributions welcome! Areas for contribution:
- New input plugins (Spotify, Apple Music, etc.)
- Additional AI models
- UI/UX improvements
- Mobile app features
- Documentation
