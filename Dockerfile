# Usa Node.js LTS slim
FROM node:18-slim

# Imposta la cartella di lavoro
WORKDIR /app

# Copia solo i file package.json e package-lock.json prima per sfruttare la cache
COPY package*.json ./

# Installa le dipendenze in modalità produzione
RUN npm install --production

# Copia tutto il resto del progetto
COPY . .

# Espone la porta definita da Cloud Run
EXPOSE 8080

# Comando di avvio
CMD ["node", "index.js"]
