const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configs
const CIABRA_API = 'https://api.az.center';
const PUBLIC_KEY = 'ad9e100fd48020871b32e216ef80db54d568e28086f4f55d9daa';
const SECRET_KEY = '2dd276e121aad993328c';
const AUTH_TOKEN = Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString('base64');

const FASTDEPIX_API = 'https://fastdepix.space/api/v1';
const FASTDEPIX_KEY = 'fdpx_43ea7e43d457193da13ef4f3ea6c9d4ab323343b462d17729bc6b33b458c6f19';

// Persistência de Configuração
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {
        console.error("Erro ao ler config:", e);
    }
    return { gateway: 'ciabra' }; // Default
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve arquivos estáticos

// --- Settings Endpoints ---
app.get('/api/settings', (req, res) => {
    res.json(loadConfig());
});

app.post('/api/settings', (req, res) => {
    const { gateway } = req.body;
    if (!['ciabra', 'fastdepix'].includes(gateway)) {
        return res.status(400).json({ error: 'Gateway inválido' });
    }

    try {
        saveConfig({ gateway });
        console.log(`[SETTINGS] Gateway alterado para: ${gateway}`);
        res.json({ success: true, gateway });
    } catch (e) {
        console.error("[SETTINGS] Erro ao salvar config:", e);
        res.status(500).json({ error: `Erro ao salvar: ${e.message}` });
    }
});

// Proxy para criar cliente
app.post('/api/customers', async (req, res) => {
    try {
        const response = await fetch(`${CIABRA_API}/invoices/applications/customers`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${AUTH_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Utilitários para FastDePix Limit Bypass ---
function generateRandomCPF() {
    const randomDigit = () => Math.floor(Math.random() * 10);
    const cpf = Array.from({ length: 9 }, randomDigit);

    const calculateDigit = (cpf, factor) => {
        let total = 0;
        for (let i = 0; i < factor - 1; i++) {
            total += cpf[i] * (factor - i);
        }
        const remainder = total % 11;
        return remainder < 2 ? 0 : 11 - remainder;
    };

    cpf.push(calculateDigit(cpf, 10));
    cpf.push(calculateDigit(cpf, 11));

    // Formata CPF apenas com números ou . - dependendo da API.
    // A maioria aceita limpo. Vamos mandar string.
    return cpf.join('');
}

function generateRandomUser() {
    const suffix = Math.floor(Math.random() * 10000);
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    return {
        name: `Cliente ${timestamp}_${suffix}`,
        cpf_cnpj: generateRandomCPF(),
        email: `cliente${timestamp}${suffix}@anonymous.com`,
        phone: "11999999999"
    };
}

// Proxy para criar cobrança (Híbrido)
app.post('/api/invoices', async (req, res) => {
    const config = loadConfig();
    const gateway = config.gateway;
    const body = req.body;

    console.log(`[CHECKOUT] Iniciando transação via ${gateway.toUpperCase()} - Valor: ${body.price}`);

    try {
        if (gateway === 'fastdepix') {
            // --- FASTDEPIX IMPLEMENTATION ---
            // Bypass 500 BRL limit by always sending user data
            const randomUser = generateRandomUser();

            const payload = {
                amount: body.price,
                custom_page_id: null,
                user: {
                    name: randomUser.name,
                    cpf_cnpj: randomUser.cpf_cnpj,
                    email: randomUser.email,
                    user_type: "individual" // Required by some APIs
                }
            };

            console.log(`[FASTDEPIX] Sending Payload with Generated User:`, JSON.stringify(payload.user));

            const response = await fetch(`${FASTDEPIX_API}/transactions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${FASTDEPIX_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('[FASTDEPIX] Erro:', JSON.stringify(data));
                return res.status(response.status).json(data);
            }

            // Normalize response to match Frontend expectations (partially)
            // Frontend expects { id, ... }
            // FastDePix returns { data: { id, qr_code_text, ... } } or direct

            const tx = data.data || data; // Handle wrapper

            // FastDePix might not return an image URL, only the text code.
            // We can generate a QR code URL using a public API for the frontend to display easily
            const qrCodeUrl = tx.qr_code || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(tx.qr_code_text)}`;

            // Return a normalized structure that our Checkout JS can handle?
            // Or assume Checkout JS will just read ID and redirect.
            // But Checkout JS usually fetches Invoice Details next.
            // Let's ensure ID is compatible.

            return res.status(201).json({
                id: tx.id,
                gateway: 'fastdepix',
                pix_code: tx.qr_code_text, // Add extra fields for convenience
                pix_url: qrCodeUrl
            });

        } else {
            // --- CIABRA IMPLEMENTATION ---
            const response = await fetch(`${CIABRA_API}/invoices/applications/invoices`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${AUTH_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();
            if (data.id) data.gateway = 'ciabra'; // Tag it properly
            res.status(response.status).json(data);
        }

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy para detalhes da cobrança (Híbrido)
// Helper to fetch from FastDePix
async function fetchFromFastDePix(invoiceId) {
    const url = `${FASTDEPIX_API}/transactions/${invoiceId}`;
    console.log(`[PROXY] Fetching FastDePix: ${url}`);
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${FASTDEPIX_KEY}` } });

    if (response.ok) {
        const json = await response.json();
        const tx = json.data || json;
        console.log(`[FASTDEPIX] Success Response:`, JSON.stringify(tx, null, 2));
        return {
            id: tx.id,
            gateway: 'fastdepix',
            id: tx.id,
            gateway: 'fastdepix',
            status: tx.status, // Pass raw status (e.g. PAID, SETTLED, CONFIRMED)
            price: tx.amount,
            pix_code: tx.qr_code_text,
            pixCode: tx.qr_code_text,
            qrCode: tx.qr_code_text,
            pix_url: tx.qr_code || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(tx.qr_code_text)}`
        };
    } else {
        if (response.status === 404) return null;
        try {
            const err = await response.json();
            // Critical Fix: FastDePix returns 400/500 with this message for Not Found
            if (err && err.message === 'Endpoint não encontrado') return null;

            console.error('[FASTDEPIX] GET Error:', err);
            throw new Error(err.message || `FastDePix Error ${response.status}`);
        } catch (e) {
            if (e.message === 'Endpoint não encontrado') return null;
            throw new Error(`FastDePix Error ${response.status}`);
        }
    }
}

// Helper to fetch from Ciabra
async function fetchFromCiabra(invoiceId) {
    console.log(`[PROXY] Fetching Ciabra: ${invoiceId}`);
    const response = await fetch(`${CIABRA_API}/invoices/applications/invoices/${invoiceId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${AUTH_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });

    if (response.ok) {
        const data = await response.json();
        data.gateway = 'ciabra';
        return data;
    } else {
        if (response.status === 404) return null;
        throw new Error(`Ciabra Error ${response.status}`);
    }
}

app.get('/api/invoices/:id', async (req, res) => {
    const config = loadConfig();
    const activeGateway = config.gateway;
    const invoiceId = req.params.id;
    console.log(`[PROXY] GET INVOICE ENTRY: ID=${invoiceId} ActiveGateway=${activeGateway}`);

    try {
        let data = null;

        // 1. Try Active Gateway First
        if (activeGateway === 'fastdepix') {
            try { data = await fetchFromFastDePix(invoiceId); } catch (e) { console.error("FastDePix Active Search Err:", e.message); }
        } else {
            try { data = await fetchFromCiabra(invoiceId); } catch (e) { console.error("Ciabra Active Search Err:", e.message); }
        }

        // 2. If Not Found, Try Other Gateway (Smart Fallback)
        if (!data) {
            console.log(`[PROXY] Invoice not found in active gateway (${activeGateway}). Trying backup...`);
            const fallbackGateway = activeGateway === 'fastdepix' ? 'ciabra' : 'fastdepix';

            if (fallbackGateway === 'fastdepix') {
                try { data = await fetchFromFastDePix(invoiceId); } catch (e) { console.error("FastDePix Backup Search Err:", e.message); }
            } else {
                try { data = await fetchFromCiabra(invoiceId); } catch (e) { console.error("Ciabra Backup Search Err:", e.message); }
            }
        }

        if (data) {
            res.json(data);
        } else {
            res.status(404).json({ error: "Invoice not found in any gateway" });
        }

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Proxy para pagamentos de parcela
app.get('/api/installments/:installmentId/payments', async (req, res) => {
    try {
        const installmentId = req.params.installmentId;

        const response = await fetch(`${CIABRA_API}/payments/applications/installments/${installmentId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${AUTH_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        console.log(`[PROXY] GET /api/installments/${installmentId}/payments ->`, JSON.stringify(data, null, 2));
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Servir checkout.html na raiz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'checkout.html'));
});

// Servir settings.html
app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'settings.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Servidor Ciabra PIX rodando!`);
    console.log(`📍 URL interna: http://0.0.0.0:${PORT}`);
    console.log(`🔄 Proxy configurado para: ${CIABRA_API}`);
    console.log(`\n✅ Acesse pelo domínio\n`);
});
