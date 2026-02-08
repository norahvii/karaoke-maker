app_jsx = '''import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// Icons (simple SVG components)
const Icons = {
  Music: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  Settings: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6m4.22-10.22l4.24-4.24M6.34 6.34L2.1 2.1m17.9 9.9h6m-6 0H6.34"/></svg>,
  Upload: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Play: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  Pause: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  Check: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>,
  X: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Folder: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  Wifi: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
  Youtube: () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
};

const App = () => {
  const [activeTab, setActiveTab] = useState('queue');
  const [queue, setQueue] = useState([]);
  const [inputUrl, setInputUrl] = useState('');
  const [settings, setSettings] = useState({
    model: 'bs_roformer',
    enhancement: '',
    lyrics: true,
    outputFormat: 'mp4',
    youtubeUpload: false,
    youtubePrivacy: 'private'
  });
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [config, setConfig] = useState(null);
  const [models, setModels] = useState([]);

  // Poll for queue updates
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/status');
        const data = await res.json();
        setConnectionStatus('connected');
        
        const queueRes = await fetch('http://localhost:3000/api/queue');
        const queueData = await queueRes.json();
        setQueue([...queueData.active, ...queueData.queue]);
      } catch (err) {
        setConnectionStatus('disconnected');
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // Load config
  useEffect(() => {
    if (window.electron) {
      window.electron.invoke('get-config').then(setConfig);
    }
    
    // Fetch available models
    fetch('http://localhost:3000/api/models')
      .then(r => r.text())
      .then(text => {
        // Parse the text output from model_manager
        const lines = text.split('\\n').slice(3); // Skip header
        const parsed = lines.filter(l => l.trim()).map(line => {
          const parts = line.trim().split(/\\s{2,}/);
          return {
            id: parts[0],
            downloaded: parts[1]?.includes('Downloaded'),
            name: parts[2]
          };
        });
        setModels(parsed);
      })
      .catch(console.error);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    try {
      const res = await fetch('http://localhost:3000/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: inputUrl,
          options: settings
        })
      });
      
      if (res.ok) {
        setInputUrl('');
        // Refresh queue
        const queueRes = await fetch('http://localhost:3000/api/queue');
        const queueData = await queueRes.json();
        setQueue([...queueData.active, ...queueData.queue]);
      } else {
        const err = await res.json();
        alert('Error: ' + err.error);
      }
    } catch (err) {
      alert('Failed to submit job: ' + err.message);
    }
  };

  const handleFileSelect = async () => {
    if (window.electron) {
      const files = await window.electron.invoke('select-audio-file');
      if (files.length > 0) {
        setInputUrl(files[0]);
      }
    }
  };

  const cancelJob = async (jobId) => {
    try {
      await fetch(`http://localhost:3000/api/job/${jobId}/cancel`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  };

  const openOutputFolder = () => {
    if (window.electron && config?.outputDir) {
      window.electron.invoke('show-item-in-folder', config.outputDir);
    }
  };

  const getStageIcon = (stage) => {
    switch (stage) {
      case 'completed': return <Icons.Check />;
      case 'failed': return <Icons.X />;
      default: return <Icons.Play />;
    }
  };

  const getStageColor = (stage) => {
    switch (stage) {
      case 'completed': return '#10b981';
      case 'failed': return '#ef4444';
      case 'processing': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <Icons.Music />
          <h1>Karaoke Maker</h1>
        </div>
        <div className="connection-status">
          <span className={`status-dot ${connectionStatus}`} />
          {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      <nav className="nav">
        <button 
          className={activeTab === 'queue' ? 'active' : ''}
          onClick={() => setActiveTab('queue')}
        >
          <Icons.Upload /> Queue
        </button>
        <button 
          className={activeTab === 'models' ? 'active' : ''}
          onClick={() => setActiveTab('models')}
        >
          <Icons.Music /> Models
        </button>
        <button 
          className={activeTab === 'settings' ? 'active' : ''}
          onClick={() => setActiveTab('settings')}
        >
          <Icons.Settings /> Settings
        </button>
      </nav>

      <main className="main">
        {activeTab === 'queue' && (
          <div className="queue-tab">
            <form className="input-form" onSubmit={handleSubmit}>
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Paste YouTube URL or local file path..."
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                />
                <button type="button" className="icon-btn" onClick={handleFileSelect}>
                  <Icons.Folder />
                </button>
                <button type="submit" className="primary-btn">
                  <Icons.Upload /> Add to Queue
                </button>
              </div>

              <div className="options-row">
                <select 
                  value={settings.model} 
                  onChange={(e) => setSettings({...settings, model: e.target.value})}
                >
                  <option value="bs_roformer">BS-RoFormer (Default)</option>
                  <option value="mdx_net">MDX-Net</option>
                  <option value="vocal_remover">Vocal Remover</option>
                  <option value="demucs">Demucs</option>
                  <option value="bve">BVE (aufr33)</option>
                  <option value="karaoke">Karaoke Model (aufr33)</option>
                </select>

                <select
                  value={settings.enhancement}
                  onChange={(e) => setSettings({...settings, enhancement: e.target.value})}
                >
                  <option value="">No Enhancement</option>
                  <option value="resemble_enhance">Resemble Enhance</option>
                  <option value="apollo">Apollo</option>
                </select>

                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={settings.lyrics}
                    onChange={(e) => setSettings({...settings, lyrics: e.target.checked})}
                  />
                  Generate Lyrics
                </label>

                <select
                  value={settings.outputFormat}
                  onChange={(e) => setSettings({...settings, outputFormat: e.target.value})}
                >
                  <option value="mp4">Video (MP4)</option>
                  <option value="mp3">Audio (MP3)</option>
                  <option value="wav">Audio (WAV)</option>
                </select>
              </div>
            </form>

            <div className="queue-list">
              <h2>Processing Queue ({queue.length})</h2>
              {queue.length === 0 ? (
                <div className="empty-state">
                  <Icons.Music />
                  <p>No jobs in queue</p>
                  <span>Add a YouTube URL or local file to get started</span>
                </div>
              ) : (
                queue.map(job => (
                  <div key={job.id} className={`job-card ${job.status}`}>
                    <div className="job-header">
                      <div className="job-icon" style={{ color: getStageColor(job.stage) }}>
                        {getStageIcon(job.stage)}
                      </div>
                      <div className="job-info">
                        <h3>{job.metadata?.title || job.input}</h3>
                        <span className="job-meta">
                          {job.plugin} • {job.options?.model} • {new Date(job.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="job-actions">
                        {job.status === 'processing' && (
                          <button onClick={() => cancelJob(job.id)} className="icon-btn danger">
                            <Icons.X />
                          </button>
                        )}
                        {job.status === 'completed' && job.outputFiles?.video && (
                          <button onClick={() => window.electron?.invoke('show-item-in-folder', job.outputFiles.video)} className="icon-btn">
                            <Icons.Folder />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{ 
                          width: `${job.progress}%`,
                          background: getStageColor(job.stage)
                        }}
                      />
                    </div>
                    
                    <div className="job-status">
                      <span className="stage">{job.stage}</span>
                      <span className="percentage">{job.progress}%</span>
                    </div>

                    {job.error && (
                      <div className="error-message">{job.error}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'models' && (
          <div className="models-tab">
            <h2>Available Models</h2>
            <p className="subtitle">Download AI models for audio processing</p>
            
            <div className="models-grid">
              {models.map(model => (
                <div key={model.id} className={`model-card ${model.downloaded ? 'downloaded' : ''}`}>
                  <div className="model-header">
                    <h3>{model.name}</h3>
                    <span className={`badge ${model.downloaded ? 'success' : 'pending'}`}>
                      {model.downloaded ? 'Downloaded' : 'Not Downloaded'}
                    </span>
                  </div>
                  <code className="model-id">{model.id}</code>
                  <button 
                    className="secondary-btn"
                    disabled={model.downloaded}
                    onClick={() => fetch('/api/models/download', {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({modelKey: model.id})
                    })}
                  >
                    {model.downloaded ? 'Downloaded' : 'Download'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="settings-tab">
            <h2>Settings</h2>
            
            <div className="settings-section">
              <h3>Paths</h3>
              <div className="setting-item">
                <label>Output Directory</label>
                <div className="path-input">
                  <input type="text" value={config?.outputDir || ''} readOnly />
                  <button onClick={openOutputFolder}><Icons.Folder /></button>
                </div>
              </div>
              
              <div className="setting-item">
                <label>Models Directory</label>
                <input type="text" value={config?.modelsDir || ''} readOnly />
              </div>
            </div>

            <div className="settings-section">
              <h3>Network</h3>
              <div className="setting-item">
                <label>API Port</label>
                <input type="number" value={config?.apiPort || 3000} readOnly />
              </div>
              
              <div className="setting-item checkbox">
                <label>
                  <input type="checkbox" checked={config?.tailscaleEnabled} readOnly />
                  Enable Tailscale (for remote access)
                </label>
              </div>
              
              {config?.tailscaleIp && (
                <div className="info-box">
                  <Icons.Wifi />
                  <div>
                    <strong>Tailscale IP:</strong> {config.tailscaleIp}
                    <p>Use this IP on your mobile device to connect remotely</p>
                  </div>
                </div>
              )}
            </div>

            <div className="settings-section">
              <h3>YouTube Integration</h3>
              <div className="setting-item">
                <button className="secondary-btn">
                  <Icons.Youtube /> Connect YouTube Account
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(<App />);