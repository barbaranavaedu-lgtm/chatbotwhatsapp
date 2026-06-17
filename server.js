const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const db = require('./db');

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

// Load config from Database
let config = db.getSettings();
let isConnected = false;
let qrCodeString = null;
let qrCodeUrl = null;

// Helpers
const delay = ms => new Promise(res => setTimeout(res, ms));

// Format phone numbers
function formatPhoneNumber(number, defaultPrefix = '') {
    let clean = number.replace(/[^\d]/g, '');
    if (!clean) return null;
    
    // If a default prefix is set and the number is short (doesn't start with prefix or is local length), prepend it
    if (defaultPrefix && !clean.startsWith(defaultPrefix) && clean.length <= 10) {
        clean = defaultPrefix + clean;
    }
    
    return `${clean}@c.us`;
}

// Parse templates
function parseTemplate(text, variables = {}) {
    if (!text) return '';
    let parsed = text;
    Object.entries(variables).forEach(([key, val]) => {
        const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
        parsed = parsed.replace(placeholder, val || '');
    });
    return parsed;
}

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

// Auto-responses matching rules from database
client.on('message', async (msg) => {
    const text = msg.body.toLowerCase().trim();
    const chat = await msg.getChat();
    const rules = db.getRules();

    // Find first matching rule
    const matchedRule = rules.find(rule => {
        return rule.triggers.some(trigger => text.includes(trigger.toLowerCase().trim()));
    });

    if (matchedRule) {
        console.log(`Matched rule triggers [${matchedRule.triggers.join(', ')}] from ${msg.from}`);
        
        // Simulating human writing
        await chat.sendStateTyping();
        await delay(config.autoResponseDelay * 1000);

        try {
            if (matchedRule.media && matchedRule.media.data) {
                const messageMedia = new MessageMedia(
                    matchedRule.media.mimetype, 
                    matchedRule.media.data, 
                    matchedRule.media.filename
                );
                if (matchedRule.captionMode) {
                    await client.sendMessage(msg.from, messageMedia, { caption: matchedRule.message });
                } else {
                    await client.sendMessage(msg.from, messageMedia);
                    if (matchedRule.message && matchedRule.message.trim()) {
                        await client.sendMessage(msg.from, matchedRule.message);
                    }
                }
            } else {
                // Text only
                if (matchedRule.message && matchedRule.message.trim()) {
                    await msg.reply(matchedRule.message);
                }
            }
        } catch (error) {
            console.error('Error handling auto-response rule:', error);
        }
    }
});

// API Endpoints

// Status
app.get('/api/status', (req, res) => {
    res.json({ isConnected, qrCodeUrl, qrCode: qrCodeString });
});

// Config Settings
app.get('/api/config', (req, res) => {
    res.json(db.getSettings());
});

app.post('/api/config', (req, res) => {
    const { autoResponseDelay, bulkDelay, defaultCountryCode } = req.body;
    const current = db.getSettings();
    
    const updated = db.saveSettings({
        autoResponseDelay: typeof autoResponseDelay === 'number' ? autoResponseDelay : current.autoResponseDelay,
        bulkDelay: typeof bulkDelay === 'number' ? bulkDelay : current.bulkDelay,
        defaultCountryCode: typeof defaultCountryCode === 'string' ? defaultCountryCode : current.defaultCountryCode
    });
    
    config = updated;
    console.log('Settings updated in DB:', updated);
    res.json({ success: true, settings: updated });
});

// Rules CRUD
app.get('/api/rules', (req, res) => {
    res.json(db.getRules());
});

app.post('/api/rules', (req, res) => {
    const { id, triggers, message, media, captionMode } = req.body;
    if (!Array.isArray(triggers) || triggers.length === 0) {
        return res.status(400).json({ error: 'Triggers must be a non-empty array' });
    }
    const saved = db.saveRule({
        id,
        triggers,
        message: message || '',
        media: media || null,
        captionMode: typeof captionMode === 'boolean' ? captionMode : true
    });
    res.json({ success: true, rule: saved });
});

app.delete('/api/rules/:id', (req, res) => {
    const success = db.deleteRule(req.params.id);
    if (success) {
        return res.json({ success: true });
    }
    return res.status(404).json({ error: 'Rule not found' });
});

// Bulk Campaign Sender
app.post('/api/send', async (req, res) => {
    const { recipients, message, media, bulkDelay, captionMode } = req.body;
    // recipients: Array of { number: '...', variables: { nombre: '...', correo: '...' } }

    if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'Recipients list must be a non-empty array' });
    }

    const currentSettings = db.getSettings();
    const delayMs = (typeof bulkDelay === 'number' ? bulkDelay : currentSettings.bulkDelay) * 1000;
    const prefix = currentSettings.defaultCountryCode || '';

    console.log(`Starting bulk campaign for ${recipients.length} recipients with delay ${delayMs}ms`);

    // Run in background
    res.json({ success: true, message: 'Campaign started in background.' });

    for (let i = 0; i < recipients.length; i++) {
        const item = recipients[i];
        if (!item || !item.number) continue;

        const formattedNumber = formatPhoneNumber(item.number, prefix);
        if (!formattedNumber) continue;

        // Parse custom variables
        const personalMessage = parseTemplate(message, item.variables || {});

        try {
            if (media && media.data) {
                const messageMedia = new MessageMedia(media.mimetype, media.data, media.filename);
                if (captionMode) {
                    await client.sendMessage(formattedNumber, messageMedia, { caption: personalMessage });
                } else {
                    await client.sendMessage(formattedNumber, messageMedia);
                    if (personalMessage && personalMessage.trim()) {
                        await client.sendMessage(formattedNumber, personalMessage);
                    }
                }
            } else {
                if (personalMessage && personalMessage.trim()) {
                    await client.sendMessage(formattedNumber, personalMessage);
                }
            }
            console.log(`Successfully sent campaign message to ${formattedNumber}`);
        } catch (err) {
            console.error(`Failed to send campaign message to ${formattedNumber}:`, err);
        }

        if (i < recipients.length - 1) {
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
