# Ciabra PIX - Sistema de Pagamentos

Site simples em HTML para gerar pagamentos PIX usando a API do Ciabra Invoice.

## 📁 Estrutura do Projeto

```
ciabra-pix/
├── index.html      # Página de login
├── setup.html      # Configuração de credenciais API
├── checkout.html   # Geração de PIX
├── success.html    # Exibição do QR Code e código PIX
└── styles.css      # Estilos
```

## 🚀 Como Usar

### 1. Inicie o servidor local

**⚠️ IMPORTANTE**: Não abra o arquivo diretamente! Use um servidor HTTP local para evitar erros de CORS.

**Opção 1 - Python (recomendado)**:
```bash
python3 server.py
```

**Opção 2 - Node.js**:
```bash
node server.js
```

**Opção 3 - Python direto**:
```bash
python3 -m http.server 8000
```

Depois acesse: **http://localhost:8000**

### 2. Faça Login
- Digite qualquer usuário e senha (é apenas uma tela simples de autenticação)

### 3. Configure as Credenciais
- **Chave Pública**: Sua chave pública do Ciabra
- **Chave Secreta**: Sua chave secreta do Ciabra

As credenciais serão validadas automaticamente com a API do Ciabra.

### 4. Gere um PIX
- Informe o valor desejado
- Adicione uma descrição (opcional)
- Clique em "Gerar PIX"

### 5. Visualize o QR Code
- Escaneie o QR Code ou copie o código PIX
- Use no app do seu banco para efetuar o pagamento

## 🔑 Obtendo as Credenciais

1. Acesse [Ciabra Invoice](https://plataforma.ciabra.com.br)
2. Faça login na sua conta
3. Vá em "Perfil do Usuário" → "Integração"
4. Copie a Chave Pública e Chave Secreta

## 📋 Pré-requisitos

- Conta validada no Ciabra Invoice
- Chaves de API (Pública e Secreta)

## 🔒 Segurança

**IMPORTANTE**: Este é um exemplo simples para demonstração. Em produção:

- ⚠️ NÃO armazene credenciais no localStorage
- ⚠️ Use um backend para fazer as chamadas à API
- ⚠️ Implemente autenticação real com JWT ou similar
- ⚠️ Use HTTPS sempre

## 🌐 API Utilizada

**Base URL**: `https://api.az.center`

**Endpoints**:
- `GET /auth/applications/check` - Validação de credenciais
- `POST /invoices/applications/customers` - Criação de cliente (automático)
- `POST /invoices/applications/invoices` - Criação de cobrança
- `GET /invoices/applications/invoices/:id` - Detalhes da cobrança

## 📖 Documentação Completa

Acesse a documentação oficial: [https://docs.ciabra.com.br](https://docs.ciabra.com.br)

## 🎨 Recursos

- ✅ Interface limpa e responsiva
- ✅ Validação de credenciais em tempo real
- ✅ Criação automática de cliente
- ✅ Geração de QR Code automática
- ✅ Botão de copiar código PIX
- ✅ Tratamento de erros
- ✅ Estados de loading

## 🛠️ Tecnologias

- HTML5
- CSS3
- JavaScript (Vanilla)
- QRCode.js (biblioteca externa para gerar QR Code)
