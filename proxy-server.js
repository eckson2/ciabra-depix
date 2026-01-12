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

// Proxy para criar cobrança (Híbrido)
app.post('/api/invoices', async (req, res) => {
    const config = loadConfig();
    const gateway = config.gateway;
    const body = req.body;

    console.log(`[CHECKOUT] Iniciando transação via ${gateway.toUpperCase()} - Valor: ${body.price}`);

    try {
        if (gateway === 'fastdepix') {
            // --- FASTDEPIX IMPLEMENTATION ---
            const payload = {
                amount: body.price,
                custom_page_id: null
                // user: ... (Optional for < 500)
            };

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
app.get('/api/invoices/:id', async (req, res) => {
    const config = loadConfig();
    const gateway = config.gateway;
    const invoiceId = req.params.id;

    try {
        // We could store gateway in transaction ID (e.g. "FD-...") or just query current.
        // Or query both!
        // For simplicity: Query Active Gateway FIRST. If 404, try others?
        // Or just let the user setting dictate (Admin responsibility).

        let data = null;
        let responseStatus = 404;

        if (gateway === 'fastdepix') {
            // Fetch from FastDePix
            const url = `${FASTDEPIX_API}/transactions/${invoiceId}`;
            console.log(`[PROXY] Fetching FastDePix: ${url}`);

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${FASTDEPIX_KEY}` }
            });
            responseStatus = response.status;

            if (response.ok) {
                const json = await response.json();
                const tx = json.data || json;

                // Normalization for Success.html (CamelCase pixCode is required!)
                data = {
                    id: tx.id,
                    status: tx.status === 'PAID' ? 'PAID' : 'PENDING',
                    price: tx.amount,
                    // Both snake and camelCase to be safe
                    pix_code: tx.qr_code_text,
                    pixCode: tx.qr_code_text,
                    qrCode: tx.qr_code_text,
                    pix_url: tx.qr_code || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(tx.qr_code_text)}`
                };
            } else {
                try {
                    const errJson = await response.json();
                    console.error('[FASTDEPIX] GET Error:', errJson);
                    data = { error: errJson }; // Pass upstream error
                } catch (e) {
                    data = { error: "Upstream error" };
                }
            }

        } else {
            // Fetch from Ciabra (Existing logic)
            // ...
            const response = await fetch(`${CIABRA_API}/invoices/applications/invoices/${invoiceId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${AUTH_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
            data = await response.json();
            responseStatus = response.status;
        }

        // Console log for debugging
        // console.log(`[PROXY] GET /api/invoices/${invoiceId} (${gateway}) ->`, responseStatus);

        if (data) res.status(responseStatus).json(data);
        else res.status(404).json({ error: "Not found" });

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
