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
    return { gateway: 'fastdepix' }; // Default is now FastDePix
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
    return cpf.join('');
}

function generateRandomCNPJ() {
    const randomDigit = () => Math.floor(Math.random() * 10);
    const cnpj = Array.from({ length: 8 }, randomDigit); // Root
    // 0001
    cnpj.push(0, 0, 0, 1);

    // Check digits
    const calculateDigit = (arr, weights) => {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) {
            sum += arr[i] * weights[i];
        }
        const remainder = sum % 11;
        return remainder < 2 ? 0 : 11 - remainder;
    };

    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    cnpj.push(calculateDigit(cnpj, w1));
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    cnpj.push(calculateDigit(cnpj, w2));

    return cnpj.join('');
}

function generateRandomUser() {
    const suffix = Math.floor(Math.random() * 10000);
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);

    // Use Company to try and get higher limits (> 500)
    return {
        name: `Usuario ${timestamp}_${suffix}`,
        cpf_cnpj: generateRandomCNPJ(),
        email: `corp${timestamp}${suffix}@anonymous.com`,
        phone: "11999999999",
        user_type: "company",
        company_name: `Empresa ${timestamp}_${suffix} LTDA`
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
            // Strategy: Use Company User (No Custom Page ID to avoid DB errors)

            const randomUser = generateRandomUser();

            const payload = {
                amount: body.price,
                custom_page_id: null,
                user: {
                    name: randomUser.name,
                    cpf_cnpj: randomUser.cpf_cnpj, // CNPJ
                    email: randomUser.email,
                    user_type: "company", // Try company for higher limits
                    company_name: randomUser.company_name
                }
            };

            console.log(`[FASTDEPIX] Sending Transaction (User: ${randomUser.cpf_cnpj})`);

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

            // Normalize response to match Frontend expectations
            const tx = data.data || data;

            // QR Code URL generator fallback
            const qrCodeUrl = tx.qr_code || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(tx.qr_code_text)}`;

            return res.status(201).json({
                id: tx.id,
                gateway: 'fastdepix',
                pix_code: tx.qr_code_text,
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

// --- Gerador de Comprovante (Server Side) ---
const RECEIPTS_DIR = path.join(__dirname, 'receipts');

// Ensure directory exists (Safe Init)
try {
    if (!fs.existsSync(RECEIPTS_DIR)) {
        fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
        console.log(`[INIT] Created receipts directory: ${RECEIPTS_DIR}`);
    }
} catch (e) {
    console.error(`[INIT] Failed to create receipts directory: ${e.message}`);
}

// Cleanup Routine: Delete receipts older than 24 hours
setInterval(() => {
    console.log('[CLEANUP] Scanning for old receipts...');
    fs.readdir(RECEIPTS_DIR, (err, files) => {
        if (err) return console.error("[CLEANUP] Scan failed:", err);

        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;

        files.forEach(file => {
            if (!file.endsWith('.html')) return; // Safety check

            const filePath = path.join(RECEIPTS_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > ONE_DAY) {
                    fs.unlink(filePath, err => {
                        if (!err) console.log(`[CLEANUP] Deleted old receipt: ${file}`);
                    });
                }
            });
        });
    });
}, 60 * 60 * 1000); // Run every 1 hour

app.post('/api/generate-receipt', (req, res) => {
    try {
        const data = req.body;
        const id = 'R' + Date.now() + Math.floor(Math.random() * 1000);
        const filename = `${id}.html`;
        const filePath = path.join(RECEIPTS_DIR, filename);

        // Basic HTML Template for Receipt
        const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Comprovante ${id}</title>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Roboto', sans-serif; background: #f0f2f5; display: flex; justify-content: center; padding: 40px 20px; }
        .receipt-card { background: white; width: 100%; max-width: 600px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: hidden; }
        .header { background: #1976D2; color: white; padding: 30px; text-align: center; }
        .header h2 { margin: 0; font-size: 22px; font-weight: 500; }
        .header .date { font-size: 13px; opacity: 0.9; margin-top: 5px; }
        .body { padding: 30px; }
        .amount-box { background: #F3F8FC; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 30px; }
        .amount-box .label { font-size: 13px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
        .amount-box .value { font-size: 36px; color: #00C853; font-weight: 700; margin-top: 5px; }
        
        .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee; font-size: 14px; }
        .row .label { color: #555; font-weight: 500; }
        .row .val { color: #333; font-weight: 600; text-align: right; }
        
        .section-title { background: #f9fafb; padding: 8px 10px; font-size: 12px; font-weight: 700; color: #555; text-transform: uppercase; margin: 25px -30px 10px; padding-left: 30px; border-left: 4px solid #1976D2; }
        
        .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; border-top: 1px dashed #ddd; padding-top: 20px; }
        
        .actions { margin-top: 30px; text-align: center; }
        .btn { display: inline-block; padding: 12px 24px; background: #1976D2; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; transition: 0.2s; cursor: pointer; border: none; font-size: 14px; }
        .btn:hover { background: #1565C0; }
        .btn.secondary { background: #fff; color: #555; border: 1px solid #ddd; margin-right: 10px; }
        .btn.secondary:hover { background: #f5f5f5; }

        @media print {
            body { background: white; padding: 0; }
            .receipt-card { box-shadow: none; max-width: 100%; border-radius: 0; }
            .actions { display: none; }
        }
    </style>
</head>
<body>
    <div class="receipt-card">
        <div class="header">
            <h2>Comprovante de Transferência</h2>
            <div class="date">${new Date().toLocaleString('pt-BR')}</div>
        </div>
        <div class="body">
            <div class="amount-box">
                <div class="label">Valor da Transferência</div>
                <div class="value">R$ ${data.amount}</div>
            </div>

            <div class="row">
                <div class="label">Tipo de Pagamento</div>
                <div class="val">PIX</div>
            </div>
            <div class="row">
                <div class="label">ID da Transação</div>
                <div class="val">E${Date.now()}893202601060022</div>
            </div>

            <!-- ORIGEM -->
            <div class="section-title">Dados de Origem</div>
            <div class="row"><div class="label">Nome</div><div class="val">${data.orig_name}</div></div>
            <div class="row"><div class="label">CPF/CNPJ</div><div class="val">${data.orig_doc}</div></div>
            <div class="row"><div class="label">Instituição</div><div class="val">${data.orig_bank}</div></div>

            <!-- DESTINO -->
            <div class="section-title">Dados de Destino</div>
            <div class="row"><div class="label">Nome</div><div class="val">${data.dest_name}</div></div>
            <div class="row"><div class="label">CPF/CNPJ</div><div class="val">${data.dest_doc}</div></div>
            <div class="row"><div class="label">Instituição</div><div class="val">${data.dest_bank}</div></div>
            <div class="row"><div class="label">Chave PIX</div><div class="val">${data.dest_key}</div></div>

            <div class="footer">
                Este comprovante possui valor legal e atesta a realização da transferência acima.<br>
                Autenticação: ${Math.random().toString(36).substring(2, 15).toUpperCase()}
            </div>

            <div class="actions">
                <button onclick="window.print()" class="btn secondary">🖨️ Imprimir / Salvar PDF</button>
                <a href="${data.checkout_url || '#'}" class="btn">Realizar Nova Transferência</a>
            </div>
        </div>
    </div>
</body>
</html>
        `;

        fs.writeFileSync(filePath, html);

        console.log(`[RECEIPT] Generated: ${filename}`);
        res.json({ success: true, url: `/receipts/${filename}` });

    } catch (e) {
        console.error("Receipt Gen Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Servidor Ciabra PIX Rodando! (v2.1 - RECEIPTS ENABLED)`);
    console.log(`📍 URL interna: http://0.0.0.0:${PORT}`);
    console.log(`🔄 Proxy configurado para: ${CIABRA_API}`);
    console.log(`\n✅ Acesse pelo domínio\n`);
});
