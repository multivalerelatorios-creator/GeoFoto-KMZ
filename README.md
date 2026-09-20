# GEOFOTO KMZ

Aplicativo de campo para captura de fotos georreferenciadas com GPS, mapa e exportação KML/KMZ.

## Arquitetura
- Cloudflare Worker: aplicação e API
- Cloudflare D1: registros e metadados
- Cloudflare R2: armazenamento das fotos
- Vite: interface web

## Segurança
As senhas e tokens de produção não ficam neste repositório. Eles são armazenados como Cloudflare Secrets.

## Desenvolvimento
```bash
npm install
npm run dev
```

## Publicação
```bash
npm run build
npx wrangler deploy
```

Endereço de produção:
https://geofoto-kmz.geofotokmz.workers.dev
