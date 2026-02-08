"""
Model Manager - Downloads and manages AI models for Karaoke Maker
Handles models from HuggingFace, GitHub releases, and direct URLs
"""

import os
import json
import requests
from pathlib import Path
from typing import Dict, List, Optional
from tqdm import tqdm
import hashlib

MODEL_REGISTRY = {
    # Official models
    "vocal_remover": {
        "name": "Vocal Remover (tsurumeso)",
        "source": "github",
        "repo": "tsurumeso/vocal-remover",
        "files": {
            "baseline.pth": "https://github.com/tsurumeso/vocal-remover/releases/download/v6.0.0b4/baseline.pth"
        },
        "type": "vocal_remover"
    },
    
    # aufr33 models
    "aufr33_bve": {
        "name": "BVE (Best Vocal Eliminator) by aufr33",
        "source": "huggingface",
        "url": "https://huggingface.co/aufr33/UVR-BVE/resolve/main/UVR-BVE-4B_SN-44100-1.pth",
        "filename": "UVR-BVE-4B_SN-44100-1.pth",
        "type": "vr_arch",
        "description": "Best Vocal Eliminator for karaoke creation"
    },
    
    "aufr33_karaoke": {
        "name": "Karaoke Model by aufr33",
        "source": "huggingface",
        "url": "https://huggingface.co/aufr33/karaoke/resolve/main/karaoke.pth",
        "filename": "aufr33_karaoke.pth",
        "type": "vr_arch"
    },
    
    "aufr33_decrowd": {
        "name": "De-Crowd by aufr33",
        "source": "huggingface",
        "url": "https://huggingface.co/aufr33/decrowd/resolve/main/decrowd.pth",
        "filename": "aufr33_decrowd.pth",
        "type": "vr_arch"
    },
    
    "aufr33_denoise": {
        "name": "Mel-RoFormer Denoise Aggressive by aufr33",
        "source": "huggingface",
        "url": "https://huggingface.co/jarredou/aufr33_MelBand_Denoise/resolve/main/denoise_mel_band_roformer_aufr33_aggr_sdr_27.9768.ckpt",
        "config_url": "https://huggingface.co/shiromiya/audio-separation-models/resolve/main/mel-denoise/model_mel_band_roformer_denoise.yaml",
        "filename": "denoise_mel_band_roformer_aufr33.ckpt",
        "config_filename": "denoise_mel_band_roformer_aufr33.yaml",
        "type": "mel_band_roformer"
    },
    
    # FoxJoy models
    "foxjoy_reverb": {
        "name": "MDX Reverb HQ by FoxJoy",
        "source": "uvr",
        "url": "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Reverb_HQ_By_FoxJoy.onnx",
        "filename": "Reverb_HQ_By_FoxJoy.onnx",
        "type": "mdx_net"
    },
    
    "foxjoy_deecho_normal": {
        "name": "UVR De-Echo Normal by FoxJoy",
        "source": "uvr",
        "url": "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-De-Echo-Normal.pth",
        "filename": "UVR-De-Echo-Normal.pth",
        "type": "vr_arch"
    },
    
    "foxjoy_deecho_aggressive": {
        "name": "UVR De-Echo Aggressive by FoxJoy",
        "source": "uvr",
        "url": "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-De-Echo-Aggressive.pth",
        "filename": "UVR-De-Echo-Aggressive.pth",
        "type": "vr_arch"
    },
    
    # @playdasegunda models
    "playdasegunda_bs_roformer_vocals": {
        "name": "BS-RoFormer Vocals by @playdasegunda",
        "source": "huggingface",
        "url": "https://huggingface.co/playdasegunda/bs_roformer_vocals/resolve/main/model_bs_roformer_vocals_ep_317_sdr_12.9755.ckpt",
        "config_url": "https://huggingface.co/playdasegunda/bs_roformer_vocals/resolve/main/config_bs_roformer_vocals.yaml",
        "filename": "bs_roformer_vocals.ckpt",
        "config_filename": "bs_roformer_vocals.yaml",
        "type": "bs_roformer"
    },
    
    "playdasegunda_bs_roformer_bass": {
        "name": "BS-RoFormer Bass by @playdasegunda",
        "source": "huggingface",
        "url": "https://huggingface.co/playdasegunda/bs_roformer_bass/resolve/main/model_bs_roformer_bass_ep_200_sdr_14.1223.ckpt",
        "config_filename": "bs_roformer_bass.yaml",
        "type": "bs_roformer"
    },
    
    "playdasegunda_mel_roformer_guitar": {
        "name": "Mel-RoFormer Guitar by @playdasegunda",
        "source": "huggingface",
        "url": "https://huggingface.co/playdasegunda/mel_roformer_guitar/resolve/main/model_mel_band_roformer_guitar_ep_1685_sdr_8.7155.ckpt",
        "config_filename": "mel_roformer_guitar.yaml",
        "type": "mel_band_roformer"
    },
    
    # Anjok07/UVR Models
    "uvr_mdx_main": {
        "name": "UVR-MDX-NET Main",
        "source": "uvr",
        "url": "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR_MDXNET_Main.onnx",
        "filename": "UVR_MDXNET_Main.onnx",
        "type": "mdx_net"
    },
    
    "uvr_mdx_karaoke": {
        "name": "UVR-MDX-NET Karaoke",
        "source": "uvr",
        "url": "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR_MDXNET_KARA.onnx",
        "filename": "UVR_MDXNET_KARA.onnx",
        "type": "mdx_net"
    },
    
    # Demucs models (Meta)
    "demucs_htdemucs": {
        "name": "Demucs v4 Hybrid Transformer",
        "source": "torchhub",
        "repo": "facebookresearch/demucs",
        "model": "htdemucs",
        "type": "demucs"
    },
    
    "demucs_htdemucs_ft": {
        "name": "Demucs v4 Hybrid Transformer Fine-tuned",
        "source": "torchhub",
        "repo": "facebookresearch/demucs",
        "model": "htdemucs_ft",
        "type": "demucs"
    }
}

class ModelManager:
    def __init__(self, models_dir: str = "~/.karaoke-app/models"):
        self.models_dir = Path(models_dir).expanduser()
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.registry_path = self.models_dir / "registry.json"
        self.load_registry()
    
    def load_registry(self):
        """Load downloaded model registry"""
        if self.registry_path.exists():
            with open(self.registry_path) as f:
                self.downloaded = json.load(f)
        else:
            self.downloaded = {}
    
    def save_registry(self):
        """Save downloaded model registry"""
        with open(self.registry_path, "w") as f:
            json.dump(self.downloaded, f, indent=2)
    
    def list_available_models(self) -> Dict[str, dict]:
        """List all available models with download status"""
        result = {}
        for key, info in MODEL_REGISTRY.items():
            result[key] = {
                **info,
                "downloaded": key in self.downloaded,
                "path": self.get_model_path(key) if key in self.downloaded else None
            }
        return result
    
    def download_model(self, model_key: str, force: bool = False) -> Path:
        """Download a model by key"""
        if model_key not in MODEL_REGISTRY:
            raise ValueError(f"Unknown model: {model_key}")
        
        if model_key in self.downloaded and not force:
            print(f"Model {model_key} already downloaded")
            return self.get_model_path(model_key)
        
        model_info = MODEL_REGISTRY[model_key]
        print(f"Downloading {model_info['name']}...")
        
        # Create model directory
        model_dir = self.models_dir / model_key
        model_dir.mkdir(exist_ok=True)
        
        # Download main model file
        if "url" in model_info:
            filepath = self._download_file(
                model_info["url"],
                model_dir / model_info.get("filename", "model.pth")
            )
        
        # Download config if available
        if "config_url" in model_info:
            self._download_file(
                model_info["config_url"],
                model_dir / model_info.get("config_filename", "config.yaml")
            )
        
        # Update registry
        self.downloaded[model_key] = {
            "version": model_info.get("version", "1.0.0"),
            "path": str(model_dir),
            "type": model_info["type"]
        }
        self.save_registry()
        
        print(f"✓ Downloaded {model_info['name']}")
        return model_dir
    
    def _download_file(self, url: str, output_path: Path) -> Path:
        """Download file with progress bar"""
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        total_size = int(response.headers.get('content-length', 0))
        
        with open(output_path, 'wb') as f, tqdm(
            desc=output_path.name,
            total=total_size,
            unit='B',
            unit_scale=True,
            unit_divisor=1024,
        ) as pbar:
            for chunk in response.iter_content(chunk_size=8192):
                size = f.write(chunk)
                pbar.update(size)
        
        return output_path
    
    def get_model_path(self, model_key: str) -> Optional[Path]:
        """Get path to downloaded model"""
        if model_key not in self.downloaded:
            return None
        return Path(self.downloaded[model_key]["path"])
    
    def get_model_for_task(self, task: str) -> Optional[str]:
        """Get recommended model key for a specific task"""
        recommendations = {
            "karaoke": "aufr33_bve",
            "vocals_separation": "playdasegunda_bs_roformer_vocals",
            "bass_separation": "playdasegunda_bs_roformer_bass",
            "guitar_separation": "playdasegunda_mel_roformer_guitar",
            "denoise": "aufr33_denoise",
            "dereverb": "foxjoy_reverb",
            "deecho": "foxjoy_deecho_normal",
            "general": "uvr_mdx_main"
        }
        return recommendations.get(task)
    
    def verify_model(self, model_key: str) -> bool:
        """Verify model files exist and are valid"""
        if model_key not in self.downloaded:
            return False
        
        model_info = self.downloaded[model_key]
        model_dir = Path(model_info["path"])
        
        # Check for expected files based on type
        if model_info["type"] in ["bs_roformer", "mel_band_roformer"]:
            return (model_dir / "model.ckpt").exists() or any(f.suffix == ".ckpt" for f in model_dir.iterdir())
        elif model_info["type"] == "mdx_net":
            return any(f.suffix == ".onnx" for f in model_dir.iterdir())
        elif model_info["type"] == "vr_arch":
            return any(f.suffix == ".pth" for f in model_dir.iterdir())
        
        return model_dir.exists() and any(model_dir.iterdir())
    
    def delete_model(self, model_key: str):
        """Delete a downloaded model"""
        if model_key not in self.downloaded:
            print(f"Model {model_key} not downloaded")
            return
        
        import shutil
        model_dir = Path(self.downloaded[model_key]["path"])
        if model_dir.exists():
            shutil.rmtree(model_dir)
        
        del self.downloaded[model_key]
        self.save_registry()
        print(f"Deleted {model_key}")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Karaoke Maker Model Manager")
    parser.add_argument("--list", "-l", action="store_true", help="List available models")
    parser.add_argument("--download", "-d", help="Download a model by key")
    parser.add_argument("--delete", help="Delete a downloaded model")
    parser.add_argument("--verify", "-v", help="Verify a model")
    parser.add_argument("--recommend", "-r", help="Get recommendation for task (karaoke, vocals_separation, denoise, etc.)")
    
    args = parser.parse_args()
    
    manager = ModelManager()
    
    if args.list:
        models = manager.list_available_models()
        print("\\nAvailable Models:")
        print("-" * 80)
        for key, info in models.items():
            status = "✓ Downloaded" if info["downloaded"] else "  Not downloaded"
            print(f"{key:30} {status:15} {info['name']}")
    
    elif args.download:
        manager.download_model(args.download)
    
    elif args.delete:
        manager.delete_model(args.delete)
    
    elif args.verify:
        valid = manager.verify_model(args.verify)
        print(f"Model {args.verify}: {'Valid' if valid else 'Invalid/Missing'}")
    
    elif args.recommend:
        model_key = manager.get_model_for_task(args.recommend)
        if model_key:
            info = MODEL_REGISTRY[model_key]
            print(f"Recommended for {args.recommend}: {info['name']} ({model_key})")
        else:
            print(f"No recommendation for task: {args.recommend}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()