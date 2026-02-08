import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_KEY = '@karaoke_api_base';
const PAIRING_CODE_KEY = '@karaoke_pairing_code';

// Simple icon components
const Icon = ({ name, size = 24, color = '#fff' }) => {
  const icons = {
    music: '🎵',
    upload: '⬆️',
    settings: '⚙️',
    wifi: '📶',
    check: '✓',
    x: '✕',
    clock: '🕐',
    play: '▶️',
    pause: '⏸️',
    folder: '📁',
    link: '🔗'
  };
  return <Text style={{ fontSize: size, color }}>{icons[name] || '•'}</Text>;
};

export default function App() {
  const [apiBase, setApiBase] = useState(null);
  const [pairingCode, setPairingCode] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [settings, setSettings] = useState({
    model: 'bs_roformer',
    enhancement: '',
    lyrics: true,
    outputFormat: 'mp4'
  });
  const [showSettings, setShowSettings] = useState(false);

  // Load saved connection on mount
  useEffect(() => {
    loadConnection();
  }, []);

  // Poll queue when connected
  useEffect(() => {
    if (!apiBase) return;
    
    const pollQueue = async () => {
      try {
        const res = await fetch(`${apiBase}/api/queue`);
        if (res.ok) {
          const data = await res.json();
          setQueue([...data.active, ...data.queue]);
          setConnectionStatus('connected');
        } else {
          setConnectionStatus('error');
        }
      } catch (err) {
        setConnectionStatus('disconnected');
      }
    };

    pollQueue();
    const interval = setInterval(pollQueue, 3000);
    return () => clearInterval(interval);
  }, [apiBase]);

  const loadConnection = async () => {
    try {
      const saved = await AsyncStorage.getItem(API_BASE_KEY);
      if (saved) {
        setApiBase(saved);
      }
    } catch (err) {
      console.error('Failed to load connection:', err);
    }
  };

  const handlePairing = async () => {
    if (!pairingCode.trim()) return;
    
    setLoading(true);
    
    try {
      // Try to connect to desktop app
      // In a real implementation, this would exchange the pairing code for connection details
      // For now, assume the user enters the IP:port directly or we use a default
      
      const testUrls = [
        `http://${pairingCode}`, // User enters IP:port
        'http://localhost:3000',
        'http://127.0.0.1:3000'
      ];
      
      let connected = false;
      for (const url of testUrls) {
        try {
          const res = await fetch(`${url}/api/status`, { timeout: 5000 });
          if (res.ok) {
            await AsyncStorage.setItem(API_BASE_KEY, url);
            setApiBase(url);
            connected = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!connected) {
        Alert.alert('Connection Failed', 'Could not connect to desktop app. Please check the IP address and port.');
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to pair with desktop app');
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    await AsyncStorage.removeItem(API_BASE_KEY);
    setApiBase(null);
    setQueue([]);
  };

  const submitJob = async () => {
    if (!inputUrl.trim()) return;
    
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: inputUrl,
          options: settings
        })
      });
      
      if (res.ok) {
        setInputUrl('');
        Alert.alert('Success', 'Added to processing queue!');
      } else {
        const err = await res.json();
        Alert.alert('Error', err.error || 'Failed to add job');
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to submit job');
    } finally {
      setLoading(false);
    }
  };

  const cancelJob = async (jobId) => {
    try {
      await fetch(`${apiBase}/api/job/${jobId}/cancel`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to cancel:', err);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return '#10b981';
      case 'failed': return '#ef4444';
      case 'processing': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  // Pairing Screen
  if (!apiBase) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
        <View style={styles.pairingContainer}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoIcon}>🎤</Text>
            <Text style={styles.logoText}>Karaoke Maker</Text>
            <Text style={styles.subtitle}>Mobile Controller</Text>
          </View>
          
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Connect to Desktop</Text>
            <Text style={styles.cardText}>
              Enter the IP address shown in your desktop app (e.g., 192.168.1.100:3000)
            </Text>
            
            <TextInput
              style={styles.input}
              placeholder="IP:Port (e.g., 192.168.1.100:3000)"
              placeholderTextColor="#64748b"
              value={pairingCode}
              onChangeText={setPairingCode}
              autoCapitalize="none"
              autoCorrect={false}
            />
            
            <TouchableOpacity 
              style={[styles.button, styles.primaryButton]}
              onPress={handlePairing}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Icon name="link" size={18} />
                  <Text style={styles.buttonText}>Connect</Text>
                </>
              )}
            </TouchableOpacity>
            
            <View style={styles.hintBox}>
              <Icon name="wifi" size={16} color="#3b82f6" />
              <Text style={styles.hintText}>
                Make sure your phone and computer are on the same WiFi network, or use Tailscale for remote access.
              </Text>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Main App Screen
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Karaoke Maker</Text>
          <View style={styles.connectionBadge}>
            <View style={[styles.statusDot, { backgroundColor: getStatusColor(connectionStatus === 'connected' ? 'completed' : 'failed') }]} />
            <Text style={styles.connectionText}>
              {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => setShowSettings(!showSettings)}>
          <Icon name="settings" />
        </TouchableOpacity>
      </View>

      {/* Settings Panel */}
      {showSettings && (
        <View style={styles.settingsPanel}>
          <ScrollView>
            <Text style={styles.settingsTitle}>Processing Options</Text>
            
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Model</Text>
              <View style={styles.pickerContainer}>
                {['bs_roformer', 'mdx_net', 'bve'].map(model => (
                  <TouchableOpacity
                    key={model}
                    style={[styles.pickerOption, settings.model === model && styles.pickerActive]}
                    onPress={() => setSettings({...settings, model})}
                  >
                    <Text style={[styles.pickerText, settings.model === model && styles.pickerTextActive]}>
                      {model}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Enhancement</Text>
              <View style={styles.pickerContainer}>
                {['', 'resemble_enhance', 'apollo'].map(enh => (
                  <TouchableOpacity
                    key={enh || 'none'}
                    style={[styles.pickerOption, settings.enhancement === enh && styles.pickerActive]}
                    onPress={() => setSettings({...settings, enhancement: enh})}
                  >
                    <Text style={[styles.pickerText, settings.enhancement === enh && styles.pickerTextActive]}>
                      {enh || 'None'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Output Format</Text>
              <View style={styles.pickerContainer}>
                {['mp4', 'mp3', 'wav'].map(fmt => (
                  <TouchableOpacity
                    key={fmt}
                    style={[styles.pickerOption, settings.outputFormat === fmt && styles.pickerActive]}
                    onPress={() => setSettings({...settings, outputFormat: fmt})}
                  >
                    <Text style={[styles.pickerText, settings.outputFormat === fmt && styles.pickerTextActive]}>
                      {fmt.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity style={styles.disconnectButton} onPress={disconnect}>
              <Icon name="x" size={16} />
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Input Section */}
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inputSection}
      >
        <View style={styles.inputCard}>
          <TextInput
            style={styles.urlInput}
            placeholder="Paste YouTube URL..."
            placeholderTextColor="#64748b"
            value={inputUrl}
            onChangeText={setInputUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity 
            style={[styles.submitButton, !inputUrl && styles.submitButtonDisabled]}
            onPress={submitJob}
            disabled={!inputUrl || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Icon name="upload" size={20} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Queue List */}
      <View style={styles.queueSection}>
        <Text style={styles.sectionTitle}>
          Queue ({queue.length})
        </Text>
        
        <FlatList
          data={queue}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.queueList}
          renderItem={({ item }) => (
            <View style={styles.jobCard}>
              <View style={styles.jobHeader}>
                <View style={[styles.jobIcon, { backgroundColor: getStatusColor(item.stage) + '20' }]}>
                  <Text style={{ color: getStatusColor(item.stage), fontSize: 18 }}>
                    {item.stage === 'completed' ? '✓' : item.stage === 'processing' ? '▶' : '⏸'}
                  </Text>
                </View>
                <View style={styles.jobInfo}>
                  <Text style={styles.jobTitle} numberOfLines={1}>
                    {item.metadata?.title || item.input}
                  </Text>
                  <Text style={styles.jobMeta}>
                    {item.options?.model} • {new Date(item.createdAt).toLocaleTimeString()}
                  </Text>
                </View>
                {item.status === 'processing' && (
                  <TouchableOpacity onPress={() => cancelJob(item.id)}>
                    <Icon name="x" color="#ef4444" />
                  </TouchableOpacity>
                )}
              </View>
              
              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { 
                        width: `${item.progress}%`,
                        backgroundColor: getStatusColor(item.stage)
                      }
                    ]} 
                  />
                </View>
                <Text style={styles.progressText}>{item.progress}%</Text>
              </View>
              
              <Text style={styles.stageText}>{item.stage}</Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Icon name="music" size={48} color="#475569" />
              <Text style={styles.emptyTitle}>No jobs in queue</Text>
              <Text style={styles.emptyText}>Add a YouTube URL to start</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  
  // Pairing Screen
  pairingContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    marginTop: 8,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    color: '#f1f5f9',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
    gap: 8,
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
  },

  // Main App
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  connectionText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },

  // Settings Panel
  settingsPanel: {
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    maxHeight: 400,
    padding: 16,
  },
  settingsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  settingRow: {
    marginBottom: 16,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#f1f5f9',
    marginBottom: 8,
  },
  pickerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#334155',
    borderRadius: 6,
  },
  pickerActive: {
    backgroundColor: '#3b82f6',
  },
  pickerText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500',
  },
  pickerTextActive: {
    color: '#fff',
  },
  disconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef444420',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    gap: 8,
  },
  disconnectText: {
    color: '#ef4444',
    fontWeight: '600',
  },

  // Input Section
  inputSection: {
    padding: 16,
    backgroundColor: '#0f172a',
  },
  inputCard: {
    flexDirection: 'row',
    gap: 12,
  },
  urlInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    color: '#f1f5f9',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  submitButton: {
    width: 50,
    height: 50,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#334155',
    opacity: 0.5,
  },

  // Queue Section
  queueSection: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  queueList: {
    gap: 12,
    paddingBottom: 24,
  },
  jobCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  jobIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  jobInfo: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: 2,
  },
  jobMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#334155',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    minWidth: 35,
  },
  stageText: {
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  
  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#f1f5f9',
    marginTop: 16,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 14,
    color: '#64748b',
  },
});