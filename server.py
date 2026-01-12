#!/usr/bin/env python3
"""
Servidor HTTP simples para o Ciabra PIX
Execute: python3 server.py
Acesse: http://localhost:8000
"""

import http.server
import socketserver

PORT = 8000

Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"🚀 Servidor rodando em http://localhost:{PORT}")
    print(f"📁 Servindo arquivos de: {__file__.replace('server.py', '')}")
    print("\nPressione Ctrl+C para parar o servidor\n")
    httpd.serve_forever()
