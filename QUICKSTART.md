# Quick Start Guide

## 1. Install (One-time)
```bash
./setup.sh
```

## 2. Start Desktop App
```bash
cd desktop-app
npm start
```

## 3. Get Connection Info
- Open settings in desktop app
- Note your IP address (e.g., `192.168.1.100:3000`)
- Or enable Tailscale for remote access

## 4. Start Mobile App
```bash
cd mobile-app
npx expo start
```

## 5. Connect & Create Karaoke
- Enter desktop IP in mobile app
- Paste YouTube URL
- Select model (BS-RoFormer recommended)
- Submit and wait for processing
- Video saved to `~/Karaoke-Output`

## Recommended Models

### For Best Quality (slowest)
- BS-RoFormer (vocals) + Resemble Enhance

### For Fast Processing
- MDX-Net Main

### For Karaoke (no vocals)
- BVE (aufr33) or Karaoke Model

### For Noisy Recordings
- De-Noise → Vocal Removal → De-Reverb

## Tips

- **GPU**: Use NVIDIA GPU for 5-10x speedup
- **Batch**: Process multiple songs overnight
- **Storage**: Each song needs ~500MB temp space
- **RAM**: 16GB minimum, 32GB recommended