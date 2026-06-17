import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';

const BACKEND_URL = 'http://localhost:3001';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [bulkDelay, setBulkDelay] = useState(2); // default 2 seconds
  const [autoResponseDelay, setAutoResponseDelay] = useState(3); // default 3 seconds
  
  // Form states
  const [numbersInput, setNumbersInput] = useState('');
  const [message, setMessage] = useState('');
  const [captionMode, setCaptionMode] = useState(true);
  
  // Media states
  const [mediaFile, setMediaFile] = useState(null); // { name, size, type, data (base64) }
  const [isDragActive, setIsDragActive] = useState(false);
  
  // Status feedback
  const [statusMessage, setStatusMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const fileInputRef = useRef(null);
  const dropzoneRef = useRef(null);
  const socketRef = useRef(null);

  // Connect Socket.io
  useEffect(() => {
    socketRef.current = io(BACKEND_URL);

    socketRef.current.on('connect', () => {
      console.log('Connected to backend socket');
    });

    socketRef.current.on('ready', (data) => {
      setIsConnected(data.status);
      if (data.status) {
        setQrCode('');
        setQrCodeUrl(null);
      }
    });

    socketRef.current.on('qr', (data) => {
      setIsConnected(false);
      setQrCode(data.qrCode || '');
      setQrCodeUrl(data.qrCodeUrl);
    });

    // Initial check
    fetch(`${BACKEND_URL}/api/status`)
      .then(res => res.json())
      .then(data => {
        setIsConnected(data.isConnected);
        if (data.qrCode) {
          setQrCode(data.qrCode);
        }
        if (data.qrCodeUrl) {
          setQrCodeUrl(data.qrCodeUrl);
        }
      })
      .catch(err => console.error('Error fetching initial status:', err));

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  // Update auto-response delay on backend
  const handleAutoResponseDelayChange = async (e) => {
    const val = Number(e.target.value);
    setAutoResponseDelay(val);
    try {
      await fetch(`${BACKEND_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delayValue: val })
      });
    } catch (error) {
      console.error('Failed to update config on backend', error);
    }
  };

  // Process selected file to base64
  const processFile = (file) => {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      // Base64 format without data prefix
      const base64Data = e.target.result.split(',')[1];
      setMediaFile({
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
        type: file.type,
        data: base64Data,
        previewUrl: file.type.startsWith('image/') ? e.target.result : null
      });
    };
    reader.readAsDataURL(file);
  };

  // Drag handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  // Paste handler
  const handlePaste = (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let index in items) {
      const item = items[index];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        processFile(file);
        break; // Process first file only
      }
    }
  };

  // Listen to paste events globally or on container
  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, []);

  const handleBrowseClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const removeMediaFile = () => {
    setMediaFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Submit Handler
  const handleSend = async (e) => {
    e.preventDefault();
    if (!numbersInput.trim()) {
      setStatusMessage('⚠️ Por favor ingresa al menos un número.');
      return;
    }

    setIsSending(true);
    setStatusMessage('🚀 Procesando envío masivo...');

    const numbersArray = numbersInput.split(',').map(n => n.trim()).filter(Boolean);

    const payload = {
      numbers: numbersArray,
      message: message,
      bulkDelay: bulkDelay,
      captionMode: captionMode,
      media: mediaFile ? {
        mimetype: mediaFile.type,
        data: mediaFile.data,
        filename: mediaFile.name
      } : null
    };

    try {
      const response = await fetch(`${BACKEND_URL}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      if (result.success) {
        setStatusMessage(`✅ Trabajo de envío masivo iniciado para ${numbersArray.length} números.`);
      } else {
        setStatusMessage(`❌ Error: ${result.error || 'No se pudo iniciar el envío.'}`);
      }
    } catch (err) {
      console.error(err);
      setStatusMessage('❌ Error al conectar con el servidor.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1 className="app-title">WhatsApp Bot & Bulk Sender</h1>
        <p className="app-subtitle">Panel de control del chatbot y envío de campañas multimedia automatizadas</p>
      </header>

      <div className="dashboard-grid">
        {/* Left Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Connection Panel */}
          <div className="glass-card">
            <h2 className="card-title">
              <span>🔌 Estado de Conexión</span>
            </h2>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <span className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
                <span className="status-dot"></span>
                {isConnected ? 'Conectado' : 'Desconectado'}
              </span>
            </div>
            
            {!isConnected && (
              <div className="qr-container">
                {qrCode ? (
                  <>
                    <div style={{ background: 'white', padding: '1rem', borderRadius: 'var(--radius-md)', display: 'inline-flex' }}>
                      <QRCodeSVG value={qrCode} size={180} />
                    </div>
                    <p className="qr-text">Escanea este código con tu celular en WhatsApp Web para vincular la sesión.</p>
                  </>
                ) : qrCodeUrl ? (
                  <>
                    <img src={qrCodeUrl} className="qr-image" alt="WhatsApp QR Code" />
                    <p className="qr-text">Escanea este código con tu celular en WhatsApp Web para vincular la sesión.</p>
                  </>
                ) : (
                  <p className="qr-text" style={{ color: 'var(--text-secondary)' }}>
                    Generando código QR... Por favor espera.
                  </p>
                )}
              </div>
            )}
            
            {isConnected && (
              <div style={{ textAlign: 'center', padding: '1rem', background: 'rgba(16, 185, 129, 0.05)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
                <span style={{ fontSize: '1.5rem' }}>🎉</span>
                <p style={{ fontSize: '0.9rem', color: '#A7F3D0', marginTop: '0.5rem' }}>Tu WhatsApp está listo para recibir auto-respuestas y enviar campañas.</p>
              </div>
            )}
          </div>

          {/* Configuration Panel */}
          <div className="glass-card">
            <h2 className="card-title">
              <span>⚙️ Configuración</span>
            </h2>
            
            <div className="form-group">
              <label className="form-label">Retraso en Envíos Masivos (segundos)</label>
              <input 
                type="number" 
                className="form-input" 
                min="0" 
                max="60"
                value={bulkDelay}
                onChange={(e) => setBulkDelay(Number(e.target.value))}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Tiempo de espera entre cada mensaje en envío masivo.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Escritura en Auto-respuestas (segundos)</label>
              <input 
                type="number" 
                className="form-input" 
                min="0" 
                max="60"
                value={autoResponseDelay}
                onChange={handleAutoResponseDelayChange}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Tiempo de simulación "Escribiendo..." antes de auto-responder.
              </span>
            </div>
            
            <div className="info-box">
              <strong>💡 Auto-respuestas configuradas:</strong>
              <ul style={{ paddingLeft: '1.25rem', marginTop: '0.25rem' }}>
                <li>"hola" → Mensaje de bienvenida</li>
                <li>"precio" → Listado de planes</li>
                <li>"contacto" → Información de soporte</li>
                <li>"pdf" → Envío de catálogo (con Caption)</li>
                <li>"imagen" → Demo de multimedia (Independiente)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Right Main Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Main Campaign Form */}
          <div className="glass-card">
            <h2 className="card-title">
              <span>🚀 Enviar Mensaje Masivo</span>
            </h2>
            
            <form onSubmit={handleSend}>
              
              <div className="form-group">
                <label className="form-label">Números Telefónicos (Separados por coma)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ej: 5219998887766, 5219992223344"
                  value={numbersInput}
                  onChange={(e) => setNumbersInput(e.target.value)}
                  disabled={isSending}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Incluye el código de país (ej: 521 para México, 34 para España) sin espacios ni símbolos (+).
                </span>
              </div>

              {/* Advanced Dropzone Container */}
              <div className="form-group">
                <label className="form-label">Archivo Multimedia</label>
                <div 
                  ref={dropzoneRef}
                  className={`dropzone-container ${isDragActive ? 'drag-active' : ''}`}
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={handleBrowseClick}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                    accept="image/*,application/pdf,video/*"
                  />
                  <span className="dropzone-icon">📁</span>
                  <p className="dropzone-text">Arrastra y suelta un archivo aquí, o haz clic para examinar</p>
                  <p className="dropzone-hint">Soporta Imágenes, PDFs y Videos (también puedes pegar capturas con Ctrl+V)</p>
                </div>

                {/* Preview Panel */}
                {mediaFile && (
                  <div className="preview-container">
                    {mediaFile.previewUrl ? (
                      <img src={mediaFile.previewUrl} className="preview-thumbnail" alt="Preview" />
                    ) : (
                      <div className="preview-icon-placeholder">
                        {mediaFile.type.includes('pdf') ? '📄' : '🎥'}
                      </div>
                    )}
                    <div className="preview-details">
                      <p className="preview-name">{mediaFile.name}</p>
                      <p className="preview-size">{mediaFile.size}</p>
                    </div>
                    <button type="button" className="preview-remove" onClick={removeMediaFile} title="Remover archivo">
                      🗑️
                    </button>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Mensaje o Texto</label>
                <textarea 
                  className="form-textarea"
                  placeholder="Escribe el cuerpo del mensaje..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={isSending}
                ></textarea>
              </div>

              {mediaFile && (
                <div className="toggle-group">
                  <div className="toggle-label-container">
                    <span className="toggle-title">Modo de Texto en Multimedia</span>
                    <span className="toggle-desc">
                      {captionMode ? 'Enviar mensaje como Caption (pie de foto)' : 'Enviar archivo y texto por separado'}
                    </span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={captionMode} 
                      onChange={(e) => setCaptionMode(e.target.checked)}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              )}

              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={isSending || !isConnected}
              >
                {isSending ? 'Enviando...' : 'Iniciar Envío Masivo'}
              </button>

              {statusMessage && (
                <div className={statusMessage.startsWith('❌') ? 'info-box' : 'success-toast'} style={{ borderColor: statusMessage.startsWith('❌') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: statusMessage.startsWith('❌') ? '#FCA5A5' : '#A7F3D0' }}>
                  {statusMessage}
                </div>
              )}
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
