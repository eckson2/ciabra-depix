# Ciabra & FastDePix Gateway - Proxy Server v2.3

Sistema de pagamentos híbrido que integra **Ciabra Invoice** e **FastDePix** para geração de PIX dinâmico com suporte a transações de alto valor (VIP).

## 🚀 Novidades da v2.3
- **FastDePix Nativo**: Integração direta via API oficial.
- **Modo VIP Automático**: Transações > R$ 500 detectadas automaticamente e processadas via rota VIP (sem scraping).
- **Persistência de Configuração**: O gateway escolhido em `/settings` é salvo em `config.json` e sobrevive a reinicializações.
- **Gerador de Comprovantes**: Geração local de PDFs/HTML com fuso horário corrigido (Brasília).

---

## 📁 Estrutura do Projeto

```
ciabra-pix/
├── proxy-server.js # Backend Node.js (Core Logic)
├── checkout.html   # Página de Pagamento
├── settings.html   # Painel de Controle (Troca de Gateway)
├── success.html    # Tela de Sucesso (QR Code)
├── config.json     # (Gerado) Armazena gateway ativo
└── receipts/       # (Gerado) Armazena comprovantes temporários
```

## ⚙️ Configuração e Instalação

### 1. Pré-requisitos
- Node.js v14+ (Recomendado v18 LTS)
- Docker (Opcional, para deploy em swarm)

### 2. Rodando Localmente
```bash
npm install
node proxy-server.js
```
Acesse: `http://localhost:3000`

### 3. Deploy com Docker Swarm (Produção)
```bash
# Atualizar código
git pull origin main

# Rebuild e Update do Serviço
docker build -t ciabratop_ciabratop-pix .
docker service update --force ciabratop_ciabratop-pix
```

---

## 💳 Gateways Suportados

### 1. FastDePix (Padrão)
Otimizado para alta performance e anonimato.
- **Modo Normal (< R$ 500)**: Transação padrão anônima.
- **Modo VIP (> R$ 500)**: Ativa automaticamente a flag `vip: true`. Gera dados de cliente aleatórios válidos (Nome Brasileiro + CPF válido) para aprovação imediata.

### 2. Ciabra (Secundário)
Gateway robusto para redundância ou uso específico.
- **Ativação**: Pode ser ativado manualmente via painel `/settings`.

---

## 🔧 Painel de Controle

Acesse `/settings` para:
1. **Alternar Gateway**: Escolha entre FastDePix e Ciabra em tempo real.
2. **Testar Comprovantes**: Gere comprovantes de teste para validação visual.
3. **Verificar Status**: Veja qual gateway está ativo no servidor.

> **Nota:** A configuração salva em `/settings` é persistente. Se você mudar para Ciabra, ele **continuará** Ciabra mesmo após reiniciar o container, até que seja alterado novamente.

## 📝 Comprovantes
- URLs geradas em `/receipts/R{timestamp}.html`
- Limpeza automática de arquivos com mais de 24 horas.
- Fuso horário forçado para `America/Sao_Paulo`.

---

## 🔒 Segurança Setup
As chaves de API estão configuradas no `proxy-server.js`.
- **FastDePix**: Bearer Token
- **Ciabra**: Basic Auth (Public + Secret Key)

## 🌐 Endpoints Principais
- `POST /api/invoices`: Cria transação (escolhe gateway via config).
- `GET /api/invoices/:id`: Busca status da transação (busca inteligente no gateway ativo + fallback).
- `POST /api/settings`: Alterna gateway ativo.
- `POST /api/generate-receipt`: Gera comprovante estático.

---
*Desenvolvido para alta disponibilidade e conversão.*
