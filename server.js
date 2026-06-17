const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Increase payload size limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

const PORT = process.env.PORT || 3001;

// Configuration in memory
let autoResponseDelay = 3; // in seconds
let isConnected = false;
let qrCodeString = null;
let qrCodeUrl = null;

// Helpers
const delay = ms => new Promise(res => setTimeout(res, ms));

// Mini mock files (base64)
const MOCK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const MOCK_PDF = 'JVBERi0xLjEKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nCiAgICAgL1BhZ2VzIDIgMCBSCiAgPj4KZW5kb2JqCjIgMCBvYmoKICA8PCAvVHlwZSAvUGFnZXMKICAgICAvS2lkcyBbIDMgMCBSIF0KICAgICAvQ291bnQgMQogID4+CmVuZG9iagozIDAgb2JqCiAgPDwgL1R5cGUgL1BhZ2UKICAgICAvUGFyZW50IDIgMCBSCiAgICAgL1Jlc291cmNlcyA8PCA+PgogICAgIC9NZWRpYUJveCBbIDAgMCA1OTUgODQyIF0KICA+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNjIgMDAwMDAgbiAKMDAwMDAwMDEyNSAwMDAwMCBuIAp0cmFpbGVyCiAgPDwgL1NpemUgNAogICAgIC9Sb290IDEgMCBSCiAgPj4Kc3RhcnR4cmVmCjIwMwolJUVPRgo=';

// Initialize WhatsApp Web Client
const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1018224536-alpha.html'
    },
    puppeteer: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('QR Code received');
    qrCodeString = qr;
    qrcode.toDataURL(qr, (err, url) => {
        if (!err) {
            qrCodeUrl = url;
            io.emit('qr', { qrCode: qr, qrCodeUrl: url });
        }
    });
});

client.on('ready', () => {
    console.log('WhatsApp client is ready!');
    isConnected = true;
    qrCodeString = null;
    qrCodeUrl = null;
    io.emit('ready', { status: true });
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
    isConnected = false;
    io.emit('ready', { status: false, error: 'Auth Failure' });
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp client disconnected:', reason);
    isConnected = false;
    io.emit('ready', { status: false, error: 'Disconnected' });
    // Re-initialize client
    client.initialize().catch(err => console.error("Re-initialization failed:", err));
});

// Auto-responses
client.on('message', async (msg) => {
    const text = msg.body.toLowerCase().trim();
    const chat = await msg.getChat();

    // Check keywords
    const keywords = ['hola', 'precio', 'contacto', 'pdf', 'imagen'];
    const matchedKeyword = keywords.find(keyword => text.includes(keyword));

    if (matchedKeyword) {
        console.log(`Matched keyword "${matchedKeyword}" from ${msg.from}`);
        
        // Simulating human writing
        await chat.sendStateTyping();
        await delay(autoResponseDelay * 1000);

        try {
            if (matchedKeyword === 'hola') {
                await msg.reply('¡Hola! Soy un bot automatizado. ¿En qué puedo ayudarte hoy?\nEscribe *precio*, *contacto*, *pdf* o *imagen* para ver ejemplos.');
            } else if (matchedKeyword === 'precio') {
                await msg.reply('Nuestros servicios premium tienen los siguientes costos:\n- Plan Básico: $29 USD/mes\n- Plan Pro: $49 USD/mes\n- Plan Enterprise: Contactar a soporte.');
            } else if (matchedKeyword === 'contacto') {
                await msg.reply('Puedes contactar con soporte técnico al correo: soporte@ejemplo.com o llamando al +1-800-555-0199.');
            } else if (matchedKeyword === 'pdf') {
                // PDF Demo - Demonstration of Caption (N/A for PDF usually, but sent as Caption)
                const mediaPdf = new MessageMedia('application/pdf', MOCK_PDF, 'Catalogo.pdf');
                await client.sendMessage(msg.from, mediaPdf, { caption: 'Aquí tienes nuestro catálogo en formato PDF (Caption Mode).' });
            } else if (matchedKeyword === 'imagen') {
                // Image Demo - Demonstration of Independent Mode (Separate message)
                const mediaPng = new MessageMedia('image/png', MOCK_PNG, 'Demo.png');
                // Send media first
                await client.sendMessage(msg.from, mediaPng);
                // Then send text immediately after
                await client.sendMessage(msg.from, 'Esta es la descripción de la imagen enviada de forma independiente.');
            }
        } catch (error) {
            console.error('Error handling auto-response:', error);
        }
    }
});

// Endpoints
app.get('/api/status', (req, res) => {
    res.json({ isConnected, qrCodeUrl, qrCode: qrCodeString });
});

app.post('/api/config', (req, res) => {
    const { delayValue } = req.body;
    if (typeof delayValue === 'number' && delayValue >= 0) {
        autoResponseDelay = delayValue;
        console.log(`autoResponseDelay updated to: ${autoResponseDelay} seconds`);
        return res.json({ success: true, autoResponseDelay });
    }
    return res.status(400).json({ error: 'Invalid delay value' });
});

app.post('/api/send', async (req, res) => {
    const { numbers, message, media, bulkDelay, captionMode } = req.body;
    // captionMode is boolean. true = Caption, false = Independent (Separate)

    if (!Array.isArray(numbers) || numbers.length === 0) {
        return res.status(400).json({ error: 'Numbers list must be a non-empty array' });
    }

    const delayMs = (typeof bulkDelay === 'number' ? bulkDelay : 2) * 1000;
    console.log(`Starting bulk send for ${numbers.length} numbers with delay ${delayMs}ms`);

    // Run in background and respond immediately to avoid API timeout
    res.json({ success: true, message: 'Bulk sending job started.' });

    for (let i = 0; i < numbers.length; i++) {
        let number = numbers[i].replace(/[^\d]/g, '');
        if (!number) continue;

        // format to whatsapp JID
        const formattedNumber = `${number}@c.us`;

        try {
            if (media && media.data) {
                const messageMedia = new MessageMedia(media.mimetype, media.data, media.filename);
                if (captionMode) {
                    // Caption Mode: Combined message
                    await client.sendMessage(formattedNumber, messageMedia, { caption: message });
                } else {
                    // Independent Mode: Send media first, then message
                    await client.sendMessage(formattedNumber, messageMedia);
                    if (message && message.trim()) {
                        await client.sendMessage(formattedNumber, message);
                    }
                }
            } else {
                // Text only
                if (message && message.trim()) {
                    await client.sendMessage(formattedNumber, message);
                }
            }
            console.log(`Successfully sent to ${formattedNumber}`);
        } catch (err) {
            console.error(`Failed to send to ${formattedNumber}:`, err);
        }

        // Apply delay between numbers (but not after the last one)
        if (i < numbers.length - 1) {
            await delay(delayMs);
        }
    }
});

// Socket.io connection events
io.on('connection', (socket) => {
    console.log('Client connected to Socket.io');
    
    // Send initial status
    socket.emit('ready', { status: isConnected });
    if (!isConnected && qrCodeUrl) {
        socket.emit('qr', { qrCode: qrCodeString, qrCodeUrl });
    }

    socket.on('disconnect', () => {
        console.log('Client disconnected from Socket.io');
    });
});

// Start WhatsApp Client
console.log('Initializing WhatsApp client...');
client.initialize().catch(err => {
    console.error('Failed to initialize client:', err);
});

// Start Server
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
