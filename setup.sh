#!/bin/bash
# Karaoke Maker Setup Script

echo "🎤 Karaoke Maker Setup"
echo "======================"

# Check Python version
python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "✓ Python version: $python_version"

# Check Node.js version
node_version=$(node --version 2>&1)
echo "✓ Node.js version: $node_version"

# Create directories
echo "Creating directories..."
mkdir -p ~/.karaoke-app/{models,plugins,temp,logs}
mkdir -p ~/Karaoke-Output

# Install Python dependencies
echo "Installing Python dependencies..."
cd desktop-app/python-pipeline
pip install -r requirements.txt

# Download default models
echo "Downloading default models..."
python model_manager.py --download bs_roformer_vocals || echo "Warning: Failed to download BS-RoFormer"
python model_manager.py --download uvr_mdx_main || echo "Warning: Failed to download MDX-Net"

# Install Node.js dependencies
echo "Installing desktop app dependencies..."
cd ../
npm install

# Build renderer
echo "Building desktop app..."
npm run build:renderer

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the application:"
echo "  cd desktop-app && npm start"
echo ""
echo "For development with hot reload:"
echo "  cd desktop-app && npm run dev"
echo ""
echo "Mobile app setup:"
echo "  cd mobile-app && npm install && npx expo start"