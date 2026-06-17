import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import * as XLSX from 'xlsx';

const BACKEND_URL = 'http://localhost:3001';

function App() {
  const [activeTab, setActiveTab] = useState('campaign'); // 'campaign' or 'rules'
  
  // Connection states
  const [isConnected, setIsConnected] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  
  // Settings states (backed by DB)
  const [bulkDelay, setBulkDelay] = useState(2);
  const [autoResponseDelay, setAutoResponseDelay] = useState(3);
  const [defaultCountryCode, setDefaultCountryCode] = useState('');
  
  // Campaign Form & Spreadsheet state
  const [message, setMessage] = useState('');
  const [captionMode, setCaptionMode] = useState(true);
  const [excelData, setExcelData] = useState([]); // Array of row objects
  const [headers, setHeaders] = useState([]); // Column names
  const [columnMapping, setColumnMapping] = useState({}); // { colName: 'phone' | 'var' }
  const [phoneColumn, setPhoneColumn] = useState(''); // Column designated as Phone number
  const [manualPasteInput, setManualPasteInput] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  
  // Media states for bulk campaign
  const [mediaFile, setMediaFile] = useState(null); // { name, size, type, data }
  const [isDragActive, setIsDragActive] = useState(false);
  
  // Rules State
  const [rules, setRules] = useState([]);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [ruleTriggers, setRuleTriggers] = useState('');
  const [ruleMessage, setRuleMessage] = useState('');
  const [ruleMedia, setRuleMedia] = useState(null); // rule-specific media
  const [ruleCaptionMode, setRuleCaptionMode] = useState(true);
  const [isRuleDragActive, setIsRuleDragActive] = useState(false);
  
  // Status feedback
  const [statusMessage, setStatusMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const fileInputRef = useRef(null);
  const ruleFileInputRef = useRef(null);
  const textareaRef = useRef(null);
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

    // Initial check & load DB settings
    fetch(`${BACKEND_URL}/api/status`)
      .then(res => res.json())
      .then(data => {
        setIsConnected(data.isConnected);
        if (data.qrCode) setQrCode(data.qrCode);
        if (data.qrCodeUrl) setQrCodeUrl(data.qrCodeUrl);
      })
      .catch(err => console.error('Error fetching initial status:', err));

    fetch(`${BACKEND_URL}/api/config`)
      .then(res => res.json())
      .then(data => {
        setBulkDelay(data.bulkDelay);
        setAutoResponseDelay(data.autoResponseDelay);
        setDefaultCountryCode(data.defaultCountryCode || '');
      })
      .catch(err => console.error('Error fetching config:', err));

    loadRules();

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  // Fetch Rules from DB
  const loadRules = () => {
    fetch(`${BACKEND_URL}/api/rules`)
      .then(res => res.json())
      .then(data => setRules(data))
      .catch(err => console.error('Error fetching rules:', err));
  };

  // Update Settings in DB
  const handleSaveSettings = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bulkDelay,
          autoResponseDelay,
          defaultCountryCode
        })
      });
      const data = await res.json();
      if (data.success) {
        showTemporaryStatus('✅ Configuración guardada en base de datos.');
      }
    } catch (error) {
      console.error(error);
      showTemporaryStatus('❌ Error al guardar configuración.');
    }
  };

  const showTemporaryStatus = (msg) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage('');
    }, 4000);
  };

  // Helper to convert File object to Base64 data block
  const fileToBase64 = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Data = e.target.result.split(',')[1];
        resolve({
          name: file.name,
          type: file.type,
          data: base64Data,
          previewUrl: file.type.startsWith('image/') ? e.target.result : null
        });
      };
      reader.readAsDataURL(file);
    });
  };

  // Drag handlers for campaign files
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const fileData = await fileToBase64(e.dataTransfer.files[0]);
      setMediaFile(fileData);
    }
  };

  // Drag handlers for rules creator
  const handleRuleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRuleDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleRuleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRuleDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const fileData = await fileToBase64(e.dataTransfer.files[0]);
      setRuleMedia(fileData);
    }
  };

  // Paste handlers (Ctrl + V)
  const handlePaste = async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let index in items) {
      const item = items[index];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        const fileData = await fileToBase64(file);
        if (activeTab === 'campaign') {
          setMediaFile(fileData);
        } else {
          setRuleMedia(fileData);
        }
        break;
      }
    }
  };

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [activeTab]);

  // Excel / CSV file parsing
  const handleSpreadsheetFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
      processParsedGrid(data);
    };
    reader.readAsBinaryString(file);
  };

  // Excel Direct Clipboard rows parsing
  const handleParseClipboardText = () => {
    if (!manualPasteInput.trim()) return;
    // Split rows by newline and columns by tab (typical excel copy)
    const rows = manualPasteInput.split('\n').map(row => row.split('\t'));
    processParsedGrid(rows);
    setShowPasteBox(false);
    setManualPasteInput('');
  };

  // Auto-detect columns, maps fields
  const processParsedGrid = (grid) => {
    if (grid.length === 0) return;
    
    // Extrapolate headers
    const cols = grid[0].map(h => (h || '').toString().trim()).filter(Boolean);
    setHeaders(cols);
    
    const rows = [];
    for (let r = 1; r < grid.length; r++) {
      const rowArr = grid[r];
      if (rowArr.length === 0 || (rowArr.length === 1 && !rowArr[0])) continue;
      
      const rowObj = {};
      cols.forEach((h, index) => {
        rowObj[h] = (rowArr[index] || '').toString().trim();
      });
      rows.push(rowObj);
    }
    setExcelData(rows);

    // Auto-detect phone column and other types
    const initialMapping = {};
    let detectedPhone = '';
    
    cols.forEach(col => {
      // Sample values to detect data type
      const samples = rows.slice(0, 5).map(r => r[col] || '');
      
      const isPhonePattern = samples.some(val => {
        const cleaned = val.replace(/[^\d]/g, '');
        return cleaned.length >= 8 && cleaned.length <= 15;
      });

      const isEmailPattern = samples.some(val => val.includes('@') && val.includes('.'));
      
      if (isPhonePattern && !detectedPhone) {
        initialMapping[col] = 'phone';
        detectedPhone = col;
      } else if (isEmailPattern) {
        initialMapping[col] = 'correo';
      } else if (col.toLowerCase().includes('nombre') || col.toLowerCase().includes('name')) {
        initialMapping[col] = 'nombre';
      } else {
        initialMapping[col] = col.toLowerCase().replace(/\s+/g, '_');
      }
    });

    setColumnMapping(initialMapping);
    setPhoneColumn(detectedPhone || cols[0]);
  };

  const handleColumnMapChange = (colName, mapTo) => {
    const updated = { ...columnMapping, [colName]: mapTo };
    setColumnMapping(updated);
    
    if (mapTo === 'phone') {
      // Ensure only one column is set as phone JID source
      Object.keys(updated).forEach(k => {
        if (k !== colName && updated[k] === 'phone') {
          updated[k] = k.toLowerCase().replace(/\s+/g, '_');
        }
      });
      setPhoneColumn(colName);
    }
  };

  // Message tag insertion at cursor
  const insertVariableTag = (tagName) => {
    const tag = `{{${tagName}}}`;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    const textBefore = message.substring(0, startPos);
    const textAfter = message.substring(endPos, message.length);

    setMessage(textBefore + tag + textAfter);
    
    // Reset cursor focus
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = startPos + tag.length;
    }, 50);
  };

  // Rules CRUD
  const handleSaveRule = async (e) => {
    e.preventDefault();
    if (!ruleTriggers.trim()) return;

    const triggersArray = ruleTriggers.split(',').map(t => t.trim()).filter(Boolean);
    const payload = {
      id: editingRuleId || undefined,
      triggers: triggersArray,
      message: ruleMessage,
      media: ruleMedia,
      captionMode: ruleCaptionMode
    };

    try {
      const res = await fetch(`${BACKEND_URL}/api/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showTemporaryStatus('✅ Regla de auto-respuesta guardada con éxito.');
        setEditingRuleId(null);
        setRuleTriggers('');
        setRuleMessage('');
        setRuleMedia(null);
        setRuleCaptionMode(true);
        loadRules();
      }
    } catch (err) {
      console.error(err);
      showTemporaryStatus('❌ Error al guardar la regla.');
    }
  };

  const handleEditRule = (rule) => {
    setEditingRuleId(rule.id);
    setRuleTriggers(rule.triggers.join(', '));
    setRuleMessage(rule.message);
    setRuleMedia(rule.media);
    setRuleCaptionMode(rule.captionMode);
  };

  const handleDeleteRule = async (id) => {
    if (!window.confirm('¿Seguro que deseas eliminar esta regla?')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/rules/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        showTemporaryStatus('🗑️ Regla eliminada.');
        loadRules();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Submit Campaign
  const handleLaunchCampaign = async (e) => {
    e.preventDefault();
    if (excelData.length === 0) {
      showTemporaryStatus('⚠️ Carga datos de Excel o pega filas de tabla antes de enviar.');
      return;
    }
    if (!phoneColumn) {
      showTemporaryStatus('⚠️ Selecciona qué columna representa el número de teléfono.');
      return;
    }

    setIsSending(true);
    setStatusMessage('🚀 Procesando campaña masiva...');

    // Transform parsed rows to recipient objects
    const recipients = excelData.map(row => {
      const variables = {};
      Object.entries(columnMapping).forEach(([colName, mappedVar]) => {
        if (mappedVar !== 'phone') {
          variables[mappedVar] = row[colName];
        }
      });
      return {
        number: row[phoneColumn],
        variables
      };
    });

    const payload = {
      recipients,
      message,
      media: mediaFile ? {
        mimetype: mediaFile.type,
        data: mediaFile.data,
        filename: mediaFile.name
      } : null,
      bulkDelay: Number(bulkDelay),
      captionMode
    };

    try {
      const response = await fetch(`${BACKEND_URL}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result.success) {
        setStatusMessage(`✅ Campaña de envío masivo iniciada en segundo plano para ${recipients.length} destinatarios.`);
      } else {
        setStatusMessage(`❌ Error: ${result.error || 'No se pudo iniciar la campaña.'}`);
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
        <h1 className="app-title">WhatsApp Campaign Hub</h1>
        <p className="app-subtitle">Campañas masivas personalizadas mediante Excel y reglas de auto-respuesta persistentes</p>
      </header>

      <div className="dashboard-grid">
        
        {/* Left Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Connection Status Panel */}
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
                <p style={{ fontSize: '0.9rem', color: '#A7F3D0', marginTop: '0.5rem' }}>WhatsApp conectado. El chatbot y las campañas están listos para usarse.</p>
              </div>
            )}
          </div>

          {/* Database Persistent Settings Panel */}
          <div className="glass-card">
            <h2 className="card-title">
              <span>⚙️ Configuración (Persistente)</span>
            </h2>
            
            <div className="form-group">
              <label className="form-label">Prefijo / Código País por Defecto</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Ej: 521, 34"
                value={defaultCountryCode}
                onChange={(e) => setDefaultCountryCode(e.target.value)}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Se aplicará a números cargados sin código de país.
              </span>
            </div>

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
            </div>

            <div className="form-group">
              <label className="form-label">Escritura en Auto-respuestas (segundos)</label>
              <input 
                type="number" 
                className="form-input" 
                min="0" 
                max="60"
                value={autoResponseDelay}
                onChange={(e) => setAutoResponseDelay(Number(e.target.value))}
              />
            </div>

            <button type="button" className="btn btn-primary" onClick={handleSaveSettings}>
              Guardar Configuración
            </button>
          </div>
        </div>

        {/* Right Main Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Tab Navigation */}
          <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.5rem' }}>
            <button 
              className={`btn`} 
              style={{ width: 'auto', background: activeTab === 'campaign' ? 'var(--color-primary-glow)' : 'transparent', color: activeTab === 'campaign' ? 'var(--color-primary)' : 'var(--text-secondary)', border: activeTab === 'campaign' ? '1px solid var(--color-primary)' : 'none' }}
              onClick={() => setActiveTab('campaign')}
            >
              📊 Envíos con Excel
            </button>
            <button 
              className={`btn`} 
              style={{ width: 'auto', background: activeTab === 'rules' ? 'var(--color-primary-glow)' : 'transparent', color: activeTab === 'rules' ? 'var(--color-primary)' : 'var(--text-secondary)', border: activeTab === 'rules' ? '1px solid var(--color-primary)' : 'none' }}
              onClick={() => setActiveTab('rules')}
            >
              🤖 Reglas Auto-respuesta
            </button>
          </div>

          {/* TAB 1: Bulk Campaign with Excel */}
          {activeTab === 'campaign' && (
            <div className="glass-card">
              <h2 className="card-title">
                <span>🚀 Campaña Masiva Personalizada</span>
              </h2>

              <div className="form-group" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Cargar Archivo Excel o CSV</label>
                  <input 
                    type="file" 
                    className="form-input" 
                    accept=".xlsx, .xls, .csv" 
                    onChange={handleSpreadsheetFile}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button 
                    type="button" 
                    className="btn" 
                    style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)' }}
                    onClick={() => setShowPasteBox(!showPasteBox)}
                  >
                    📋 Pegar desde Excel
                  </button>
                </div>
              </div>

              {showPasteBox && (
                <div className="form-group" style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-card)' }}>
                  <label className="form-label">Copia y pega las filas de tu hoja de cálculo abajo:</label>
                  <textarea 
                    className="form-textarea" 
                    placeholder="Ejemplo:&#10;Teléfono	Nombre	Correo&#10;5219998887766	Juan Perez	juan@correo.com"
                    value={manualPasteInput}
                    onChange={(e) => setManualPasteInput(e.target.value)}
                  />
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    style={{ marginTop: '0.75rem' }}
                    onClick={handleParseClipboardText}
                  >
                    Procesar Filas Pegadas
                  </button>
                </div>
              )}

              {/* Parsed spreadsheet columns and type mapping visualization */}
              {excelData.length > 0 && (
                <div className="form-group" style={{ background: 'rgba(0, 0, 0, 0.2)', padding: '1rem', borderRadius: 'var(--radius-md)', overflowX: 'auto' }}>
                  <h4 style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--color-accent)' }}>
                    🔍 Datos Detectados ({excelData.length} registros)
                  </h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    Asigna el tipo de dato de cada columna para mapear los números telefónicos y crear etiquetas dinámicas.
                  </p>
                  
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                    <thead>
                      <tr>
                        {headers.map(h => (
                          <th key={h} style={{ padding: '0.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <span>{h}</span>
                              <select 
                                value={columnMapping[h] || ''} 
                                onChange={(e) => handleColumnMapChange(h, e.target.value)}
                                style={{ background: '#1F2937', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', padding: '2px' }}
                              >
                                <option value="phone">📞 Teléfono</option>
                                <option value="nombre">👤 Nombre</option>
                                <option value="correo">📧 Correo</option>
                                <option value="monto">💰 Monto</option>
                                <option value={h.toLowerCase().replace(/\s+/g, '_')}>🏷️ Variable: {h}</option>
                              </select>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {excelData.slice(0, 3).map((row, idx) => (
                        <tr key={idx}>
                          {headers.map(h => (
                            <td key={h} style={{ padding: '0.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)' }}>
                              {row[h]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {excelData.length > 3 && (
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.5rem', textAlign: 'center' }}>
                      Mostrar primeros 3 registros...
                    </p>
                  )}
                </div>
              )}

              {/* Message Editor with click-to-insert variable tags */}
              <form onSubmit={handleLaunchCampaign}>
                <div className="form-group">
                  <label className="form-label">Editor del Mensaje Personalizado</label>
                  {headers.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)' }}>
                      <span style={{ fontSize: '0.8rem', alignSelf: 'center', color: 'var(--text-secondary)' }}>Variables dinámicas:</span>
                      {headers.map(h => {
                        const variableName = columnMapping[h];
                        if (!variableName) return null;
                        return (
                          <button 
                            type="button" 
                            key={h} 
                            className="btn" 
                            style={{ width: 'auto', padding: '3px 8px', fontSize: '0.75rem', background: 'var(--color-primary-glow)', color: 'var(--color-primary)', border: '1px solid rgba(16, 185, 129, 0.2)' }}
                            onClick={() => insertVariableTag(variableName)}
                          >
                            {`{{${variableName}}}`}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  
                  <textarea 
                    ref={textareaRef}
                    className="form-textarea"
                    placeholder="Escribe el cuerpo del mensaje..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Puedes insertar variables dinámicas escribiendo, por ejemplo: Hola {"{{nombre}}"}, tu saldo es de {"{{monto}}"}.
                  </span>
                </div>

                {/* File Attachment Dropzone */}
                <div className="form-group">
                  <label className="form-label">Archivo Multimedia de Campaña (Opcional)</label>
                  <div 
                    className={`dropzone-container ${isDragActive ? 'drag-active' : ''}`}
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current.click()}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        if (e.target.files && e.target.files[0]) {
                          const fileData = await fileToBase64(e.target.files[0]);
                          setMediaFile(fileData);
                        }
                      }}
                      accept="image/*,application/pdf,video/*"
                    />
                    <span className="dropzone-icon">📁</span>
                    <p className="dropzone-text">Arrastra un archivo aquí o haz clic para examinar</p>
                    <p className="dropzone-hint">Imágenes, PDFs o Videos (o presiona Ctrl+V para pegar capturas)</p>
                  </div>

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
                      </div>
                      <button type="button" className="preview-remove" onClick={() => setMediaFile(null)}>
                        🗑️
                      </button>
                    </div>
                  )}
                </div>

                {mediaFile && (
                  <div className="toggle-group">
                    <div className="toggle-label-container">
                      <span className="toggle-title">Modo de Texto en Multimedia</span>
                      <span className="toggle-desc">
                        {captionMode ? 'Mensaje como Caption (pie de foto)' : 'Enviar archivo y texto secuencialmente'}
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
                  {isSending ? 'Enviando Campaña...' : 'Iniciar Campaña Masiva'}
                </button>

                {statusMessage && (
                  <div className={statusMessage.startsWith('❌') ? 'info-box' : 'success-toast'} style={{ borderColor: statusMessage.startsWith('❌') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: statusMessage.startsWith('❌') ? '#FCA5A5' : '#A7F3D0' }}>
                    {statusMessage}
                  </div>
                )}
              </form>
            </div>
          )}

          {/* TAB 2: Persistent Auto-Response Rules */}
          {activeTab === 'rules' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* Form Rule Builder */}
              <div className="glass-card">
                <h2 className="card-title">
                  <span>{editingRuleId ? '✏️ Editar Regla de Auto-respuesta' : '🤖 Crear Regla de Auto-respuesta'}</span>
                </h2>
                <form onSubmit={handleSaveRule}>
                  
                  <div className="form-group">
                    <label className="form-label">Palabras Clave Disparadoras (Separadas por comas)</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Ej: hola, buenas tardes, saludos"
                      value={ruleTriggers}
                      onChange={(e) => setRuleTriggers(e.target.value)}
                      required
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      El bot responderá cuando el mensaje entrante coincida con alguna de estas palabras.
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Texto de la Respuesta</label>
                    <textarea 
                      className="form-textarea" 
                      placeholder="Mensaje automático a enviar..."
                      value={ruleMessage}
                      onChange={(e) => setRuleMessage(e.target.value)}
                    />
                  </div>

                  {/* Rule Media Attachment */}
                  <div className="form-group">
                    <label className="form-label">Adjuntar Archivo de Respuesta (Opcional)</label>
                    <div 
                      className={`dropzone-container ${isRuleDragActive ? 'drag-active' : ''}`}
                      onDragEnter={handleRuleDrag}
                      onDragOver={handleRuleDrag}
                      onDragLeave={handleRuleDrag}
                      onDrop={handleRuleDrop}
                      onClick={() => ruleFileInputRef.current.click()}
                    >
                      <input 
                        type="file" 
                        ref={ruleFileInputRef}
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          if (e.target.files && e.target.files[0]) {
                            const fileData = await fileToBase64(e.target.files[0]);
                            setRuleMedia(fileData);
                          }
                        }}
                        accept="image/*,application/pdf,video/*"
                      />
                      <span className="dropzone-icon">📁</span>
                      <p className="dropzone-text">Arrastra un archivo aquí o haz clic para examinar</p>
                      <p className="dropzone-hint">Soporta imágenes, documentos PDF o videos</p>
                    </div>

                    {ruleMedia && (
                      <div className="preview-container">
                        {ruleMedia.previewUrl ? (
                          <img src={ruleMedia.previewUrl} className="preview-thumbnail" alt="Preview" />
                        ) : (
                          <div className="preview-icon-placeholder">
                            {ruleMedia.type.includes('pdf') ? '📄' : '🎥'}
                          </div>
                        )}
                        <div className="preview-details">
                          <p className="preview-name">{ruleMedia.name}</p>
                        </div>
                        <button type="button" className="preview-remove" onClick={() => setRuleMedia(null)}>
                          🗑️
                        </button>
                      </div>
                    )}
                  </div>

                  {ruleMedia && (
                    <div className="toggle-group">
                      <div className="toggle-label-container">
                        <span className="toggle-title">Modo de Texto en Multimedia</span>
                        <span className="toggle-desc">
                          {ruleCaptionMode ? 'Enviar mensaje como Caption (pie de foto)' : 'Enviar archivo y texto secuencialmente'}
                        </span>
                      </div>
                      <label className="switch">
                        <input 
                          type="checkbox" 
                          checked={ruleCaptionMode} 
                          onChange={(e) => setRuleCaptionMode(e.target.checked)}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                      {editingRuleId ? 'Guardar Cambios' : 'Crear Regla'}
                    </button>
                    {editingRuleId && (
                      <button 
                        type="button" 
                        className="btn" 
                        style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'white', width: 'auto' }}
                        onClick={() => {
                          setEditingRuleId(null);
                          setRuleTriggers('');
                          setRuleMessage('');
                          setRuleMedia(null);
                          setRuleCaptionMode(true);
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Rules List */}
              <div className="glass-card">
                <h2 className="card-title">
                  <span>📋 Reglas Registradas</span>
                </h2>
                
                {rules.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem' }}>
                    No hay reglas creadas en la base de datos.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {rules.map(rule => (
                      <div key={rule.id} style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.5rem' }}>
                            {rule.triggers.map(t => (
                              <span key={t} style={{ padding: '2px 6px', background: 'var(--color-accent-glow)', color: '#93C5FD', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500 }}>
                                {t}
                              </span>
                            ))}
                          </div>
                          <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', whiteSpace: 'pre-line' }}>{rule.message}</p>
                          {rule.media && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-primary)' }}>
                              <span>📎 {rule.media.name}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>
                                ({rule.captionMode ? 'Caption' : 'Separado'})
                              </span>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '1rem' }}>
                          <button type="button" className="btn" style={{ width: 'auto', padding: '4px 8px', fontSize: '0.8rem', background: 'rgba(59, 130, 246, 0.15)', color: '#93C5FD' }} onClick={() => handleEditRule(rule)}>
                            ✏️
                          </button>
                          <button type="button" className="btn" style={{ width: 'auto', padding: '4px 8px', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.15)', color: '#FCA5A5' }} onClick={() => handleDeleteRule(rule.id)}>
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

        </div>

      </div>
    </div>
  );
}

export default App;
