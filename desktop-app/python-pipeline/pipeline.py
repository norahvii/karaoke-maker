#!/usr/bin/env python3

"""
Karaoke Maker - Audio Processing Pipeline
Orchestrates multiple AI models for vocal removal and audio enhancement

Models integrated:
- vocal-remover (tsurumeso) - DNN-based vocal separation
- mdx-net-submission (kuielab) - MDX-Net music demixing
- BS-RoFormer (lucidrains) - Band Split RoFormer for source separation
- Demucs (Meta) - General music source separation
- resemble-enhance - Audio enhancement
- Apollo (JusperLee) - Post-processing enhancement

Custom models by community:
- aufr33 (BVE, De-crowd, De-noise, Karaoke, Sax/Wind)
- Anjok07 (UVR GUI models)
- FoxJoy (MDX De-reverb, UVR De-echo)
- @playdasegunda (BS-RoFormer variants)
"""

import os
import sys
import json
import argparse
import tempfile
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import subprocess
import shutil
import librosa
import soundfile as sf
import numpy as np
import torch

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ProcessingStage(Enum):
    DOWNLOAD = "download"
    SEPARATION = "separation"
    ENHANCEMENT = "enhancement"
    LYRICS = "lyrics"
    VIDEO = "video"
    UPLOAD = "upload"

class SeparationModel(Enum):
    VOCAL_REMOVER = "vocal_remover"  # tsurumeso
    MDX_NET = "mdx_net"              # kuielab
    BS_ROFORMER = "bs_roformer"      # lucidrains
    DEMUCS = "demucs"                # Meta
    # Custom models
    BVE = "bve"                      # aufr33
    DECROWD = "decrowd"              # aufr33
    DENOISE = "denoise"              # aufr33
    KARAOKE = "karaoke"              # aufr33
    DEREVERB = "dereverb"            # FoxJoy
    DEECHO = "deecho"                # FoxJoy
    BS_ROFORMER_VOCALS = "bs_roformer_vocals"  # @playdasegunda
    BS_ROFORMER_BASS = "bs_roformer_bass"
    MEL_ROFORMER_GUITAR = "mel_roformer_guitar"

class EnhancementModel(Enum):
    RESEMBLE_ENHANCE = "resemble_enhance"  # resemble-ai
    APOLLO = "apollo"                      # JusperLee

@dataclass
class ProcessingConfig:
    """Configuration for audio processing"""
    input_path: str
    output_dir: str
    separation_model: SeparationModel = SeparationModel.BS_ROFORMER
    enhancement_model: Optional[EnhancementModel] = None
    enable_lyrics: bool = True
    output_format: str = "mp4"  # mp4, mp3, wav
    youtube_title: Optional[str] = None
    youtube_description: Optional[str] = None
    youtube_privacy: str = "private"  # private, unlisted, public
    
    # Model-specific parameters
    vocal_remover_model_path: Optional[str] = None
    mdx_net_model_path: Optional[str] = None
    bs_roformer_model_path: Optional[str] = None
    custom_models_dir: str = "~/.karaoke-app/models"
    
    # Processing options
    extract_instruments: bool = True
    extract_vocals: bool = False  # For acapella
    enhance_quality: bool = True
    normalize_audio: bool = True
    target_lufs: float = -14.0

@dataclass
class ProcessingJob:
    """Represents a single processing job"""
    job_id: str
    config: ProcessingConfig
    status: str = "pending"  # pending, processing, completed, failed
    progress: float = 0.0
    current_stage: Optional[ProcessingStage] = None
    output_files: Dict[str, str] = None
    error_message: Optional[str] = None
    
    def __post_init__(self):
        if self.output_files is None:
            self.output_files = {}

class ModelRegistry:
    """Manages model loading and inference for all supported models"""
    
    def __init__(self, models_dir: str = "~/.karaoke-app/models"):
        self.models_dir = Path(models_dir).expanduser()
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.loaded_models = {}
        
    def get_model_path(self, model_name: str) -> Optional[Path]:
        """Get path to model weights"""
        # Check custom models directory
        custom_path = self.models_dir / f"{model_name}.pth"
        if custom_path.exists():
            return custom_path
        
        # Check default locations
        default_paths = [
            Path(f"models/{model_name}.pth"),
            Path(f"models/{model_name}/model.pth"),
        ]
        for path in default_paths:
            if path.exists():
                return path
        return None
    
    def load_vocal_remover(self, model_path: Optional[str] = None):
        """Load tsurumeso/vocal-remover model"""
        if "vocal_remover" in self.loaded_models:
            return self.loaded_models["vocal_remover"]
        
        try:
            # Import vocal-remover modules
            sys.path.insert(0, str(Path(__file__).parent / "lib" / "vocal-remover"))
            from lib import spec_utils
            from lib.nets import CascadedNet
            
            model = CascadedNet(window_size=512)
            
            if model_path and Path(model_path).exists():
                checkpoint = torch.load(model_path, map_location='cpu')
                model.load_state_dict(checkpoint)
            else:
                # Download pre-trained if not exists
                logger.info("Loading pre-trained vocal-remover model...")
                # Implementation would download from releases
                
            model.eval()
            if torch.cuda.is_available():
                model = model.cuda()
                
            self.loaded_models["vocal_remover"] = model
            return model
        except Exception as e:
            logger.error(f"Failed to load vocal-remover: {e}")
            raise
    
    def load_mdx_net(self, model_path: Optional[str] = None):
        """Load kuielab/mdx-net-submission model"""
        if "mdx_net" in self.loaded_models:
            return self.loaded_models["mdx_net"]
        
        try:
            sys.path.insert(0, str(Path(__file__).parent / "lib" / "mdx-net"))
            import torch
            from models import TFC_TDF_net
            
            # MDX-Net configuration
            config = {
                'num_blocks': 7,
                'lstm_dim': 128,
                'n_fft': 6144,
                'hop_length': 1024,
            }
            
            model = TFC_TDF_net(config)
            
            if model_path and Path(model_path).exists():
                model.load_state_dict(torch.load(model_path, map_location='cpu'))
            
            model.eval()
            if torch.cuda.is_available():
                model = model.cuda()
                
            self.loaded_models["mdx_net"] = model
            return model
        except Exception as e:
            logger.error(f"Failed to load MDX-Net: {e}")
            raise
    
    def load_bs_roformer(self, model_path: Optional[str] = None, variant: str = "default"):
        """Load lucidrains/BS-RoFormer model"""
        cache_key = f"bs_roformer_{variant}"
        if cache_key in self.loaded_models:
            return self.loaded_models[cache_key]
        
        try:
            from bs_roformer import MelBandRoformer
            
            # Configuration based on variant
            configs = {
                "default": {"dim": 512, "depth": 12},
                "vocals": {"dim": 256, "depth": 8},
                "bass": {"dim": 128, "depth": 6},
                "guitar": {"dim": 128, "depth": 6},
            }
            
            cfg = configs.get(variant, configs["default"])
            
            model = MelBandRoformer(
                dim=cfg["dim"],
                depth=cfg["depth"],
                time_transformer_depth=1,
                freq_transformer_depth=1
            )
            
            if model_path and Path(model_path).exists():
                checkpoint = torch.load(model_path, map_location='cpu')
                model.load_state_dict(checkpoint)
                logger.info(f"Loaded BS-RoFormer variant: {variant}")
            
            model.eval()
            if torch.cuda.is_available():
                model = model.cuda()
                
            self.loaded_models[cache_key] = model
            return model
        except Exception as e:
            logger.error(f"Failed to load BS-RoFormer: {e}")
            raise
    
    def load_demucs(self, model_name: str = "htdemucs"):
        """Load Meta/Demucs model"""
        if f"demucs_{model_name}" in self.loaded_models:
            return self.loaded_models[f"demucs_{model_name}"]
        
        try:
            import demucs.pretrained
            from demucs.apply import apply_model
            
            model = demucs.pretrained.get_model(model_name)
            model.eval()
            
            self.loaded_models[f"demucs_{model_name}"] = model
            return model
        except Exception as e:
            logger.error(f"Failed to load Demucs: {e}")
            raise

class AudioProcessor:
    """Main audio processing engine"""
    
    def __init__(self, config: ProcessingConfig):
        self.config = config
        self.model_registry = ModelRegistry(config.custom_models_dir)
        self.temp_dir = Path(tempfile.mkdtemp())
        
    def process(self) -> Dict[str, str]:
        """Run complete processing pipeline"""
        logger.info(f"Starting processing for: {self.config.input_path}")
        
        try:
            # Step 1: Load and prepare audio
            audio, sr = self._load_audio(self.config.input_path)
            
            # Step 2: Source separation (vocal removal)
            if self.config.extract_instruments:
                instrumental = self._separate_audio(audio, sr)
            else:
                instrumental = audio
            
            # Step 3: Enhancement (optional)
            if self.config.enhancement_model:
                instrumental = self._enhance_audio(instrumental, sr)
            
            # Step 4: Normalization
            if self.config.normalize_audio:
                instrumental = self._normalize_audio(instrumental, sr)
            
            # Step 5: Generate lyrics and video (if enabled)
            if self.config.enable_lyrics:
                video_path = self._create_karaoke_video(instrumental, sr)
            else:
                video_path = self._export_audio(instrumental, sr)
            
            # Collect output files
            outputs = {
                "instrumental": str(self.temp_dir / "instrumental.wav"),
                "video": video_path,
            }
            
            if self.config.extract_vocals:
                outputs["vocals"] = str(self.temp_dir / "vocals.wav")
            
            return outputs
            
        except Exception as e:
            logger.error(f"Processing failed: {e}")
            raise
        finally:
            # Cleanup temp files if not in debug mode
            pass
    
    def _load_audio(self, path: str) -> Tuple[np.ndarray, int]:
        """Load audio file"""
        audio, sr = librosa.load(path, sr=None, mono=False)
        if audio.ndim == 1:
            audio = np.stack([audio, audio])
        return audio, sr
    
    def _separate_audio(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Separate vocals from instrumental"""
        model_type = self.config.separation_model
        
        logger.info(f"Using separation model: {model_type.value}")
        
        if model_type == SeparationModel.VOCAL_REMOVER:
            return self._process_vocal_remover(audio, sr)
        elif model_type == SeparationModel.MDX_NET:
            return self._process_mdx_net(audio, sr)
        elif model_type == SeparationModel.BS_ROFORMER:
            return self._process_bs_roformer(audio, sr)
        elif model_type == SeparationModel.DEMUCS:
            return self._process_demucs(audio, sr)
        elif model_type in [SeparationModel.KARAOKE, SeparationModel.BVE]:
            return self._process_custom_model(audio, sr, model_type.value)
        else:
            raise ValueError(f"Unknown model type: {model_type}")
    
    def _process_vocal_remover(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Process with tsurumeso/vocal-remover"""
        model = self.model_registry.load_vocal_remover(self.config.vocal_remover_model_path)
        
        # Convert to mono for processing if needed
        if audio.shape[0] == 2:
            mono = np.mean(audio, axis=0)
        else:
            mono = audio[0]
        
        # Preprocess
        from lib import spec_utils
        X = spec_utils.wave_to_spectrogram(mono, 512, 2048)
        
        # Inference
        with torch.no_grad():
            X_mag = np.abs(X)
            X_mag = torch.from_numpy(X_mag).unsqueeze(0).unsqueeze(0)
            
            if torch.cuda.is_available():
                X_mag = X_mag.cuda()
            
            mask = model(X_mag)
            
            # Apply mask
            mask = mask.cpu().numpy()[0, 0]
            Y = X * mask
        
        # Postprocess
        instrumental = spec_utils.spectrogram_to_wave(Y, 512, 2048)
        
        # Save intermediate
        output_path = self.temp_dir / "instrumental_vr.wav"
        sf.write(output_path, instrumental.T, sr)
        
        return instrumental
    
    def _process_mdx_net(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Process with kuielab/mdx-net"""
        model = self.model_registry.load_mdx_net(self.config.mdx_net_model_path)
        
        # Ensure correct shape
        if audio.ndim == 1:
            audio = np.stack([audio, audio])
        
        # Convert to torch tensor
        audio_tensor = torch.from_numpy(audio).float()
        if torch.cuda.is_available():
            audio_tensor = audio_tensor.cuda()
        
        # Process in chunks if needed
        chunk_size = 352800  # ~8 seconds at 44.1kHz
        overlap = 88200      # ~2 seconds
        
        results = []
        for i in range(0, audio_tensor.shape[1], chunk_size - overlap):
            chunk = audio_tensor[:, i:i+chunk_size]
            if chunk.shape[1] < chunk_size:
                # Pad last chunk
                padding = chunk_size - chunk.shape[1]
                chunk = torch.nn.functional.pad(chunk, (0, padding))
            
            with torch.no_grad():
                separated = model(chunk.unsqueeze(0))
                results.append(separated[0].cpu().numpy())
        
        # Merge chunks (simple average overlap)
        instrumental = np.mean(results, axis=0)
        
        output_path = self.temp_dir / "instrumental_mdx.wav"
        sf.write(output_path, instrumental.T, sr)
        
        return instrumental
    
    def _process_bs_roformer(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Process with lucidrains/BS-RoFormer"""
        # Determine variant based on config
        variant = "default"
        if self.config.separation_model == SeparationModel.BS_ROFORMER_VOCALS:
            variant = "vocals"
        elif self.config.separation_model == SeparationModel.BS_ROFORMER_BASS:
            variant = "bass"
        
        model = self.model_registry.load_bs_roformer(self.config.bs_roformer_model_path, variant)
        
        # Convert to tensor
        audio_tensor = torch.from_numpy(audio).float()
        if torch.cuda.is_available():
            audio_tensor = audio_tensor.cuda()
        
        # BS-RoFormer expects specific input format
        # Process in segments if audio is long
        segment_length = 352800  # ~8 seconds at 44.1kHz
        
        if audio_tensor.shape[1] <= segment_length:
            with torch.no_grad():
                separated = model(audio_tensor.unsqueeze(0))
            instrumental = separated[0].cpu().numpy()
        else:
            # Process segments
            segments = []
            for i in range(0, audio_tensor.shape[1], segment_length):
                segment = audio_tensor[:, i:i+segment_length]
                if segment.shape[1] < segment_length:
                    segment = torch.nn.functional.pad(segment, (0, segment_length - segment.shape[1]))
                
                with torch.no_grad():
                    sep = model(segment.unsqueeze(0))
                    segments.append(sep[0].cpu().numpy())
            
            # Concatenate
            instrumental = np.concatenate(segments, axis=1)
            instrumental = instrumental[:, :audio_tensor.shape[1]]
        
        output_path = self.temp_dir / "instrumental_bsroformer.wav"
        sf.write(output_path, instrumental.T, sr)
        
        return instrumental
    
    def _process_demucs(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Process with Meta/Demucs"""
        from demucs.apply import apply_model
        
        model = self.model_registry.load_demucs()
        
        # Demucs expects shape (batch, channels, time)
        audio_tensor = torch.from_numpy(audio).float().unsqueeze(0)
        if torch.cuda.is_available():
            audio_tensor = audio_tensor.cuda()
        
        with torch.no_grad():
            sources = apply_model(model, audio_tensor, split=True, overlap=0.25)
        
        # sources shape: (batch, n_sources, channels, time)
        # Get instrumental (drums, bass, other - excluding vocals)
        # Demucs order: drums, bass, other, vocals
        instrumental = sources[0, [0, 1, 2]].sum(dim=0).cpu().numpy()
        
        output_path = self.temp_dir / "instrumental_demucs.wav"
        sf.write(output_path, instrumental.T, sr)
        
        return instrumental
    
    def _process_custom_model(self, audio: np.ndarray, sr: int, model_name: str) -> np.ndarray:
        """Process with custom models (aufr33, FoxJoy, etc.)"""
        model_path = self.model_registry.get_model_path(model_name)
        
        if not model_path:
            raise FileNotFoundError(f"Custom model {model_name} not found")
        
        # Load custom model
        # These are typically UVR-compatible ONNX or PyTorch models
        try:
            import onnxruntime as ort
            
            session = ort.InferenceSession(str(model_path))
            
            # Preprocess for the specific model
            # This varies by model type
            
            # Placeholder implementation
            # Real implementation would need model-specific preprocessing
            audio_tensor = torch.from_numpy(audio).float()
            
            # Run inference
            outputs = session.run(None, {"input": audio_tensor.numpy()})
            instrumental = outputs[0]
            
            output_path = self.temp_dir / f"instrumental_{model_name}.wav"
            sf.write(output_path, instrumental.T if instrumental.ndim > 1 else instrumental, sr)
            
            return instrumental
            
        except Exception as e:
            logger.error(f"Failed to process with custom model {model_name}: {e}")
            # Fallback to BS-RoFormer
            return self._process_bs_roformer(audio, sr)
    
    def _enhance_audio(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Enhance audio quality using resemble-enhance or Apollo"""
        model_type = self.config.enhancement_model
        
        logger.info(f"Using enhancement model: {model_type.value}")
        
        if model_type == EnhancementModel.RESEMBLE_ENHANCE:
            return self._process_resemble_enhance(audio, sr)
        elif model_type == EnhancementModel.APOLLO:
            return self._process_apollo(audio, sr)
        else:
            return audio
    
    def _process_resemble_enhance(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Enhance with resemble-ai/resemble-enhance"""
        try:
            from resemble_enhance.enhancer import enhance
            
            # Resemble-enhance works on chunks
            chunk_duration = 10  # seconds
            chunk_samples = chunk_duration * sr
            
            enhanced_segments = []
            for i in range(0, audio.shape[1], chunk_samples):
                chunk = audio[:, i:i+chunk_samples]
                
                # Convert to mono for enhancement if stereo
                if chunk.shape[0] == 2:
                    chunk_mono = np.mean(chunk, axis=0)
                else:
                    chunk_mono = chunk[0]
                
                enhanced = enhance(chunk_mono, sr, solver="midpoint", nfe=64, lambd=0.9)
                
                # If stereo, duplicate to both channels
                if audio.shape[0] == 2:
                    enhanced = np.stack([enhanced, enhanced])
                else:
                    enhanced = enhanced[np.newaxis, :]
                
                enhanced_segments.append(enhanced)
            
            enhanced_audio = np.concatenate(enhanced_segments, axis=1)
            
            output_path = self.temp_dir / "enhanced_resemble.wav"
            sf.write(output_path, enhanced_audio.T, sr)
            
            return enhanced_audio
            
        except Exception as e:
            logger.error(f"Resemble-enhance failed: {e}")
            return audio
    
    def _process_apollo(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Enhance with JusperLee/Apollo"""
        try:
            # Apollo is a deep learning-based speech enhancement model
            # Implementation depends on the specific Apollo version
            
            # Load Apollo model
            sys.path.insert(0, str(Path(__file__).parent / "lib" / "apollo"))
            from models import ApolloModel
            
            model = ApolloModel()
            checkpoint = torch.load(self.model_registry.get_model_path("apollo"), map_location='cpu')
            model.load_state_dict(checkpoint)
            model.eval()
            
            if torch.cuda.is_available():
                model = model.cuda()
            
            # Process
            audio_tensor = torch.from_numpy(audio).float()
            if torch.cuda.is_available():
                audio_tensor = audio_tensor.cuda()
            
            with torch.no_grad():
                enhanced = model(audio_tensor.unsqueeze(0))[0].cpu().numpy()
            
            output_path = self.temp_dir / "enhanced_apollo.wav"
            sf.write(output_path, enhanced.T, sr)
            
            return enhanced
            
        except Exception as e:
            logger.error(f"Apollo enhancement failed: {e}")
            return audio
    
    def _normalize_audio(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Normalize audio to target LUFS"""
        import pyloudnorm as pyln
        
        meter = pyln.Meter(sr)
        
        # Convert to mono for measurement
        if audio.shape[0] == 2:
            mono = np.mean(audio, axis=0)
        else:
            mono = audio[0]
        
        current_lufs = meter.integrated_loudness(mono)
        gain_db = self.config.target_lufs - current_lufs
        gain_linear = 10 ** (gain_db / 20)
        
        normalized = audio * gain_linear
        
        # Prevent clipping
        max_val = np.max(np.abs(normalized))
        if max_val > 1.0:
            normalized = normalized / max_val * 0.99
        
        return normalized
    
    def _create_karaoke_video(self, instrumental: np.ndarray, sr: int) -> str:
        """Create karaoke video with lyrics"""
        # First, generate lyrics using audio transcription
        lyrics_data = self._extract_lyrics(instrumental, sr)
        
        # Create video with ffmpeg
        video_path = str(Path(self.config.output_dir) / f"karaoke_{Path(self.config.input_path).stem}.mp4")
        
        # Save instrumental audio
        audio_path = self.temp_dir / "final_instrumental.wav"
        sf.write(audio_path, instrumental.T, sr)
        
        # Generate karaoke video using ffmpeg with subtitles
        self._generate_video_with_lyrics(audio_path, lyrics_data, video_path)
        
        return video_path
    
    def _extract_lyrics(self, audio: np.ndarray, sr: int) -> List[Dict]:
        """Extract lyrics with timing using Whisper or similar"""
        try:
            import whisper
            
            # Save temp audio for whisper
            temp_path = self.temp_dir / "whisper_input.wav"
            sf.write(temp_path, audio.T, sr)
            
            model = whisper.load_model("large-v2")
            result = model.transcribe(str(temp_path), word_timestamps=True)
            
            lyrics = []
            for segment in result["segments"]:
                for word in segment.get("words", []):
                    lyrics.append({
                        "text": word["word"],
                        "start": word["start"],
                        "end": word["end"]
                    })
            
            return lyrics
        except Exception as e:
            logger.error(f"Lyrics extraction failed: {e}")
            return []
    
    def _generate_video_with_lyrics(self, audio_path: Path, lyrics: List[Dict], output_path: str):
        """Generate MP4 video with lyrics overlay"""
        # Create ASS subtitle file
        ass_path = self.temp_dir / "lyrics.ass"
        self._create_ass_subtitles(lyrics, ass_path)
        
        # Use ffmpeg to burn subtitles into video
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=30:d=3600",
            "-i", str(audio_path),
            "-vf", f"subtitles={ass_path}:force_style='Fontsize=48,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=100'",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "320k",
            "-shortest",
            output_path
        ]
        
        subprocess.run(cmd, check=True)
    
    def _create_ass_subtitles(self, lyrics: List[Dict], output_path: Path):
        """Create ASS format subtitles from lyrics data"""
        header = """[Script Info]
Title: Karaoke
ScriptType: v4.00+
PlayDepth: 0
Timer: 100.0000

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,100,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        
        lines = [header]
        
        for word in lyrics:
            start = self._format_time(word["start"])
            end = self._format_time(word["end"])
            text = word["text"].replace(",", "\\,").replace("{", "\\{").replace("}", "\\}")
            lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")
        
        output_path.write_text("\\n".join(lines), encoding='utf-8')
    
    def _format_time(self, seconds: float) -> str:
        """Format seconds to ASS time format"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        cs = int((seconds % 1) * 100)
        return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"
    
    def _export_audio(self, audio: np.ndarray, sr: int) -> str:
        """Export audio only (no video)"""
        output_path = str(Path(self.config.output_dir) / f"{Path(self.config.input_path).stem}_karaoke.mp3")
        sf.write(output_path, audio.T, sr)
        return output_path


def main():
    parser = argparse.ArgumentParser(description="Karaoke Maker Audio Processing Pipeline")
    parser.add_argument("input", help="Input audio file path")
    parser.add_argument("--output-dir", "-o", default="./output", help="Output directory")
    parser.add_argument("--model", "-m", default="bs_roformer", 
                       choices=[m.value for m in SeparationModel],
                       help="Separation model to use")
    parser.add_argument("--enhance", "-e", choices=[m.value for m in EnhancementModel],
                       help="Enhancement model to use")
    parser.add_argument("--no-lyrics", action="store_true", help="Disable lyrics generation")
    parser.add_argument("--format", "-f", default="mp4", choices=["mp4", "mp3", "wav"],
                       help="Output format")
    parser.add_argument("--config", "-c", help="JSON config file")
    
    args = parser.parse_args()
    
    # Load config from file if provided
    if args.config:
        with open(args.config) as f:
            config_dict = json.load(f)
        config = ProcessingConfig(**config_dict)
    else:
        config = ProcessingConfig(
            input_path=args.input,
            output_dir=args.output_dir,
            separation_model=SeparationModel(args.model),
            enhancement_model=EnhancementModel(args.enhance) if args.enhance else None,
            enable_lyrics=not args.no_lyrics,
            output_format=args.format
        )
    
    # Run processing
    processor = AudioProcessor(config)
    outputs = processor.process()
    
    print(json.dumps(outputs, indent=2))


if __name__ == "__main__":
    main()

