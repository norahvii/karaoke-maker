const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const os = require('os');
const fs = require('fs').promises;
const Store = require('electron-store');

const store = new Store();

class KaraokeApp {
  constructor() {
    this.mainWindow = null;
    this.apiServer = null;
    this.pythonProcess = null;
    this.queue = [];
    this.activeJobs = new Map();
    this.plugins = new Map();
    
    this.config = {
      apiPort: store.get('apiPort', 3000),
      pythonPath: store.get('pythonPath', 'python3'),
      modelsDir: store.get('modelsDir', path.join(os.homedir(), '.karaoke-app', 'models')),
      outputDir: store.get('outputDir', path.join(os.homedir(), 'Karaoke-Output')),
      youtubeClientId: store.get('youtubeClientId', null),
      youtubeClientSecret: store.get('youtubeClientSecret', null),
      tailscaleEnabled: store.get('tailscaleEnabled', false),
      tailscaleIp: store.get('tailscaleIp', null)
    };
  }

  async initialize() {
    await app.whenReady();
    await this.createMainWindow();
    await this.startApiServer();
    await this.loadPlugins();
    this.setupIpcHandlers();
  }

  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      titleBarStyle: 'hiddenInset',
      show: false
    });

    // Load renderer
    const isDev = !app.isPackaged;
    if (isDev) {
      this.mainWindow.loadURL('http://localhost:3001');
      this.mainWindow.webContents.openDevTools();
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  startApiServer() {
    return new Promise((resolve) => {
      const apiApp = express();
      
      apiApp.use(cors());
      apiApp.use(bodyParser.json({ limit: '50mb' }));
      apiApp.use(express.static(path.join(__dirname, '../../public')));

      // API Routes
      this.setupApiRoutes(apiApp);

      this.apiServer = apiApp.listen(this.config.apiPort, '0.0.0.0', () => {
        console.log(`API Server running on port ${this.config.apiPort}`);
        
        // Display connection info
        const interfaces = os.networkInterfaces();
        const addresses = [];
        
        for (const name of Object.keys(interfaces)) {
          for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
              addresses.push(iface.address);
            }
          }
        }
        
        console.log('Local IP addresses:', addresses);
        resolve();
      });
    });
  }

  setupApiRoutes(apiApp) {
    // Status endpoint
    apiApp.get('/api/status', (req, res) => {
      res.json({
        status: 'running',
        version: app.getVersion(),
        queueLength: this.queue.length,
        activeJobs: Array.from(this.activeJobs.keys()),
        config: {
          port: this.config.apiPort,
          tailscaleEnabled: this.config.tailscaleEnabled,
          tailscaleIp: this.config.tailscaleIp
        }
      });
    });

    // Get queue
    apiApp.get('/api/queue', (req, res) => {
      res.json({
        queue: this.queue,
        active: Array.from(this.activeJobs.entries()).map(([id, job]) => ({
          id,
          ...job
        }))
      });
    });

    // Add job to queue
    apiApp.post('/api/process', async (req, res) => {
      const { input, options = {} } = req.body;
      
      if (!input) {
        return res.status(400).json({ error: 'Input URL or path required' });
      }

      // Find appropriate plugin
      const plugin = this.findPluginForInput(input);
      if (!plugin) {
        return res.status(400).json({ 
          error: 'No plugin available to handle this input type',
          availablePlugins: Array.from(this.plugins.keys())
        });
      }

      const jobId = this.generateJobId();
      const job = {
        id: jobId,
        input,
        plugin: plugin.name,
        status: 'pending',
        progress: 0,
        stage: 'queued',
        options: {
          model: options.model || 'bs_roformer',
          enhancement: options.enhancement || null,
          lyrics: options.lyrics !== false,
          outputFormat: options.outputFormat || 'mp4',
          youtubeUpload: options.youtubeUpload || false,
          youtubeTitle: options.youtubeTitle,
          youtubeDescription: options.youtubeDescription,
          youtubePrivacy: options.youtubePrivacy || 'private'
        },
        createdAt: new Date().toISOString(),
        outputFiles: {}
      };

      this.queue.push(job);
      this.processQueue();

      res.json({ jobId, status: 'queued', position: this.queue.length });
    });

    // Get job status
    apiApp.get('/api/job/:id', (req, res) => {
      const job = this.findJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      res.json(job);
    });

    // Cancel job
    apiApp.post('/api/job/:id/cancel', (req, res) => {
      const job = this.findJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      
      if (job.status === 'pending') {
        this.queue = this.queue.filter(j => j.id !== req.params.id);
        job.status = 'cancelled';
      } else if (job.status === 'processing') {
        // Kill Python process if running
        const process = this.activeJobs.get(req.params.id)?.process;
        if (process) {
          process.kill();
        }
        job.status = 'cancelled';
      }
      
      res.json({ success: true });
    });

    // List available models
    apiApp.get('/api/models', async (req, res) => {
      try {
        const models = await this.getAvailableModels();
        res.json(models);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Download model
    apiApp.post('/api/models/download', async (req, res) => {
      const { modelKey } = req.body;
      try {
        const result = await this.downloadModel(modelKey);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get settings
    apiApp.get('/api/settings', (req, res) => {
      res.json(this.config);
    });

    // Update settings
    apiApp.post('/api/settings', (req, res) => {
      const updates = req.body;
      Object.assign(this.config, updates);
      
      // Save to store
      for (const [key, value] of Object.entries(updates)) {
        store.set(key, value);
      }
      
      res.json({ success: true, config: this.config });
    });

    // List plugins
    apiApp.get('/api/plugins', (req, res) => {
      const pluginList = Array.from(this.plugins.entries()).map(([name, plugin]) => ({
        name,
        version: plugin.version,
        canHandle: plugin.canHandle.toString()
      }));
      res.json(pluginList);
    });

    // YouTube OAuth callback
    apiApp.get('/api/youtube/callback', (req, res) => {
      const { code } = req.query;
      this.handleYouTubeCallback(code);
      res.send('Authorization successful! You can close this window.');
    });
  }

  async loadPlugins() {
    const pluginsDir = path.join(os.homedir(), '.karaoke-app', 'plugins');
    
    try {
      const files = await fs.readdir(pluginsDir);
      
      for (const file of files) {
        if (file.endsWith('.js')) {
          try {
            const pluginPath = path.join(pluginsDir, file);
            delete require.cache[require.resolve(pluginPath)];
            const plugin = require(pluginPath);
            
            if (plugin.name && plugin.canHandle && plugin.fetch) {
              this.plugins.set(plugin.name, plugin);
              console.log(`Loaded plugin: ${plugin.name} v${plugin.version || '1.0.0'}`);
            }
          } catch (err) {
            console.error(`Failed to load plugin ${file}:`, err);
          }
        }
      }
    } catch (err) {
      // Plugins directory doesn't exist yet
      console.log('No plugins directory found');
    }

    // Load built-in YouTube plugin if no plugins loaded
    if (this.plugins.size === 0) {
      this.loadBuiltinPlugins();
    }
  }

  loadBuiltinPlugins() {
    // Built-in YouTube plugin using yt-dlp
    const youtubePlugin = {
      name: 'youtube',
      version: '1.0.0',
      canHandle: (input) => {
        return /youtube\.com|youtu\.be/.test(input);
      },
      fetch: async (input) => {
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);
        
        const outputDir = path.join(os.tmpdir(), 'karaoke-downloads');
        await fs.mkdir(outputDir, { recursive: true });
        
        const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');
        
        // Download audio
        const { stdout } = await execPromise(
          `yt-dlp -x --audio-format wav --audio-quality 0 -o "${outputTemplate}" "${input}"`
        );
        
        // Find downloaded file
        const files = await fs.readdir(outputDir);
        const downloadedFile = files.find(f => f.endsWith('.wav'));
        
        if (!downloadedFile) {
          throw new Error('Download failed');
        }
        
        const filePath = path.join(outputDir, downloadedFile);
        
        // Get metadata
        const { stdout: infoStdout } = await execPromise(
          `yt-dlp --print-json --skip-download "${input}"`
        );
        const info = JSON.parse(infoStdout);
        
        return {
          path: filePath,
          metadata: {
            title: info.title,
            artist: info.artist || info.channel,
            duration: info.duration,
            thumbnail: info.thumbnail,
            webpage_url: info.webpage_url
          }
        };
      }
    };

    this.plugins.set('youtube', youtubePlugin);
    
    // Local file plugin
    const localPlugin = {
      name: 'local',
      version: '1.0.0',
      canHandle: (input) => {
        return !input.startsWith('http') && (input.startsWith('/') || input.startsWith('\\\\') || /^[a-zA-Z]:/.test(input));
      },
      fetch: async (input) => {
        if (!await fs.access(input).then(() => true).catch(() => false)) {
          throw new Error('File not found');
        }
        return {
          path: input,
          metadata: {
            title: path.basename(input, path.extname(input))
          }
        };
      }
    };

    this.plugins.set('local', localPlugin);
  }

  findPluginForInput(input) {
    for (const [name, plugin] of this.plugins) {
      if (plugin.canHandle(input)) {
        return plugin;
      }
    }
    return null;
  }

  async processQueue() {
    if (this.activeJobs.size >= 2 || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    
    this.broadcastToRenderer('job-started', job);

    try {
      // Fetch audio using plugin
      this.updateJobProgress(job.id, 10, 'downloading');
      const plugin = this.plugins.get(job.plugin);
      const { path: audioPath, metadata } = await plugin.fetch(job.input);
      
      job.metadata = metadata;
      
      // Run Python pipeline
      await this.runPythonPipeline(job, audioPath);
      
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      this.broadcastToRenderer('job-failed', job);
    }

    // Process next job
    setTimeout(() => this.processQueue(), 1000);
  }

  runPythonPipeline(job, audioPath) {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../python-pipeline/pipeline.py');
      const outputDir = this.config.outputDir;
      
      const args = [
        scriptPath,
        audioPath,
        '--output-dir', outputDir,
        '--model', job.options.model,
        '--format', job.options.outputFormat
      ];

      if (job.options.enhancement) {
        args.push('--enhance', job.options.enhancement);
      }

      if (!job.options.lyrics) {
        args.push('--no-lyrics');
      }

      const process = spawn(this.config.pythonPath, args, {
        env: {
          ...process.env,
          KARAOKE_MODELS_DIR: this.config.modelsDir,
          KARAOKE_JOB_ID: job.id
        }
      });

      this.activeJobs.set(job.id, { process, job });

      let outputData = '';
      let errorData = '';

      process.stdout.on('data', (data) => {
        outputData += data.toString();
        
        // Parse progress updates
        const lines = data.toString().split('\\n');
        for (const line of lines) {
          if (line.includes('PROGRESS:')) {
            const match = line.match(/PROGRESS:(\\d+):(.*)/);
            if (match) {
              this.updateJobProgress(job.id, parseInt(match[1]), match[2]);
            }
          }
        }
      });

      process.stderr.on('data', (data) => {
        errorData += data.toString();
        console.error(`Python stderr: ${data}`);
      });

      process.on('close', (code) => {
        this.activeJobs.delete(job.id);

        if (code === 0) {
          try {
            const outputs = JSON.parse(outputData);
            job.status = 'completed';
            job.progress = 100;
            job.stage = 'completed';
            job.outputFiles = outputs;
            job.completedAt = new Date().toISOString();
            
            // Upload to YouTube if requested
            if (job.options.youtubeUpload) {
              this.uploadToYouTube(job);
            }
            
            this.broadcastToRenderer('job-completed', job);
            resolve(outputs);
          } catch (err) {
            reject(new Error('Failed to parse pipeline output'));
          }
        } else {
          reject(new Error(`Pipeline failed with code ${code}: ${errorData}`));
        }
      });
    });
  }

  updateJobProgress(jobId, progress, stage) {
    const job = this.findJob(jobId);
    if (job) {
      job.progress = progress;
      job.stage = stage;
      this.broadcastToRenderer('job-progress', { jobId, progress, stage });
    }
  }

  findJob(jobId) {
    // Check active jobs
    const active = this.activeJobs.get(jobId)?.job;
    if (active) return active;
    
    // Check queue
    return this.queue.find(j => j.id === jobId);
  }

  generateJobId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  broadcastToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  setupIpcHandlers() {
    // File dialog
    ipcMain.handle('select-audio-file', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      return result.filePaths;
    });

    // Select output directory
    ipcMain.handle('select-output-dir', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openDirectory']
      });
      if (result.filePaths[0]) {
        this.config.outputDir = result.filePaths[0];
        store.set('outputDir', this.config.outputDir);
      }
      return result.filePaths[0];
    });

    // Open file manager
    ipcMain.handle('show-item-in-folder', (event, filePath) => {
      shell.showItemInFolder(filePath);
    });

    // Get config
    ipcMain.handle('get-config', () => this.config);

    // Set config
    ipcMain.handle('set-config', (event, updates) => {
      Object.assign(this.config, updates);
      for (const [key, value] of Object.entries(updates)) {
        store.set(key, value);
      }
      return this.config;
    });

    // Reload plugins
    ipcMain.handle('reload-plugins', async () => {
      this.plugins.clear();
      await this.loadPlugins();
      return Array.from(this.plugins.keys());
    });
  }

  async getAvailableModels() {
    // Run model_manager.py to get available models
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../python-pipeline/model_manager.py');
      const process = spawn(this.config.pythonPath, [scriptPath, '--list']);
      
      let output = '';
      process.stdout.on('data', (data) => output += data);
      process.on('close', () => resolve(output));
      process.on('error', reject);
    });
  }

  async downloadModel(modelKey) {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../python-pipeline/model_manager.py');
      const process = spawn(this.config.pythonPath, [scriptPath, '--download', modelKey]);
      
      let output = '';
      process.stdout.on('data', (data) => output += data);
      process.on('close', (code) => {
        if (code === 0) resolve({ success: true, output });
        else reject(new Error(output));
      });
    });
  }

  async uploadToYouTube(job) {
    // YouTube upload implementation using OAuth2
    // This would use the googleapis library
    console.log('Uploading to YouTube:', job.id);
    // Implementation omitted for brevity
  }

  handleYouTubeCallback(code) {
    // Exchange code for tokens and save
    console.log('YouTube auth code received:', code);
  }
}

// Initialize app
const karaokeApp = new KaraokeApp();
karaokeApp.initialize().catch(console.error);

// App event handlers
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (karaokeApp.mainWindow === null) {
    karaokeApp.createMainWindow();
  }
});

app.on('before-quit', () => {
  // Cleanup
  if (karaokeApp.apiServer) {
    karaokeApp.apiServer.close();
  }
  for (const [id, { process }] of karaokeApp.activeJobs) {
    process.kill();
  }
});
