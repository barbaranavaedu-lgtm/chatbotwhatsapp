const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');

const DEFAULT_DATA = {
    settings: {
        autoResponseDelay: 3,
        bulkDelay: 2,
        defaultCountryCode: ''
    },
    rules: [
        {
            id: 'rule_1',
            triggers: ['hola', 'buenos dias', 'buenas tardes'],
            message: '¡Hola! Soy un bot automatizado. ¿En qué puedo ayudarte hoy?\nEscribe *precio* o *catalogo* para ver ejemplos.',
            media: null,
            captionMode: true
        },
        {
            id: 'rule_2',
            triggers: ['precio', 'costos', 'planes'],
            message: 'Nuestros servicios premium tienen los siguientes costos:\n- Plan Básico: $29 USD/mes\n- Plan Pro: $49 USD/mes\n- Plan Enterprise: Contactar a soporte.',
            media: null,
            captionMode: true
        }
    ]
};

function readDb() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DATA, null, 2), 'utf8');
            return DEFAULT_DATA;
        }
        const raw = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error reading database file, returning default:', error);
        return DEFAULT_DATA;
    }
}

function writeDb(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing database file:', error);
        return false;
    }
}

const db = {
    getSettings() {
        const data = readDb();
        return data.settings;
    },

    saveSettings(newSettings) {
        const data = readDb();
        data.settings = { ...data.settings, ...newSettings };
        writeDb(data);
        return data.settings;
    },

    getRules() {
        const data = readDb();
        return data.rules || [];
    },

    saveRule(rule) {
        const data = readDb();
        if (!data.rules) data.rules = [];
        
        if (rule.id) {
            // Edit
            const idx = data.rules.findIndex(r => r.id === rule.id);
            if (idx !== -1) {
                data.rules[idx] = { ...data.rules[idx], ...rule };
            }
        } else {
            // Create
            rule.id = 'rule_' + Date.now();
            data.rules.push(rule);
        }
        writeDb(data);
        return rule;
    },

    deleteRule(id) {
        const data = readDb();
        if (!data.rules) return false;
        const initialLen = data.rules.length;
        data.rules = data.rules.filter(r => r.id !== id);
        writeDb(data);
        return data.rules.length < initialLen;
    }
};

module.exports = db;
