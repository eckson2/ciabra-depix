# Usar imagem oficial do Node.js
FROM node:18-slim

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm install --production

# Copiar todos os arquivos do projeto
COPY . .

# Expor a porta que o servidor vai rodar
EXPOSE 3000

# Comando para iniciar o servidor
CMD ["node", "proxy-server.js"]
